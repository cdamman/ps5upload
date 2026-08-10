#ifndef PS5UPLOAD_ELF_PARAM_H
#define PS5UPLOAD_ELF_PARAM_H

#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* Locating a title's SDK-version fields inside an ELF.
 *
 * Downgrading those fields is step one of backporting a game to older
 * firmware — without it the system refuses to launch the title. The
 * previous implementation scanned the whole file for two 32-bit magic
 * values and patched every hit, which meant a coincidental match in game
 * data got four bytes overwritten. A 100 MB eboot is ~25M aligned words,
 * so those collisions are not hypothetical.
 *
 * The parameters actually live in dedicated program-header segments, so
 * walking the header table turns a probabilistic search into an exact
 * lookup — and gives the signed-file check for free, because an
 * encrypted SELF has no readable program headers.
 *
 * Offsets follow idlesauce's ps5_elf_sdk_downgrade.py, which is what the
 * scene tooling (BackPork et al.) expects. They are segment-relative:
 * the magic sits at +0x08, so the SDK words at +0x14 / +0x10 are the
 * same fields a magic-relative +0x0C / +0x08 would reach.
 *
 * Tests: payload/tests/elf_param_selftest.c. */

#define PT_SCE_PROCPARAM     0x61000001u
#define PT_SCE_MODULE_PARAM  0x61000002u

#define SCE_PROCESS_PARAM_MAGIC 0x4942524Fu
#define SCE_MODULE_PARAM_MAGIC  0x3C13F4BFu

#define SCE_PARAM_MAGIC_OFFSET   0x08u
#define SCE_PARAM_PS5_SDK_OFFSET 0x14u
#define SCE_PARAM_PS4_SDK_OFFSET 0x10u

typedef enum {
    ELF_PARAM_OK = 0,
    ELF_PARAM_NOT_ELF,      /* no \x7fELF — not something we may patch */
    ELF_PARAM_SIGNED_SELF,  /* encrypted; patching would corrupt it */
    ELF_PARAM_MALFORMED,    /* header table runs outside the file */
    ELF_PARAM_NO_PARAMS,    /* a valid ELF that carries no param segment */
} elf_param_status_t;

/* Where a patchable SDK word lives, and which field it is. */
typedef struct {
    size_t   offset;   /* absolute file offset of the 4-byte value */
    uint32_t seg_type; /* PT_SCE_PROCPARAM or PT_SCE_MODULE_PARAM */
} elf_param_site_t;

static inline uint16_t elf_rd16(const unsigned char *p) {
    return (uint16_t)(p[0] | ((uint16_t)p[1] << 8));
}
static inline uint32_t elf_rd32(const unsigned char *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}
static inline uint64_t elf_rd64(const unsigned char *p) {
    return (uint64_t)elf_rd32(p) | ((uint64_t)elf_rd32(p + 4) << 32);
}

/* A signed SELF, which must never be written to. */
static inline int elf_is_signed_self(const unsigned char *buf, size_t len) {
    if (len < 4) return 0;
    uint32_t m = elf_rd32(buf);
    return m == 0x1D3D154Fu || /* PS4 FSELF */
           m == 0xEEF51454u;   /* PS5 FSELF */
}

/* Collect every patchable SDK-version site. Returns how many were found
 * (at most `max`), or -1 with `status` set when the file must not be
 * touched at all. */
static inline int elf_find_param_sites(const unsigned char *buf, size_t len,
                                       elf_param_site_t *out, int max,
                                       elf_param_status_t *status) {
    if (status) *status = ELF_PARAM_OK;
    if (!buf || !out || max <= 0) {
        if (status) *status = ELF_PARAM_MALFORMED;
        return -1;
    }
    if (elf_is_signed_self(buf, len)) {
        if (status) *status = ELF_PARAM_SIGNED_SELF;
        return -1;
    }
    if (len < 0x40 || memcmp(buf, "\x7f" "ELF", 4) != 0) {
        if (status) *status = ELF_PARAM_NOT_ELF;
        return -1;
    }

    uint64_t phoff = elf_rd64(buf + 0x20);
    uint16_t phentsize = elf_rd16(buf + 0x36);
    uint16_t phnum = elf_rd16(buf + 0x38);
    if (phentsize < 0x28 || phoff == 0 ||
        phoff + (uint64_t)phentsize * phnum > (uint64_t)len) {
        if (status) *status = ELF_PARAM_MALFORMED;
        return -1;
    }

    int found = 0;
    for (uint16_t i = 0; i < phnum && found < max; i++) {
        const unsigned char *ph = buf + phoff + (uint64_t)i * phentsize;
        uint32_t p_type = elf_rd32(ph + 0x00);
        if (p_type != PT_SCE_PROCPARAM && p_type != PT_SCE_MODULE_PARAM) continue;

        uint64_t p_offset = elf_rd64(ph + 0x08);
        uint64_t p_filesz = elf_rd64(ph + 0x20);
        uint32_t want_magic = (p_type == PT_SCE_PROCPARAM)
                                  ? SCE_PROCESS_PARAM_MAGIC
                                  : SCE_MODULE_PARAM_MAGIC;
        uint32_t sdk_off = (p_type == PT_SCE_PROCPARAM) ? SCE_PARAM_PS5_SDK_OFFSET
                                                        : SCE_PARAM_PS4_SDK_OFFSET;

        /* The segment must actually hold the struct we expect. */
        if (p_filesz < sdk_off + 4) continue;
        if (p_offset + p_filesz > (uint64_t)len) continue;
        if (elf_rd32(buf + p_offset + SCE_PARAM_MAGIC_OFFSET) != want_magic) continue;

        out[found].offset = (size_t)(p_offset + sdk_off);
        out[found].seg_type = p_type;
        found++;
    }

    if (found == 0 && status) *status = ELF_PARAM_NO_PARAMS;
    return found;
}

#endif
