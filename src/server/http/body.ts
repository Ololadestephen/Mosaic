import { DomainError, requireCondition } from "@/domain/errors";

const maxBodyBytes = 100_000;

export async function readBody(request: Request): Promise<unknown> {
  requireCondition(
    request.headers.get("content-type")?.startsWith("application/json"),
    "INVALID_INPUT",
    "Send a JSON request.",
  );
  const reader = request.body?.getReader();
  requireCondition(reader, "INVALID_INPUT", "Request body is required.");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      requireCondition(
        size <= maxBodyBytes,
        "INVALID_INPUT",
        "Request is too large.",
      );
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_INPUT", "Request must contain valid JSON.", {
      cause: error,
    });
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Cleanup must not replace the primary parse/size error or successful body.
    } finally {
      reader.releaseLock();
    }
  }
}
