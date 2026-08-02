#ifndef PS5UPLOAD_SDK_CHANGER_H
#define PS5UPLOAD_SDK_CHANGER_H

#include <stddef.h>

void sdk_changer_init(void);

int sdk_changer_scan(char *buf, size_t cap, size_t *written);

int sdk_changer_patch(const char *title_id, const char *target_sdk,
                      char *err, size_t err_cap);

int sdk_changer_restore(const char *title_id, int *restored_count,
                        char *err, size_t err_cap);

#endif
