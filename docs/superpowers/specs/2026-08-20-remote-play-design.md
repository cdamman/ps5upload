# Remote Play, end to end — design

**Status:** draft for review
**Date:** 2026-08-20
**Research base:** linkdev, ps5-remoteplay-get-pin (idlesauce), ActRemoteLink,
offact, ps5debug-NG — all GPLv3-compatible; ps5upload is GPLv3. Everything
below is reimplemented from the documented mechanism, not copied.

## Why now

Remote Play in ps5upload does not work at all, and I proved why on hardware:

```
sceRemoteplayInitialize failed: 0x80FC0001
```

`payload/src/remoteplay.c` declares two Sony functions with the wrong arity:

| symbol | ours | actual (3 independent sources agree) |
|---|---|---|
| `sceRemoteplayInitialize` | `(void)` | `(void*, size_t)`, called `(0,0)` |
| `sceRemoteplayGeneratePinCode` | `(user_id, char*, size_t)` | `(uint32_t* pin)` |

The first is the live blocker. I patched the arity on a test build, reloaded,
and it got past Initialize — failing on the next *precondition* instead (no
foreground user). The second is latent but worse: the callee writes the PIN
through its first argument, and we pass `uid`, an integer. That is a wild
write, not a PIN.

Everything else in that file — the dlopen strategy, the regmgr entry-number
formula, the state machine, the base64 (whose padding bug we already fixed) —
is correct and matches the references.

## What actually makes Remote Play work

Pairing and connecting are **two different gates**. Getting only the first is
why people report "pairing succeeded but Chiaki says 403".

1. **Account is activated** — `account_id` (u64), `account_type` = `"np"`,
   `account_flags` = 4098. Reboot after.
2. **Account is in an NP signed-in state** — `/system_data/priv/home/<uid
   hex>/np/auth.dat` and `config.dat` exist, and ~20 registry keys mirror
   `config.dat`'s contents. **Without this, pairing succeeds and the session
   fails with `0x80108b12` / HTTP 403.**
3. **Remote Play service enabled** — `REMOTEPLAY_rp_enable` = 1.
4. **Remote Play enabled for that specific user** — FW 10.00 added per-user
   Remote Play permissions, with a matching per-user registry key:
   `USER_01_16_REMOTEPLAY_rp_enable(slot) = ENT_NUM(slot,16,65536,125859841,127170561)`
5. **That user is the foreground user** — required when pairing *and* when
   connecting.
6. **Pair** — `Initialize(0,0)` → `NotifyPinCodeError(1)` →
   `GeneratePinCode(&pin)` → poll `ConfirmDeviceRegist(&status,&err)` for
   300 s. `status==2` paired; `status==3` failed (`0x80FC1047` wrong PIN,
   `0x80FC1040` wrong account id).
7. **Client needs the account id** as base64 of the raw 8 bytes,
   little-endian — not of the hex string.

Once paired, Remote Play works **even unjailbroken**, because the gating that
blocks it lives in ShellUI rather than in the Remote Play service.

## Scope

Own steps 1–7 and hand streaming to Chiaki / chiaki-ng / the official app. We
do not implement the streaming protocol: those clients already do it well,
and the part that is broken for users is everything *before* the stream.

## Architecture: direct calls, no ptrace

The pairing APIs are called **directly** from our payload, as linkdev does.

This is a deliberate stability choice. idlesauce reached the same functions by
ptracing SceShellUI and noted Initialize "only works from a bigapp" — but I
tested it from our elfldr-injected payload and it works. That matters because
ptracing SceShellUI is the mechanism behind the #267 console-lockup report
(see `shellui-ptrace-kills-console` in project memory). Remote Play should add
no ptrace at all.

Layers, following the existing shape:

- **payload** — `remoteplay.c` (fix arity, add per-user enable, registration
  table) and a new `np_signin.c` (activation + NP sign-in). New FTX2 frames.
- **engine** — routes over the existing management port.
- **client** — one screen driven by a readiness model.

## The NP sign-in writer

`config.dat` is a binary struct; the registry is populated *from* it. The
documented map is 7 strings and 13 integers, e.g. `0x108` → `signin_id`
(125830656), `0x1AD` → `NP_online_id` (125874188), `0x177` → account type
(125874183), `0x50` → `login_flag` (125831168), `0x1F8` → `NP_sub_account`
(125874185).

ActRemoteLink ships a fixed `config.dat` template and a fixed `auth.dat` blob.
**We do it differently**: read an existing `config.dat` from an already-valid
user on the same console, patch the identity fields, and write it for the
target user. That keeps us on the console's own firmware- and region-correct
structure instead of shipping a foreign binary, and it is a smaller thing to
maintain.

Open question to resolve during implementation: `auth.dat` appears to be an
opaque token written verbatim. If it cannot be derived or copied from an
existing user, we fall back to a generated equivalent and must verify on
hardware that a session actually connects. **This is the one step whose
mechanism we do not fully understand yet**, and the plan must treat it as a
spike rather than assume it.

## Safety model

Activation writes account identity. It can disassociate or corrupt save data,
so the UI enforces what the reference projects only document:

- **Try unmodified first.** If the readiness check shows the user could
  already work, we say so and change nothing.
- **Never offer to modify Slot 1** when it looks like a restored-backup
  account — it is usually already associated, and changing its `account_id`
  is how people lose saves. Warn and refuse by default.
- **Prefer a new user.** Guide the user to create a fresh local user (slot 2+)
  and activate that.
- **Back up saves first.** ps5upload already has save backup — the risky
  action is gated behind a one-click backup of that user's saves. No other
  tool in this space can offer that.
- **Never write blind.** Every write is preceded by a read, and every value we
  change is shown before and after.
- **Reboot honestly.** Where a reboot is required, say so and offer to do it.

## The screen

One screen, a readiness checklist where every row is a check *with its fix*:

```
Remote Play                                   Pro · FW 9.60
  ✓ Helper connected
  ✓ Foreground user: "yunpeng" (slot 3)
  ⚠ Account not activated                     [Activate…]
  ✗ Not signed in to PSN (sessions will 403)  [Fix sign-in…]
  ✗ Remote Play service disabled              [Enable]
  ✗ Not enabled for this user  (FW 10.00+)    [Enable for yunpeng]
  ── ready to pair ─────────────────────────────────────────
  [ Pair a device ]   PIN 2836 0549   ID eGlaSzwtHo8=   4:59
                      waiting → paired ✓
  Paired devices (3)  PS Vita · iPhone · PC          [Unpair]
```

Nobody should need to know the recipe, read a README, or watch a video. The
FW 10.00+ row only appears on firmware that has it, keyed off
`kernel_get_fw_version()` — which we already read with fault recovery.

## Firmware handling

Follow ps5debug-NG's pattern: an explicit table of known firmware families and
**fail closed** on anything unrecognised, with a clear message rather than a
guess. Remote Play behaviour genuinely differs across firmwares (the per-user
key is 10.00+), so the readiness model is firmware-aware by construction.

## Phasing

1. **Fix what is broken** — the two arities, plus a hardware test that pairs.
   This alone makes Remote Play work for already-activated accounts.
2. **Readiness model** — read-only checks across all layers; no writes. Users
   immediately learn *why* it does not work.
3. **Enable actions** — service and per-user `rp_enable`. Low risk, both are
   single integers we already know how to write.
4. **Registered devices** — list and unpair from the 32-slot table.
5. **Activation + NP sign-in** — the risky part, behind the safety model, with
   the `auth.dat` spike resolved first.

Each phase is useful on its own, and the risky work comes last.

## Testing

- Host-testable cores for the pure logic (key derivation, base64,
  readiness-state machine, config.dat field map), in the existing
  `payload/tests/*_selftest.c` style.
- Hardware, on both consoles (5.10 and 9.60): pair, then actually connect
  with Chiaki. **Connecting is the acceptance test, not pairing** — that is
  the whole lesson of the 403.
- A regression check that we never write account identity without a preceding
  read and an explicit confirmation.
