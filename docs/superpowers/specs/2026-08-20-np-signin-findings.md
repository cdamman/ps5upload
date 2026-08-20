# NP sign-in spike — findings

**Date:** 2026-08-20
**Question:** can ps5upload safely write the NP sign-in state
(`auth.dat`, `config.dat`, registry keys) that Remote Play sessions need?

**Answer: not yet.** Three things are now known, one is still unknown, and
one of them changes the design.

## 1. The files exist, and are firmware-sized

On a PS5 running FW 9.60:

```
/system_data/priv/home/179a0cd8/config.dat        16384 bytes
/system_data/priv/home/179a0cd8/np/auth.dat        1200 bytes
```

Note the directory is **lowercase** hex of the user id (`%x`), not
uppercase — a path built with `%X` gets ENOENT.

ActRemoteLink's embedded templates are **1200 bytes** for `auth.dat`
(matching) and **8192 bytes** for `config.dat` — *half* the size of the
real file on this firmware.

**This settles the design question.** Shipping a foreign `config.dat`
template would write a file half the expected size onto these consoles.
Reading the console's own `config.dat` and patching the documented offsets
is not merely tidier, it is the only correct approach across firmwares.

## 2. Our own read allowlist blocks the path

`FS_READ` on those paths returns `fs_read_path_not_allowed`. The payload
restricts reads to known-safe roots and `/system_data/priv/home` is not
among them.

That guard is doing its job. Implementing NP sign-in means deliberately
widening it for these two files, which should be a narrow, explicit
exception rather than a general loosening.

## 3. Still unknown: what is actually *in* `auth.dat`

Because of (2) I could not read it, so I cannot say whether it is a
constant, per-account, or per-console. The exact size match with
ActRemoteLink's template hints at a fixed-size structure, but a hint is
not a basis for writing account identity to somebody's console.

**This is the blocker.** Writing a wrong `auth.dat` produces an account
that pairs and then fails every session — the 403 this whole feature
exists to fix — and writing a wrong `account_id` can disassociate save
data.

## 4. The test consoles cannot validate this feature

Both consoles already have `config.dat`, `auth.dat`, an activated account
(`account_type = "np"`) and Remote Play enabled. They are the *already
working* case.

So the activation path cannot be exercised here without deliberately
creating a second local user and activating that — which is exactly the
operation the safety model says to be most careful with.

## Recommendation

Do not implement activation or NP sign-in writes yet. In order:

1. Widen the FS_READ allowlist for exactly these two paths (read-only),
   ship it, and look at a real `config.dat`/`auth.dat`.
2. Compare `auth.dat` across two consoles with the same account, and
   across two accounts on one console. That answers the constant /
   per-account / per-console question directly.
3. Only then design the writer, gated behind the safety model already in
   the Remote Play spec (try-unmodified-first, never Slot 1 from a restored
   backup, prefer a new user, back up saves first).

Meanwhile the *readable* half is already useful and shipping: the Remote
Play screen reports activation state, and the Profile tab can expose the
account id it reads.

## What this unblocks right now

Since both consoles are already in the working state, the end-to-end
question — does a paired client actually **connect**, not just pair — is
testable today with Chiaki and does not depend on any of the above.
