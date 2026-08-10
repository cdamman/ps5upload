/* Host-side test for locating SDK-version fields inside an ELF.
 *
 * This is step one of backporting a game to older firmware. The previous
 * implementation scanned the entire file for two 32-bit magic values and
 * patched every match, so a coincidental hit in game data silently
 * corrupted four bytes, and a signed (encrypted) SELF would be written
 * to despite the real parameters being unreadable.
 *
 * The fixture builds real ELF64 headers because that is the whole point:
 * a fixture that just embedded the magic somewhere would pass against
 * the scanning implementation this replaces. */
#include <stdio.h>
#include <string.h>

#include "../include/elf_param.h"

static int failures = 0;

#define CHECK(expr)                                                     \
    do {                                                                \
        if (!(expr)) {                                                  \
            fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expr);     \
            failures++;                                                 \
        }                                                               \
    } while (0)

#define PHOFF 0x40u
#define PHENTSIZE 0x38u

static unsigned char g_elf[4096];
static size_t g_len;

static void wr32(size_t at, uint32_t v) {
    g_elf[at] = (unsigned char)(v & 0xff);
    g_elf[at + 1] = (unsigned char)((v >> 8) & 0xff);
    g_elf[at + 2] = (unsigned char)((v >> 16) & 0xff);
    g_elf[at + 3] = (unsigned char)((v >> 24) & 0xff);
}
static void wr16(size_t at, uint16_t v) {
    g_elf[at] = (unsigned char)(v & 0xff);
    g_elf[at + 1] = (unsigned char)((v >> 8) & 0xff);
}
static void wr64(size_t at, uint64_t v) {
    wr32(at, (uint32_t)(v & 0xffffffffu));
    wr32(at + 4, (uint32_t)(v >> 32));
}

/* Minimal ELF64 with `phnum` program headers starting at PHOFF. */
static void elf_reset(uint16_t phnum) {
    memset(g_elf, 0, sizeof(g_elf));
    memcpy(g_elf, "\x7f" "ELF", 4);
    g_elf[4] = 2; /* ELFCLASS64 */
    g_elf[5] = 1; /* little endian */
    wr64(0x20, PHOFF);
    wr16(0x36, PHENTSIZE);
    wr16(0x38, phnum);
    g_len = PHOFF + (size_t)PHENTSIZE * phnum;
    if (g_len < 0x40) g_len = 0x40;
}

/* Write program header `i`, and lay its segment down at `seg_off`. */
static void elf_put_segment(uint16_t i, uint32_t p_type, size_t seg_off,
                            uint64_t filesz, uint32_t magic, uint32_t sdk_at,
                            uint32_t sdk_value) {
    size_t ph = PHOFF + (size_t)PHENTSIZE * i;
    wr32(ph + 0x00, p_type);
    wr64(ph + 0x08, seg_off);
    wr64(ph + 0x20, filesz);
    if (magic) wr32(seg_off + SCE_PARAM_MAGIC_OFFSET, magic);
    if (sdk_at) wr32(seg_off + sdk_at, sdk_value);
    if (seg_off + filesz > g_len) g_len = seg_off + (size_t)filesz;
}

int main(void) {
    elf_param_site_t sites[8];
    elf_param_status_t st;
    int n;

    /* A signed SELF must be refused outright — its parameters are
     * encrypted, so writing to it can only corrupt it. */
    {
        memset(g_elf, 0, sizeof(g_elf));
        wr32(0, 0x1D3D154Fu); /* PS4 FSELF */
        n = elf_find_param_sites(g_elf, 64, sites, 8, &st);
        CHECK(n == -1);
        CHECK(st == ELF_PARAM_SIGNED_SELF);

        wr32(0, 0xEEF51454u); /* PS5 FSELF */
        n = elf_find_param_sites(g_elf, 64, sites, 8, &st);
        CHECK(n == -1);
        CHECK(st == ELF_PARAM_SIGNED_SELF);
    }

    /* Anything without the ELF magic is not ours to patch. */
    {
        memset(g_elf, 0, sizeof(g_elf));
        memcpy(g_elf, "NOTANELF", 8);
        n = elf_find_param_sites(g_elf, 512, sites, 8, &st);
        CHECK(n == -1);
        CHECK(st == ELF_PARAM_NOT_ELF);
    }

    /* The ordinary case: one process-param segment. */
    {
        elf_reset(1);
        elf_put_segment(0, PT_SCE_PROCPARAM, 0x200, 0x40,
                        SCE_PROCESS_PARAM_MAGIC, SCE_PARAM_PS5_SDK_OFFSET,
                        0x10000000u);
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 1);
        CHECK(st == ELF_PARAM_OK);
        if (n == 1) {
            CHECK(sites[0].offset == 0x200 + SCE_PARAM_PS5_SDK_OFFSET);
            CHECK(sites[0].seg_type == PT_SCE_PROCPARAM);
        }
    }

    /* Module params use the other magic and the other offset. */
    {
        elf_reset(1);
        elf_put_segment(0, PT_SCE_MODULE_PARAM, 0x200, 0x40,
                        SCE_MODULE_PARAM_MAGIC, SCE_PARAM_PS4_SDK_OFFSET,
                        0x10000000u);
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 1);
        if (n == 1) CHECK(sites[0].offset == 0x200 + SCE_PARAM_PS4_SDK_OFFSET);
    }

    /* The regression that matters: the magic appearing in ordinary data
     * outside any param segment must NOT be treated as a patch site.
     * The old whole-file scan patched exactly this. */
    {
        elf_reset(1);
        elf_put_segment(0, 0x00000001u /* PT_LOAD */, 0x200, 0x100, 0, 0, 0);
        wr32(0x240, SCE_PROCESS_PARAM_MAGIC); /* coincidental match */
        wr32(0x2C0, SCE_MODULE_PARAM_MAGIC);  /* another one */
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 0);
        CHECK(st == ELF_PARAM_NO_PARAMS);
    }

    /* A param segment whose magic does not match is not a param segment,
     * whatever the header claims. */
    {
        elf_reset(1);
        elf_put_segment(0, PT_SCE_PROCPARAM, 0x200, 0x40, 0xDEADBEEFu,
                        SCE_PARAM_PS5_SDK_OFFSET, 0x10000000u);
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 0);
    }

    /* Both kinds present. */
    {
        elf_reset(2);
        elf_put_segment(0, PT_SCE_PROCPARAM, 0x200, 0x40,
                        SCE_PROCESS_PARAM_MAGIC, SCE_PARAM_PS5_SDK_OFFSET, 0);
        elf_put_segment(1, PT_SCE_MODULE_PARAM, 0x300, 0x40,
                        SCE_MODULE_PARAM_MAGIC, SCE_PARAM_PS4_SDK_OFFSET, 0);
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 2);
    }

    /* A header table pointing outside the file must be rejected, not
     * followed. */
    {
        elf_reset(1);
        wr64(0x20, 0x100000); /* phoff past EOF */
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == -1);
        CHECK(st == ELF_PARAM_MALFORMED);
    }

    /* A segment that claims to extend past EOF is skipped rather than
     * read out of bounds. */
    {
        elf_reset(1);
        size_t ph = PHOFF;
        wr32(ph + 0x00, PT_SCE_PROCPARAM);
        wr64(ph + 0x08, 0x200);
        wr64(ph + 0x20, 0x100000); /* filesz past EOF */
        g_len = 0x300;
        n = elf_find_param_sites(g_elf, g_len, sites, 8, &st);
        CHECK(n == 0);
    }

    /* Never write past the caller's array. */
    {
        elf_reset(3);
        elf_put_segment(0, PT_SCE_PROCPARAM, 0x200, 0x40,
                        SCE_PROCESS_PARAM_MAGIC, SCE_PARAM_PS5_SDK_OFFSET, 0);
        elf_put_segment(1, PT_SCE_PROCPARAM, 0x300, 0x40,
                        SCE_PROCESS_PARAM_MAGIC, SCE_PARAM_PS5_SDK_OFFSET, 0);
        elf_put_segment(2, PT_SCE_PROCPARAM, 0x400, 0x40,
                        SCE_PROCESS_PARAM_MAGIC, SCE_PARAM_PS5_SDK_OFFSET, 0);
        n = elf_find_param_sites(g_elf, g_len, sites, 2, &st);
        CHECK(n == 2);
    }

    printf("elf_param_selftest: %s\n", failures == 0 ? "ALL PASS" : "FAILED");
    return failures == 0 ? 0 : 1;
}
