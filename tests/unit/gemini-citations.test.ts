import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SourceVersion } from "@/domain/contracts";
import { normalizeSource } from "@/domain/sources/citations";
import {
  citationPassages,
  geminiTransportOutput,
  resolveGeminiCitation,
  resolveGeminiOutput,
} from "@/server/ai/gemini-citations";

const revision = (text: string): SourceVersion => ({
  id: randomUUID(),
  sourceId: randomUUID(),
  number: 1,
  predecessorId: null,
  text,
});
const citation = (
  source: SourceVersion,
  quote: string,
  passageId?: string,
) => ({
  sourceVersionId: source.id,
  quote,
  ...(passageId === undefined ? {} : { passageId }),
});
const proposal = (cite: unknown) => ({
  items: [
    {
      key: "d",
      kind: "decision",
      reason: "Synthetic",
      impact: "",
      statement: "Review interpretation",
      needsReview: true,
      citations: [cite],
    },
  ],
  questions: [],
  preserved: [],
});

describe("Gemini exact-quote transport resolution (offline)", () => {
  it("resolves exact text without changing the raw transport or its quote", () => {
    const source = revision("Before. Exact quotation. After.");
    const raw = proposal(citation(source, "Exact quotation."));
    const before = JSON.stringify(raw);
    const output = resolveGeminiOutput(raw, source);
    expect(JSON.stringify(raw)).toBe(before);
    expect(output.items[0].citations).toEqual([
      {
        sourceVersionId: source.id,
        start: 8,
        end: 24,
        quote: "Exact quotation.",
      },
    ]);
  });
  it("rejects missing/absent quotes without trimming, case folding or fuzzy matching", () => {
    const source = revision("Exact quotation");
    for (const quote of [
      "",
      " Exact quotation",
      "Exact quotation ",
      "exact quotation",
      "Exact quotations",
    ]) {
      expect(() =>
        resolveGeminiCitation(citation(source, quote), source),
      ).toThrow();
    }
    expect(() =>
      resolveGeminiCitation({ sourceVersionId: source.id }, source),
    ).toThrow();
  });
  it("rejects repeated matches unless a supplied passage identifies exactly one", () => {
    const source = revision("Repeat\nRepeat\n");
    expect(() =>
      resolveGeminiCitation(citation(source, "Repeat"), source),
    ).toThrow("multiple exact matches");
    const passages = citationPassages(source);
    expect(passages.map((p) => p.text)).toEqual(["Repeat\n", "Repeat\n"]);
    expect(
      resolveGeminiCitation(citation(source, "Repeat", passages[1].id), source),
    ).toMatchObject({ start: 7, end: 13 });
    const sameLine = revision("Repeat Repeat");
    expect(() =>
      resolveGeminiCitation(
        citation(sameLine, "Repeat", citationPassages(sameLine)[0].id),
        sameLine,
      ),
    ).toThrow("multiple exact matches");
    const overlapping = revision("aaa");
    expect(() =>
      resolveGeminiCitation(citation(overlapping, "aa"), overlapping),
    ).toThrow("multiple exact matches");
  });
  it("rejects wrong sources, predecessor revisions, invented passage IDs and text outside a passage", () => {
    const source = revision("First\nSecond");
    const other = revision(source.text);
    const predecessor = { ...source, id: randomUUID(), number: 0 };
    for (const wrong of [other, predecessor]) {
      expect(() =>
        resolveGeminiCitation(citation(wrong, "First"), source),
      ).toThrow("selected authorized");
      expect(() =>
        resolveGeminiCitation(
          citation(source, "First", citationPassages(wrong)[0].id),
          source,
        ),
      ).toThrow("passage");
    }
    expect(() =>
      resolveGeminiCitation(
        citation(source, "First", `${source.id}:line:999`),
        source,
      ),
    ).toThrow("passage");
    expect(() =>
      resolveGeminiCitation(
        citation(source, "Second", citationPassages(source)[0].id),
        source,
      ),
    ).toThrow("absent");
  });
  it("derives UTF-16 offsets and preserves Unicode without canonical normalization", () => {
    const source = revision("A😀B\né\ne\u0301");
    expect(
      resolveGeminiCitation(citation(source, "😀B"), source),
    ).toMatchObject({ start: 1, end: 4, quote: "😀B" });
    expect(resolveGeminiCitation(citation(source, "é"), source)).toMatchObject({
      start: 5,
      end: 6,
    });
    expect(
      resolveGeminiCitation(citation(source, "e\u0301"), source),
    ).toMatchObject({ start: 7, end: 9 });
    const composed = revision("é");
    expect(() =>
      resolveGeminiCitation(citation(composed, "e\u0301"), composed),
    ).toThrow("absent");
    for (const quote of ["\ud83d", "\ude00"])
      expect(() =>
        resolveGeminiCitation(citation(source, quote), source),
      ).toThrow("Unicode");
  });
  it("uses stored newlines exactly, including cross-line quotes and trailing LF", () => {
    const source = revision(normalizeSource("A\r\nB\rC\n"));
    expect(
      resolveGeminiCitation(citation(source, "A\nB"), source),
    ).toMatchObject({ start: 0, end: 3 });
    expect(
      resolveGeminiCitation(
        citation(source, "C\n", citationPassages(source)[2].id),
        source,
      ),
    ).toMatchObject({ start: 4, end: 6 });
    expect(() =>
      resolveGeminiCitation(citation(source, "A\r\nB"), source),
    ).toThrow("absent");
    expect(() =>
      resolveGeminiCitation(
        citation(source, "A\nB", citationPassages(source)[0].id),
        source,
      ),
    ).toThrow("absent");
  });
  it("rejects legacy offsets and keeps kind-specific domain fields strict", () => {
    const source = revision("Exact");
    expect(() =>
      resolveGeminiOutput(
        proposal({ ...citation(source, "Exact"), start: 0, end: 5 }),
        source,
      ),
    ).toThrow();
    const raw = proposal(citation(source, "Exact"));
    expect(() =>
      geminiTransportOutput.parse({
        ...raw,
        items: [{ ...raw.items[0], taskId: randomUUID() }],
      }),
    ).toThrow();
    expect(() =>
      geminiTransportOutput.parse({
        ...raw,
        items: [{ ...raw.items[0], statement: undefined }],
      }),
    ).toThrow();
  });
});
