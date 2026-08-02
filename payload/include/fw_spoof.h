#ifndef PS5UPLOAD_FW_SPOOF_H
#define PS5UPLOAD_FW_SPOOF_H

#include <stddef.h>

void fw_spoof_init(void);

int fw_spoof_status(char *buf, size_t cap, size_t *written);

#endif
