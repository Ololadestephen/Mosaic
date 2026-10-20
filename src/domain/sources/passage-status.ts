export type PassageChange = "unchanged" | "edited" | "removed";

export type Hunk = { oldStart: number; oldEnd: number; newStart: number };

// A shared letter is not the passage. A real edit leaves a short contiguous piece.
const editedRunMinimum = 3;

export function statusFromHunks(
  hunks: Hunk[],
  start: number,
  end: number,
): PassageChange {
  const mapped = mapCitation(hunks, start, end);
  if (citationIntact(mapped)) return "unchanged";
  return overlapCountsAsEdit(longestContiguousRun(mapped), mapped.length)
    ? "edited"
    : "removed";
}

// A surviving run must be at least three code units, unless the whole citation is shorter.
export function overlapCountsAsEdit(longest: number, span: number) {
  return longest >= Math.min(editedRunMinimum, span);
}

function mapCitation(hunks: Hunk[], start: number, end: number): Int32Array {
  const mapped = new Int32Array(end - start).fill(-1);
  for (const hunk of hunks) {
    const from = Math.max(start, hunk.oldStart);
    const to = Math.min(end, hunk.oldEnd);
    for (let position = from; position < to; position += 1)
      mapped[position - start] = hunk.newStart + (position - hunk.oldStart);
  }
  return mapped;
}

function citationIntact(mapped: Int32Array): boolean {
  if (mapped.length === 0 || mapped[0] < 0) return false;
  for (let index = 0; index < mapped.length; index += 1) {
    if (mapped[index] !== mapped[0] + index) return false;
  }
  return true;
}

function longestContiguousRun(mapped: Int32Array): number {
  let longest = 0;
  let run = 0;
  for (let index = 0; index < mapped.length; index += 1) {
    const continues =
      mapped[index] >= 0 &&
      (index === 0 || mapped[index] === mapped[index - 1] + 1);
    if (!continues) run = 0;
    if (mapped[index] >= 0) {
      run += 1;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}
