# Games, payload tools, and firmware 12 package installs

Research and implementation note — 2026-08-25

## What changed

The app now organizes game work around intent:

- **Ready to play** contains titles registered with the selected PS5. This is
  where users launch, stop, inspect, and uninstall games.
- **Game files** contains folders and disk images found in console storage. This
  is where users mount, register, move, and inspect source files.

The old `/installed` and `/library` links remain valid but redirect into the
correct Games view. View tabs participate in history, and the shell exposes
Back and Forward controls.

ShadowMount+ and nanoDNS are now in **Payloads**, beside Catalog and Send file.
They are both management interfaces for a loaded payload, so this is a more
stable mental model than placing one in Games and the other in Advanced.

## Issue #277: what actually failed

The attached firmware 12.40 report provides a precise sequence:

1. In-process `sceAppInstUtilInstallByPackage` returned `0x80B2116F`.
2. The ShellUI route also rejected the request.
3. The old final fallback, `sceAppInstUtilAppInstallPkg`, returned zero but did
   not return a content id.
4. The installer consumed **0 bytes of an 85,290,778,624-byte package** for the
   full 180-second verification window.

The third step was a false success. ps5upload manufactured a task for an
operation that had copied nothing, then eventually reported “accepted but
unverified.” The automatic `AppInstallPkg` fallback is now disabled. The app
keeps the staged package and surfaces the original PlayGo compatibility error
instead of waiting three minutes on a task that cannot progress.

## What “proper support” means on high firmware

The correct contract is capability- and evidence-based, not “return code 0”:

1. Confirm compatible jailbreak/kstuff capability.
2. Acquire the installer identity required by the chosen, hardware-verified
   route. Do not infer high-firmware compatibility from an AuthID change:
   singleDPI's Debug AuthID readiness check still reaches the same
   `0x80B2116F` rejection on firmware 11.60.
3. Initialize AppInst before issuing an install.
4. Treat `InstallByPackage` success as asynchronous acceptance only.
5. Track the returned content id with `GetInstallStatus` where safe and verify
   the category-specific installed artifact on disk/app registration.
6. Keep the staged package on rejection, stall, uncertainty, or verification
   failure.
7. For `0x80B2116F`, explain that this is a known AppInst/PlayGo firmware
   incompatibility and direct the user to the PS5's own **Settings → System →
   Debug Settings → Game → Package Installer**.

ps5upload now follows that failure contract. It does not claim that firmware
12.40 is solved without firmware-12 hardware verification.

## Primary sources

- [Issue #277 and its firmware 12.40 bug report](https://github.com/phantomptr/ps5upload/issues/277)
- [etaHEN package installation technical write-up](https://github.com/etaHEN/etaHEN/blob/main/PS5%20technical%20writeups/pkg-writeup.md)
- [etaHEN DirectPKGInstaller v2 source](https://github.com/etaHEN/etaHEN/blob/main/Source%20Code/util/source/DirectPKGInstaller.cpp)
- [PS5 Direct Package Installer high-firmware status](https://github.com/MaxMilu/ps5-direct-package-installer/blob/main/README_EN.md#higher-firmware-compatibility-status-and-planned-path)
- [PS5 Direct Package Installer source](https://github.com/MaxMilu/ps5-direct-package-installer/blob/main/source/main.cpp)
- [ps5-ezremote-dpi source](https://github.com/cy33hc/ps5-ezremote-dpi/blob/main/source/main.cpp)
- [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
