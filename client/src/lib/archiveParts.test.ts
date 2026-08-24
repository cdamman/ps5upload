import { describe, expect, it } from "vitest";
import {
  needsManualPartUploads,
  parseArchivePart,
  siblingParts,
  siblingPartPaths,
  diagnoseArchiveSet,
} from "./archiveParts";

const SET = [
  "[SITE]- 01.021 PPSA23226.part01.zip",
  "[SITE]- 01.021 PPSA23226.part02.zip",
  "[SITE]- 01.021 PPSA23226.part03.zip",
  "readme.txt",
];

describe("parseArchivePart", () => {
  it("splits the marker off", () => {
    expect(parseArchivePart("Game.part01.zip")).toEqual({
      stem: "Game",
      index: 1,
      ext: "zip",
    });
    expect(parseArchivePart("Game.part7.7z")?.index).toBe(7);
    expect(parseArchivePart("Game.PART02.ZIP")?.ext).toBe("zip");
  });

  it("returns null for names with no marker", () => {
    expect(parseArchivePart("Game.zip")).toBeNull();
    // "part" without digits is not a marker.
    expect(parseArchivePart("Counterpart.zip")).toBeNull();
  });
});

describe("siblingParts", () => {
  it("finds the whole set and ignores unrelated files", () => {
    const parts = siblingParts(SET[0], SET);
    expect(parts.map((p) => p.index)).toEqual([1, 2, 3]);
  });

  it("does not mix extensions — a .rar of the same name is a different set", () => {
    const names = ["G.part1.zip", "G.part2.zip", "G.part1.rar", "G.part2.rar"];
    expect(siblingParts("G.part1.zip", names).map((p) => p.ext)).toEqual([
      "zip",
      "zip",
    ]);
  });

  it("returns nothing when the part is alone — no set to warn about", () => {
    expect(siblingParts("G.part1.zip", ["G.part1.zip", "other.zip"])).toEqual(
      [],
    );
  });

  it("counts a duplicated index once (G.part1 and G.part01)", () => {
    const names = ["G.part1.zip", "G.part01.zip", "G.part2.zip"];
    expect(siblingParts("G.part1.zip", names).map((p) => p.index)).toEqual([
      1, 2,
    ]);
  });
});

describe("needsManualPartUploads", () => {
  it("is true for a multi-part zip set", () => {
    expect(needsManualPartUploads(SET[0], SET)).toBe(true);
  });

  it("is FALSE for rar — UnRAR really does pull the siblings itself", () => {
    const rars = ["G.part1.rar", "G.part2.rar", "G.part3.rar"];
    expect(needsManualPartUploads("G.part1.rar", rars)).toBe(false);
  });

  it("is false for an ordinary single archive", () => {
    expect(needsManualPartUploads("Game.zip", ["Game.zip"])).toBe(false);
  });
});

describe("siblingPartPaths", () => {
  it("keeps a Windows path a Windows path", () => {
    const dir = "C:\\Users\\Majid\\Downloads\\Black Myth Wukong";
    expect(siblingPartPaths(`${dir}\\${SET[0]}`, SET)).toEqual([
      `${dir}\\${SET[0]}`,
      `${dir}\\${SET[1]}`,
      `${dir}\\${SET[2]}`,
    ]);
  });

  it("keeps a POSIX path a POSIX path", () => {
    expect(siblingPartPaths(`/home/me/games/${SET[1]}`, SET)).toEqual([
      `/home/me/games/${SET[0]}`,
      `/home/me/games/${SET[1]}`,
      `/home/me/games/${SET[2]}`,
    ]);
  });

  it("orders by part number, not by listing order", () => {
    const shuffled = [SET[2], SET[0], SET[3], SET[1]];
    expect(siblingPartPaths(`/g/${SET[0]}`, shuffled)).toEqual([
      `/g/${SET[0]}`,
      `/g/${SET[1]}`,
      `/g/${SET[2]}`,
    ]);
  });

  it("preserves the zero-padding actually on disk", () => {
    const mixed = ["Game.part1.zip", "Game.part2.zip", "Game.part10.zip"];
    expect(siblingPartPaths("/g/Game.part1.zip", mixed)).toEqual([
      "/g/Game.part1.zip",
      "/g/Game.part2.zip",
      "/g/Game.part10.zip",
    ]);
  });

  it("returns nothing for a lone archive", () => {
    expect(siblingPartPaths("/g/Game.zip", ["Game.zip"])).toEqual([]);
    expect(siblingPartPaths("/g/Game.part01.zip", ["Game.part01.zip"])).toEqual(
      [],
    );
  });

  it("returns nothing when there is no directory to rebuild against", () => {
    expect(siblingPartPaths(SET[0], SET)).toEqual([]);
  });

  it("does not mix a rar set into a zip set", () => {
    const both = [...SET, "[SITE]- 01.021 PPSA23226.part01.rar"];
    expect(siblingPartPaths(`/g/${SET[0]}`, both)).toEqual([
      `/g/${SET[0]}`,
      `/g/${SET[1]}`,
      `/g/${SET[2]}`,
    ]);
  });
});

// Reported 2026-08-23 against 5.4.17: part 1 uploaded, "Upload complete",
// nothing about the other ten parts. The folder turned out to hold ONE zip
// and TEN rar volumes under the same stem — so the extension-matching in
// siblingParts found zero siblings and the app said nothing at all.
const MIXED = [
  "[DLPSGAME.COM]- 01.021 PPSA23226.part01.zip",
  ...Array.from(
    { length: 10 },
    (_, i) =>
      `[DLPSGAME.COM]- 01.021 PPSA23226.part${String(i + 2).padStart(2, "0")}.rar`,
  ),
];

describe("diagnoseArchiveSet", () => {
  it("flags the mixed zip/rar folder the old code was silent about", () => {
    expect(needsManualPartUploads(MIXED[0], MIXED)).toBe(false); // the bug
    expect(diagnoseArchiveSet(MIXED[0], MIXED)).toEqual({
      kind: "mixed-extensions",
      selectedExt: "zip",
      otherExt: "rar",
      otherCount: 10,
      missingFirst: "[DLPSGAME.COM]- 01.021 PPSA23226.part01.rar",
    });
  });

  it("names no missing volume when the other set starts at part 1", () => {
    const folder = ["G.part01.zip", "G.part01.rar", "G.part02.rar"];
    const d = diagnoseArchiveSet("G.part01.zip", folder);
    expect(d).toMatchObject({ kind: "mixed-extensions", missingFirst: null });
  });

  it("still reports a plain zip set as manual-parts", () => {
    expect(diagnoseArchiveSet(SET[0], SET)).toEqual({
      kind: "manual-parts",
      total: 3,
    });
  });

  it("says nothing for a healthy rar set — unrar follows the volumes", () => {
    const rars = ["G.part01.rar", "G.part02.rar", "G.part03.rar"];
    expect(diagnoseArchiveSet(rars[0], rars)).toBeNull();
  });

  it("says nothing for a lone archive", () => {
    expect(diagnoseArchiveSet("Game.zip", ["Game.zip"])).toBeNull();
  });

  it("picks the largest foreign set when several formats collide", () => {
    const folder = [
      "G.part01.zip",
      "G.part02.rar",
      "G.part03.rar",
      "G.part04.7z",
    ];
    expect(diagnoseArchiveSet("G.part01.zip", folder)).toMatchObject({
      otherExt: "rar",
      otherCount: 2,
    });
  });
});
