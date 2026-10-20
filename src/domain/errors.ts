export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "INVALID_OUTPUT"
  | "PROVIDER_FAILED";

const statuses: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  QUOTA_EXHAUSTED: 429,
  INVALID_OUTPUT: 502,
  PROVIDER_FAILED: 502,
};

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = statuses[code];
  }
}

export function requireCondition(
  condition: unknown,
  code: ErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
