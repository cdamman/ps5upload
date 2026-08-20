# Remote Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Remote Play work in ps5upload — fix the broken pairing, then tell the user exactly what is missing and let them fix it from one screen.

**Architecture:** Sony's Remote Play APIs are called **directly** from our payload (no ptrace — proven to work on hardware). Pure logic (registry key derivation, readiness rules) lives in header-only cores with host self-tests, matching `hw_guard.h` / `appdb_scan.h`. New FTX2 frames expose it; the engine proxies; one React screen renders a readiness checklist.

**Tech Stack:** C payload (PS5 Payload SDK, `-Wall -Wextra -Werror`), Rust engine (Axum), React/TS client, host self-tests via `make test-payload`.

**Spec:** `docs/superpowers/specs/2026-08-20-remote-play-design.md`

## Global Constraints

- `sceRemoteplayInitialize` is `(void*, size_t)`, always called `(0, 0)`.
- `sceRemoteplayGeneratePinCode` is `(uint32_t* pin)` — ONE out-pointer. The PIN is a `uint32_t` rendered as 8 zero-padded digits.
- `sceRemoteplayNotifyPinCodeError` is `(int)`, called with `1` to clear stale state.
- Registry entry number: `(slot < 1 || slot > max) ? fallback : (slot - 1) * stride + base`. Already implemented as `rp_regmgr_ent_num`.
- Global service key `REMOTEPLAY_rp_enable` = `1098973184`.
- Per-user key `USER_01_16_REMOTEPLAY_rp_enable(slot)` = `ENT_NUM(slot, 16, 65536, 125859841, 127170561)` — **FW 10.00+ only**.
- Registration table, 32 slots: `user_id` base `1090584832`, `regist_key` base `1090585088`, `aes_key` base `1090585344`, `client_type` base `1090585600`; stride `65536`, fallbacks `1092681984`/`1092682240`/`1092682496`/`1092682752`.
- Firmware magic is BCD-ish: 9.60 = `0x09600000`, 10.00 = `0x10000000`, 12.70 = `0x12700000`. Read via `kernel_get_fw_version()`; treat `0` as unknown and **fail closed**.
- New FTX2 frame numbers start at **248** (247 is the highest currently used).
- **No writes to account identity in this plan.** Activation and NP sign-in are Task 7 (a spike only).
- Never `cargo fmt --all`; fix only your own hunks.

---

## File Structure

| File | Responsibility |
|---|---|
| `payload/include/rp_keys.h` | **New.** Pure registry-key derivation + firmware gating. Header-only, host-testable. |
| `payload/tests/rp_keys_selftest.c` | **New.** Host tests for the above. |
| `payload/src/remoteplay.c` | Fix arities; add per-user enable, readiness snapshot, device table. |
| `payload/src/runtime.c` | New FTX2 frames 248–251. |
| `engine/crates/ps5upload-core/src/remoteplay.rs` | Client-side calls for the new frames. |
| `engine/crates/ps5upload-engine/src/lib.rs` | Routes. |
| `client/src/screens/RemotePlay/index.tsx` | Readiness checklist UI. |

---

### Task 1: Fix the arities — make pairing work at all

**Files:**
- Modify: `payload/src/remoteplay.c`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `remoteplay_request()`; PIN stored in `g_rp_pin` as 8 digits.

- [ ] **Step 1: Correct the typedefs**

In the typedef block near the top:

```c
/* Arity confirmed against three independent implementations (linkdev,
 * ps5-remoteplay-get-pin, ActRemoteLink) and verified on hardware: the
 * previous `(void)` declaration made every call fail 0x80FC0001 because
 * the callee read garbage registers. */
typedef int (*rp_init_fn)(void *opt, size_t opt_size);
/* Writes the PIN through its ONLY argument. The previous
 * `(user_id, char*, size_t)` form passed an integer where the callee
 * writes — a wild pointer store, not a PIN. */
typedef int (*rp_gen_pin_fn)(uint32_t *out_pin);
typedef int (*rp_notify_pin_err_fn)(int errcode);
```

- [ ] **Step 2: Correct the call sites**

Replace the `g_init()` call with `g_init(0, 0)`.

Replace the PIN generation block:

```c
        /* Generate the pairing PIN. Sony returns it as a raw 32-bit
         * number; clients show it as 8 digits, zero-padded. */
        uint32_t pin_raw = 0;
        rc = g_gen_pin(&pin_raw);
        if (rc != 0) {
            pthread_mutex_lock(&g_rp_mtx);
            g_rp_state = RP_STATE_FAILED;
            snprintf(g_rp_err, sizeof(g_rp_err),
                     "sceRemoteplayGeneratePinCode failed: 0x%08X", (unsigned)rc);
            pthread_mutex_unlock(&g_rp_mtx);
            return -1;
        }
        char pin[16];
        snprintf(pin, sizeof(pin), "%08u", (unsigned)pin_raw);
```

Replace both `g_notify_pin_err()` calls with `g_notify_pin_err(1)`.

- [ ] **Step 3: Build**

Run: `make payload 2>&1 | tail -2`
Expected: `✓ Built payload/ps5upload.elf` with no warnings (the tree is `-Werror`).

- [ ] **Step 4: Verify on hardware**

Load and probe. The console must have a user logged in at the TV.

```bash
PS5_IP=192.168.86.99 ./tests/lab/send-payload.sh payload/ps5upload.elf
```

Then from the engine workspace, call `remoteplay_request` / `remoteplay_status`
against `<ip>:9114`. Expected: state leaves `idle`, and either reaches
`waiting` with an 8-digit PIN, or fails with a *precondition* message such as
`no foreground user` — **not** `sceRemoteplayInitialize failed`.

If it still reports `sceRemoteplayInitialize failed: 0x80FC0001`, stop: the
arity fix did not take.

- [ ] **Step 5: Commit**

```bash
git add payload/src/remoteplay.c
git commit -m "fix(remoteplay): correct Sony API arities

sceRemoteplayInitialize takes (void*, size_t) and must be called (0,0);
declaring it (void) made every call fail 0x80FC0001 on garbage registers,
which is why Remote Play never worked. GeneratePinCode takes a single
out-pointer, so the old three-argument call passed an integer where the
callee writes the PIN."
```

---

### Task 2: Registry keys and firmware gating as a testable core

**Files:**
- Create: `payload/include/rp_keys.h`
- Create: `payload/tests/rp_keys_selftest.c`
- Modify: `Makefile` (register the selftest)

**Interfaces:**
- Produces:
  - `uint32_t rp_key_service_enable(void)`
  - `uint32_t rp_key_user_enable(uint32_t slot)`
  - `uint32_t rp_key_regist_user_id(uint32_t slot)`
  - `uint32_t rp_key_regist_key(uint32_t slot)`
  - `uint32_t rp_key_regist_client_type(uint32_t slot)`
  - `int rp_fw_has_per_user_enable(unsigned int fw_magic)`

- [ ] **Step 1: Write the failing test**

Create `payload/tests/rp_keys_selftest.c`:

```c
/* Host-side tests for Remote Play registry key derivation.
 *
 * These are plain arithmetic, but they are arithmetic that writes to the
 * console's registry — a wrong base silently writes the wrong setting,
 * which is far worse than a crash. The expected values below come from
 * Sony's own SCE_REGMGR_ENT_NUM macro as published in ps5-payload-dev's
 * regmgr.h. */
#include <stdio.h>
#include "../include/rp_keys.h"

static int failures = 0;
#define CHECK(expr)                                                     \
    do {                                                                \
        if (!(expr)) {                                                  \
            fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expr);     \
            failures++;                                                 \
        }                                                               \
    } while (0)

int main(void) {
    /* Global service toggle. */
    CHECK(rp_key_service_enable() == 1098973184u);

    /* Per-user enable: ENT_NUM(slot, 16, 65536, 125859841, 127170561). */
    CHECK(rp_key_user_enable(1) == 125859841u);
    CHECK(rp_key_user_enable(2) == 125859841u + 65536u);
    CHECK(rp_key_user_enable(16) == 125859841u + 15u * 65536u);
    /* Out of range falls back, exactly like Sony's macro. */
    CHECK(rp_key_user_enable(0) == 127170561u);
    CHECK(rp_key_user_enable(17) == 127170561u);

    /* Registration table, 32 slots. */
    CHECK(rp_key_regist_user_id(1) == 1090584832u);
    CHECK(rp_key_regist_user_id(32) == 1090584832u + 31u * 65536u);
    CHECK(rp_key_regist_user_id(33) == 1092681984u);
    CHECK(rp_key_regist_key(1) == 1090585088u);
    CHECK(rp_key_regist_client_type(1) == 1090585600u);

    /* Firmware gating: the per-user toggle arrived in 10.00. */
    CHECK(!rp_fw_has_per_user_enable(0x09600000u));  /* 9.60  */
    CHECK(rp_fw_has_per_user_enable(0x10000000u));   /* 10.00 */
    CHECK(rp_fw_has_per_user_enable(0x10010000u));   /* 10.01 */
    CHECK(rp_fw_has_per_user_enable(0x12700000u));   /* 12.70 */
    /* Unknown firmware must fail CLOSED — never guess that a write is safe. */
    CHECK(!rp_fw_has_per_user_enable(0u));

    printf("rp_keys_selftest: %s\n", failures == 0 ? "ALL PASS" : "FAILED");
    return failures == 0 ? 0 : 1;
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cc -O2 -Wall -Wextra -Werror -o /tmp/rp-keys payload/tests/rp_keys_selftest.c`
Expected: FAIL — `rp_keys.h` does not exist.

- [ ] **Step 3: Write the header**

Create `payload/include/rp_keys.h`:

```c
#ifndef PS5UPLOAD_RP_KEYS_H
#define PS5UPLOAD_RP_KEYS_H

#include <stdint.h>

/* Remote Play registry keys, derived with Sony's entry-number formula.
 *
 * Header-only so the payload and a host-built selftest share one
 * implementation — same pattern as hw_guard.h and appdb_scan.h. Bases are
 * from ps5-payload-dev's regmgr.h.
 *
 * Getting a base wrong does not crash: it silently reads or writes a
 * DIFFERENT system setting. That is why these are pinned by tests. */

#define RP_KEY_SERVICE_ENABLE 1098973184u

/* Sony's SCE_REGMGR_ENT_NUM: out-of-range slots return the fallback. */
static inline uint32_t rp_ent_num(uint32_t slot, uint32_t max, uint32_t stride,
                                  uint32_t base, uint32_t fallback) {
    if (slot < 1 || slot > max) return fallback;
    return (slot - 1) * stride + base;
}

static inline uint32_t rp_key_service_enable(void) {
    return RP_KEY_SERVICE_ENABLE;
}

/* Per-user Remote Play permission. FW 10.00 added "choose which users can
 * connect"; this is the key behind that setting. Writing it on older
 * firmware is meaningless, so gate with rp_fw_has_per_user_enable(). */
static inline uint32_t rp_key_user_enable(uint32_t slot) {
    return rp_ent_num(slot, 16, 65536, 125859841u, 127170561u);
}

/* Paired-device table: 32 slots of registration records. */
static inline uint32_t rp_key_regist_user_id(uint32_t slot) {
    return rp_ent_num(slot, 32, 65536, 1090584832u, 1092681984u);
}
static inline uint32_t rp_key_regist_key(uint32_t slot) {
    return rp_ent_num(slot, 32, 65536, 1090585088u, 1092682240u);
}
static inline uint32_t rp_key_regist_client_type(uint32_t slot) {
    return rp_ent_num(slot, 32, 65536, 1090585600u, 1092682752u);
}

/* Does this firmware have per-user Remote Play permissions?
 *
 * Firmware magic is BCD-ish: 9.60 is 0x09600000, 10.00 is 0x10000000. A
 * magic of 0 means we could not read it — return 0 so callers fail closed
 * rather than writing a key that may not exist. */
static inline int rp_fw_has_per_user_enable(unsigned int fw_magic) {
    if (fw_magic == 0u) return 0;
    return fw_magic >= 0x10000000u;
}

#endif
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cc -O2 -Wall -Wextra -Werror -o /tmp/rp-keys payload/tests/rp_keys_selftest.c && /tmp/rp-keys`
Expected: `rp_keys_selftest: ALL PASS`

- [ ] **Step 5: Register in the Makefile**

In the `test-payload` target, before the `SDK Changer filesystem-safety` block:

```make
	@echo "Running Remote Play registry-key self-test (host build)..."
	@cc -O2 -Wall -Wextra -Werror -o /tmp/ps5upload-rp-keys-selftest \
		$(PAYLOAD_DIR)/tests/rp_keys_selftest.c
	@/tmp/ps5upload-rp-keys-selftest
	@echo "✓ Remote Play keys match Sony's entry-number formula"
```

- [ ] **Step 6: Verify and commit**

Run: `make test-payload 2>&1 | grep -c '^✓'`
Expected: one more than before (16).

```bash
git add payload/include/rp_keys.h payload/tests/rp_keys_selftest.c Makefile
git commit -m "feat(remoteplay): registry keys as a tested core

A wrong base does not crash — it silently reads or writes a different
system setting, so these are pinned by tests against Sony's published
entry-number formula. Includes the per-user enable key FW 10.00 added,
gated so unknown firmware fails closed."
```

---

### Task 3: Readiness snapshot in the payload

**Files:**
- Modify: `payload/src/remoteplay.c`
- Modify: `payload/src/runtime.c`

**Interfaces:**
- Consumes: `rp_keys.h` (Task 2).
- Produces: FTX2 frame `248` (`REMOTEPLAY_READINESS`) answering with JSON:
  `{"fw_magic":<u32>,"has_per_user":0|1,"foreground_uid":<int>,"user_slot":<int>,"account_id_b64":"…","account_id_raw":<u64>,"account_type":"np"|"","service_enabled":0|1,"user_enabled":0|1,"symbols_ok":0|1}`

- [ ] **Step 1: Add the readiness builder**

In `remoteplay.c`, add (using the existing `sys_registry_*` wrappers and the
existing account-id/base64 helpers):

```c
/* Read-only snapshot of everything that decides whether Remote Play can
 * work. Deliberately performs NO writes: the UI shows the user what is
 * wrong first, and every fix is a separate, explicit action. */
int remoteplay_readiness_json(char *out, size_t out_size) {
    int uid = 0, slot = 0, svc = 0, usr = 0;
    unsigned int fw = rp_safe_fw_version();
    uint64_t acct = 0;
    char acct_b64[32] = "";
    char acct_type[24] = "";

    if (sceUserServiceGetForegroundUser(&uid) != 0) uid = 0;
    if (uid > 0) slot = rp_slot_for_user(uid);           /* existing helper */
    if (slot > 0) {
        (void)sys_registry_get_bin(rp_key_account_id((uint32_t)slot),
                                   &acct, sizeof(acct), NULL);
        rp_b64_account(acct, acct_b64, sizeof(acct_b64)); /* existing helper */
        (void)sys_registry_get_str(rp_key_account_type((uint32_t)slot),
                                   acct_type, sizeof(acct_type), NULL);
    }
    (void)sys_registry_get_int(rp_key_service_enable(), &svc, NULL);
    if (slot > 0 && rp_fw_has_per_user_enable(fw)) {
        (void)sys_registry_get_int(rp_key_user_enable((uint32_t)slot), &usr, NULL);
    }

    return snprintf(out, out_size,
        "{\"fw_magic\":%u,\"has_per_user\":%d,\"foreground_uid\":%d,"
        "\"user_slot\":%d,\"account_id_b64\":\"%s\",\"account_id_raw\":%llu,"
        "\"account_type\":\"%s\",\"service_enabled\":%d,\"user_enabled\":%d,"
        "\"symbols_ok\":%d}",
        fw, rp_fw_has_per_user_enable(fw), uid, slot, acct_b64,
        (unsigned long long)acct, acct_type, svc ? 1 : 0, usr ? 1 : 0,
        g_resolved ? 1 : 0);
}
```

If `rp_slot_for_user`, `rp_b64_account`, `rp_key_account_type`, or
`rp_safe_fw_version` do not already exist under those names, read the file and
use the existing equivalents rather than inventing new ones — the account-id
lookup and base64 are already implemented there.

Declare it in `payload/include/remoteplay.h`.

- [ ] **Step 2: Wire the frame**

In `runtime.c`, beside the existing Remote Play frames:

```c
#define FTX2_FRAME_REMOTEPLAY_READINESS  248u
```

and in the dispatcher, next to `FTX2_FRAME_REMOTEPLAY_STATUS`:

```c
    if (hdr.frame_type == FTX2_FRAME_REMOTEPLAY_READINESS) {
        char body[512];
        int n = remoteplay_readiness_json(body, sizeof(body));
        if (n < 0 || (size_t)n >= sizeof(body)) {
            return send_frame(client_fd, FTX2_FRAME_ERROR, 0, trace_id,
                              "readiness_overflow", 18);
        }
        return send_frame(client_fd, FTX2_FRAME_REMOTEPLAY_READINESS, 0,
                          trace_id, body, (uint64_t)n);
    }
```

- [ ] **Step 3: Build and check on hardware**

Run: `make payload && PS5_IP=192.168.86.99 ./tests/lab/send-payload.sh payload/ps5upload.elf`

Expected: builds clean; the frame returns JSON whose `service_enabled` and
`foreground_uid` match what the console actually shows.

- [ ] **Step 4: Commit**

```bash
git add payload/src/remoteplay.c payload/src/runtime.c payload/include/remoteplay.h
git commit -m "feat(remoteplay): read-only readiness snapshot

Reports every precondition in one frame so the UI can tell people what is
wrong instead of failing with a Sony error code. Performs no writes —
each fix is a separate explicit action."
```

---

### Task 4: Enable actions

**Files:**
- Modify: `payload/src/remoteplay.c`, `payload/src/runtime.c`

**Interfaces:**
- Consumes: `rp_keys.h`, readiness (Task 3).
- Produces: FTX2 frame `249` (`REMOTEPLAY_ENABLE`), body `{"scope":"service"|"user"}`, replying with the same readiness JSON so the UI refreshes from truth rather than assuming success.

- [ ] **Step 1: Implement**

```c
/* Turn Remote Play on. Two scopes, because FW 10.00 split them: the
 * service toggle, and per-user permission. Re-reads and returns the full
 * readiness snapshot so the caller never has to assume the write stuck. */
int remoteplay_enable(int user_scope, char *out, size_t out_size) {
    int uid = 0, slot = 0;
    unsigned int fw = rp_safe_fw_version();

    if (!user_scope) {
        if (sys_registry_set_int(rp_key_service_enable(), 1, NULL) != 0) {
            return -1;
        }
    } else {
        if (!rp_fw_has_per_user_enable(fw)) return -2;  /* not on this FW */
        if (sceUserServiceGetForegroundUser(&uid) != 0 || uid <= 0) return -3;
        slot = rp_slot_for_user(uid);
        if (slot <= 0) return -3;
        if (sys_registry_set_int(rp_key_user_enable((uint32_t)slot), 1, NULL) != 0) {
            return -1;
        }
    }
    return remoteplay_readiness_json(out, out_size);
}
```

- [ ] **Step 2: Wire frame 249**

```c
#define FTX2_FRAME_REMOTEPLAY_ENABLE  249u
```

Dispatcher arm: parse `scope` from the request body with
`extract_json_string_field`, call `remoteplay_enable(strcmp(scope,"user")==0, …)`,
and map `-2` to error `rp_enable_unsupported_fw`, `-3` to `rp_enable_no_user`,
`-1` to `rp_enable_write_failed`.

- [ ] **Step 3: Verify on hardware**

Enable the service, then re-read readiness and confirm `service_enabled` flips
to 1. On a FW 9.60 console, the user scope must return
`rp_enable_unsupported_fw` rather than writing anything.

- [ ] **Step 4: Commit**

```bash
git add payload/src/remoteplay.c payload/src/runtime.c payload/include/remoteplay.h
git commit -m "feat(remoteplay): enable the service and per-user permission

Returns the re-read readiness snapshot rather than a bare ok, so the UI
reflects what the console actually holds. Per-user writes are refused on
firmware without the setting instead of writing a key that may not exist."
```

---

### Task 5: Paired-device list

**Files:**
- Modify: `payload/src/remoteplay.c`, `payload/src/runtime.c`

**Interfaces:**
- Produces: FTX2 frame `250` (`REMOTEPLAY_DEVICES`) →
  `{"devices":[{"slot":1,"user_id":123,"client_type":2,"registered":1}, …]}`

- [ ] **Step 1: Implement**

```c
/* Enumerate the 32-slot registration table. A slot with user_id 0 is
 * empty. The registration and AES keys are deliberately NOT reported —
 * they are pairing secrets and the UI has no use for them. */
int remoteplay_devices_json(char *out, size_t out_size) {
    size_t n = 0;
    n += (size_t)snprintf(out + n, out_size - n, "{\"devices\":[");
    int first = 1;
    for (uint32_t slot = 1; slot <= 32; slot++) {
        int user_id = 0, client_type = 0;
        if (sys_registry_get_int(rp_key_regist_user_id(slot), &user_id, NULL) != 0) {
            continue;
        }
        if (user_id == 0) continue;
        (void)sys_registry_get_int(rp_key_regist_client_type(slot),
                                   &client_type, NULL);
        if (n + 96 >= out_size) break;   /* leave room for the tail */
        n += (size_t)snprintf(out + n, out_size - n,
                              "%s{\"slot\":%u,\"user_id\":%d,"
                              "\"client_type\":%d,\"registered\":1}",
                              first ? "" : ",", slot, user_id, client_type);
        first = 0;
    }
    n += (size_t)snprintf(out + n, out_size - n, "]}");
    return (int)n;
}
```

- [ ] **Step 2: Wire frame 250** the same way as Task 3's frame.

- [ ] **Step 3: Verify on hardware** — pair a device with Chiaki, then confirm it appears.

- [ ] **Step 4: Commit**

```bash
git add payload/src/remoteplay.c payload/src/runtime.c payload/include/remoteplay.h
git commit -m "feat(remoteplay): list paired devices

Reads the 32-slot registration table. Pairing secrets (regist_key,
aes_key) are deliberately not reported — the UI has no use for them and
they should not travel over the wire."
```

---

### Task 6: Engine routes and the readiness screen

**Files:**
- Modify: `engine/crates/ps5upload-core/src/remoteplay.rs`
- Modify: `engine/crates/ps5upload-engine/src/lib.rs`
- Modify: `client/src/screens/RemotePlay/index.tsx`
- Modify: `client/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes: frames 248/249/250.
- Produces: `GET /api/ps5/remoteplay/readiness`, `POST /api/ps5/remoteplay/enable` (`{"scope":"service"|"user"}`), `GET /api/ps5/remoteplay/devices`.

- [ ] **Step 1: Core calls**

Follow the existing `remoteplay_status` shape exactly: connect, send frame,
match on `FrameType`, `bail!` on `FrameType::Error` with the payload's message,
`serde_json::from_slice` into a typed struct. Add
`RemotePlayReadiness { fw_magic: u32, has_per_user: bool, foreground_uid: i32, user_slot: i32, account_id_b64: String, account_id_raw: u64, account_type: String, service_enabled: bool, user_enabled: bool, symbols_ok: bool }` with `#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]`.

The payload sends `0`/`1` integers for the booleans; add
`#[serde(deserialize_with = "…")]` or make them `u8` and convert — do **not**
assume serde will coerce, which is the failure mode recorded in
`payload-engine-json-key-contract`.

- [ ] **Step 2: Routes** — mirror the three existing remoteplay routes.

- [ ] **Step 3: Screen**

Render a checklist where every failing row carries its fix. Rows, in order:
helper connected; foreground user; account activated (`account_id_raw != 0 &&
account_type == "np"`); Remote Play service (`service_enabled`, fix = enable
service); enabled for this user (**only when `has_per_user`**, fix = enable
user). Below it, the existing pair button, PIN, account id, countdown, and the
device list.

Copy rules: name the console and firmware; never show a raw Sony error code
without a plain-English line above it; when a row cannot be fixed from here
(activation), say what to do instead rather than offering a dead button.

- [ ] **Step 4: Gate**

Run: `npm run validate 2>&1 | tail -3`
Expected: `all selected checks passed`. New i18n keys must be added to
`en.ts` and either translated or allow-listed, or the i18n gate fails.

- [ ] **Step 5: Commit**

```bash
git add engine client
git commit -m "feat(remoteplay): readiness API and checklist screen

Every failing precondition is a row with its own fix, so nobody needs to
know the recipe or read a guide. The per-user row only appears on firmware
that has the setting."
```

---

### Task 7: SPIKE — NP sign-in (`auth.dat` / `config.dat`)

**This task ships no product code.** Its output is an answer.

**Files:**
- Create: `docs/superpowers/specs/2026-08-20-np-signin-findings.md`

- [ ] **Step 1: Read what a working user has**

On a console with a working account, read
`/system_data/priv/home/<user_id_hex>/config.dat` and `np/auth.dat` via the
payload's existing FS_READ. Record sizes and whether the documented offsets
(`0x108` np email, `0x1AD` online id, `0x177` account type, `0x50` login flag,
`0x1F8` sub-account) hold on our firmwares.

- [ ] **Step 2: Answer three questions in the findings doc**

1. Can `config.dat` be produced by copying the console's own file and patching
   those offsets — i.e. do we need no foreign template?
2. Is `auth.dat` identical across users/consoles (a constant), or per-account?
   If per-account, what varies?
3. Does an account that has NP files but no PSN link actually **connect** in
   Chiaki, or only pair?

- [ ] **Step 3: Recommend**

Either "safe to implement, here is the write plan" or "not yet — here is what
is still unknown". Do not write account identity to a console until this
question is answered; a wrong `auth.dat` is a support burden and a wrong
`account_id` can cost someone their saves.

- [ ] **Step 4: Commit the findings**

```bash
git add docs/superpowers/specs/2026-08-20-np-signin-findings.md
git commit -m "docs: NP sign-in spike findings"
```

---

## Self-Review

**Spec coverage:** arity fixes → Task 1. Per-user key + FW gating → Task 2. Readiness (all preconditions) → Task 3. Enable actions → Task 4. Device list → Task 5. UI/UX and copy rules → Task 6. Activation + NP sign-in → Task 7, deliberately a spike, matching the spec's statement that this mechanism is not yet fully understood. Direct-calls-no-ptrace → Task 1 keeps the existing direct calls and adds none. Safety model → enforced by Tasks 3–6 performing no identity writes at all.

**Deferred deliberately:** activation writes, save-backup gating, and the Slot-1 guard all belong to the phase that Task 7 unblocks. They are in the spec and must not be implemented before the spike answers.

**Type consistency:** `rp_key_*` names are identical in Tasks 2–5. `remoteplay_readiness_json(char*, size_t)` is defined in Task 3 and reused in Task 4. Frame numbers 248/249/250 are allocated once each. `RemotePlayReadiness` field names match the payload's JSON keys exactly — the snake_case contract that `payload-engine-json-key-contract` exists to protect.

**Known risk:** Task 3's snippet assumes helper names (`rp_slot_for_user`, `rp_b64_account`, `rp_safe_fw_version`) that may differ in the real file; the step says to use the existing equivalents rather than invent. That is the one place an implementer must read before writing.
