import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { api, ApiError } from "@/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client failures", () => {
  it("turns a non-JSON proxy failure into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Service unavailable</html>", {
          status: 503,
          headers: { "x-request-id": "proxy-request" },
        }),
      ),
    );
    const failure = await api("workspaces", z.unknown()).catch(
      (error) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      message: "Request failed.",
      status: 503,
      code: "UNAVAILABLE",
      requestId: "proxy-request",
    });
  });

  it("preserves a structured API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: "This proposal has changed.",
            code: "CONFLICT",
            requestId: "request-id",
          },
          { status: 409 },
        ),
      ),
    );
    await expect(api("workspaces", z.unknown())).rejects.toMatchObject({
      message: "This proposal has changed.",
      status: 409,
      code: "CONFLICT",
      requestId: "request-id",
    });
  });
});
