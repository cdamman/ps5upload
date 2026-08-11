import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { fwToSdkHex, PS5_FIRMWARES } from "./fwVersion";

const here = dirname(fileURLToPath(import.meta.url));
const screens = resolve(here, "../screens");
const read = (p: string) => readFileSync(resolve(screens, p), "utf8");

/**
 * Values a screen ships pre-filled must be valid before anyone touches
 * them.
 *
 * Two shipped defaults were broken at once and neither was caught by a
 * test, because tests exercise the values *they* choose while a user
 * gets the one in the box:
 *
 *   - SmbBrowser defaulted to "smb://192.168.1.100:445". The backend
 *     takes a socket address, not a URL, so it tried to DNS-resolve that
 *     literal string and failed in 50 ms — before touching the network,
 *     on a subnet almost nobody is on.
 *   - SdkChanger defaulted to 0x09060000, which is not a firmware.
 *     Versions are BCD, so 9.60 is 0x09600000.
 *
 * These assert against the source text rather than rendering, because
 * the property under test is "what ships", not "what renders".
 */
describe("shipped defaults are usable as-is", () => {
  it("SdkChanger's default firmware is one the picker offers", () => {
    const src = read("SdkChanger/index.tsx");
    const m = /useState\("(\d{1,2}\.\d{1,2})"\)/.exec(src);
    expect(m, "SdkChanger should default to a firmware string").not.toBeNull();
    const fw = m![1];
    expect(PS5_FIRMWARES).toContain(fw);
    // And it must survive the conversion the patch path actually uses.
    expect(fwToSdkHex(fw)).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("SdkChanger no longer ships a raw hex default", () => {
    const src = read("SdkChanger/index.tsx");
    // Assert on the default itself, not on the file text: the comment
    // explaining why 0x09060000 was wrong is worth keeping, and a test
    // that bans the string outright would force it to be deleted.
    const defaults = [...src.matchAll(/useState\((["'])(.*?)\1\)/g)].map((m) => m[2]);
    for (const d of defaults) {
      expect(d, `"${d}" looks like a raw SDK word, not a firmware`).not.toMatch(
        /^0x[0-9a-fA-F]+$/,
      );
    }
  });

  it("SmbBrowser ships an empty server rather than an unusable example", () => {
    const src = read("SmbBrowser/index.tsx");
    const m = /const \[server, setServer\] = useState\((.*?)\);/.exec(src);
    expect(m, "SmbBrowser should declare a server default").not.toBeNull();
    // Empty is correct: the placeholder shows the shape instead. A
    // pre-filled value has to be one the backend can parse.
    expect(m![1].trim()).toBe('""');
  });

  it("FtpServer's default port avoids the port ftpsrv already uses", () => {
    const src = read("FtpServer/index.tsx");
    const m = /const \[port, setPort\] = useState\((\d+)\)/.exec(src);
    expect(m, "FtpServer should declare a numeric port default").not.toBeNull();
    const port = Number(m![1]);
    // 2121 is ftpsrv.elf's default, and ftpsrv ships in our own payload
    // catalogue — sharing it produced bind_failed out of the box.
    expect(port).not.toBe(2121);
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it("every PS5 path default is absolute", () => {
    // A relative default would resolve against whatever the payload's
    // cwd happens to be, which is not a thing a user can reason about.
    for (const [file, re] of [
      ["DiskUsage/index.tsx", /const \[path, setPath\] = useState\("(.*?)"\)/],
      ["Shell/index.tsx", /const \[cwd, setCwd\] = useState\("(.*?)"\)/],
      ["SmbBrowser/index.tsx", /const \[destRoot, setDestRoot\] = useState\("(.*?)"\)/],
      ["FtpServer/index.tsx", /const \[root, setRoot\] = useState\("(.*?)"\)/],
    ] as const) {
      const m = re.exec(read(file));
      expect(m, `${file} should declare its path default`).not.toBeNull();
      expect(m![1].startsWith("/"), `${file} default "${m![1]}" must be absolute`).toBe(
        true,
      );
    }
  });
});
