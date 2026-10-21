import { z } from "zod";
import {
  analysisOutput,
  proposalItem,
  type SourceVersion,
} from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { validateCitation } from "@/domain/sources/citations";

const transportCitation = z
  .object({
    sourceVersionId: z.uuid(),
    passageId: z.string().min(1).max(100).optional(),
    quote: z.string().min(1).max(3000),
  })
  .strict();
const citations = z.array(transportCitation).min(1).max(8);
const [create, update, decision] = proposalItem.options;
export const geminiTransportOutput = analysisOutput
  .extend({
    items: z
      .array(
        z.discriminatedUnion("kind", [
          create.extend({ citations }),
          update.extend({ citations }),
          decision.extend({ citations }),
        ]),
      )
      .max(40),
  })
  .strict();

// These ranges are computed from the authorized immutable revision, never model data.
// Lines include their original newline; no trimming or normalization occurs here.
export function citationPassages(source: SourceVersion) {
  const passages: { id: string; start: number; end: number; text: string }[] =
    [];
  let start = 0;
  while (start < source.text.length) {
    const newline = source.text.indexOf("\n", start);
    const end = newline < 0 ? source.text.length : newline + 1;
    passages.push({
      id: `${source.id}:line:${passages.length + 1}`,
      start,
      end,
      text: source.text.slice(start, end),
    });
    start = end;
  }
  return passages;
}

export function resolveGeminiCitation(raw: unknown, source: SourceVersion) {
  const citation = transportCitation.parse(raw);
  requireCondition(
    citation.sourceVersionId === source.id,
    "INVALID_OUTPUT",
    "Citation must identify the selected authorized immutable source revision.",
  );
  const passage =
    citation.passageId === undefined
      ? undefined
      : citationPassages(source).find((p) => p.id === citation.passageId);
  requireCondition(
    citation.passageId === undefined || passage,
    "INVALID_OUTPUT",
    "Citation passage is not in the selected immutable source revision.",
  );
  const text = passage?.text ?? source.text;
  const first = text.indexOf(citation.quote);
  requireCondition(
    first >= 0,
    "INVALID_OUTPUT",
    "Citation quote is absent from the identified source or passage. No text was repaired.",
  );
  requireCondition(
    text.indexOf(citation.quote, first + 1) < 0,
    "INVALID_OUTPUT",
    "Citation quote has multiple exact matches; choose a supplied passage with one exact match.",
  );
  const start = (passage?.start ?? 0) + first;
  const resolved = {
    sourceVersionId: source.id,
    start,
    end: start + citation.quote.length,
    quote: citation.quote,
  };
  validateCitation(resolved, new Map([[source.id, source]]));
  return resolved;
}

export function resolveGeminiOutput(raw: unknown, source: SourceVersion) {
  const transport = geminiTransportOutput.parse(raw);
  return analysisOutput.parse({
    ...transport,
    items: transport.items.map((item) => ({
      ...item,
      citations: item.citations.map((citation) =>
        resolveGeminiCitation(citation, source),
      ),
    })),
  });
}
