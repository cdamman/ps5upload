import { describe, expect, it } from "vitest";
import {
  needsManualPartUploads,
  parseArchivePart,
  siblingParts,
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
