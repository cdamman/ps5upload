# Console Health Check — Design

**Status:** approved for implementation
**Date:** 2026-08-20

## Goal

One screen a user opens to answer: *is my jailbroken console set up
correctly, is ps5upload working correctly, and is anything wrong?* —
and, where we safely can, a button that fixes what we found.

## Why this exists

Support traffic on this project is dominated by states the user cannot
see: a payload that never loaded, a payload built from a different
version than the desktop app, a `/data` partition with no room left, a
registry layer that silently resolves to NULL. Every one of those is
mechanically detectable. Today the user learns about them by a feature
failing in a confusing way.

CE-108262-9 (2026-08-20) is the motivating case. Sony defines it as "an
error occurred while reading the system software or application data" —
a general software crash. Ours came from unserialized Sony API calls.
The user had no way to see anything was wrong until the console shut
down.

## Principles

1. **Never invent a check we cannot actually perform.** A check that
   guesses is worse than no check. Where the console genuinely does not
   expose something (see [[hardware-baseline-sensors]]), the result is
   `skip` with the reason — not `pass`, and not `fail`.
2. **Separate "not supported here" from "broken."** On retail firmware
   many things are legitimately unavailable. Reporting those as
   failures trains users to ignore the screen.
3. **Fixes are explicit and reversible.** Nothing destructive runs
   without the user pressing a specific button that names what it will
   delete. Cleanup only ever touches paths this tool created.
4. **Guidance where we cannot act.** Rebuilding the console database
   cannot be automated. Say so, and give the Safe Mode steps.

## Data model

```
CheckStatus = pass | warn | fail | skip
CheckCategory = connectivity | runtime | storage | system | remoteplay | hygiene

HealthCheck {
  id           stable slug, e.g. "payload_version_match"
  title        short human label
  category     CheckCategory
  status       CheckStatus
  detail       what we actually observed, with numbers
  remedy       what the user should do, when status != pass
  fix          Option<FixAction>   // present only when we can act
}

HealthReport {
  ran_at, addr, duration_ms
  checks: Vec<HealthCheck>
  summary { pass, warn, fail, skip }
}
```

`fix` is an enum, not a free-form command, so the UI cannot be tricked
into asking the engine to run something arbitrary.

## The checks

### connectivity
- `mgmt_port_reachable` — management port answers a frame.
- `transfer_port_reachable` — transfer port accepts a connection.
  Distinguishes "payload down" from "wrong port" (`wrong_port` is a
  real protocol reply and a common misconfiguration).

### runtime
- `payload_version_match` — payload build version vs engine version.
  A mismatch is the single most common cause of "feature does nothing".
- `sony_symbols_resolved` — `symbols_ok` / `registry_err` from the
  readiness frame. Catches the `-lSceRegMgr` class of failure, where
  every registry call silently no-ops.
- `firmware_detected` — `fw_magic` decodes to a plausible BCD version.
  Guards the 5.16/9.96 decoding bug class.
- `duplicate_payload` — more than one helper instance listening.

### storage
- `internal_free_space` — warn <10% free, fail <5%.
- `data_partition_writable` — create + delete a probe file under
  `/data/ps5upload/`.
- `tool_dirs_present` — the directories the tool needs exist
  (`cheats`, `backups`, `spool`, `tx`, `runtime`, …). Fixable.
- `extended_storage` — mounted and writable, or `skip` if none.

### system
- `clock_sane` — console time vs host time. A wrong clock breaks
  licence checks and makes logs unreadable. Fixable.
- `appdb_readable` — informational. The PS5 ships no `libSceSqlite`
  (see [[appdb-sqlite-never-resolves]]), so `sqlite_unavailable` is a
  `skip`, never a `fail`.

### remoteplay
- `rp_service_enabled` — registry service flag. Fixable.
- `rp_account_activated` — account has an id and `np` type.

### hygiene
- `junk_files` — leftover staging packages, partial transfers and
  debug logs under tool-owned paths, with a total size. Fixable.

## Fix actions

| Action | Does | Risk |
|---|---|---|
| `CreateToolDirs` | mkdir the missing tool directories | none |
| `CleanJunk` | delete leftover staging/partial/debug files under `/data/ps5upload/**` only | named files listed before deletion |
| `EnableRemotePlay` | set the Remote Play service registry flag | reversible in Settings |
| `SyncClock` | set console time from host | reversible |

Guidance-only (no button, instructions shown):
- Rebuild Database (Safe Mode)
- Reload the payload (version mismatch)
- Free space (storage full)

`CleanJunk` never walks outside `/data/ps5upload/`. It reuses the
existing path allowlist rather than introducing a second one.

## Non-goals

- No automated database rebuild, factory reset, or firmware action.
- No "fix everything" button. Each fix is chosen individually.
- No claim of console safety. This tool drives a jailbroken console;
  see DISCLAIMER.md.

## Testing

Pure scoring/classification logic lives in functions with no I/O so it
is unit-testable: thresholds, status roll-up, junk classification,
firmware plausibility. The network-dependent scan is exercised by an
`#[ignore]`d live test against a real console, following the existing
`live_*` convention.
