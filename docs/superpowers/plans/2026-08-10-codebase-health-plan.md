# Codebase health — analysis and plan

**Date:** 2026-08-10
**Baseline:** v5.2.0 + `fix/v5.2.1-stabilization` (24 files uncommitted)
**Method:** measured, not estimated. Every claim below has a command
behind it; where a hypothesis failed, that is recorded rather than
quietly dropped.

## What is already healthy

Worth stating, because it bounds the work and stops good properties from
being "improved" away.

| Area | Measurement |
|---|---|
| Payload memory discipline | **0** unbounded `strcpy`/`strcat`/`sprintf`; 521 bounded `snprintf` |
| Rust panic surface | **29** production sites, mostly a deliberate debug hook and comments — the other 249 are in integration tests, where `unwrap` is correct |
| Stale markers | **0** `TODO`/`FIXME`/`HACK`/`XXX` in tracked source |
| Payload logic tests | **9** host self-tests, run under `-Wall -Wextra -Werror` by `make test-payload` |
| Gate | Comprehensive and green: fmt, clippy `-D warnings`, tests, typecheck, lint, i18n, build |

Two hypotheses I formed and then disproved:

- *"Unguarded destructive actions are a P0."* `powerShutdown`, `ufsFsck`
  and `pkgDirectMount` have **no callers**. Not live risk.
- *"30 API functions are dead."* Wrong pattern — several are passed as
  function references (`run("eject", peripheralEject)`). The real number
  is **17**.

---

## P1 — `runtime.c` is the structural bottleneck

**18,623 lines. 103 frame handlers. One file.**

| Function | Lines |
|---|---|
| `handle_shell_builtin` | **1,981** |
| `handle_binary_frame` | **1,691** |

Those two alone are a fifth of the file, and one of them is a single
function larger than most modules in the tree.

This is not a style objection. It has already cost real money twice:

1. The app.db reader had to be **extracted** from this file before it
   could be tested at all — that extraction is what revealed the
   heuristic was returning metadata blobs instead of title names.
2. A duplicate app.db implementation survived here for months *because
   the file is too large to audit*, and it silently fed package install
   verification.

**Plan.** Split by domain, following the pattern the payload already
uses. Each extracted unit gets a header in `include/` and, where the
logic is separable from the console, a host self-test:

- `handle_shell_builtin` → `src/shell_builtin.c` + `include/shell_builtin.h`.
  Command parsing and output formatting are pure and testable; only the
  syscalls need the console.
- `handle_binary_frame` → a dispatch table keyed by frame type, so
  adding a frame is a table entry rather than an edit inside a
  1,691-line function.
- Transfer internals (`runtime_write_shard_*`, `runtime_apply_spool`,
  `handle_stream_shard`, `handle_packed_shard`) → `src/shard_io.c`.
- `handle_fs_mount` (446 lines) → `src/mount_ops.c`.

Do these one at a time, each behind the full gate plus a hardware smoke,
because this file is the transfer path. Expected result: `runtime.c`
under ~8k lines and every extracted unit independently testable.

**Effort:** large. **Risk if skipped:** the next duplicate hides just as
long as the last one did.

---

## P2 — the screen layer is untested, and that is where the bugs are

**4 of 44 screens have a test.** 81% of the 85 client test files sit in
`lib/` (49) and `state/` (20).

All three UI bugs found this session were in untested screens:

| Bug | Screen | Consequence |
|---|---|---|
| `handleStart` only caught throws, so `ok:false` in an HTTP 200 showed nothing | `FtpServer` | Start button looked dead |
| Default value `smb://192.168.1.100:445` could not be parsed by the backend | `SmbBrowser` | Connect failed in 50 ms, before any network |
| Default `0x09060000` is not a real firmware (BCD: 9.60 is `0x09600000`) | `SdkChanger` | Patching the wrong version |

Every one is *pure logic reachable without rendering* — a default value,
an error branch, a conversion. They need no DOM.

**Plan.** Not "test all 44 screens". Test the two things that keep
breaking:

1. **Defaults are valid.** One table-driven test asserting every shipped
   default parses/round-trips through the code that consumes it. Would
   have caught two of the three above.
2. **Failure branches surface.** For each screen with an action button, a
   test that a rejected action produces visible error state. Extract
   handlers (`handleStart`-style) out of components so they are callable
   without rendering; that refactor is most of the work and is worth it
   on its own.

**Effort:** medium. **Risk if skipped:** this exact bug class recurs —
it has three times already.

---

## P3 — engine modules with no tests

**12 of 36** `ps5upload-core` modules have no `#[cfg(test)]` block:

`app_lifecycle`, `backup`, `cleanup`, `diagnostics`, `fan_curve`,
`notif`, `remoteplay`, `saves`, `smp_meta`, `users` (plus `lib`, `log`).

`backup`, `saves` and `users` touch user data. `diagnostics` is what
`appdb_has_title` calls, so it gates install verification.

**103 HTTP routes against 5 integration test files.**

**Plan.** Prioritise by blast radius, not by coverage percentage:
`backup` and `saves` first (data loss), then `users` (account state),
then `diagnostics` (install verification correctness). Mock-server
integration tests already exist as a pattern — extend rather than invent.

**Effort:** medium. **Risk if skipped:** a silent regression in backup or
save handling is discovered by a user, not a test.

---

## P4 — close the `ok:false` pattern properly

7 of 31 `ok`-carrying API functions are guarded. Most of the rest are
queries (where `ok:false` legitimately means "unsupported here") or
unreferenced, so the live exposure is small — but the *pattern* is what
bit us, not any individual call site.

**Plan.** Make it structural rather than a checklist:

- An ESLint rule, in the repo's existing `client/eslint-rules/`, that
  flags an awaited API call whose response type has `ok` and is neither
  passed through `assertOk` nor inspected.
- Split the response types so the compiler carries the distinction:
  action endpoints return a type that must be unwrapped; status
  endpoints return one where `ok` is ordinary data.

**Effort:** small. **Leverage:** high — it converts a recurring review
question into a build failure.

---

## P5 — hygiene

- **24 uncommitted files** (+1,311 / −409), gate-green but unlanded.
  This is the most fragile thing in the tree right now: it is not on a
  commit, so it is not on a branch, so it is one accident from gone.
  Land it before starting anything above.
- **17 unreferenced API functions** (`fsIndexStart`, `lwfsMount`,
  `ufsFsck`, `zipInspect` — superseded by `zipInspectStream` — …). Either
  wire them up or delete them; each is a maintenance cost with no user.
- **`fwVersion.ts` and `ps5Firmware.ts`** are complementary (SDK-hex
  conversion vs. parsing the kernel string) but the names do not say so.
  Merge, or rename to `sdkVersionHex` / `kernelFirmwareString`.
- **Docs**: R1–R4 landed. `CHANGELOG.md` and the FAQ will keep needing a
  pass per release; the constraints are recorded in
  `2026-08-09-doc-refresh-design.md`.

---

## Outcome (2026-08-12)

All five items closed, two of them by deciding *not* to do the work:

- **P5** landed (`8d90bd66`); the "17 dead API functions" turned out not to
  be dead. Most back live engine routes with browserInvoke plumbing, and
  the README advertises the engine as scriptable from CLI/CI, so they are
  the typed client for a public API. Rationale recorded in `api/ps5.ts`
  so the next audit does not delete it.
- **P4** shipped as a lint rule (`b22b3f7d`) with three allowed outcomes —
  guard, status endpoint, or an explicit `ok-checked-by-caller` marker.
  The third came from checking callers: PowerControl and PeripheralPanel
  handle refusals themselves, and forcing a throw would have replaced a
  considered message with an exception.
- **P2** shipped (`acdc6e62`, `e9a73f9e`), mutation-checked against the
  two original bugs.
- **P3** covered backup/saves/users (`f9c4fb01`); 24 -> 27 of 36 modules.
- **P1** cut `runtime.c` 18,623 -> 16,381 by removing the built-in shell
  (`8d1da717`) and the five inline transaction arms (`6780fe84`), taking
  `handle_binary_frame` from 1,691 to 556 lines.

**P1 stops here deliberately.** Moving the transaction handlers into
their own file would require exporting `runtime_acquire_tx_entry`,
`runtime_alloc_tx_entry` and `runtime_find_tx_entry` — the transaction
table's slot-locking and eviction internals — across a translation-unit
boundary. Handlers belong next to the table they lock. The defect was
never the line count; it was a 1,981-line function hiding a duplicate
reader, and that is gone.

Two bugs were found by verifying rather than by reading: extracting the
transaction arms broke `CommitTx` (`request_body` is dispatcher-filled
input, not scratch), caught by the hardware smoke; and `df` returned
truncated JSON and killed the payload, which a worktree build of the
parent commit proved pre-existing.

## Suggested order

1. **Land the uncommitted work** (P5) — everything else builds on it.
2. **P4 lint rule** — small, and stops the recurring class immediately.
3. **P2 defaults test + handler extraction** — cheap, targets proven bugs.
4. **P3 backup/saves/users tests** — before touching that code again.
5. **P1 `runtime.c` split** — largest, do it incrementally, gate plus
   hardware smoke per extraction.

P1 is the biggest investment and the one most likely to be deferred
indefinitely. It is also the one that made the other problems hard to
see, so deferring it has a compounding cost.
