import "server-only";

const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ZodError",
  "DomainError",
  "PostgresError",
  "TimeoutError",
  "AbortError",
  "GeminiHttpError",
]);

// Never serialize error messages, arbitrary properties, SQL or provider/source text.
export function errorDiagnostic(error: unknown) {
  if (!(error instanceof Error)) return { type: "UnknownError", locations: [] };
  const locations = [
    ...(error.stack ?? "").matchAll(
      /(?:src|scripts)\/[A-Za-z0-9_./[\]-]+\.(?:tsx?|js):\d+:\d+/g,
    ),
  ]
    .slice(0, 6)
    .map((match) => match[0]);
  return {
    type: errorTypes.has(error.name) ? error.name : "Error",
    locations,
  };
}

export function reportError(
  operation: string,
  error: unknown,
  requestId?: string,
) {
  console.error({
    operation,
    requestId,
    ...errorDiagnostic(error),
    cause:
      error instanceof Error && error.cause
        ? errorDiagnostic(error.cause)
        : undefined,
  });
}
