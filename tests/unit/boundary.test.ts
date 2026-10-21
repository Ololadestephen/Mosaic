import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/components/api";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { readBody } from "@/server/http/body";
import { env } from "@/server/env";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("environment", () => {
  it("rejects a server that has no database", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => env()).toThrow(DomainError);
  });

  it("keeps live analysis off unless budget and a model are set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://local@localhost/mosaic_test");
    expect(env().AI_ENABLED).toBe("false");
    expect(env().APP_ORIGIN).toBe("http://localhost:3000");
  });

  it("accepts the approved ten-attempt hosted ceiling and rejects eleven", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://local@localhost/mosaic_test");
    vi.stubEnv("GEMINI_HOSTED_ATTEMPT_LIMIT", "10");
    expect(env().GEMINI_HOSTED_ATTEMPT_LIMIT).toBe(10);
    vi.stubEnv("GEMINI_HOSTED_ATTEMPT_LIMIT", "11");
    expect(() => env()).toThrow(DomainError);
  });
});

describe("request body", () => {
  it("requires json and rejects a body over the limit", async () => {
    await expect(
      readBody(new Request("http://local/api", { method: "POST" })),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const request = new Request("http://local/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readBody(request)).resolves.toEqual({ ok: true });
    const huge = new Request("http://local/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(100_001),
    });
    await expect(readBody(huge)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("browser client", () => {
  it("parses a successful payload and keeps the error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ id: "workspace", extra: true })),
    );
    await expect(
      api("workspaces", z.object({ id: z.string() }).catchall(z.unknown())),
    ).resolves.toMatchObject({
      id: "workspace",
      extra: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: "Sign in to continue.",
            code: "UNAUTHENTICATED",
            requestId: "req",
          },
          { status: 401 },
        ),
      ),
    );
    const failed = api("session", z.unknown());
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({
      message: "Sign in to continue.",
      status: 401,
      code: "UNAUTHENTICATED",
      requestId: "req",
    });
  });
});
