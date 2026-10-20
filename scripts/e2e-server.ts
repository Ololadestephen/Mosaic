import { readFile } from "node:fs/promises";
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
await migrate(url);
const server = spawn(
  process.execPath,
  [
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
      AI_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      MOSAIC_E2E: "true",
    },
  },
);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
