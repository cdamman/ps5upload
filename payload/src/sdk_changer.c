#include "sdk_changer.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define APP_BASE "/user/app"
#define APPMETA_BASE "/user/appmeta"
#define BACKUP_SUFFIX ".bak"

#define SCE_PROCESS_PARAM_MAGIC 0x4942524FU
#define SCE_MODULE_PARAM_MAGIC  0x3C13F4BFU
#define SCE_PARAM_PS5_SDK_OFFSET 0x0CU
#define SCE_PARAM_PS4_SDK_OFFSET 0x08U

static void json_escape(const char *in, char *out, size_t cap) {
    size_t o = 0;
    for (const char *s = in; *s && o + 2 < cap; s++) {
        if (*s == '"' || *s == '\\') { out[o++] = '\\'; out[o++] = *s; }
        else if (*s == '\n') { out[o++] = '\\'; out[o++] = 'n'; }
        else if ((unsigned char)*s >= 0x20) out[o++] = *s;
    }
    out[o] = '\0';
}

static int read_file_all(const char *path, char **out_buf, size_t *out_len) {
    int fd = open(path, O_RDONLY);
    if (fd < 0) return -1;
    struct stat st;
    if (fstat(fd, &st) < 0) { close(fd); return -1; }
    size_t len = (size_t)st.st_size;
    char *buf = malloc(len + 1);
    if (!buf) { close(fd); return -1; }
    size_t off = 0;
    while (off < len) {
        ssize_t n = read(fd, buf + off, len - off);
        if (n <= 0) { free(buf); close(fd); return -1; }
        off += (size_t)n;
    }
    close(fd);
    buf[len] = '\0';
    *out_buf = buf;
    *out_len = len;
    return 0;
}

static void extract_json_str(const char *json, const char *field,
                              char *out, size_t cap) {
    out[0] = '\0';
    char pat[64];
    snprintf(pat, sizeof(pat), "\"%s\"", field);
    const char *p = strstr(json, pat);
    if (!p) return;
    p += strlen(pat);
    while (*p && *p != ':') p++;
    if (*p != ':') return;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '"') {
        p++;
        size_t i = 0;
        while (*p && *p != '"' && i < cap - 1) {
            out[i++] = *p++;
        }
        out[i] = '\0';
    }
}

static int patch_binary_sdk(const char *path, uint32_t target_sdk) {
    int fd = open(path, O_RDWR);
    if (fd < 0) return -1;
    struct stat st;
    if (fstat(fd, &st) < 0) { close(fd); return -1; }
    size_t len = (size_t)st.st_size;
    if (len < 16) { close(fd); return -1; }

    void *map = mmap(NULL, len, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) { close(fd); return -1; }

    int patched = 0;
    uint8_t *data = (uint8_t *)map;
    for (size_t i = 0; i + 16 <= len; i += 4) {
        uint32_t val = *(uint32_t *)(data + i);
        if (val == SCE_PROCESS_PARAM_MAGIC) {
            *(uint32_t *)(data + i + SCE_PARAM_PS5_SDK_OFFSET) = target_sdk;
            patched++;
        }
        if (val == SCE_MODULE_PARAM_MAGIC) {
            *(uint32_t *)(data + i + SCE_PARAM_PS4_SDK_OFFSET) = target_sdk;
            patched++;
        }
    }

    msync(map, len, MS_SYNC);
    munmap(map, len);
    close(fd);
    return patched;
}

static int patch_param_json_file(const char *path, uint32_t target_sdk) {
    char *buf = NULL;
    size_t len = 0;
    if (read_file_all(path, &buf, &len) != 0) return -1;

    char sdk_str[32];
    snprintf(sdk_str, sizeof(sdk_str), "0x%08x00000000", target_sdk);
    char fw_str[32];
    snprintf(fw_str, sizeof(fw_str), "0x%08x00000000", target_sdk);

    char *p = strstr(buf, "\"sdkVersion\"");
    int changed = 0;
    if (p) {
        p = strchr(p, ':');
        if (p) {
            p++;
            while (*p == ' ' || *p == '\t') p++;
            if (*p == '"') {
                p++;
                size_t vlen = 0;
                while (p[vlen] && p[vlen] != '"') vlen++;
                if (vlen == strlen(sdk_str)) {
                    memcpy(p, sdk_str, vlen);
                    changed++;
                }
            }
        }
    }

    p = strstr(buf, "\"requiredSystemSoftwareVersion\"");
    if (p) {
        p = strchr(p, ':');
        if (p) {
            p++;
            while (*p == ' ' || *p == '\t') p++;
            if (*p == '"') {
                p++;
                size_t vlen = 0;
                while (p[vlen] && p[vlen] != '"') vlen++;
                if (vlen == strlen(fw_str)) {
                    memcpy(p, fw_str, vlen);
                    changed++;
                }
            }
        }
    }

    if (changed > 0) {
        char tmp[512];
        snprintf(tmp, sizeof(tmp), "%s.tmp", path);
        FILE *f = fopen(tmp, "w");
        if (f) {
            fwrite(buf, 1, len, f);
            fclose(f);
            rename(tmp, path);
        }
    }
    free(buf);
    return changed;
}

static void make_backup(const char *path) {
    char bak[512];
    snprintf(bak, sizeof(bak), "%s%s", path, BACKUP_SUFFIX);
    struct stat st;
    if (stat(bak, &st) != 0) {
        char *buf = NULL;
        size_t len = 0;
        if (read_file_all(path, &buf, &len) == 0) {
            FILE *f = fopen(bak, "w");
            if (f) {
                fwrite(buf, 1, len, f);
                fclose(f);
            }
            free(buf);
        }
    }
}

static void walk_and_patch(const char *dir_path, uint32_t target_sdk,
                           int *patched_count) {
    DIR *dir = opendir(dir_path);
    if (!dir) return;
    struct dirent *de;
    while ((de = readdir(dir))) {
        if (de->d_name[0] == '.') continue;

        char full[512];
        snprintf(full, sizeof(full), "%s/%s", dir_path, de->d_name);

        struct stat st;
        if (stat(full, &st) != 0) continue;

        if (S_ISDIR(st.st_mode)) {
            walk_and_patch(full, target_sdk, patched_count);
            continue;
        }
        if (!S_ISREG(st.st_mode)) continue;

        const char *dot = strrchr(de->d_name, '.');
        if (!dot) continue;
        if (strcasecmp(dot, ".bin") == 0 ||
            strcasecmp(dot, ".self") == 0 ||
            strcasecmp(dot, ".sprx") == 0 ||
            strcasecmp(dot, ".prx") == 0 ||
            strcasecmp(dot, ".elf") == 0) {
            make_backup(full);
            int n = patch_binary_sdk(full, target_sdk);
            if (n > 0) *patched_count += n;
        }
    }
    closedir(dir);
}

static void walk_and_restore(const char *dir_path, int *restored_count) {
    DIR *dir = opendir(dir_path);
    if (!dir) return;
    struct dirent *de;
    while ((de = readdir(dir))) {
        if (de->d_name[0] == '.') continue;

        char full[512];
        snprintf(full, sizeof(full), "%s/%s", dir_path, de->d_name);

        struct stat st;
        if (stat(full, &st) != 0) continue;

        if (S_ISDIR(st.st_mode)) {
            walk_and_restore(full, restored_count);
            continue;
        }
        if (!S_ISREG(st.st_mode)) continue;

        size_t namelen = strlen(de->d_name);
        size_t suffixlen = strlen(BACKUP_SUFFIX);
        if (namelen > suffixlen &&
            strcmp(de->d_name + namelen - suffixlen, BACKUP_SUFFIX) == 0) {
            char orig[512];
            size_t fulllen = strlen(full);
            if (fulllen - suffixlen >= sizeof(orig)) continue;
            memcpy(orig, full, fulllen - suffixlen);
            orig[fulllen - suffixlen] = '\0';

            if (rename(full, orig) == 0) {
                *restored_count += 1;
            }
        }
    }
    closedir(dir);
}

void sdk_changer_init(void) {
}

int sdk_changer_scan(char *buf, size_t cap, size_t *written) {
    DIR *dir = opendir(APPMETA_BASE);
    if (!dir) {
        int n = snprintf(buf, cap, "{\"titles\":[],\"error\":\"cannot open appmeta\"}");
        if (written) *written = (size_t)(n > 0 ? n : 0);
        return 0;
    }

    int n = snprintf(buf, cap, "{\"titles\":[");
    int first = 1;

    struct dirent *de;
    while ((de = readdir(dir))) {
        if (de->d_name[0] == '.') continue;

        char param_path[512];
        snprintf(param_path, sizeof(param_path), "%s/%s/sce_sys/param.json",
                 APPMETA_BASE, de->d_name);
        struct stat st;
        if (stat(param_path, &st) != 0) {
            snprintf(param_path, sizeof(param_path), "%s/%s/param.json",
                     APPMETA_BASE, de->d_name);
            if (stat(param_path, &st) != 0) continue;
        }

        char *content = NULL;
        size_t clen = 0;
        if (read_file_all(param_path, &content, &clen) != 0) continue;

        char title_id[32], name[128], sdk_ver[32], fw_req[32];
        extract_json_str(content, "titleId", title_id, sizeof(title_id));
        extract_json_str(content, "titleName", name, sizeof(name));
        extract_json_str(content, "sdkVersion", sdk_ver, sizeof(sdk_ver));
        extract_json_str(content, "requiredSystemSoftwareVersion", fw_req, sizeof(fw_req));
        free(content);

        if (strlen(title_id) < 4) continue;

        char esc_tid[40], esc_name[160], esc_sdk[40], esc_fw[40];
        json_escape(title_id, esc_tid, sizeof(esc_tid));
        json_escape(name, esc_name, sizeof(esc_name));
        json_escape(sdk_ver, esc_sdk, sizeof(esc_sdk));
        json_escape(fw_req, esc_fw, sizeof(esc_fw));

        const char *sep = first ? "" : ",";
        first = 0;
        int more = snprintf(buf + n, cap - (size_t)n,
            "%s{\"title_id\":\"%s\",\"name\":\"%s\","
            "\"sdk_version\":\"%s\",\"fw_required\":\"%s\"}",
            sep, esc_tid, esc_name, esc_sdk, esc_fw);
        if (more < 0 || (size_t)(n + more) >= cap) break;
        n += more;
    }
    closedir(dir);

    int end = snprintf(buf + n, cap - (size_t)n, "]}");
    if (end < 0 || (size_t)(n + end) >= cap) return -1;
    n += end;
    if (written) *written = (size_t)n;
    return 0;
}

int sdk_changer_patch(const char *title_id, const char *target_sdk,
                      char *err, size_t err_cap) {
    if (!title_id || !target_sdk) {
        if (err) snprintf(err, err_cap, "missing title_id or target_sdk");
        return -1;
    }

    uint32_t target = (uint32_t)strtoul(target_sdk, NULL, 16);
    if (target == 0) {
        if (err) snprintf(err, err_cap, "invalid target_sdk: %s", target_sdk);
        return -1;
    }

    DIR *dir = opendir(APP_BASE);
    if (!dir) {
        if (err) snprintf(err, err_cap, "cannot open %s", APP_BASE);
        return -1;
    }

    char game_path[512] = "";
    struct dirent *de;
    while ((de = readdir(dir))) {
        if (strcasestr(de->d_name, title_id)) {
            snprintf(game_path, sizeof(game_path), "%s/%s", APP_BASE, de->d_name);
            break;
        }
    }
    closedir(dir);

    if (game_path[0] == '\0') {
        if (err) snprintf(err, err_cap, "title %s not found in %s",
                          title_id, APP_BASE);
        return -1;
    }

    char param_path[512];
    snprintf(param_path, sizeof(param_path), "%s/sce_sys/param.json", game_path);
    struct stat st;
    if (stat(param_path, &st) == 0) {
        make_backup(param_path);
        patch_param_json_file(param_path, target);
    }

    int patched = 0;
    walk_and_patch(game_path, target, &patched);

    if (patched == 0) {
        if (err) snprintf(err, err_cap,
                          "patched param.json but no binary SDK magic found");
    }

    return 0;
}

int sdk_changer_restore(const char *title_id, int *restored_count,
                        char *err, size_t err_cap) {
    if (!title_id) {
        if (err) snprintf(err, err_cap, "missing title_id");
        return -1;
    }
    if (restored_count) *restored_count = 0;

    DIR *dir = opendir(APP_BASE);
    if (!dir) {
        if (err) snprintf(err, err_cap, "cannot open %s", APP_BASE);
        return -1;
    }

    char game_path[512] = "";
    struct dirent *de;
    while ((de = readdir(dir))) {
        if (strcasestr(de->d_name, title_id)) {
            snprintf(game_path, sizeof(game_path), "%s/%s", APP_BASE, de->d_name);
            break;
        }
    }
    closedir(dir);

    if (game_path[0] == '\0') {
        if (err) snprintf(err, err_cap, "title %s not found in %s",
                          title_id, APP_BASE);
        return -1;
    }

    int count = 0;
    walk_and_restore(game_path, &count);
    if (restored_count) *restored_count = count;

    if (count == 0) {
        if (err) snprintf(err, err_cap, "no .bak files found for %s", title_id);
    }

    return 0;
}
