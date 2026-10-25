import "server-only";
import { z } from "@/domain/zod";
import { analysisOutput } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import type { AnalysisContext } from "../reconciliation";
import { env } from "../env";
import {
  analysisData,
  encodeRequest,
  instructions,
  maxOutputTokens,
} from "./prompt";

export const freeModel = "deepseek/deepseek-v4.1-flash-1017:free";
const usdPerMillionScale = 1_000_000;
const maxProviderResponseCharacters = 250_000;
const providerUrl = "https://openrouter.ai/api/v1/chat/completions";

const completion = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z
          .object({
            content: z
              .union([
                z.string(),
                z.array(
                  z.object({
                    type: z.string().optional(),
                    text: z.string().optional(),
                  }),
                ),
              ])
              .nullable()
              .optional(),
            refusal: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

export function analysisAvailable(config = env()) {
  const identified =
    config.AI_ENABLED === "true" &&
    config.OPENROUTER_API_KEY.trim().length > 0 &&
    config.OPENROUTER_MODEL.trim().length > 0;
  if (!identified) return false;
  if (config.OPENROUTER_MODEL === freeModel)
    return (
      config.AI_INPUT_USD_PER_MILLION === 0 &&
      config.AI_OUTPUT_USD_PER_MILLION === 0
    );
  return (
    config.AI_DAILY_BUDGET_USD > 0 &&
    config.AI_INPUT_USD_PER_MILLION > 0 &&
    config.AI_OUTPUT_USD_PER_MILLION > 0
  );
}

export function analysisRequest(context: AnalysisContext) {
  const config = env();
  const body = {
    model: config.OPENROUTER_MODEL,
    messages: [
      { role: "system", content: instructions },
      {
        role: "user",
        content: JSON.stringify(analysisData(context)),
      },
    ],
    max_tokens: maxOutputTokens,
    reasoning: { effort: "none" },
    provider: { require_parameters: true },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mosaic_proposal",
        strict: true,
        schema: z.toJSONSchema(analysisOutput, { target: "draft-7" }),
      },
    },
  };
  const encoded = encodeRequest(body);
  const reservedInputTokens = Buffer.byteLength(encoded, "utf8") * 2;
  const reservedUsd =
    Math.ceil(
      ((reservedInputTokens * config.AI_INPUT_USD_PER_MILLION +
        maxOutputTokens * config.AI_OUTPUT_USD_PER_MILLION) /
        usdPerMillionScale) *
        usdPerMillionScale,
    ) / usdPerMillionScale;
  return { body: encoded, reservedUsd };
}

function assertAnalysisEnabled() {
  requireCondition(
    analysisAvailable(),
    "UNAVAILABLE",
    "Live analysis needs an OpenRouter key. The free DeepSeek model uses zero token prices and the daily call limit. Any other model needs current token prices and a daily budget above zero. Your source is saved.",
  );
}

async function providerFailure(response: Response) {
  const raw = await response.text();
  try {
    const result = z
      .object({
        error: z.union([z.string(), z.object({ message: z.string() })]),
      })
      .safeParse(JSON.parse(raw));
    if (!result.success) return "";
    const message =
      typeof result.data.error === "string"
        ? result.data.error
        : result.data.error.message;
    return message?.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
  } catch {
    return "";
  }
}

function messageText(content: string | { text?: string }[] | null | undefined) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((part) => part.text ?? "").join("");
  return "";
}

export async function callProvider(
  body: string,
  signal?: AbortSignal,
  captureResponse?: (raw: string) => Promise<void>,
): Promise<unknown> {
  assertAnalysisEnabled();
  const config = env();
  try {
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.APP_ORIGIN,
        "X-Title": "Mosaic",
      },
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(90_000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
    if (response.status === 429)
      throw new DomainError(
        "RATE_LIMITED",
        "OpenRouter is rate-limited. No automatic retry was made.",
      );
    if (!response.ok) {
      const detail = await providerFailure(response);
      throw new DomainError(
        "PROVIDER_FAILED",
        detail
          ? `OpenRouter could not complete analysis (${response.status}: ${detail}). No automatic retry was made.`
          : "OpenRouter could not complete analysis. Check the key and model; no automatic retry was made.",
      );
    }
    const text = await response.text();
    requireCondition(
      text.length <= maxProviderResponseCharacters,
      "PROVIDER_FAILED",
      "The model response exceeded the allowed size.",
    );
    await captureResponse?.(text);
    const parsed = completion.parse(JSON.parse(text));
    const choice = parsed.choices[0];
    requireCondition(
      choice.finish_reason !== "length",
      "PROVIDER_FAILED",
      "The model did not complete its response. Your source is saved.",
    );
    requireCondition(
      !choice.message?.refusal && choice.finish_reason !== "content_filter",
      "PROVIDER_FAILED",
      "The model declined this analysis. Your source is saved.",
    );
    return JSON.parse(messageText(choice.message?.content));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "PROVIDER_FAILED",
      error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
        ? "Analysis timed out. Your source is saved; check this run before retrying."
        : "The model returned an unusable response. No work was changed.",
      { cause: error },
    );
  }
}
