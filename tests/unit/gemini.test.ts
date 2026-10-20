import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { callGemini, geminiRequest } from "@/server/ai/gemini";
import { prepareAnalysis } from "@/server/ai/provider";

const output = {
  items: [],
  questions: ["Which task should change?"],
  preserved: [],
};
const context = () => {
  const source = {
    id: randomUUID(),
    sourceId: randomUUID(),
    text: "Synthetic note only.",
    number: 1,
    predecessorId: null,
  };
  return {
    source,
    versions: [source],
    tasks: [],
    members: [],
    memberIds: [],
    restrictedTo: null,
  };
};
function response() {
  const text = JSON.stringify(output);
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { text: "Never show internal thoughts", thought: true },
            { text: text.slice(0, 20) },
            { text: text.slice(20) },
          ],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 15,
      candidatesTokenCount: 12,
      totalTokenCount: 27,
      secretOrTranscript: "must not persist",
    },
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://local@localhost/mosaic_test");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "mock-gemini-key-never-sent");
  vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
  vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "true");
  vi.stubEnv("GEMINI_VALIDATION_ID", randomUUID());
  vi.stubEnv("AI_DAILY_BUDGET_USD", "0");
  vi.stubEnv("AI_INPUT_USD_PER_MILLION", "0");
  vi.stubEnv("AI_OUTPUT_USD_PER_MILLION", "0");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Gemini boundary with mocked HTTP only", () => {
  it("requires confirmed free-tier configuration and refuses paid or unknown models", async () => {
    vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "false");
    await expect(callGemini("{}")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "true");
    vi.stubEnv("AI_DAILY_BUDGET_USD", "1");
    await expect(callGemini("{}")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    vi.stubEnv("AI_DAILY_BUDGET_USD", "0");
    vi.stubEnv("GEMINI_MODEL", "gemini-paid-or-preview-model");
    await expect(callGemini("{}")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses a bounded text-only schema request and contains no key, tools or paid fallback", () => {
    const request = prepareAnalysis(context());
    const body = JSON.parse(request.body);
    expect(request.provider).toBe("gemini");
    expect(request.reservedUsd).toBe(0);
    expect(body.systemInstruction.parts[0].text).toContain("untrusted DATA");
    expect(body.generationConfig.maxOutputTokens).toBe(5000);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(
      body.generationConfig.responseJsonSchema.properties.items,
    ).toBeDefined();
    expect(body.tools).toBeUndefined();
    expect(request.body).not.toContain("mock-gemini-key");
    const huge = context();
    huge.source.text = "x".repeat(90_001);
    expect(() => geminiRequest(huge)).toThrow("input limit");
  });
  it("parses text parts, ignores thought parts, and retains only safe token counts", async () => {
    const mock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", mock);
    const result = await callGemini(geminiRequest(context()).body);
    expect(result.output).toEqual(output);
    expect(result.usage).toEqual({
      promptTokenCount: 15,
      candidatesTokenCount: 12,
      totalTokenCount: 27,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "mock-gemini-key-never-sent",
    );
    expect(init.redirect).toBe("error");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("reports quota and access errors without retrying, echoing error text or falling back", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    for (const status of [429, 400, 401, 403, 404, 503]) {
      mock.mockResolvedValue(
        Response.json(
          { error: { message: "secret source text and key" } },
          { status },
        ),
      );
      const error = await callGemini("{}").catch((error: Error) => error);
      expect(error).toMatchObject({
        code: status === 429 ? "QUOTA_EXHAUSTED" : "PROVIDER_FAILED",
      });
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain("secret source");
    }
    expect(mock).toHaveBeenCalledTimes(6);
  });
  it("preserves HTTP status for malformed and oversized rejection bodies", async () => {
    for (const raw of [
      "<html>mock-gemini-key-never-sent</html>",
      "x".repeat(250_001),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(raw, { status: 400 })),
      );
      const error = await callGemini("{}").catch((error: Error) => error);
      expect(error).toMatchObject({
        httpStatus: 400,
        category: "PROVIDER_ERROR",
        diagnostic: { httpStatus: 400, code: null },
      });
      expect(JSON.stringify(error)).not.toContain("mock-gemini-key-never-sent");
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects blocked, truncated, absent and schema-invalid output", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    for (const value of [
      { promptFeedback: { blockReason: "SAFETY" } },
      {
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: JSON.stringify(output) }] },
          },
        ],
      },
      { candidates: [] },
      {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: '{"items":[],"questions":[],"preserved":[],"execute":"delete"}',
                },
              ],
            },
          },
        ],
      },
      { candidates: [{ finishReason: "STOP", content: { parts: [] } }] },
    ]) {
      mock.mockResolvedValue(Response.json(value));
      await expect(callGemini("{}")).rejects.toThrow();
    }
    expect(mock).toHaveBeenCalledTimes(5);
  });
  it("cancels before HTTP, handles timeout, and bounds streamed response size", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(callGemini("{}", controller.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")),
    );
    await expect(callGemini("{}")).rejects.toThrow("timed out");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(250_001))),
    );
    await expect(callGemini("{}")).rejects.toThrow("exceeded");
  });
});
