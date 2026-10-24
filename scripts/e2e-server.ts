import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { migrate } from "./migrate";

const port = Number(process.env.MOSAIC_E2E_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("MOSAIC_E2E_PORT must be an integer from 1024 to 65535.");

const local = await readFile(".local/test.env", "utf8").catch(() => "");
const url =
  process.env.TEST_DATABASE_URL ??
  local.trim().replace(/^TEST_DATABASE_URL=/, "");
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Browser tests require an isolated _test database. Start the local database first.",
  );
const mockAnalysis = process.env.MOSAIC_E2E_MOCK_ANALYSIS === "1";
if (
  mockAnalysis &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw new Error("Mock analysis is restricted to the local test database.");
await migrate(url);
const server = spawn(
  process.execPath,
  [
    ...(mockAnalysis ? ["--import", "./tests/e2e/mock-provider.mjs"] : []),
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      APP_ORIGIN: `http://localhost:${port}`,
      AI_ENABLED: mockAnalysis ? "true" : "false",
      ...(mockAnalysis
        ? {
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${process.cwd()}/tests/e2e/mock-provider.mjs`,
            AI_PROVIDER: "gemini",
            GEMINI_API_KEY: "mock-only-never-sent-to-provider",
            GEMINI_MODEL: "gemini-3.5-flash-lite",
            GEMINI_FREE_TIER_CONFIRMED: "true",
            GEMINI_VALIDATION_ID: randomUUID(),
            GEMINI_VALIDATION_CALL_LIMIT: "1",
            AI_DAILY_BUDGET_USD: "0",
            AI_INPUT_USD_PER_MILLION: "0",
            AI_OUTPUT_USD_PER_MILLION: "0",
          }
        : {}),
      NEXT_TELEMETRY_DISABLED: "1",
      MOSAIC_E2E: "true",
    },
  },
);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
