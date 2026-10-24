import "server-only";
import { requireCondition } from "@/domain/errors";
import { env } from "../env";
import type { AnalysisContext } from "../reconciliation";
import {
  callGemini,
  geminiAvailable,
  geminiRequest,
  GeminiHttpError,
} from "./gemini";
import { resolveGeminiOutput } from "./gemini-citations";
import type { GeminiErrorDetails } from "./gemini-errors";
import {
  analysisAvailable as openRouterAvailable,
  analysisRequest as openRouterRequest,
  callProvider as callOpenRouter,
} from "./openrouter";

export type ProviderResult = {
  output: unknown;
  usage: Record<string, number | undefined> | null;
  durationMs: number;
};

export function providerFailureDetails(error: unknown) {
  if (!(error instanceof GeminiHttpError)) return null;
  return {
    httpStatus: error.httpStatus,
    code: error.category,
    details: error.diagnostic satisfies GeminiErrorDetails,
  };
}

export function analysisProvider(config = env()) {
  return config.AI_PROVIDER === "gemini"
    ? {
        id: "gemini" as const,
        name: "Gemini" as const,
        model: config.GEMINI_MODEL,
        enabled: geminiAvailable(config),
      }
    : {
        id: "openrouter" as const,
        name: "OpenRouter" as const,
        model: config.OPENROUTER_MODEL,
        enabled: openRouterAvailable(config),
      };
}

export function prepareAnalysis(context: AnalysisContext) {
  const provider = analysisProvider();
  requireCondition(
    provider.enabled,
    "UNAVAILABLE",
    `${provider.name} analysis is unavailable. Check the server configuration. Your source is saved; no fixture fallback is used.`,
  );
  const request =
    provider.id === "gemini"
      ? geminiRequest(context)
      : openRouterRequest(context);
  return { ...request, provider: provider.id, model: provider.model };
}

export async function callProvider(
  request: ReturnType<typeof prepareAnalysis>,
  source: AnalysisContext["source"],
  signal?: AbortSignal,
  captureResponse?: (raw: string) => Promise<void>,
  observeUsage?: (
    metadata: Pick<ProviderResult, "usage" | "durationMs">,
  ) => void,
): Promise<ProviderResult> {
  if (request.provider === "gemini") {
    const response = await callGemini(request.body, signal, captureResponse);
    observeUsage?.({ usage: response.usage, durationMs: response.durationMs });
    return {
      ...response,
      output: resolveGeminiOutput(response.output, source),
    };
  }
  const started = Date.now();
  return {
    output: await callOpenRouter(request.body, signal, captureResponse),
    usage: null,
    durationMs: Date.now() - started,
  };
}
