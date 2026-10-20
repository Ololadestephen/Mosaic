import { z } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const failureBody = z
  .object({
    error: z.string().optional(),
    code: z.string().optional(),
    requestId: z.string().optional(),
  })
  .catchall(z.unknown());

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  operationKey?: string,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(operationKey ? { "X-Operation-Key": operationKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const failure = failureBody.safeParse(data);
    throw new ApiError(
      failure.success
        ? (failure.data.error ?? "Request failed.")
        : "Request failed.",
      response.status,
      failure.success ? (failure.data.code ?? "UNAVAILABLE") : "UNAVAILABLE",
      failure.success ? failure.data.requestId : undefined,
    );
  }
  return schema.parse(data);
}
