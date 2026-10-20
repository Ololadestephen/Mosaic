import { describe, expect, it } from "vitest";
import { revisionRows } from "@/domain/sources/passage-change";

describe("bounded read-only revision comparison", () => {
  it("preserves text and offsets through insertions, deletions and repeated Unicode lines", () => {
    const before = "😀 brief\nRepeated\nRepeated\nEnd";
    const after = "Intro\n😀 brief\nRepeated\nEnd";
    const result = revisionRows(before, after);
    expect(result.before.map((row) => row.text).join("")).toBe(before);
    expect(result.after.map((row) => row.text).join("")).toBe(after);
    for (const [text, rows] of [
      [before, result.before],
      [after, result.after],
    ] as const)
      for (const row of rows)
        expect(text.slice(row.start, row.start + row.text.length)).toBe(
          row.text,
        );
    expect(result.after[0].changed).toBe(true);
    expect(result.after[1].changed).toBe(false);
    expect(result.before.filter((row) => row.changed)).toHaveLength(1);
  });
  it("distinguishes unchanged text from edited and empty passages", () => {
    expect(revisionRows("same", "same").before[0].changed).toBe(false);
    expect(revisionRows("Friday", "Monday").after[0].changed).toBe(true);
    expect(
      revisionRows("", "Added")
        .before.map((row) => row.text)
        .join(""),
    ).toBe("");
  });
  it("bounds alignment memory and explicitly identifies a coarse comparison", () => {
    const lines = Array.from(
      { length: 1600 },
      (_, index) => `Shared ${index}\n`,
    );
    const changed = [...lines];
    changed[2] = "First change\n";
    changed[1597] = "Last change\n";
    const result = revisionRows(lines.join(""), changed.join(""));
    expect(result.coarse).toBe(true);
    expect(result.before[0].changed).toBe(false);
    expect(result.after.at(-1)?.changed).toBe(false);
    expect(result.after[800].changed).toBe(true);
    expect(result.after.map((row) => row.text).join("")).toBe(changed.join(""));
  });
});
