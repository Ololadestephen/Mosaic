import { defineConfig } from "@playwright/test";

const port = Number(process.env.MOSAIC_E2E_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("MOSAIC_E2E_PORT must be an integer from 1024 to 65535.");
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: ".local/evidence/browser-report", open: "never" }],
  ],
  outputDir: ".local/evidence/browser-results",
  use: {
    baseURL: origin,
    headless: true,
    channel: process.env.CI ? "chromium" : "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/e2e-server.ts",
    url: origin,
    timeout: 45000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
