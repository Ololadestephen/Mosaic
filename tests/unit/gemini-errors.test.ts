import { describe, expect, it } from "vitest";
import { geminiErrorDetails } from "@/server/ai/gemini-errors";

describe("redacted Gemini rejection diagnostics (no live HTTP)", () => {
  it("preserves status, numeric code, message, reason and field violations", () => {
    const detail = geminiErrorDetails(
      400,
      JSON.stringify({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message:
            "Invalid JSON payload received. Unknown name 'unsupportedOption'.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                {
                  field: "generation_config.unsupported_option",
                  description: "Cannot find field.",
                },
              ],
            },
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              metadata: { ignoredSecret: "never retained" },
            },
          ],
        },
      }),
      "{}",
      "fake-key",
    );
    expect(detail).toEqual({
      httpStatus: 400,
      code: 400,
      status: "INVALID_ARGUMENT",
      message:
        "Invalid JSON payload received. Unknown name 'unsupportedOption'.",
      reasons: ["API_KEY_INVALID"],
      fieldViolations: [
        {
          field: "generation_config.unsupported_option",
          description: "Cannot find field.",
        },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("never retained");
  });
  it("redacts keys and full or fragmentary source echoes before truncation", () => {
    const key = "AIzaFakeCredential123456789012345678901";
    const body = JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: JSON.stringify({
                source: {
                  text: "Confidential LaunchNotebook deadline tomorrow Li 123",
                  id: "source-identity",
                },
                members: [{ name: "PrivatePerson" }],
              }),
            },
          ],
        },
      ],
    });
    const detail = geminiErrorDetails(
      400,
      JSON.stringify({
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: `Invalid value ${key}: Confidential LaunchNotebook deadline tomorrow Li 123; LaunchNotebook; PrivatePerson; source-identity; Li; 123`,
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                {
                  field: "contents[0].parts[0].text",
                  description: `Unexpected LaunchNotebook and ${key}`,
                },
              ],
            },
          ],
        },
      }),
      body,
      key,
    );
    const saved = JSON.stringify(detail);
    for (const secret of [
      key,
      "Confidential",
      "LaunchNotebook",
      "PrivatePerson",
      "source-identity",
      "Li",
      "123",
    ])
      expect(saved).not.toContain(secret);
    expect(detail.fieldViolations[0].field).toBe("contents[0].parts[0].text");
    expect(detail.message).toContain("Invalid value");
    expect(detail.message).toContain("[redacted]");
  });
  it("never retains malformed, HTML or oversized-message tails and retains HTTP status", () => {
    const raw = "<html>secret</html>";
    expect(geminiErrorDetails(503, raw, "{}", "key")).toMatchObject({
      httpStatus: 503,
      code: null,
      status: "PROVIDER_ERROR",
    });
    expect(
      JSON.stringify(geminiErrorDetails(503, raw, "{}", "key")),
    ).not.toContain("secret");
    expect(geminiErrorDetails(429, "", "{}", "").status).toBe(
      "RESOURCE_EXHAUSTED",
    );
    const detail = geminiErrorDetails(
      400,
      JSON.stringify({ error: { message: "x".repeat(5000) } }),
      "{}",
      "",
    );
    expect(detail.message.length).toBe(1600);
  });
});
