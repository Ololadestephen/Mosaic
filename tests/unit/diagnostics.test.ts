import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { errorDiagnostic, reportError } from "@/server/diagnostics";
import { analysisFailure, recordAnalysisFailure } from "@/server/ai/analyze";

afterEach(() => vi.restoreAllMocks());
describe("redacted internal errors", () => {
  it("retains causes but logs only safe type and source locations", () => {
    const secret = "synthetic-private-source-and-password";
    const cause = new TypeError(secret);
    cause.stack = `TypeError: ${secret}\n    at save (/private/${secret}/src/server/ai/analyze.ts:170:4)`;
    const failure = new DomainError("UNAVAILABLE", "Saved input is safe.", {
      cause,
    });
    expect(failure.cause).toBe(cause);
    expect(errorDiagnostic(cause)).toEqual({
      type: "TypeError",
      locations: ["src/server/ai/analyze.ts:170:4"],
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("http-request", failure, "synthetic-request-id");
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).toContain("analyze.ts:170:4");
  });
  it("does not blame output validation for unknown infrastructure failures", () => {
    const primary = new TypeError("synthetic internal failure");
    expect(analysisFailure(primary)).toMatchObject({
      code: "UNAVAILABLE",
      cause: primary,
    });
    const parsed = z.string().safeParse(42);
    if (parsed.success) throw Error("Expected invalid fixture");
    expect(analysisFailure(parsed.error).code).toBe("INVALID_OUTPUT");
    const denied = new DomainError("FORBIDDEN", "Permission changed.");
    expect(analysisFailure(denied)).toBe(denied);
  });
  it("secondary failure recording cannot replace the primary failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const primary = new DomainError("PROVIDER_FAILED", "Provider failed.");
    await expect(
      recordAnalysisFailure(primary, async () => {
        throw new Error("synthetic SQL credentials");
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "synthetic SQL credentials",
    );
    expect(analysisFailure(primary)).toBe(primary);
  });
});
