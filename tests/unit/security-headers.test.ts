import { afterEach, describe, expect, it, vi } from "vitest";

async function policyFor(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { default: config } = await import("../../next.config");
  const [rule] = await config.headers!();
  return rule.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )!.value;
}

afterEach(() => vi.unstubAllEnvs());

describe("content security policy", () => {
  it("allows neither eval nor websockets in production", async () => {
    const policy = await policyFor("production");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("frame-ancestors 'none'");
  });
  it("keeps eval and hot-reload websockets for the development server", async () => {
    const policy = await policyFor("development");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
  });
});
