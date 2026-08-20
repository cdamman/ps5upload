#ifndef PS5UPLOAD_REMOTEPLAY_H
#define PS5UPLOAD_REMOTEPLAY_H

#include <stdint.h>
#include <stddef.h>

void remoteplay_init(void);

int remoteplay_request(const char *manual_account_id);

int remoteplay_get_status(char *buf, size_t cap);

int remoteplay_cancel(void);

/* Read-only readiness snapshot as JSON. Returns the snprintf length, or
 * negative on error. Performs no writes. */
int remoteplay_readiness_json(char *out, size_t out_size);

/* Paired devices from the 32-slot registration table, as JSON. Pairing
 * secrets are never included. Returns the length written. */
int remoteplay_devices_json(char *out, size_t out_size);

/* Enable Remote Play. user_scope=0 is the system service toggle,
 * user_scope=1 is per-user permission (FW 10.00+). Writes the re-read
 * readiness snapshot to `out`. Returns >=0 on success, -1 write failed,
 * -2 no per-user setting on this firmware, -3 no foreground user. */
int remoteplay_enable(int user_scope, char *out, size_t out_size);

#endif
