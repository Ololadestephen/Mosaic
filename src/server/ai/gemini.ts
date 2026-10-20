import "server-only";
import { z } from "zod";
import { analysisOutput } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { env } from "../env";
import { geminiErrorDetails, type GeminiErrorDetails } from "./gemini-errors";
import type { AnalysisContext } from "../reconciliation";
import {
  analysisData,
  encodeRequest,
  instructions,
  maxOutputTokens,
} from "./prompt";

const tokenCount = z.number().int().nonnegative();
export class GeminiHttpError extends DomainError {
  constructor(
    readonly httpStatus: number,
    readonly category: string,
    readonly diagnostic: GeminiErrorDetails,
  ) {
    super(
      httpStatus === 429 ? "QUOTA_EXHAUSTED" : "PROVIDER_FAILED",
      `Gemini rejected analysis (HTTP ${httpStatus}, ${category}). No automatic retry was made; your source is saved.`,
    );
  }
}
const usage = z.object({
  promptTokenCount: tokenCount.optional(),
  candidatesTokenCount: tokenCount.optional(),
  totalTokenCount: tokenCount.optional(),
  thoughtsTokenCount: tokenCount.optional(),
  cachedContentTokenCount: tokenCount.optional(),
});
const completion = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string(),
        content: z
          .object({
            parts: z.array(
              z.object({
                text: z.string().optional(),
                thought: z.boolean().optional(),
              }),
            ),
          })
          .optional(),
      }),
    )
    .default([]),
  usageMetadata: usage.optional(),
});

export type ProviderResult = {
  output: unknown;
  usage: z.infer<typeof usage> | null;
  durationMs: number;
};

export function geminiAvailable(config = env()) {
  return (
    config.AI_ENABLED === "true" &&
    config.GEMINI_API_KEY.trim().length > 0 &&
    config.GEMINI_FREE_TIER_CONFIRMED === "true" &&
    config.GEMINI_VALIDATION_ID.length > 0 &&
    config.AI_DAILY_BUDGET_USD === 0 &&
    config.AI_INPUT_USD_PER_MILLION === 0 &&
    config.AI_OUTPUT_USD_PER_MILLION === 0
  );
}

// Gemini accepts a JSON Schema subset. Local Zod and evidence validation retain
// the stricter string/date/identity rules that generation cannot establish.
function generationSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(generationSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (
        [
          "$schema",
          "pattern",
          "minLength",
          "maxLength",
          "format",
          "editedBy",
        ].includes(key)
      )
        return [];
      if (key === "const") return [["enum", [item]]];
      return [[key, generationSchema(item)]];
    }),
  );
}

export function geminiRequest(context: AnalysisContext) {
  return {
    body: encodeRequest({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(analysisData(context)) }],
        },
      ],
      generationConfig: {
        candidateCount: 1,
        maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: generationSchema(
          z.toJSONSchema(analysisOutput, { target: "draft-7" }),
        ),
      },
    }),
    reservedUsd: 0,
  };
}

async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  requireCondition(
    reader,
    "INVALID_OUTPUT",
    "Gemini returned an empty response.",
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      requireCondition(
        size <= 250_000,
        "INVALID_OUTPUT",
        "Gemini response exceeded the allowed size. No proposal was saved.",
      );
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function callGemini(
  body: string,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  const config = env();
  requireCondition(
    geminiAvailable(config),
    "UNAVAILABLE",
    "Gemini is unavailable. Configure the server key and confirm this project's free tier before enabling analysis.",
  );
  const started = Date.now();
  try {
    const cancellation = AbortSignal.any([
      AbortSignal.timeout(90_000),
      ...(signal ? [signal] : []),
    ]);
    cancellation.throwIfAborted();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": config.GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body,
        signal: cancellation,
        redirect: "error",
      },
    );
    if (!response.ok) {
      let raw = "";
      try {
        raw = await boundedResponse(response);
      } catch {
        /* Preserve HTTP status even if the body is unusable. */
      }
      const diagnostic = geminiErrorDetails(
        response.status,
        raw,
        body,
        config.GEMINI_API_KEY,
      );
      throw new GeminiHttpError(response.status, diagnostic.status, diagnostic);
    }
    const parsed = completion.parse(
      JSON.parse(await boundedResponse(response)),
    );
    cancellation.throwIfAborted();
    requireCondition(
      !parsed.promptFeedback?.blockReason,
      "PROVIDER_FAILED",
      "Gemini blocked this analysis. No proposal was saved.",
    );
    const candidate = parsed.candidates[0];
    requireCondition(
      parsed.candidates.length === 1 && candidate?.finishReason === "STOP",
      "INVALID_OUTPUT",
      "Gemini returned blocked, incomplete or truncated output. No proposal was saved.",
    );
    const text =
      candidate.content?.parts
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("") ?? "";
    return {
      output: analysisOutput.parse(JSON.parse(text)),
      usage: parsed.usageMetadata ?? null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (signal?.aborted)
      throw new DomainError(
        "PROVIDER_FAILED",
        "Analysis was cancelled. No proposal was saved; check this run before retrying.",
      );
    throw new DomainError(
      error instanceof SyntaxError || error instanceof z.ZodError
        ? "INVALID_OUTPUT"
        : "PROVIDER_FAILED",
      error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
        ? "Gemini timed out. No automatic retry was made; your source is saved."
        : "Gemini returned an unusable response or could not be reached. No proposal was saved.",
    );
  }
}
