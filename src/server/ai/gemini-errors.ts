import { z } from "zod";

const providerError = z.object({
  error: z.object({
    code: z.number().int().optional(),
    status: z
      .enum([
        "CANCELLED",
        "UNKNOWN",
        "INVALID_ARGUMENT",
        "DEADLINE_EXCEEDED",
        "NOT_FOUND",
        "ALREADY_EXISTS",
        "PERMISSION_DENIED",
        "UNAUTHENTICATED",
        "RESOURCE_EXHAUSTED",
        "FAILED_PRECONDITION",
        "ABORTED",
        "OUT_OF_RANGE",
        "UNIMPLEMENTED",
        "INTERNAL",
        "UNAVAILABLE",
        "DATA_LOSS",
        "PROVIDER_ERROR",
      ])
      .catch("PROVIDER_ERROR")
      .optional(),
    message: z.string().optional(),
    details: z
      .array(
        z.object({
          "@type": z.string(),
          reason: z.string().optional(),
          fieldViolations: z
            .array(z.object({ field: z.string(), description: z.string() }))
            .optional(),
        }),
      )
      .optional(),
  }),
});

// Only caller-supplied content is sensitive here; schema and instruction text
// must not erase the technical field names needed to diagnose a bad request.
function contentStrings(body: string): string[] {
  const values: string[] = [];
  function collect(value: unknown) {
    if (typeof value === "string") {
      values.push(value);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  }
  try {
    const contents = z
      .array(
        z.object({ parts: z.array(z.object({ text: z.string().optional() })) }),
      )
      .parse(JSON.parse(body).contents);
    for (const content of contents)
      for (const part of content.parts) {
        if (!part.text) continue;
        try {
          const data: unknown = JSON.parse(part.text);
          if (data && typeof data === "object") collect(data);
          else values.push(part.text);
        } catch {
          values.push(part.text);
        }
      }
  } catch {
    values.push(body);
  }
  return values;
}

export function geminiErrorDetails(
  httpStatus: number,
  raw: string,
  body: string,
  key: string,
) {
  const strings = contentStrings(body);
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literals = [
    ...strings,
    ...(key
      ? [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]
      : []),
  ];
  const words = strings.flatMap(
    (value) => value.match(/[\p{L}\p{N}_-]+/gu) ?? [],
  );
  const expressions = [
    ...literals.filter(Boolean).map(escape),
    ...words.map(
      (word) => `(?<![\\p{L}\\p{N}_-])${escape(word)}(?![\\p{L}\\p{N}_-])`,
    ),
  ];
  const patterns = [...new Set(expressions)]
    .sort((a, b) => b.length - a.length)
    .map((expression) => new RegExp(expression, "giu"));
  function redact(value: string, limit = 1600) {
    let safe = value.replace(/\ufffc/g, " ");
    for (const pattern of patterns) safe = safe.replace(pattern, "\ufffc");
    safe = safe.replace(/AIza[\w-]+|Bearer\s+[^\s,;]+|sk-[\w-]+/gi, "\ufffc");
    return safe
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replaceAll("\ufffc", "[redacted]")
      .slice(0, limit);
  }
  let parsed: z.infer<typeof providerError> | undefined;
  try {
    parsed = providerError.parse(JSON.parse(raw));
  } catch {
    /* Never retain an unstructured body. */
  }
  const error = parsed?.error;
  return {
    httpStatus,
    code: error?.code ?? null,
    status:
      error?.status ??
      (httpStatus === 429 ? "RESOURCE_EXHAUSTED" : "PROVIDER_ERROR"),
    message: error?.message
      ? redact(error.message)
      : "Provider returned no usable structured error message.",
    reasons: (error?.details ?? [])
      .filter(
        (detail) =>
          detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo",
      )
      .flatMap((detail) =>
        detail.reason && /^[A-Z_]{1,80}$/.test(detail.reason)
          ? [redact(detail.reason, 80)]
          : [],
      )
      .slice(0, 10),
    fieldViolations: (error?.details ?? [])
      .filter(
        (detail) =>
          detail["@type"] === "type.googleapis.com/google.rpc.BadRequest",
      )
      .flatMap((detail) => detail.fieldViolations ?? [])
      .slice(0, 20)
      .map((violation) => ({
        field: redact(violation.field, 300),
        description: redact(violation.description),
      })),
  };
}

export type GeminiErrorDetails = ReturnType<typeof geminiErrorDetails>;
