#include "activity.h"

#include "appdb_scan.h"

#include <ctype.h>
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <time.h>
#include <unistd.h>

#include <ps5/kernel.h>

#define MAX_TITLES 512
#define TITLE_ID_LEN 16
#define ACTIVITY_FILE "/data/ps5upload/activity.json"
#define ACTIVITY_DIR "/data/ps5upload"
#define POLL_INTERVAL_SEC 30
#define LAUNCH_DEBOUNCE_SEC 5

/* sysctl KERN_PROC kinfo layout offsets (same as cheats.c) */
#define KINFO_STRUCT_MINSIZE 448
#define KINFO_PID_OFFSET     72

/* Canonical layout + title-id helpers. The previous local copy put
 * title_id at offset 64, so play-time tracking never saw a game. */
#include "app_info.h"

typedef struct {
    char     title_id[TITLE_ID_LEN];
    uint64_t launches;
    uint64_t total_seconds;
    int64_t  last_launch_ts;
    int64_t  last_seen_ts;
    int64_t  session_started_ts;
} entry_t;

static entry_t g_entries[MAX_TITLES];
static int g_count;
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static atomic_int g_watcher_running;
static time_t g_last_save;

static int64_t now_ts(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (int64_t)ts.tv_sec;
}

static entry_t *find_entry(const char *title_id) {
    for (int i = 0; i < g_count; i++) {
        if (strcasecmp(g_entries[i].title_id, title_id) == 0)
            return &g_entries[i];
    }
    return NULL;
}

static entry_t *find_or_create(const char *title_id) {
    entry_t *e = find_entry(title_id);
    if (e) return e;
    if (g_count >= MAX_TITLES) return NULL;
    e = &g_entries[g_count++];
    memset(e, 0, sizeof(*e));
    strncpy(e->title_id, title_id, TITLE_ID_LEN - 1);
    return e;
}

static void json_escape(const char *in, char *out, size_t cap) {
    size_t o = 0;
    for (const char *s = in; *s && o + 2 < cap; s++) {
        if (*s == '"' || *s == '\\') { out[o++] = '\\'; out[o++] = *s; }
        else if (*s == '\n') { out[o++] = '\\'; out[o++] = 'n'; }
        else if ((unsigned char)*s >= 0x20) out[o++] = *s;
    }
    out[o] = '\0';
}

static void load_state(void) {
    FILE *f = fopen(ACTIVITY_FILE, "r");
    if (!f) return;
    char buf[65536];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = '\0';

    const char *p = buf;
    while (p && *p) {
        const char *tid_start = strchr(p, '"');
        if (!tid_start) break;
        tid_start++;
        const char *tid_end = strchr(tid_start, '"');
        if (!tid_end) break;

        char tid[TITLE_ID_LEN] = "";
        size_t tlen = (size_t)(tid_end - tid_start);
        if (tlen >= TITLE_ID_LEN) tlen = TITLE_ID_LEN - 1;
        memcpy(tid, tid_start, tlen);
        tid[tlen] = '\0';

        if (strlen(tid) < 4) { p = tid_end + 1; continue; }

        entry_t *e = find_or_create(tid);
        if (!e) { p = tid_end + 1; continue; }

        const char *obj_end = strchr(tid_end, '}');
        if (!obj_end) break;

        const char *q;
        if ((q = strstr(tid_end, "\"launches\":"))) {
            e->launches = strtoull(q + 11, NULL, 10);
        }
        if ((q = strstr(tid_end, "\"totalSeconds\":"))) {
            e->total_seconds = strtoull(q + 15, NULL, 10);
        }
        if ((q = strstr(tid_end, "\"lastLaunchTs\":"))) {
            e->last_launch_ts = (int64_t)strtoll(q + 15, NULL, 10);
        }
        if ((q = strstr(tid_end, "\"lastSeenTs\":"))) {
            e->last_seen_ts = (int64_t)strtoll(q + 13, NULL, 10);
        }
        if ((q = strstr(tid_end, "\"sessionStartedTs\":"))) {
            e->session_started_ts = (int64_t)strtoll(q + 19, NULL, 10);
        }

        p = obj_end + 1;
    }

    if (g_count > 0) {
        pthread_mutex_lock(&g_lock);
        for (int i = 0; i < g_count; i++) {
            if (g_entries[i].session_started_ts > 0 &&
                g_entries[i].last_seen_ts > g_entries[i].session_started_ts) {
                g_entries[i].total_seconds +=
                    (uint64_t)(g_entries[i].last_seen_ts -
                               g_entries[i].session_started_ts);
                g_entries[i].session_started_ts = 0;
            }
        }
        pthread_mutex_unlock(&g_lock);
    }
}

static void save_state(void) {
    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s.tmp", ACTIVITY_FILE);
    FILE *f = fopen(tmp, "w");
    if (!f) return;

    fprintf(f, "{");
    int first = 1;
    for (int i = 0; i < g_count; i++) {
        entry_t *e = &g_entries[i];
        if (e->launches == 0 && e->total_seconds == 0 &&
            e->session_started_ts == 0) {
            continue;
        }
        char esc_tid[32];
        json_escape(e->title_id, esc_tid, sizeof(esc_tid));
        if (!first) fprintf(f, ",");
        fprintf(f, "\"%s\":{\"launches\":%llu,\"totalSeconds\":%llu,"
                   "\"lastLaunchTs\":%lld,\"lastSeenTs\":%lld,"
                   "\"sessionStartedTs\":%lld}",
                esc_tid,
                (unsigned long long)e->launches,
                (unsigned long long)e->total_seconds,
                (long long)e->last_launch_ts,
                (long long)e->last_seen_ts,
                (long long)e->session_started_ts);
        first = 0;
    }
    fprintf(f, "}");

    /* Atomic replace, done properly.
     *
     * fprintf() buffers, so a full disk or an I/O error does not
     * surface until the stream is flushed. Renaming without checking
     * would publish a truncated file over the good one and lose every
     * play-time total we had -- and a console low on space is exactly
     * when this fires. ferror() catches the buffered write failures,
     * fsync() gets the bytes down before the rename makes them
     * visible, and any failure leaves the previous file untouched.
     *
     * notif.c, cheats.c and the ownership writer in runtime.c all do
     * this; this function was the one that did not. */
    int failed = ferror(f) != 0;
    if (!failed) {
        int fd = fileno(f);
        if (fd >= 0) (void)fsync(fd);
    }
    if (fclose(f) != 0) failed = 1;
    if (failed) {
        (void)unlink(tmp);
        return;
    }
    (void)rename(tmp, ACTIVITY_FILE);
}

/* Adopt a game that was already running when we started watching.
 *
 * Counting it as a launch would be a guess, and a wrong one: reloading
 * the helper mid-session made "times played" climb every time, so the
 * number drifted upward with no relation to how often the game was
 * actually started. We only count launches we witnessed.
 *
 * The session clock starts now rather than at the real launch, because
 * we genuinely do not know when that was -- better to under-count the
 * current session than to invent time the user may not have played. */
static void record_resume(const char *title_id) {
    pthread_mutex_lock(&g_lock);
    entry_t *e = find_or_create(title_id);
    if (!e) { pthread_mutex_unlock(&g_lock); return; }
    int64_t now = now_ts();
    /* A session left open by an unclean shutdown is closed out first,
     * so its time is banked rather than double-counted from `now`. */
    if (e->session_started_ts > 0 && e->last_seen_ts > e->session_started_ts) {
        e->total_seconds += (uint64_t)(e->last_seen_ts - e->session_started_ts);
    }
    e->session_started_ts = now;
    e->last_seen_ts = now;
    pthread_mutex_unlock(&g_lock);
}

static void record_launch(const char *title_id) {
    pthread_mutex_lock(&g_lock);
    entry_t *e = find_or_create(title_id);
    if (!e) { pthread_mutex_unlock(&g_lock); return; }

    int64_t now = now_ts();
    if (e->session_started_ts > 0) {
        if (now - e->last_launch_ts < LAUNCH_DEBOUNCE_SEC) {
            e->last_seen_ts = now;
            pthread_mutex_unlock(&g_lock);
            return;
        }
        e->total_seconds += (uint64_t)(e->last_seen_ts - e->session_started_ts);
        e->session_started_ts = 0;
    }

    e->launches++;
    e->session_started_ts = now;
    e->last_launch_ts = now;
    e->last_seen_ts = now;
    pthread_mutex_unlock(&g_lock);
}

static void record_exit(const char *title_id) {
    pthread_mutex_lock(&g_lock);
    entry_t *e = find_entry(title_id);
    if (!e || e->session_started_ts == 0) {
        pthread_mutex_unlock(&g_lock);
        return;
    }
    int64_t now = now_ts();
    e->total_seconds += (uint64_t)(now - e->session_started_ts);
    e->session_started_ts = 0;
    e->last_seen_ts = now;
    pthread_mutex_unlock(&g_lock);
}

static int find_running_title(char *title_out, size_t cap) {
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PROC, 0};
    size_t buf_size = 0;
    if (sysctl(mib, 4, NULL, &buf_size, NULL, 0) != 0 || buf_size == 0)
        return 0;

    uint8_t *buf = malloc(buf_size);
    if (!buf) return 0;
    if (sysctl(mib, 4, buf, &buf_size, NULL, 0) != 0) {
        free(buf);
        return 0;
    }

    int found = 0;
    for (uint8_t *ptr = buf; ptr < buf + buf_size && !found; ) {
        int ki_structsize = *(int *)ptr;
        if (ki_structsize < KINFO_STRUCT_MINSIZE ||
            (size_t)(ptr - buf) + (size_t)ki_structsize > buf_size) break;
        pid_t pid = *(pid_t *)&ptr[KINFO_PID_OFFSET];
        app_info_t info;
        memset(&info, 0, sizeof(info));
        char tid[10];
        /* app_info_title_id validates the shape before handing it over,
         * so a struct-layout mistake yields "no game running" rather
         * than a garbage title id recorded as play time. */
        if (sceKernelGetAppInfo(pid, &info) == 0 &&
            app_info_title_id(&info, tid, sizeof(tid)) &&
            strncmp(tid, "NPXS", 4) != 0) {
            snprintf(title_out, cap, "%s", tid);
            found = 1;
        }
        ptr += ki_structsize;
    }
    free(buf);
    return found;
}

static char g_current_title[TITLE_ID_LEN];
static pid_t g_current_pid;

/* Cleared once the first poll has run. Until then we cannot tell a
 * game that just launched from one that was already playing. */
static int g_first_poll = 1;

static void detect_and_track(void) {
    char title[TITLE_ID_LEN] = "";

    if (!find_running_title(title, sizeof(title))) {
        /* No game running */
        if (g_current_pid > 0) {
            record_exit(g_current_title);
            g_current_pid = 0;
            g_current_title[0] = '\0';
        }
        return;
    }

    if (g_current_title[0] && strcmp(title, g_current_title) == 0) {
        /* Same game still running — update last_seen */
        pthread_mutex_lock(&g_lock);
        entry_t *e = find_entry(g_current_title);
        if (e) e->last_seen_ts = now_ts();
        pthread_mutex_unlock(&g_lock);
        return;
    }

    /* Different game started */
    if (g_current_pid > 0 && g_current_title[0]) {
        record_exit(g_current_title);
    }

    strncpy(g_current_title, title, TITLE_ID_LEN - 1);
    g_current_title[TITLE_ID_LEN - 1] = '\0';
    g_current_pid = 1; /* marker: a game is running */

    if (g_first_poll) {
        /* Already running when we arrived: resume, do not count it. */
        record_resume(title);
    } else {
        record_launch(title);
    }
}

static void *watcher_thread(void *arg) {
    (void)arg;
    for (;;) {
        sleep(POLL_INTERVAL_SEC);
        detect_and_track();
        /* After one full poll we have a baseline, so anything new
         * from here really is a launch we witnessed. */
        g_first_poll = 0;

        time_t now = time(NULL);
        if (now - g_last_save > 60) {
            pthread_mutex_lock(&g_lock);
            save_state();
            pthread_mutex_unlock(&g_lock);
            g_last_save = now;
        }
    }
    return NULL;
}

/* Flush tracked play time to disk.
 *
 * The watcher only saves every 60s, and a payload swap or shutdown in
 * between silently loses the current session. Called from the shutdown
 * path so an orderly exit keeps what it counted. */
/* Discard all recorded play time.
 *
 * Clears the in-memory table, the in-flight session and the on-disk
 * file in one locked step, so a reset cannot be partially applied and
 * the watcher cannot re-save the old totals underneath it. The current
 * session is dropped too -- resetting and then having the game you are
 * playing immediately re-appear with its old total would not read as a
 * reset.
 *
 * Returns how many titles were removed. */
int activity_reset(void) {
    pthread_mutex_lock(&g_lock);
    int removed = g_count;
    memset(g_entries, 0, sizeof(g_entries));
    g_count = 0;
    g_current_title[0] = '\0';
    save_state();
    pthread_mutex_unlock(&g_lock);
    return removed;
}

void activity_flush(void) {
    pthread_mutex_lock(&g_lock);
    /* Close out the in-flight session first, or the time between the last
     * poll and shutdown is dropped. */
    if (g_current_title[0]) {
        entry_t *e = find_entry(g_current_title);
        if (e && e->session_started_ts > 0) {
            int64_t now = now_ts();
            if (now > e->last_seen_ts) e->last_seen_ts = now;
        }
    }
    save_state();
    pthread_mutex_unlock(&g_lock);
}

void activity_init(void) {
    mkdir(ACTIVITY_DIR, 0755);
    load_state();

    int expected = 0;
    if (atomic_compare_exchange_strong(&g_watcher_running, &expected, 1)) {
        pthread_t thr;
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        if (pthread_create(&thr, &attr, watcher_thread, NULL) != 0) {
            atomic_store(&g_watcher_running, 0);
        }
        pthread_attr_destroy(&attr);
    }
}

int activity_get_json(char *buf, size_t cap, size_t *written) {
    pthread_mutex_lock(&g_lock);

    int64_t now = now_ts();
    /* The game running right now, so a client can say "playing now"
     * without inferring it. The field was in the client's contract but
     * never emitted here, so it always read as empty and the UI could
     * not tell a live session from a finished one. */
    char cur_esc[32];
    json_escape(g_current_title, cur_esc, sizeof(cur_esc));
    int n = snprintf(buf, cap,
                     "{\"now_ts\":%lld,\"current_title\":\"%s\",\"titles\":[",
                     (long long)now, cur_esc);
    if (n < 0 || (size_t)n >= cap) { pthread_mutex_unlock(&g_lock); return -1; }

    int first = 1;
    for (int i = 0; i < g_count; i++) {
        entry_t *e = &g_entries[i];
        /* Skip entries with nothing to report — but never skip one with
         * a session open right now.
         *
         * A game adopted at startup (running before we began watching)
         * has no launches and no banked seconds yet, because both are
         * only written when a session ends. Filtering on the stored
         * values alone hid the game the user was actually playing: it
         * appeared as current_title with no row to show for it. */
        if (e->launches == 0 && e->total_seconds == 0 &&
            e->session_started_ts == 0) {
            continue;
        }

        char esc[32];
        json_escape(e->title_id, esc, sizeof(esc));

        uint64_t live_total = e->total_seconds;
        int active = 0;
        if (e->session_started_ts > 0) {
            live_total += (uint64_t)(now - e->session_started_ts);
            active = 1;
        }

        const char *sep = first ? "" : ",";
        first = 0;

        int more = snprintf(buf + n, cap - (size_t)n,
                "%s{\"title_id\":\"%s\",\"launches\":%llu,"
                "\"total_seconds\":%llu,\"last_played\":%lld,"
                "\"active\":%s}",
                sep, esc,
                (unsigned long long)e->launches,
                (unsigned long long)live_total,
                (long long)e->last_launch_ts,
                active ? "true" : "false");
        if (more < 0 || (size_t)(n + more) >= cap) break;
        n += more;
    }

    int end = snprintf(buf + n, cap - (size_t)n, "]}");
    if (end < 0 || (size_t)(n + end) >= cap) {
        pthread_mutex_unlock(&g_lock);
        return -1;
    }
    n += end;

    if (written) *written = (size_t)n;
    pthread_mutex_unlock(&g_lock);
    return 0;
}

typedef struct sqlite3 sqlite3;
typedef struct sqlite3_stmt sqlite3_stmt;
typedef int (*adb_open_fn)(const char *, sqlite3 **, int, const char *);
typedef int (*adb_close_fn)(sqlite3 *);
typedef int (*adb_busy_fn)(sqlite3 *, int);
typedef int (*adb_prepare_fn)(sqlite3 *, const char *, int, sqlite3_stmt **, const char **);
typedef int (*adb_step_fn)(sqlite3_stmt *);
typedef int (*adb_finalize_fn)(sqlite3_stmt *);
typedef const unsigned char *(*adb_text_fn)(sqlite3_stmt *, int);

#define ADB_READONLY 1
#define ADB_ROW 100

/* Emit a one-line JSON error body. The caller returns 0 either way — an
 * empty result with a reason is a valid answer, not a transport failure. */
static int db_query_err(char *buf, size_t cap, size_t *written,
                        const char *reason) {
    int n = snprintf(buf, cap, "{\"rows\":[],\"source\":\"none\",\"error\":\"%s\"}",
                     reason);
    if (written) *written = (size_t)(n > 0 ? n : 0);
    return 0;
}

/* "Recently played" without sqlite.
 *
 * The console ships no libSceSqlite.sprx under any lib path and the
 * payload links none, so the dlsym probe below never resolves — on every
 * firmware, not just some. This is therefore the path that actually
 * serves this query. Shares appdb_scan_entries() with runtime.c's
 * APPDB_QUERY handler so the parsing has one implementation and one set
 * of tests (payload/tests/appdb_scan_selftest.c). */
static int appdb_scan_rows_json(char *buf, size_t cap, size_t *written) {
    int fd = open("/system_data/priv/mms/app.db", O_RDONLY);
    if (fd < 0) return db_query_err(buf, cap, written, "cannot open app.db");

    /* app.db runs 400-800 KB in practice; cap the read so a surprise
     * cannot balloon the payload's heap. */
    const size_t raw_cap = 1024 * 1024;
    unsigned char *raw = (unsigned char *)malloc(raw_cap);
    if (!raw) {
        close(fd);
        return db_query_err(buf, cap, written, "out of memory");
    }
    size_t total = 0;
    while (total < raw_cap) {
        ssize_t r = read(fd, raw + total, raw_cap - total);
        if (r <= 0) break;
        total += (size_t)r;
    }
    close(fd);

    const int max_rows = 100;
    appdb_entry_t *entries =
        (appdb_entry_t *)malloc(sizeof(appdb_entry_t) * (size_t)max_rows);
    if (!entries) {
        free(raw);
        return db_query_err(buf, cap, written, "out of memory");
    }

    int count = appdb_scan_entries(raw, total, entries, max_rows);
    free(raw);
    if (count < 0) {
        free(entries);
        return db_query_err(buf, cap, written, "app.db is not a SQLite image");
    }

    int n = snprintf(buf, cap, "{\"rows\":[");
    if (n < 0 || (size_t)n >= cap) {
        free(entries);
        return -1;
    }
    int emitted = 0;
    for (int i = 0; i < count; i++) {
        /* Skip Sony's own apps — Media Gallery, Disc Player and friends
         * are not "recently played". Same NPXS rule the play-time
         * watcher uses in find_running_title(). */
        if (strncmp(entries[i].title_id, "NPXS", 4) == 0) continue;

        char esc_tid[32], esc_name[512];
        json_escape(entries[i].title_id, esc_tid, sizeof(esc_tid));
        json_escape(entries[i].name, esc_name, sizeof(esc_name));
        int more = snprintf(buf + n, cap - (size_t)n,
                            "%s{\"title_id\":\"%s\",\"name\":\"%s\"}",
                            emitted ? "," : "", esc_tid, esc_name);
        if (more < 0 || (size_t)(n + more) >= cap) break;
        n += more;
        emitted++;
    }
    free(entries);

    /* Distinct from the sqlite path's "app_db" so the UI can tell which
     * one answered without guessing. */
    int end = snprintf(buf + n, cap - (size_t)n, "],\"source\":\"app_db_scan\"}");
    if (end < 0 || (size_t)(n + end) >= cap) return -1;
    n += end;
    if (written) *written = (size_t)n;
    return 0;
}

int activity_db_query_json(const char *query, char *buf, size_t cap,
                           size_t *written) {
    if (!query || !buf || cap == 0) return -1;

    adb_open_fn    sq_open    = (adb_open_fn)dlsym(RTLD_DEFAULT, "sqlite3_open_v2");
    adb_close_fn   sq_close   = (adb_close_fn)dlsym(RTLD_DEFAULT, "sqlite3_close");
    adb_busy_fn    sq_busy    = (adb_busy_fn)dlsym(RTLD_DEFAULT, "sqlite3_busy_timeout");
    adb_prepare_fn sq_prepare = (adb_prepare_fn)dlsym(RTLD_DEFAULT, "sqlite3_prepare_v2");
    adb_step_fn    sq_step    = (adb_step_fn)dlsym(RTLD_DEFAULT, "sqlite3_step");
    adb_finalize_fn sq_fin    = (adb_finalize_fn)dlsym(RTLD_DEFAULT, "sqlite3_finalize");
    adb_text_fn    sq_text    = (adb_text_fn)dlsym(RTLD_DEFAULT, "sqlite3_column_text");

    if (!sq_open || !sq_close || !sq_prepare || !sq_step ||
        !sq_fin || !sq_text) {
        /* Expected, not exceptional: no console we have tested ships
         * libSceSqlite.sprx, so this is the normal path. recently_played
         * has a parser that needs no sqlite; play_time does not, because
         * its rows are serialized blobs inside sl2_log.db that a B-tree
         * text scan cannot reassemble. Say so instead of blaming the
         * firmware. */
        if (strcmp(query, "recently_played") == 0)
            return appdb_scan_rows_json(buf, cap, written);
        if (strcmp(query, "play_time") == 0)
            return db_query_err(buf, cap, written,
                                "play time needs sqlite, which this console "
                                "does not provide");
        return db_query_err(buf, cap, written, "unknown query");
    }

    const char *db_path = NULL;
    const char *sql = NULL;

    if (strcmp(query, "recently_played") == 0) {
        db_path = "/system_data/priv/mms/app.db";
        sql = "SELECT titleId, titleName FROM tbl_appbrowser_2_appinfo "
              "WHERE titleId IS NOT NULL "
              "AND (titleId LIKE '%PPSA%' OR titleId LIKE '%CUSA%') "
              "ORDER BY titleId LIMIT 100";
    } else if (strcmp(query, "play_time") == 0) {
        db_path = "/system_data/priv/system_logger2/nobackup/database/sl2_log.db";
        sql = "SELECT log FROM tbl_log WHERE event_id="
              "'ApplicationSessionEndBi' LIMIT 50";
    } else {
        int n = snprintf(buf, cap, "{\"rows\":[],\"source\":\"none\","
                         "\"error\":\"unknown query\"}");
        if (written) *written = (size_t)(n > 0 ? n : 0);
        return 0;
    }

    sqlite3 *db = NULL;
    if (sq_open(db_path, &db, ADB_READONLY, NULL) != 0 || !db) {
        int n = snprintf(buf, cap, "{\"rows\":[],\"source\":\"none\","
                         "\"error\":\"cannot open db\"}");
        if (written) *written = (size_t)(n > 0 ? n : 0);
        return 0;
    }
    if (sq_busy) sq_busy(db, 3000);

    sqlite3_stmt *stmt = NULL;
    if (sq_prepare(db, sql, -1, &stmt, NULL) != 0 || !stmt) {
        sq_close(db);
        int n = snprintf(buf, cap, "{\"rows\":[],\"source\":\"none\","
                         "\"error\":\"prepare failed\"}");
        if (written) *written = (size_t)(n > 0 ? n : 0);
        return 0;
    }

    int n = snprintf(buf, cap, "{\"rows\":[");
    int first = 1;

    int rc;
    while ((rc = sq_step(stmt)) == ADB_ROW) {
        if (strcmp(query, "recently_played") == 0) {
            const unsigned char *tid = sq_text(stmt, 0);
            const unsigned char *name = sq_text(stmt, 1);
            char esc_tid[32], esc_name[128];
            json_escape((const char *)tid, esc_tid, sizeof(esc_tid));
            json_escape((const char *)(name ? name : (const unsigned char *)""), 
                       esc_name, sizeof(esc_name));
            const char *sep = first ? "" : ",";
            first = 0;
            int more = snprintf(buf + n, cap - (size_t)n,
                "%s{\"title_id\":\"%s\",\"name\":\"%s\"}",
                sep, esc_tid, esc_name);
            if (more < 0 || (size_t)(n + more) >= cap) break;
            n += more;
        } else {
            const unsigned char *log = sq_text(stmt, 0);
            if (!log) continue;
            const char *p = strstr((const char *)log, "\"appTitleId\":");
            char tid[32] = "";
            if (p) {
                p += 13;
                while (*p == ' ' || *p == '"') p++;
                size_t tl = 0;
                while (p[tl] && p[tl] != '"' && tl < sizeof(tid) - 1) {
                    tid[tl] = p[tl]; tl++;
                }
                tid[tl] = '\0';
            }
            int64_t fg_time = 0;
            p = strstr((const char *)log, "\"totalFgTime\":");
            if (p) fg_time = (int64_t)strtoll(p + 14, NULL, 10);

            if (tid[0]) {
                char esc[32];
                json_escape(tid, esc, sizeof(esc));
                const char *sep = first ? "" : ",";
                first = 0;
                int more = snprintf(buf + n, cap - (size_t)n,
                    "%s{\"title_id\":\"%s\",\"total_seconds\":%lld}",
                    sep, esc, (long long)fg_time);
                if (more < 0 || (size_t)(n + more) >= cap) break;
                n += more;
            }
        }
    }

    sq_fin(stmt);
    sq_close(db);

    const char *source = (strcmp(query, "recently_played") == 0) ? "app_db" : "sl2_log";
    int end = snprintf(buf + n, cap - (size_t)n, "],\"source\":\"%s\"}", source);
    if (end < 0 || (size_t)(n + end) >= cap) return -1;
    n += end;

    if (written) *written = (size_t)n;
    return 0;
}
