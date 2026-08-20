# Editing exFAT game images on the PC/Mac (#246)

**Status:** design, not yet implemented
**Date:** 2026-08-20

## What changed my mind

I first told the reporter this was substantial work: "a filesystem
implementation that can safely modify an image in place". That framing
was wrong, and studying `drakmor/ShadowMountPlus` (2026-06-28) is what
corrected it.

We do not need to implement exFAT. **Every desktop OS already has an
exFAT driver.** The job is to attach the image as a block device and let
the OS mount it — then the user edits files with the tools they already
know, and every write goes through a filesystem implementation far
better tested than anything we would write.

That turns "write an exFAT library" into "orchestrate three OS
commands", and removes the risk that motivated my original caution:
a bug in our writer corrupting an image somebody spent hours building.

## The mechanism, per platform

ShadowMountPlus creates images this way; the same primitives open an
existing one.

**macOS** — no elevated privileges needed:
```
hdiutil attach -imagekey diskimage-class=CRawDiskImage <image>
# ...auto-mounts in Finder; user edits...
hdiutil detach <device>
```
`-nomount` plus `mount -t exfat` is only needed for *formatting*, which
requires real sector geometry via ioctl. For editing, plain attach is
enough and avoids needing root — which matters, because this is the
platform the reporter is on and the reason they filed the issue.

**Linux** — prefer `udisksctl` so it works without root:
```
udisksctl loop-setup -f <image>
udisksctl mount -b <device>
...
udisksctl unmount -b <device> && udisksctl loop-delete -b <device>
```
Falls back to `losetup` + `mount` when udisks is absent (needs root).

**Windows** — the awkward one. `Mount-DiskImage` handles VHD/ISO, not
raw. Needs a third-party driver (OSFMount, ImDisk). Out of scope for
the first version; the UI says so rather than silently offering a
button that cannot work.

## Design

One engine module, `local_image.rs`, with three operations:

```
attach(path)   -> { device, mount_point }
detach(device) -> ()
status()       -> [ { image, device, mount_point } ]
```

and a client action on any `.exfat`/`.img` file: **Open on this
computer**, which attaches, reveals the mount point in Finder/Explorer,
and offers **Done editing** to detach.

### Rules

1. **Never leave an image attached silently.** Attached images are
   tracked and listed; the app offers to detach on quit. A forgotten
   loop device is how someone later gets "resource busy" on a file they
   no longer associate with us.
2. **Refuse while the image is in use by a transfer.** Mounting an
   image mid-upload is a corruption path.
3. **Detach is idempotent** and tolerates a device that vanished
   (user ejected it in Finder).
4. **Never format, never resize, never write to the image ourselves.**
   Attach and detach only. Every byte written is written by the OS
   driver at the user's direction.
5. **Windows is explicitly unsupported at first** and says why, rather
   than failing at attach time.

### Testing

Attach/detach is OS-dependent, so the unit-testable parts are the
platform-command construction and the device-name parsing from
`hdiutil`/`udisksctl` output — both pure string work, both easy to get
subtly wrong. Live attach is an `#[ignore]`d test following the
existing `live_*` convention.

## What this does not do

It does not edit param.json / game names for the user, which #246 also
asks about. Once the image is mounted, those files are ordinary files
on a mounted volume — the existing local file tools apply. Doing more
than that is a separate feature and should not be bundled in.
