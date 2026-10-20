import { defineConfig } from "@playwright/test";

const target = process.env.MOSAIC_PREVIEW_URL;
const commit = process.env.MOSAIC_EXPECTED_COMMIT;
if (!target || !commit || !/^[a-f0-9]{40}$/.test(commit))
  throw new Error(
    "An explicit preview URL and full expected PR commit SHA are required.",
  );
const url = new URL(target);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw new Error(
    "Use an HTTPS preview origin without credentials, path, query or fragment.",
  );

export default defineConfig({
  testDir: "./tests/hosted",
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [["list"]],
  outputDir: ".local/evidence/hosted-results",
  use: {
    baseURL: url.origin,
    ignoreHTTPSErrors: false,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
