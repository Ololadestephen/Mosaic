import {
  statusFromHunks,
  type Hunk,
  type PassageChange,
} from "./passage-status";

export type { PassageChange };

// A match never authorizes a task write.

export const PASSAGE_REVIEW_LABEL = "Supporting passage changed — review";
type Row = { text: string; start: number };

const DIFF_CELL_LIMIT = 2_250_000;

// Read-only line comparison uses the same bounded alignment as passage signals.
// A changed line is context for review, never authority to write a task.
export function revisionRows(predecessor: string, revision: string) {
  const before = rowsOf(predecessor);
  const after = rowsOf(revision);
  const coarse = before.length * after.length > DIFF_CELL_LIMIT;
  const matches = coarse
    ? new Map<number, number>()
    : lineMatches(
        before.map((row) => row.text),
        after.map((row) => row.text),
      );
  if (coarse) {
    let head = 0;
    while (
      head < Math.min(before.length, after.length) &&
      before[head].text === after[head].text
    ) {
      matches.set(head, head);
      head++;
    }
    let tail = 0;
    while (
      before.length - 1 - tail >= head &&
      after.length - 1 - tail >= head &&
      before[before.length - 1 - tail].text ===
        after[after.length - 1 - tail].text
    ) {
      matches.set(before.length - 1 - tail, after.length - 1 - tail);
      tail++;
    }
  }
  const matchedAfter = new Set(matches.values());
  return {
    coarse,
    before: before.map((row, index) => ({
      ...row,
      changed: predecessor !== revision && !matches.has(index),
    })),
    after: after.map((row, index) => ({
      ...row,
      changed: predecessor !== revision && !matchedAfter.has(index),
    })),
  };
}

export function supportingPassageChange(
  predecessor: string,
  revision: string,
  start: number,
  end: number,
): PassageChange {
  if (start < 0 || end > predecessor.length || start >= end)
    throw new RangeError("Citation offsets are outside the predecessor text.");
  return statusFromHunks(diffHunks(predecessor, revision), start, end);
}

function diffHunks(predecessor: string, revision: string): Hunk[] {
  const before = rowsOf(predecessor);
  const after = rowsOf(revision);
  if (before.length * after.length > DIFF_CELL_LIMIT)
    return edgeHunks(predecessor, revision, 0, 0);
  const matches = lineMatches(
    before.map((row) => row.text),
    after.map((row) => row.text),
  );
  return [
    ...matchedLineHunks(before, after, matches),
    ...unmatchedLineHunks(before, after, matches, predecessor, revision),
  ];
}

function matchedLineHunks(
  before: Row[],
  after: Row[],
  matches: Map<number, number>,
): Hunk[] {
  const hunks: Hunk[] = [];
  for (const [oldIndex, newIndex] of matches) {
    const oldRow = before[oldIndex];
    const newRow = after[newIndex];
    if (!oldRow || !newRow)
      throw new Error("Internal diff alignment index is invalid.");
    hunks.push({
      oldStart: oldRow.start,
      oldEnd: oldRow.start + oldRow.text.length,
      newStart: newRow.start,
    });
  }
  return hunks;
}

function unmatchedLineHunks(
  before: Row[],
  after: Row[],
  matches: Map<number, number>,
  predecessor: string,
  revision: string,
): Hunk[] {
  const hunks: Hunk[] = [];
  let index = 0;
  while (index < before.length) {
    if (matches.has(index)) {
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < before.length && !matches.has(index)) index += 1;
    const gap = lineGap(
      before,
      after,
      matches,
      predecessor,
      revision,
      runStart,
      index,
    );
    hunks.push(...gap);
  }
  return hunks;
}

function lineGap(
  before: Row[],
  after: Row[],
  matches: Map<number, number>,
  predecessor: string,
  revision: string,
  runStart: number,
  runEnd: number,
): Hunk[] {
  const first = before[runStart];
  const last = before[runEnd - 1];
  if (!first || !last) throw new Error("Internal diff gap is empty.");
  const previous = runStart === 0 ? -1 : matches.get(runStart - 1);
  const next = runEnd === before.length ? after.length : matches.get(runEnd);
  if (previous === undefined || next === undefined)
    throw new Error("Internal diff gap has unmatched boundaries.");
  const oldStart = first.start;
  const newStart =
    previous === -1 ? 0 : after[previous].start + after[previous].text.length;
  const newEnd = next === after.length ? revision.length : after[next].start;
  return characterHunks(
    predecessor.slice(oldStart, last.start + last.text.length),
    revision.slice(newStart, newEnd),
    oldStart,
    newStart,
  );
}

function rowsOf(text: string): Row[] {
  const rows: Row[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) {
      rows.push({ text: text.slice(start), start });
      break;
    }
    rows.push({ text: text.slice(start, newline + 1), start });
    start = newline + 1;
  }
  return rows.length ? rows : [{ text: "", start: 0 }];
}

function commonIndexes(
  beforeCount: number,
  afterCount: number,
  equal: (beforeIndex: number, afterIndex: number) => boolean,
): [number, number][] {
  const width = afterCount + 1;
  const scores = new Uint16Array((beforeCount + 1) * width);
  const at = (row: number, column: number) => row * width + column;
  for (let row = 1; row <= beforeCount; row += 1) {
    for (let column = 1; column <= afterCount; column += 1) {
      scores[at(row, column)] = equal(row - 1, column - 1)
        ? scores[at(row - 1, column - 1)] + 1
        : Math.max(scores[at(row - 1, column)], scores[at(row, column - 1)]);
    }
  }
  const pairs: [number, number][] = [];
  let row = beforeCount;
  let column = afterCount;
  while (row > 0 && column > 0) {
    if (
      equal(row - 1, column - 1) &&
      scores[at(row, column)] === scores[at(row - 1, column - 1)] + 1
    ) {
      pairs.push([row - 1, column - 1]);
      row -= 1;
      column -= 1;
    } else if (scores[at(row - 1, column)] >= scores[at(row, column - 1)]) {
      row -= 1;
    } else column -= 1;
  }
  return pairs;
}

function lineMatches(before: string[], after: string[]): Map<number, number> {
  return new Map(
    commonIndexes(
      before.length,
      after.length,
      (left, right) => before[left] === after[right],
    ),
  );
}

function characterHunks(
  before: string,
  after: string,
  oldBase: number,
  newBase: number,
): Hunk[] {
  if (!before || !after) return [];
  if (before.length * after.length > DIFF_CELL_LIMIT)
    return edgeHunks(before, after, oldBase, newBase);
  const points = commonIndexes(
    before.length,
    after.length,
    (left, right) => before[left] === after[right],
  )
    .map(([old, next]) => ({ old, next }))
    .reverse();
  const hunks: Hunk[] = [];
  for (const point of points) {
    const last = hunks.at(-1);
    const oldPosition = oldBase + point.old;
    const newPosition = newBase + point.next;
    if (
      last &&
      last.oldEnd === oldPosition &&
      last.newStart + (last.oldEnd - last.oldStart) === newPosition
    ) {
      last.oldEnd += 1;
    } else {
      hunks.push({
        oldStart: oldPosition,
        oldEnd: oldPosition + 1,
        newStart: newPosition,
      });
    }
  }
  return hunks;
}

function edgeHunks(
  before: string,
  after: string,
  oldBase: number,
  newBase: number,
): Hunk[] {
  if (!before || !after) return [];
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const hunks: Hunk[] = [];
  if (prefix > 0)
    hunks.push({
      oldStart: oldBase,
      oldEnd: oldBase + prefix,
      newStart: newBase,
    });
  if (suffix > 0)
    hunks.push({
      oldStart: oldBase + before.length - suffix,
      oldEnd: oldBase + before.length,
      newStart: newBase + after.length - suffix,
    });
  return hunks;
}
