# Documentation refresh — design

**Date:** 2026-08-09 (revised 2026-08-10)
**Status:** approved, not yet executed
**Baseline:** v5.1.8 + branch `fix/appdb-ftp-smb-silent-failures`

## Why

The docs describe a v3-era product. README covers roughly 13 features
against 43 shipping screens, and `engine/README.md` and
`payload/README.md` still say the directories are *"reserved for"* a
rewrite whose *"planned responsibilities"* have been shipping for three
major versions.

The original framing of this work was that the docs were **incomplete**.
Exercising the features against real hardware showed that framing was
wrong: a meaningful share of what is written is **inaccurate**, which is
worse, because a reader cannot tell which half to trust.

## What we established (all hardware-verified unless noted)

Test rig: PS5 Pro `CFI-7019` on FW 9.60, PS5 Phat `CFI-1115A` on FW 5.10.

### Firmware support has two different ceilings, and the docs conflate them

| Ceiling | Value | Evidence |
|---|---|---|
| Payload compatibility | **1.00 – 13.60** | The SDK's `crt/kernel.c` offset table, read directly. Discrete case list topping out at `0x13600000`; unknown FW returns `-ENOSYS`. |
| Practical usability | **1.00 – 12.70** | Gated by the third-party ELF loader, which needs a kernel exploit. UMTX covers ≤ 5.50; the Y2JB + P2JB chain covers 10.20 – 12.70. Above 12.70 the SDK has offsets but no public exploit exists. |

README currently prints one fuzzy range ("roughly 4.x through 13.x").
It should state both ceilings and say plainly that the loader is the
practical gate.

Firmware versions are **BCD**: 9.60 is `0x09600000`, not `0x09060000`.

### Claims contradicted by hardware

| Doc claim | Reality |
|---|---|
| "plus the PS5 date/time, refreshed live" | `time/get` returns `ok:false` on 9.60. Remove. |
| "a reading may show `—`" (sensors) | Too vague. CPU/SoC/M.2 temps and CPU frequency **work**; SoC clock, SoC power, CPU usage and fan duty **do not**. Name them. |
| Game Activity "play-time tracking" | Two mechanisms with different scope — see below. |
| Drive sensors | `storage[]` populated; `drives[]` empty — no per-drive SMART/temperature on these consoles. |

### Features whose behaviour changed on this branch

These need documenting as they now are, not as they were:

- **Game Activity** has two independent sources. The watcher polls
  `KERN_PROC` every 30 s, so it catches *any* launch including a
  controller launch — but only while the payload is loaded, and only at
  30 s resolution. "Recently Played" reads app.db and was dead on every
  firmware until fixed.
- **FTP server** works. Downloads previously wedged the console; the
  default port collided with `ftpsrv.elf`. Both fixed.
- **SMB browser** is engine-side only — it browses a LAN server to *your
  computer*, with no PS5 path at all, and a 2 GiB in-memory cap.
- **SDK Version Changer** is step 2 of a four-step backport and does
  nothing visible alone. It cannot touch signed SELFs, which is what
  retail installs are.
- **Game Metadata** (was "TMDB" — not The Movie Database) now reads the
  console instead of scraping a storefront that returns empty JSON.
- **Fakelib** screen is new.

### Undocumented but shipping

Game Hub, Cheats, Save data, Backup/restore, FTP server, SMB browser,
nanoDNS, Remote Play, Processes, Profile/users, Fan Curve, Game Activity,
SDK Changer, Game Metadata, FW Spoof, Shell, Disk Usage, Stats, Tasks,
Audit Log, Bug report, Dashboard, Fakelib, multi-console.

## Approach

Four rounds, each independently committable and gated by
`npm run validate`. Front-loads *wrong* over *incomplete*, so stopping
early still removes misinformation.

**R1 — Truth.** Rewrite `engine/README.md`, `payload/README.md` and
`tests/lab/README.md` from placeholders to what they are. Drop README's
`2.2.26` reference. Re-banner `docs/v5-design.md` and siblings as
historical rather than *"PLANNING — no v5 code written yet"*.

**R2 — Coverage and correction.** Restructure README's feature list into
~10 capability areas covering all 43 screens, each linking into the FAQ.
Add FAQ sections for the undocumented features. Correct the contradicted
claims above.

**R3 — Testing docs.** Refresh `TESTING.md`: the real three-tier gate,
`make android-*`, the Docker/webui images, the SDK pin, and a
"point it at your console" section using `PS5_HOST` / `PS5_LOADER_PORT` /
`PS5_ADDR` with a gitignored `lab.env.local`.

**R4 — Verify.** Re-probe hardware for every claim; run the full gate.

## Key constraints

- **`FAQ.md` and `CHANGELOG.md` are `include_str!`'d into the Tauri
  binary** (`client/src-tauri/src/commands/app_info.rs`) and rendered
  in-app. The FAQ screen splits on `## ` and filters by section, so every
  H2 is a searchable help topic — which is why depth belongs in the FAQ
  and the README stays a capability map.
- **No bare version numbers in descriptive prose.** `VERSION` is
  canonical and `update-version.js --check` gates `validate`, but it only
  covers files it knows about — which is how `2.2.26` survived. Keep the
  FAQ's existing `(3.3.25+)` "since" tags; never write "the 5.1.8 X does Y".
- **Committed defaults stay generic.** Document `PS5_HOST` / `PS5_ADDR`
  overrides; keep the maintainer's LAN out of a public repo.
- **Any new user-facing string needs an `en.ts` key**, then a translation
  or a scoped allowlist entry. Never `i18n:bootstrap`.

## Out of scope

`CHANGELOG.md` (append-only history), the `docs/v5-*.md` specs beyond a
status banner, `.codex/repo-map.md` (gitignored local notes), and
translating the newly added keys.
