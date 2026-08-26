/*
 * focus_probe.c — answer "which app is on screen right now?" without ptrace.
 *
 * See focus_probe.h for why this exists and why it is dlsym-only.
 */

#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "focus_probe.h"

/* sceSystemServiceGetAppIdOfBigApp / ...MiniApp take no arguments and
 * return the app id directly (negative or 0 when nothing qualifies).
 * "Big app" is the full-screen foreground application — a game; "mini
 * app" is the overlaid system UI. Neither is declared by the payload
 * SDK, so the prototypes live here. */
typedef int (*sce_get_app_id_fn)(void);

/* sceLncUtilGetAppStatus-style getters take an app id and fill a status
 * word. Probed opportunistically: if a firmware exports one it gives a
 * second, independent read on the same question. */
typedef int (*sce_get_status_fn)(unsigned int app_id, int *out_status);

static sce_get_app_id_fn p_big_app   = NULL;
static sce_get_app_id_fn p_mini_app  = NULL;
static int focus_resolve_attempted = 0;

static void *resolve_quiet(const char *name) {
    void *p;
    dlerror();
    p = dlsym(RTLD_DEFAULT, name);
    if (!p) (void)dlerror(); /* clear, absence is expected per-firmware */
    return p;
}

/* Candidate foreground/focus getters, probed by name.
 *
 * Resolving a symbol is free and side-effect-free, so we probe broadly and
 * report what this firmware actually exports. CALLING one is a different
 * matter: these are undeclared by the SDK, so invoking a name whose real
 * signature differs from our guess corrupts the stack. Only the two
 * no-argument getters below are ever called; the rest are reported for
 * availability only, so we can pick the next step from evidence instead of
 * burning a rebuild-and-redeploy cycle per guess.
 *
 * Measured on FW 9.60: GetAppIdOfBigApp / GetAppIdOfMiniApp do NOT resolve,
 * while sceLncUtilGetAppStatus does. */
static const char *const FOCUS_CANDIDATES[] = {
    "sceSystemServiceGetAppIdOfBigApp",
    "sceSystemServiceGetAppIdOfMiniApp",
    "sceSystemServiceGetAppStatus",
    "sceSystemServiceGetForegroundAppId",
    "sceSystemServiceGetRenderingMode",
    "sceLncUtilGetAppStatus",
    "sceLncUtilGetAppId",
    "sceLncUtilGetForegroundAppId",
    "sceLncUtilGetCurrentAppId",
    "sceLncUtilGetAppStatusList",
    "sceLncUtilGetAppInfo",
    "sceShellCoreUtilGetForegroundAppId",
    "sceShellCoreUtilGetAppFocus",
    "sceApplicationGetAppId",
    "sceApplicationGetFocusedAppId",
};
#define FOCUS_CANDIDATE_COUNT \
    (sizeof FOCUS_CANDIDATES / sizeof FOCUS_CANDIDATES[0])

static int focus_available[FOCUS_CANDIDATE_COUNT];

static void resolve_focus_apis(void) {
    size_t i;
    if (focus_resolve_attempted) return;
    focus_resolve_attempted = 1;

    for (i = 0; i < FOCUS_CANDIDATE_COUNT; i++) {
        focus_available[i] = resolve_quiet(FOCUS_CANDIDATES[i]) ? 1 : 0;
        fprintf(stderr, "[payload2] focus probe: %s=%s\n",
                FOCUS_CANDIDATES[i], focus_available[i] ? "yes" : "no");
    }

    /* Safe to call: documented as taking no arguments. */
    p_big_app  = (sce_get_app_id_fn)resolve_quiet(
        "sceSystemServiceGetAppIdOfBigApp");
    p_mini_app = (sce_get_app_id_fn)resolve_quiet(
        "sceSystemServiceGetAppIdOfMiniApp");
}

/* CLOCK_MONOTONIC millis so a caller sampling every second can spot a
 * gap (helper restarted, console slept) rather than reading a stalled
 * value as a steady one. */
static long long monotonic_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return -1;
    return (long long)ts.tv_sec * 1000LL + (long long)(ts.tv_nsec / 1000000L);
}

int focus_probe_get_json(char *buf, size_t cap, size_t *written_out,
                         const char **err_out) {
    int big = 0, mini = 0;
    int n;
    size_t off = 0, i;

    if (!buf || cap == 0) {
        if (err_out) *err_out = "focus_probe_bad_args";
        return -1;
    }

    resolve_focus_apis();

    if (p_big_app)  big  = p_big_app();
    if (p_mini_app) mini = p_mini_app();

    /* Emit the whole candidate table so a single probe tells us what this
     * firmware can answer, rather than one guess per redeploy. */
    n = snprintf(buf, cap, "{\"ok\":true,\"apis\":{");
    if (n < 0 || (size_t)n >= cap) {
        if (err_out) *err_out = "focus_probe_buf_too_small";
        return -1;
    }
    off = (size_t)n;
    for (i = 0; i < FOCUS_CANDIDATE_COUNT; i++) {
        n = snprintf(buf + off, cap - off, "%s\"%s\":%s",
                     i ? "," : "", FOCUS_CANDIDATES[i],
                     focus_available[i] ? "true" : "false");
        if (n < 0 || (size_t)n >= cap - off) {
            if (err_out) *err_out = "focus_probe_buf_too_small";
            return -1;
        }
        off += (size_t)n;
    }
    n = snprintf(buf + off, cap - off,
                 "},\"big_app\":%s,\"mini_app\":%s,"
                 "\"big_app_id\":%d,\"mini_app_id\":%d,"
                 "\"monotonic_ms\":%lld}",
                 p_big_app ? "true" : "false",
                 p_mini_app ? "true" : "false",
                 big, mini, monotonic_ms());
    if (n >= 0 && (size_t)n < cap - off) off += (size_t)n;

    if (written_out) *written_out = off;
    return 0;
}
