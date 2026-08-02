#ifndef PS5UPLOAD2_WAKE_WATCHDOG_H
#define PS5UPLOAD2_WAKE_WATCHDOG_H

/*
 * Rest-mode wake watchdog.
 *
 * After the PS5 wakes from rest mode (suspend-to-RAM), the kernel resets
 * process credentials. Our payload's ucred elevation becomes stale —
 * Sony APIs silently fail, the fan threshold pin is lost, and mounts
 * may need reconciliation.
 *
 * The watchdog detects a wake event by polling wall-clock drift: a
 * `sleep(N)` that actually takes much longer than N seconds means the
 * process was suspended (the PS5 froze all userland threads during
 * rest mode). On detection we:
 *
 *   1. Check if a BigApp (game) is running — if so, skip. The PS5
 *      throttles background threads when a game is foreground, which
 *      can cause a 5s sleep to overrun 60s without any actual suspend.
 *      A real resume from rest kills all games first, so a live BigApp
 *      means we were never actually suspended.
 *   2. Force re-elevation of ucred credentials.
 *   3. Re-apply the persisted fan threshold.
 *   4. Reconcile orphaned mounts.
 *   5. Fire a toast so the user sees the re-activation on screen.
 *
 * Algorithm adapted from elf-arsenal's wake_watchdog_thread (sys.c:1855).
 * Threshold is 60s (raised from elf-arsenal's original 15s for the same
 * reason: PS5 thread throttling under game load).
 *
 * The thread is detached and self-contained — safe to start once at
 * payload boot and never join.
 */

/* Launch the wake watchdog as a detached thread. Safe to call once
 * from main() after the fan threshold restore block. The thread runs
 * for the lifetime of the payload process. */
void start_wake_watchdog(void);

#endif /* PS5UPLOAD2_WAKE_WATCHDOG_H */
