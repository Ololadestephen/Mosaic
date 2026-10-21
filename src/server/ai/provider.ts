import "server-only";
import { requireCondition } from "@/domain/errors";
import { env } from "../env";
import type { AnalysisContext } from "../reconciliation";
import {
  callGemini,
  geminiAvailable,
  geminiRequest,
  type ProviderResult,
} from "./gemini";
import {
  analysisAvailable as openRouterAvailable,
  analysisRequest as openRouterRequest,
  callProvider as callOpenRouter,
} from "./openrouter";

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
  signal?: AbortSignal,
  captureResponse?: (raw: string) => Promise<void>,
): Promise<ProviderResult> {
  if (request.provider === "gemini")
    return callGemini(request.body, signal, captureResponse);
  const started = Date.now();
  return {
    output: await callOpenRouter(request.body, signal),
    usage: null,
    durationMs: Date.now() - started,
  };
}
