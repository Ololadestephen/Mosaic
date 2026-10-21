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
  vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", undefined);
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
  it("uses a 4096-token production JSON mode with prompt rules, no diagnostic limit, schema or fallback", () => {
    const request = prepareAnalysis(context());
    const body = JSON.parse(request.body);
    expect(request.provider).toBe("gemini");
    expect(request.reservedUsd).toBe(0);
    expect(Object.keys(body)).toEqual(["contents", "generationConfig"]);
    expect(body.contents[0].parts[0].text).toContain("untrusted DATA");
    expect(body.contents[0].parts[0].text).toContain("expectedRevision");
    expect(body.contents[0].parts[0].text).toContain(
      "Do not return start/end offsets",
    );
    expect(body.contents[0].parts[0].text).toContain("citationPassages");
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    expect(body.contents[0].parts[0].text).toContain("4096 tokens");
    expect(body.contents[0].parts[0].text).toContain("at most two");
    expect(body.contents[0].parts[0].text).not.toMatch(/\.\.\.|…/);
    expect(body.contents[0].parts[0].text).not.toContain("fields:{status");
    expect(body.contents[0].parts[0].text).not.toContain("256 output tokens");
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
    expect(body.contents[0].role).toBeUndefined();
    expect(body.systemInstruction).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(request.body).not.toContain("mock-gemini-key");
    const huge = context();
    huge.source.text = "x".repeat(90_001);
    expect(() => geminiRequest(huge)).toThrow("input limit");
  });
  it("uses the explicitly configured output budget and rejects diagnostic/out-of-model limits before HTTP", () => {
    vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", "8192");
    const body = JSON.parse(geminiRequest(context()).body);
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(body.contents[0].parts[0].text).toContain("8192 tokens");
    for (const value of ["256", "0", "-1", "4096.5", "65537", "invalid"]) {
      vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", value);
      expect(() => geminiRequest(context())).toThrow("configuration");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("permits the authorized cumulative cap of thirteen, but no higher slots", () => {
    vi.stubEnv("GEMINI_VALIDATION_CALL_LIMIT", "13");
    expect(() => geminiRequest(context())).not.toThrow();
    vi.stubEnv("GEMINI_VALIDATION_CALL_LIMIT", "14");
    expect(() => geminiRequest(context())).toThrow("configuration");
    expect(fetch).not.toHaveBeenCalled();
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
  it("rejects malformed, fenced, missing-field and mixed-kind JSON without repair or coercion", async () => {
    for (const text of [
      "{broken",
      '{"items":[{"citations":[{"start":0,..."quote":"Synthetic"}]}],"questions":[],"preserved":[]}',
      `\x60\x60\x60json\n${JSON.stringify(output)}\n\x60\x60\x60`,
      JSON.stringify({ items: [], questions: [] }),
      JSON.stringify({ items: [], questions: "question", preserved: [] }),
      JSON.stringify({
        items: [
          {
            kind: "decision",
            key: "d",
            reason: "r",
            impact: "",
            citations: [
              { sourceVersionId: randomUUID(), start: 0, end: 1, quote: "A" },
            ],
            statement: "s",
            needsReview: true,
            taskId: randomUUID(),
          },
        ],
        questions: [],
        preserved: [],
      }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            candidates: [
              { finishReason: "STOP", content: { parts: [{ text }] } },
            ],
          }),
        ),
      );
      await expect(callGemini("{}")).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
        message: expect.stringContaining("no repair call"),
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("captures the exact bounded response before malformed-output rejection, without repairing it", async () => {
    const raw =
      '{ "candidates": [{"finishReason":"STOP","content":{"parts":[{"text":"{broken"}]}}] }';
    const capture = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw)));
    await expect(callGemini("{}", undefined, capture)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
    expect(capture).toHaveBeenCalledExactlyOnceWith(raw);
    expect(fetch).toHaveBeenCalledTimes(1);
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
