// Multi-part archive detection for the Upload screen.
//
// Sites publish a game as `Game.part01.zip` … `Game.part06.zip`. Unlike a
// spanned RAR set — where UnRAR opens the first volume and pulls its
// siblings in automatically — those zips are SEPARATE, self-contained
// archives, each holding a different slice of the game's files. Nothing
// links them, so uploading part01 sends only part01's contents and the
// user is left wondering where the rest went.
//
// We can't merge them for the user (each is its own upload), but we can
// stop them finding out afterwards.

/** A `.partN` marker split off an archive filename. */
export interface ArchivePartInfo {
  /** Filename with the `.partN` marker and extension removed. */
  stem: string;
  /** The part number as written (`01` → 1). */
  index: number;
  /** Lowercased extension without the dot: `zip` | `7z` | `rar`. */
  ext: string;
}

const PART_RE = /^(.*)\.part(\d+)\.(zip|7z|rar)$/i;

/** Parse `Game.part01.zip` → `{ stem: "Game", index: 1, ext: "zip" }`.
 *  Returns null when the name carries no multi-part marker. */
export function parseArchivePart(filename: string): ArchivePartInfo | null {
  const m = PART_RE.exec(filename);
  if (!m) return null;
  const index = Number.parseInt(m[2], 10);
  if (!Number.isFinite(index)) return null;
  return { stem: m[1], index, ext: m[3].toLowerCase() };
}

/** Given the chosen archive's filename and the names sitting beside it,
 *  return every sibling part of the SAME set, sorted by part number.
 *
 *  Matching is on the stem AND extension, so `Game.part1.zip` never pulls
 *  in an unrelated `Game.part1.rar` sitting in the same folder. Returns an
 *  empty array when the file isn't part of a set, or is the only part
 *  present — in both cases there is nothing useful to tell the user.
 */
export function siblingParts(
  filename: string,
  namesInFolder: readonly string[],
): ArchivePartInfo[] {
  const self = parseArchivePart(filename);
  if (!self) return [];
  const found = namesInFolder
    .map((n) => ({ name: n, info: parseArchivePart(n) }))
    .filter(
      (x): x is { name: string; info: ArchivePartInfo } =>
        x.info !== null &&
        x.info.ext === self.ext &&
        x.info.stem.toLowerCase() === self.stem.toLowerCase(),
    )
    .map((x) => x.info);
  // De-dupe by index: a folder holding both `G.part1.zip` and `G.part01.zip`
  // is malformed, and counting it twice would overstate the set.
  const byIndex = new Map<number, ArchivePartInfo>();
  for (const p of found) if (!byIndex.has(p.index)) byIndex.set(p.index, p);
  const all = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return all.length > 1 ? all : [];
}

/** True when this archive is one of several parts that the user must
 *  upload individually — i.e. a zip/7z set. A `.rar` set is excluded:
 *  UnRAR genuinely does pull the sibling volumes in from the first one,
 *  so warning about it would be wrong. */
export function needsManualPartUploads(
  filename: string,
  namesInFolder: readonly string[],
): boolean {
  const self = parseArchivePart(filename);
  if (!self || self.ext === "rar") return false;
  return siblingParts(filename, namesInFolder).length > 1;
}

/** Rebuild the full paths of every part in the set, given the selected
 *  archive's full path and the filenames sitting beside it in its folder.
 *
 *  Ordered by part number, so feeding the result straight into the upload
 *  queue runs the parts in sequence.
 *
 *  The separator is read off the selected path rather than hardcoded: these
 *  paths go back to the host filesystem, and a Windows source
 *  (`C:\Users\...\Game.part01.zip`) has to stay a Windows path.
 *
 *  Filenames come from the folder listing rather than being synthesised
 *  from the stem, so the exact casing and zero-padding on disk survive.
 */
export function siblingPartPaths(
  selectedPath: string,
  namesInFolder: readonly string[],
): string[] {
  const sep = Math.max(
    selectedPath.lastIndexOf("/"),
    selectedPath.lastIndexOf("\\"),
  );
  if (sep <= 0) return [];
  const dir = selectedPath.slice(0, sep);
  const slash = selectedPath[sep];
  const parts = siblingParts(selectedPath.slice(sep + 1), namesInFolder);
  if (parts.length === 0) return [];

  const nameByIndex = new Map<number, string>();
  for (const n of namesInFolder) {
    const info = parseArchivePart(n);
    if (!info) continue;
    const inSet = parts.some(
      (p) =>
        p.index === info.index &&
        p.ext === info.ext &&
        p.stem.toLowerCase() === info.stem.toLowerCase(),
    );
    if (inSet && !nameByIndex.has(info.index)) nameByIndex.set(info.index, n);
  }

  return parts
    .map((p) => nameByIndex.get(p.index))
    .filter((n): n is string => n !== undefined)
    .map((n) => `${dir}${slash}${n}`);
}
