// Explicit local test-process HTTP fixture. Never loaded by a deployment or normal app startup.
import { readFile, appendFile } from "node:fs/promises";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  process.env.MOSAIC_E2E_MOCK_ANALYSIS !== "1" ||
  process.env.NODE_ENV === "production" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
  !database.pathname.endsWith("_test")
)
  throw new Error(
    "Mock provider requires the explicit isolated local browser lane.",
  );
const original = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.hostname !== "generativelanguage.googleapis.com")
    return original(input, init);
  // All Gemini requests terminate here, including invalid requests. No network fallback.
  if (
    url.pathname !== "/v1beta/models/gemini-3.5-flash-lite:generateContent" ||
    init?.method !== "POST"
  )
    throw new Error("Unexpected mocked provider request.");
  const fixture = JSON.parse(
    await readFile(".local/evidence/browser-analysis-fixture.json", "utf8"),
  );
  if (!init.body.includes(fixture.sourceVersionId))
    throw new Error("Mock source revision mismatch.");
  await appendFile(
    ".local/evidence/browser-analysis-attempts.jsonl",
    JSON.stringify({ sourceVersionId: fixture.sourceVersionId, mocked: true }) +
      "\n",
  );
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(fixture.output) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 30,
      totalTokenCount: 40,
    },
  });
};
