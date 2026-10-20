import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/server/env";

afterEach(() => vi.unstubAllEnvs());
function preview() {
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@localhost/mosaic_test");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", "mosaic-pr-42.example.com");
  vi.stubEnv("APP_ORIGIN", undefined);
  vi.stubEnv("AI_ENABLED", "false");
  vi.stubEnv("ALLOW_REGISTRATION", "false");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
}
describe("restricted hosted previews", () => {
  it("uses its own HTTPS origin and keeps AI and registration disabled", () => {
    preview();
    expect(env()).toMatchObject({
      APP_ORIGIN: "https://mosaic-pr-42.example.com",
      AI_ENABLED: "false",
      ALLOW_REGISTRATION: "false",
    });
  });
  it.each([
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "AI_ENABLED",
    "ALLOW_REGISTRATION",
  ])("fails closed for unsafe preview configuration: %s", (field) => {
    preview();
    vi.stubEnv(
      field,
      field.endsWith("API_KEY") ? "synthetic-placeholder" : "true",
    );
    expect(() => env()).toThrow("Preview deployments require");
  });
  it("refuses a preview without an HTTPS origin", () => {
    preview();
    vi.stubEnv("VERCEL_URL", undefined);
    expect(() => env()).toThrow("exact HTTPS origin");
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    expect(() => env()).toThrow("exact HTTPS origin");
  });
});
