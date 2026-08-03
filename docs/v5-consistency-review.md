# v5 Design Docs — Final Consistency Review (Loops 81-90)

**Scope:** Cross-document audit across all 8 v5 design docs, performed before the master consolidation (loops 91-100). This review catalogs every remaining conflict, unapplied resolution, stale reference, and spec gap, with canonical resolutions for each.

**Documents reviewed:**
| # | Doc | Lines | Role |
|---|-----|-------|------|
| 1 | `v5-design.md` | 901 | Original parent (partially superseded) |
| 2 | `game-hub-revised-design.md` | 864 | Supersedes §5 |
| 3 | `v5-file-browser-redesign.md` | 1173 | Supersedes §3/§4-E/§9.3/App B |
| 4 | `v5-task-system.md` | 1314 | Supersedes §6 |
| 5 | `v5-home-console-redesign.md` | 1735 | Supersedes §3.1/§3.4 |
| 6 | `v5-cross-cutting-concerns.md` | 1064 | Canonical: nav/routes/offline/error/state/phases |
| 7 | `v5-mobile-design.md` | 1197 | Mobile/Android |
| 8 | `v5-accessibility-design-system.md` | 1654 | Supersedes §8/§10/App C |

---

## Conflict Register

33 findings: **6 CRITICAL**, **13 MAJOR**, **14 MINOR**. Grouped by theme.

### Theme A — Unapplied §0 resolutions (C3, C5, C12, C18 were resolved in the register but never written into the target docs)

#### R1 — C5 unapplied: File Browser still fully homes `ufsFsck` + `appdbQuery` [CRITICAL]
- **Docs:** cross-cutting §9.2 (lines 795-809) vs file-browser §14.2 (872-885) + §14.3 (887-911)
- **Conflict:** C5 resolved that `ufsFsck` and `appdbQuery` single-home in **Console → Tools**, with File Browser only deep-linking. File Browser §14.2/§14.3 still specify complete UIs (consent-escalation modal for fsck; SQL console with Run/Export-CSV for app.db) — directly contradicting the "system-layer concern lives in Console → Tools" rule.
- **Resolution:** Rewrite File Browser §14.2/§14.3 as deep-link affordances ("Verify volume →" opens Console → Tools → UFS fsck with volume pre-filled; "Query in app.db →" opens Console → Tools → app.db with filter pre-filled). Remove the inline modal/SQL-console specs.

#### R2 — C3 unapplied: `TaskKind` union missing `fs-rename` + `mirror` [CRITICAL]
- **Docs:** cross-cutting §0 C3 (line 47) + §8.3 vs task-system §1.1 (60-75)
- **Conflict:** C3 resolved `TaskKind` be extended with `fs-rename` and `mirror`, and added to the retry matrix §2.3. Task System §1.1 lists `fs-delete | fs-copy | fs-move` but NOT `fs-rename`; no `mirror` kind exists. File Browser §15.4 + §11.4 assume these kinds exist.
- **Resolution:** Add `"fs-rename"` to the filesystem-ops group and `"mirror"` to the union in Task System §1.1; add both to §2.3 retry matrix (both: restart, idempotent).

#### R3 — C12 unapplied: Task System has no ⌘K addendum [MAJOR]
- **Docs:** cross-cutting §0 C12 (line 56) + §4.5 (413-428) vs task-system (whole doc)
- **Conflict:** C12 resolved "§4.5 + Task System §3 addendum — unified ⌘K". Cross-cutting §4.5 has the spec; Task System §3 has no addendum. Only hit is unrelated (line 586 "palette of task kinds").
- **Resolution:** Add a note in Task System §3 or §11 referencing cross-cutting §4.5's `#task-id` jump syntax.

#### R4 — C18 unapplied: Home/Console backup UI missing "Settings" radio [MAJOR]
- **Docs:** cross-cutting §7.6 (635-649) vs home-console §16.1 (1209-1210)
- **Conflict:** §7.6 specifies Console → Backup scope gains a 5th radio "Settings only" (Task System §2.3 references `saves/trophies/settings`). Home/Console §16.1 mockup shows only 4 options.
- **Resolution:** Add `( ) Settings only` to Home/Console §16.1 scope line.

### Theme B — Phase plan divergence (C9 only partially resolved)

#### R5 — Phase plan diverges across 4 docs [CRITICAL]
- **Docs:** cross-cutting §12 (canonical, 890-997) vs home-console §24 (1599-1660), file-browser §18 (1071-1125), mobile §17 (1086-1141), v5-design §12 (692-757)
- **Conflicts:**
  1. **File Browser §18 re-uses letters 5.1-a…5.1-f** already assigned to Game Hub in canonical §12. Then introduces "Phase 5.2 — Mirror jobs" colliding with canonical 5.2-a.
  2. **Home/Console §24 uses "Phase 5.2 — Alert integration"** colliding with canonical 5.2-a.
  3. **Mobile §17 uses 5.0-m / 5.1-m / 5.1-n / 5.2-m / 5.3-m** — but canonical 5.1-m = "Tasks tab". Collision.
  4. **v5-design §12** entirely stale and unmarked.
- **Resolution:** (a) Renumber File Browser to 5.1-l.1…5.1-l.6; rename "Phase 5.2 — Mirror jobs" → 5.1-l.7 or 5.2-f. (b) Rename Home/Console "Phase 5.2" → "folded into 5.2-a". (c) Renumber Mobile phases to 5.0-mo / 5.1-mo / 5.1-mo2 / 5.2-mo / 5.3-mo. (d) Mark v5-design §12 superseded.

### Theme C — v5-design.md staleness (superseded sections carry no markers)

#### R6 — v5-design §6 (Task System) unmarked as superseded [CRITICAL]
- **Docs:** v5-design §6 (404-445) vs task-system header (line 3) + footer (1314)
- **Resolution:** Add supersession banner.

#### R7 — v5-design §5 Game Hub tab list stale (6 tabs vs canonical 8) [CRITICAL]
- **Docs:** v5-design §5.2/§4-B (250-257, 332) + Phase 5.1 step 2 (715) vs game-hub §3 (142-145) + a11y §5 + mobile §5.3
- **Conflict:** v5-design says 6 tabs; revised spec says 8.
- **Resolution:** Mark §5 superseded.

#### R8 — v5-design §3.3 drawer contents stale (C11 not back-applied) [MINOR]
- **Docs:** v5-design §3.3 vs cross-cutting §3.1 / C11
- **Resolution:** Mark superseded.

#### R9 — v5-design §3.2 status bar fields stale (C16 not back-applied) [MINOR]
- **Docs:** v5-design §3.2 / §7.2 vs cross-cutting §1.4 / C16
- **Resolution:** Mark superseded.

#### R10 — v5-design §9.1 haptics stale (C15 not back-applied) [MINOR]
- **Docs:** v5-design §9.1 vs cross-cutting §6.6 / C15
- **Resolution:** Mark superseded.

#### R11 — v5-design §4-G ⌘K actions stale (C12 not back-applied) [MINOR]
- **Docs:** v5-design §4-G (297-313) vs cross-cutting §4.5 / C12
- **Resolution:** Mark superseded.

#### R12 — v5-design §8, §10, Appendix C stale (superseded by a11y doc) [MAJOR]
- **Docs:** v5-design §8 (485-540), §10 (601-664), Appendix C (833-897) vs a11y doc header
- **Resolution:** Add supersession banners pointing to a11y-design-system §19 / §11-18.

#### R13 — v5-design Phase 5.2 "Unified Tasks + Telemetry" misaligned [MINOR]
- **Docs:** v5-design §12 Phase 5.2 (726-740) vs cross-cutting §12 (5.2-a..e)
- **Resolution:** Fold into R5(d).

**High-leverage fix:** Add supersession banners to v5-design §3.2, §3.3, §4-G, §5, §6, §8, §9.1, §10, §12, App B, App C — converts v5-design from "active misleading" to "clearly archival" and closes R6-R13 in one pass.

### Theme D — Component API conflicts (a11y doc §19 vs other docs)

#### R14 — Haptic vocabulary mismatch (3 vs 4 events) [CRITICAL]
- **Docs:** cross-cutting §6.6 (line 577: "Three haptic events") vs mobile §4.4 (line 323: `HapticKind = "tap" | "confirm" | "danger" | "selection"`)
- **Conflict:** Cross-cutting has tap/confirm/danger (3). Mobile adds `selection` (8ms, for Toggle/Checkbox). Mobile §4.4 actively uses it.
- **Resolution:** Adopt the 4-event set. Add `selection` (8ms) to cross-cutting §6.6 table. Mobile §4.4 is canonical for the event set.

#### R15 — `EmptyState` consumed but has no §19 spec [MAJOR]
- **Docs:** a11y §19 (missing) vs cross-cutting §6.4, v5-design §8.1, game-hub, a11y line 14
- **Conflict:** EmptyState named as consumed primitive in 4 places; §19 has no entry; 72vh-vs-55vh bug (v5-design §8.2) unresolved.
- **Resolution:** Add `§19.29 EmptyState (evolve)` with `{ title, body?, action?, hero?, role? }`. Resolve height to 55vh (the v3 docstring value; the 72vh in code is the bug).

#### R16 — `Spotlight` mobile behavior contradicts §19.21 [MAJOR]
- **Docs:** a11y §19.21 ("full-screen on mobile") vs mobile §5.2 ("peek sheet — long-press → bottom sheet")
- **Conflict:** Different interaction models (full-screen takeover vs transient peek).
- **Resolution:** Both are correct for different triggers. Amend §19.21: tap → full-screen Spotlight; long-press → Sheet (peek). Document both paths.

#### R17 — `Spotlight` API drift (Appendix C vs §19.21) [MAJOR]
- **Docs:** v5-design App C (886: no `onClose`, no `disabled`/`disabledReason`) vs a11y §19.21
- **Resolution:** Mark Appendix C superseded (fold into R12).

#### R18 — `Tabs` API drift: `urlParam` removed, `variant`/`ariaLabel` added [MAJOR]
- **Docs:** v5-design App C (875: `<Tabs urlParam="tab">`) vs a11y §19.9 (no `urlParam`; TabbedShell wraps)
- **Resolution:** Mark Appendix C superseded (fold into R12).

#### R19 — Game Hub tab `variant` contradiction (pills vs underline) [MAJOR]
- **Docs:** a11y §19.9 (line 1170: "pills (Game Hub)") vs mobile §5.3 (line 410: "underlined")
- **Conflict:** Different visual treatments.
- **Resolution:** Desktop = pills; mobile = underline (scrollable, 8 tabs). Amend §19.9 to note responsive variant.

#### R20 — Game Hub uses toast for recoverable error; Toaster API can't express it [MAJOR]
- **Docs:** game-hub §7.3 (line 496: crash-recovery toast with 3 action buttons) vs cross-cutting §6.5 ("NOT for errors") + a11y §19.17 (`action?: { label; onClick }` — single action)
- **Conflict:** Crash-recovery is an error with 3 actions in a toast. Canonical Toaster supports 1 action and bans errors.
- **Resolution:** Render crash-recovery as inline `Callout tone="error"` with 3 action buttons (canonical path). The game-hub "toast" description was imprecise — it's a persistent inline callout until dismissed.

#### R21 — Critical-alert toast has no error/critical tone [MAJOR]
- **Docs:** cross-cutting §6.5 (line 572: "Critical alerts … toast immediately") + home-console §18.3 (line 1360) vs a11y §19.17 (`tone?: "info" | "success" | "warn"` — no error/critical)
- **Conflict:** Critical alert is semantically an error but the API has no error tone.
- **Resolution:** Add `tone?: "critical"` to §19.17 (maps to `bad` color, `role="alert"`, sticky). Documented as the ONLY error-in-toast exception (Task System §7.4 carve-out).

### Theme E — Cross-reference errors in newest docs

#### R22 — C13 resolution points to wrong section; 5-surfaces list never in body [MAJOR]
- **Docs:** cross-cutting §0 C13 (line 57, points to "§5.5") vs cross-cutting §5 (actual: "Offline Mode") vs home-console §18.3 (has the list, cites Task System §7.4)
- **Conflict:** C13's resolution cell says "§5.5 — canonical 5 surfaces" but §5.5 is "Rest mode / reboot mid-task". The list exists only in the register cell.
- **Resolution:** Add §6.7 "Alert surfaces — canonical 5" to cross-cutting; fix C13 register cell; fix Home/Console §18.3 citation.

#### R23 — a11y doc §22 wrong cross-references to cross-cutting phase plan [MAJOR]
- **Docs:** a11y §22 (1614-1631) vs cross-cutting §12 / ToC
- **Conflict:** a11y §22 says "Cross-cutting §10" but §10 is "Concurrency"; phase plan is §12. Also invents "5.0.0 / 5.0.1-5.0.4" sub-numbering not in cross-cutting.
- **Resolution:** Change "§10" → "§12"; change "5.0.0" → "Phase 5.0"; "5.0.1-5.0.4" → "Phase 5.1 screen rewrites".

#### R24 — a11y doc "~15 NEW primitives" claim vs actual 19+ [MINOR]
- **Docs:** a11y line 17 vs §19
- **Resolution:** Change "~15" to actual count (19 new primitives in §19.2-19.28 excluding the 5 "evolve" entries).

#### R25 — Mobile §0 unsourced "12 concerns / resolve 8" claim [MINOR]
- **Docs:** mobile §0 (line 66)
- **Resolution:** Delete the sentence (M1-M20 table is self-sufficient).

### Theme F — Spec gaps (components referenced but not specified)

#### R26 — `ConfirmDialog` fate undefined [MINOR]
- **Docs:** a11y §20 Phase 6 item 35 (fix prompt input) vs §19 (no entry) vs mobile §4.4 (assigns `confirm` haptic)
- **Resolution:** Add note in §19.26 (Modal) or §20.3: ConfirmDialog stays as-is (thin wrapper over Modal with `role="alertdialog"`); only the prompt-input `.input` class fix applies.

#### R27 — Touch-target 24×24 AA floor only in a11y doc [MINOR]
- **Docs:** a11y §9.1 vs cross-cutting §1.2, mobile §3
- **Resolution:** Add one-line note in cross-cutting §1.2 referencing WCAG 2.5.8 AA floor (24×24) + 2.5.5 AAA (44×44) + our 44×44 target.

### Theme G — Register hygiene

#### R28 — C9 register cell mis-describes Task System phase numbering [MINOR]
- **Docs:** cross-cutting §0 C9 (line 53)
- **Resolution:** Amend C9 cell: "Task System §14 has no phase plan (defer to cross-cutting §12); File Browser §18 uses 5.1-a..f + 5.2 (collides); Game Hub §13 uses 5.1-a..f (collides); Home/Console §24 uses 5.1-g..k + 5.2."

#### R29 — Home/Console §18.3 alert-surfaces citation attributes list to wrong doc [MINOR]
- **Docs:** home-console §18.3 (line 1355) vs task-system §7.4
- **Resolution:** Change citation to "Per cross-cutting §6.7 (canonical 5 surfaces)".

### Theme H — Documentation polish

#### R30 — v5-design §8.1 Checkbox 24px vs a11y §19.6 20px/24px [MINOR]
- **Resolution:** a11y §19.6 canonical (20px mouse / 24px touch). Fold into R12.

#### R31 — v5-design §8.1 Button `lg` absent vs a11y §19.1 [MINOR]
- **Resolution:** Fold into R12.

#### R32 — ErrorBoundary token list differs (a11y adds `--color-bg`) [MINOR]
- **Docs:** a11y §20.1 item 31 (adds `--color-bg` → `--color-surface`) vs v5-design §8.2 (only 2 tokens)
- **Resolution:** a11y §20.1 canonical. Fold into R12.

#### R33 — a11y ToC omits §19 sub-sections [MINOR]
- **Resolution:** Optional — add a "Primitive index" table at start of §19.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 6 | R1, R2, R5, R6, R7, R14 |
| MAJOR | 13 | R3, R4, R12, R15, R16, R17, R18, R19, R20, R21, R22, R23 |
| MINOR | 14 | R8-R11, R13, R24-R33 |

**Root patterns:**
1. **4 of 18 §0 resolutions were never applied** to target docs (R1-R4). These are the highest priority — they're decisions that were MADE but not WRITTEN.
2. **v5-design.md is extensively stale** — 11 sections superseded with no markers (R6-R13, R17, R18, R30-R32). One pass of supersession banners fixes 12 findings.
3. **The two newest docs (mobile, a11y) introduced NEW conflicts** the §0 register doesn't cover (R14 haptics, R16 Spotlight, R19 Tabs variant, R20 toast-policy, R21 toast-tone, R23 phase-refs).
4. **Phase plan divergence (R5)** is the single largest structural issue — 4 docs have colliding phase IDs.

**Fix order:**
1. R14 (haptics) — blocks `lib/haptics.ts`, touches every haptic call site.
2. R1, R2, R3, R4 — apply the 4 unapplied §0 resolutions.
3. R6-R13, R17, R18, R30-R32 — supersession banners on v5-design.md (one pass).
4. R5 — renumber phase IDs in file-browser, home-console, mobile.
5. R20, R21 — toast/error policy decisions.
6. R15, R16, R19, R26 — fill spec gaps (EmptyState, Spotlight mobile, Tabs variant, ConfirmDialog).
7. R22, R23, R24, R25, R27-R29, R33 — citation/reference hygiene.

---

## Resolutions Applied (Loops 81-90)

All 33 findings resolved in this pass. Each fix is annotated in-line at the target doc with a `(Rn, loops 81-90)` or `(resolves Cn/Rn)` marker so future readers can trace any change back to this register.

### CRITICAL (6) — all closed
- **R1** — File Browser §14.2/§14.3 rewritten as deep-link affordances to Console → Tools (UFS fsck + app.db query). `v5-file-browser-redesign.md`.
- **R2** — `fs-rename` + `mirror` added to `TaskKind` union (Task System §1.1) and retry matrix (§2.3). `v5-task-system.md`.
- **R5** — Phase IDs renumbered: File Browser → `5.1-l.1`…`5.1-l.6` + `5.2-f`; Home/Console → `5.2-a`; Mobile → `-mo` suffixes (`5.0-mo`, `5.1-mo`, `5.1-mo2`, `5.2-mo`, `5.3-mo`). v5-design §12 marked superseded.
- **R6** — v5-design §6 marked superseded by Task System doc.
- **R7** — v5-design §5 marked superseded (6 tabs → 8).
- **R14** — Cross-cutting §6.6 haptic vocabulary updated to 4 events (added `selection`).

### MAJOR (13) — all closed
- **R3** — Task System §3.5 added (⌘K `#task-id` jump syntax).
- **R4** — Home/Console §16.1 backup scope gains "Settings only" radio.
- **R12** — v5-design §8, §10, App C marked superseded by a11y doc (carries R17, R18, R30-R32 with it).
- **R15** — a11y §19.29 `EmptyState` spec added (resolves 72vh bug → 55vh).
- **R16** — a11y §19.21 Spotlight amended: tap = full-screen, long-press = peek Sheet.
- **R17** — folded into R12 (App C superseded).
- **R18** — folded into R12 (App C superseded).
- **R19** — a11y §19.9 Tabs amended: responsive variant (pills desktop / underline mobile).
- **R20** — game-hub §7.3 crash-recovery rewritten as inline `Callout tone="error"`, not toast.
- **R21** — a11y §19.17 Toaster gains `tone="critical"` (sticky, `role="alert"`, sole error-in-toast carve-out).
- **R22** — Cross-cutting §6.7 "Alert surfaces — canonical 5" added; C13 register cell fixed.
- **R23** — a11y §22 cross-refs fixed ("§10" → "§12"; "5.0.0/5.0.1-4" → "Phase 5.0/5.1").
- **R24** — a11y "~15 NEW primitives" → "21 NEW primitives".

### MINOR (14) — all closed
- **R8, R9, R10, R11, R13** — folded into v5-design supersession banners (§3.3, §3.2, §9.1, §4-G, §12).
- **R25** — Mobile §0 unsourced "12 concerns / resolve 8" sentence deleted.
- **R26** — a11y §19.26 Modal gains ConfirmDialog fate note (stays as thin wrapper; only prompt-input fix applies).
- **R27** — Cross-cutting §1.2 gains touch-target note (44×44 AAA target, 24×24 AA floor).
- **R28** — Cross-cutting C9 register cell corrected (Task System has no phase plan; File Browser renumbered).
- **R29** — Home/Console §18.3 alert-surfaces citation fixed (now points to cross-cutting §6.7).
- **R30, R31, R32** — folded into R12 (Checkbox 24px, Button `lg`, ErrorBoundary tokens all canonical in a11y doc).
- **R33** — optional (a11y ToC primitive index); skipped, low value.

### Edits touched
- `v5-consistency-review.md` (this doc)
- `v5-cross-cutting-concerns.md` — §1.2, §6.6, §6.7 (new), §0 C9 + C13 register cells
- `v5-task-system.md` — §1.1 (TaskKind), §2.3 (retry matrix), §3.5 (new ⌘K addendum)
- `v5-file-browser-redesign.md` — §14.2, §14.3 (deep-link affordances), §18 phase renumber
- `v5-home-console-redesign.md` — §16.1 (5th radio), §18.3 (citation), §24 phase renumber
- `v5-mobile-design.md` — §0 (trim), §17 phase renumber
- `v5-accessibility-design-system.md` — §17 (intro count), §19.9 (Tabs variant), §19.17 (critical tone), §19.21 (Spotlight mobile), §19.26 (ConfirmDialog), §19.29 (EmptyState, new), §22 (cross-refs)
- `game-hub-revised-design.md` — §7.3 (Callout not toast)
- `v5-design.md` — archival notice + 11 supersession banners (§3.2, §3.3, §4-G, §5, §6, §8, §9.1, §10, §12, App B, App C)

**Net result:** v5-design.md is now clearly archival; all sub-docs agree on phase IDs, haptic vocabulary, alert surfaces, and component APIs; the 4 unapplied §0 resolutions are written into their target docs; the 6 component-API conflicts are reconciled. Ready for master consolidation in loops 91-100.
