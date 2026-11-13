import { revisionRows } from "./passage-change";

export type CoveragePassage = {
  id: string;
  side: "previous" | "selected";
  start: number;
  end: number;
  text: string;
};

export function changedPassages(previous: string, selected: string) {
  const { before, after, coarse } = revisionRows(previous, selected);
  const passages: CoveragePassage[] = [];

  for (const [side, rows] of [
    ["previous", before],
    ["selected", after],
  ] as const) {
    for (const row of rows) {
      if (!row.changed || !row.text.trim()) continue;
      passages.push({
        id: `${side}:${row.start}`,
        side,
        start: row.start,
        end: row.start + row.text.length,
        text: row.text,
      });
    }
  }
  return { passages, coarse };
}
