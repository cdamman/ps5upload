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

#endif
