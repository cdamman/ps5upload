/*
 * wake_watchdog.c — rest-mode wake detection and re-escalation.
 *
 * After PS5 wakes from rest mode, the kernel resets our process's ucred
 * credentials. This watchdog detects the wake via wall-clock drift and
 * re-applies the full jailbreak + fan threshold + mount reconciliation.
 *
 * See wake_watchdog.h for the full design rationale.
 */

#include "wake_watchdog.h"
#include "config.h"
#include "runtime.h"
#include "hw_info.h"

#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <stdlib.h>
#include <pthread.h>
#include <dlfcn.h>
#include <sys/syscall.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <sys/user.h>

/* Poll interval and suspend threshold.
 *
 * WAKE_POLL_S: how often we sample the wall clock. 5s keeps CPU overhead
 *   negligible (one time(NULL) + one sleep per cycle).
 *
 * WAKE_THRESH_S: minimum wall-clock jump that qualifies as a genuine suspend.
 *   Was 15s in elf-arsenal's early code — raised to 60s because the PS5
 *   aggressively throttles background threads when a game is foreground.
 *   A 5s sleep can overrun 15s with no actual suspend, causing a false
 *   resume → spurious re-escalation. At 60s the only realistic cause of
 *   such a large jump is rest mode (or a full reboot, which kills us
 *   anyway). */
#define WAKE_POLL_S    5
#define WAKE_THRESH_S  60

/* ── BigApp detection ────────────────────────────────────────────────── */

/* We check whether a game is running by scanning the sysctl proc list
 * for any process whose sceKernelGetAppInfo returns a non-zero app_id
 * with a real (non-NPXS) title_id. This is the same logic proc_list.c
 * uses to classify processes as "app" vs "system".
 *
 * We intentionally DON'T call sceSystemServiceGetAppIdOfRunningBigApp
 * (which elf-arsenal uses) because that symbol is not available in our
 * SDK headers and its NID may differ across firmware. The sysctl walk
 * is firmware-independent and doesn't require kernel R/W.
 *
 * sceKernelGetAppInfo is exported by libkernel_web and available on
 * every PS5 firmware. It's declared extern here (same as proc_list.c). */
#include "app_info.h"

/* KINFO_PROC offsets — identical to proc_list.c (stable across all PS5
 * firmware revisions). We read the raw bytes directly instead of going
 * through proc_list_get_json_ex (which builds a large JSON buffer and
 * calls sceKernelGetAppInfo for every process — wasteful for a simple
 * boolean "is a game running?" check). */
#define WAKE_KINFO_PID_OFFSET    72
#define WAKE_KINFO_TDNAME_OFFSET 447

/* Returns 1 if any registered game/app (non-system, non-NPXS) is
 * currently running, 0 otherwise. Best-effort: on sysctl failure we
 * return 0 (conservative — if we can't check, we'd rather risk a
 * spurious re-escalation than skip a real one). */
static int bigapp_running(void) {
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PROC, 0};
    size_t buf_size = 0;
    if (sysctl(mib, 4, NULL, &buf_size, NULL, 0) != 0 || buf_size == 0)
        return 0;

    /* 25% headroom + 1 KiB padding (same growth strategy as proc_list.c). */
    size_t alloc = buf_size + (buf_size / 4) + 1024;
    uint8_t *kbuf = malloc(alloc);
    if (!kbuf) return 0;

    size_t got = alloc;
    if (sysctl(mib, 4, kbuf, &got, NULL, 0) != 0) {
        free(kbuf);
        return 0;
    }

    const size_t MIN_BYTES = WAKE_KINFO_TDNAME_OFFSET + 1;
    int found = 0;

    for (uint8_t *p = kbuf;
         (size_t)(p - kbuf) + sizeof(int) <= got && !found;) {
        int ki_structsize = *(int *)p;
        if (ki_structsize <= 0 ||
            (size_t)ki_structsize < MIN_BYTES ||
            (size_t)(p - kbuf) + (size_t)ki_structsize > got) {
            break;
        }

        pid_t pid = *(pid_t *)&p[WAKE_KINFO_PID_OFFSET];

        /* Ask the kernel if this pid is a registered app. */
        app_info_t ai;
        if (sceKernelGetAppInfo(pid, &ai) == 0 && ai.app_id != 0) {
            /* Got a registered app. Check if it's a real game (non-NPXS).
             * NPXS* = Sony system app (ShellUI, media player, etc.) —
             * those are always running and don't count as "BigApp".
             * title_id is char[14], not guaranteed NUL-terminated. */
            if (strncmp(ai.title_id, "NPXS", 4) != 0) {
                /* Real game/app running. */
                found = 1;
            }
        }

        p += (size_t)ki_structsize;
    }

    free(kbuf);
    return found;
}

/* ── Watchdog thread ─────────────────────────────────────────────────── */

static void *wake_watchdog_thread_fn(void *arg) {
    (void)arg;
    (void)syscall(SYS_thr_set_name, -1, "ps5upload-wake");

    for (;;) {
        time_t t0 = time(NULL);
        sleep(WAKE_POLL_S);
        time_t elapsed = time(NULL) - t0;

        /* Normal case: we slept roughly WAKE_POLL_S. */
        if (elapsed < WAKE_THRESH_S) continue;

        /* Wall clock jumped — we were likely suspended. But first check
         * if a game is running: the PS5 throttles bg threads under game
         * load, which can make a 5s sleep overrun 60s with no actual
         * suspend. A real resume from rest kills all games first, so a
         * live BigApp means the jump was throttle, not suspend. */
        if (bigapp_running()) {
            fprintf(stderr,
                    "wake_watchdog: slept %llds but BigApp running — "
                    "skipping re-escalation (thread throttle)\n",
                    (long long)elapsed);
            continue;
        }

        fprintf(stderr,
                "wake_watchdog: resume detected (slept %llds) — re-escalating\n",
                (long long)elapsed);

        /* 1. Force re-elevation. Clear the cached success flag so
         *    runtime_apply_ucred_jailbreak() actually runs the full
         *    kernel-write sequence instead of early-outing. */
        g_ucred_elevation_rc = -1;
        runtime_apply_ucred_jailbreak();

        /* 2. Re-apply fan threshold if one was pinned. */
        int pinned = hw_fan_pinned_threshold();
        if (pinned >= HW_FAN_THRESHOLD_MIN && pinned <= HW_FAN_THRESHOLD_MAX) {
            const char *err = NULL;
            if (hw_fan_set_threshold((uint8_t)pinned, &err) == 0) {
                fprintf(stderr,
                        "wake_watchdog: fan threshold re-applied (%d°C)\n",
                        pinned);
            } else {
                fprintf(stderr,
                        "wake_watchdog: fan re-apply failed (%s)\n",
                        err ? err : "unknown");
            }
        }

        /* 3. Reconcile mounts (orphaned mounts from pre-suspend state).
         *    Best-effort — if getmntinfo hangs (rare FW issue), we
         *    still have elevation + fan. */
        runtime_reconcile_mounts();

        /* 4. Toast so the user sees we recovered. */
        pop_notification("PS5Upload: re-activated after rest mode");

        fprintf(stderr, "wake_watchdog: re-escalation complete\n");
    }

    return NULL;
}

void start_wake_watchdog(void) {
    pthread_t t;
    pthread_attr_t a;
    if (pthread_attr_init(&a) != 0) return;
    (void)pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
    if (pthread_create(&t, &a, wake_watchdog_thread_fn, NULL) != 0) {
        fprintf(stderr, "wake_watchdog: failed to start thread\n");
    }
    pthread_attr_destroy(&a);
}
