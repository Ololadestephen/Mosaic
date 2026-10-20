import type { Citation, SourceVersion } from "../contracts";
import { requireCondition } from "../errors";

export function normalizeSource(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function validateCitation(
  citation: Citation,
  versions: Map<string, SourceVersion>,
): void {
  const version = versions.get(citation.sourceVersionId);
  requireCondition(
    version,
    "INVALID_INPUT",
    "Citation refers to an unavailable source revision.",
  );
  requireCondition(
    citation.start < citation.end &&
      citation.end <= version.text.length &&
      version.text.slice(citation.start, citation.end) === citation.quote,
    "INVALID_INPUT",
    "Citation offsets and quote do not match the immutable source.",
  );
  for (const offset of [citation.start, citation.end]) {
    const code = version.text.charCodeAt(offset);
    requireCondition(
      !(code >= 0xdc00 && code <= 0xdfff),
      "INVALID_INPUT",
      "Citation splits a Unicode character.",
    );
  }
}
