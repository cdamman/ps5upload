#ifndef PS5UPLOAD_APP_INFO_H
#define PS5UPLOAD_APP_INFO_H

/* sceKernelGetAppInfo(pid, &info) — app id and title id for a process.
 *
 * ── Why this header exists ──────────────────────────────────────────
 *
 * This struct was copy-pasted into four files, and every copy had the
 * layout wrong in one of two ways:
 *
 *   - proc_list.c, cheats.c, wake_watchdog.c omitted `app_type`, which
 *     put `title_id` at offset 16 instead of 20.
 *   - activity.c used `uint8_t unk[0x40]` and put it at offset 64.
 *
 * Offset 16 lands on `app_type`. For an ordinary process that field is
 * zero, so the first byte read as `title_id` is NUL and every title id
 * came back as the empty string. That is why listing processes reported
 * no title ids at all, why the cheat engine could not identify the
 * running game, and why play-time tracking never recorded anything: all
 * three ask this question and all three got "" for every process.
 *
 * The layout below (title_id at offset 20) is what etaHEN, onionHEN and
 * the payload SDK's own `ps` sample all use. One SDK sample disagrees
 * (samples/test_privileges), and prints a title id it would never
 * actually read correctly — treat that copy as the outlier it is.
 *
 * A returned value of non-zero means the pid is not a registered app
 * (a daemon or system process); the struct contents are meaningless in
 * that case and callers must not read them.
 */

#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>

typedef struct app_info {
    uint32_t app_id;
    uint64_t unknown1;
    uint32_t app_type;
    /* 9 characters plus the terminator, e.g. "CUSA12345". Treat as
     * fixed-size: do not assume the kernel terminated it. */
    char     title_id[10];
    char     unknown2[0x3c];
} app_info_t;

/* The whole bug was a wrong offset, so pin it. If someone reorders or
 * drops a field again, this fails at compile time rather than silently
 * returning empty title ids on a console. */
_Static_assert(offsetof(app_info_t, app_id) == 0,
               "app_id must be first");
_Static_assert(offsetof(app_info_t, app_type) == 16,
               "app_type sits between unknown1 and title_id");
_Static_assert(offsetof(app_info_t, title_id) == 20,
               "title_id must be at offset 20 — offset 16 reads app_type "
               "and yields an empty string for every process");

extern int sceKernelGetAppInfo(pid_t pid, app_info_t *info);

/* True when `s` looks like a real title id: four upper-case letters
 * then five digits (CUSA12345, PPSA01234, NPXS40000).
 *
 * Checked before any title id is used, so that if this struct is ever
 * wrong again the result is "no title" rather than garbage flowing into
 * cheat lookups and the UI. */
static inline int app_info_title_id_valid(const char *s) {
    if (!s) return 0;
    for (int i = 0; i < 4; i++)
        if (s[i] < 'A' || s[i] > 'Z') return 0;
    for (int i = 4; i < 9; i++)
        if (s[i] < '0' || s[i] > '9') return 0;
    return s[9] == '\0';
}

/* Copy the title id out as a NUL-terminated string. Returns 1 and fills
 * `out` when the process is an app with a plausible title id, else 0
 * and leaves `out` an empty string. */
static inline int app_info_title_id(const app_info_t *info,
                                    char *out, size_t out_sz) {
    if (!out || out_sz < 10) return 0;
    out[0] = '\0';
    if (!info) return 0;
    char tid[10];
    for (int i = 0; i < 9; i++) tid[i] = info->title_id[i];
    tid[9] = '\0';
    if (!app_info_title_id_valid(tid)) return 0;
    for (int i = 0; i < 10; i++) out[i] = tid[i];
    return 1;
}

#endif /* PS5UPLOAD_APP_INFO_H */
