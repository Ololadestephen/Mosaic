import "server-only";
import { z } from "zod";
import { DomainError } from "@/domain/errors";

const environment = z.object({
  DATABASE_URL: z.string().refine((value) => {
    try {
      return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Use a postgres database URL."),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  AI_ENABLED: z.enum(["true", "false"]).default("false"),
  // Empty allowlist denies all hosted production analysis; UUIDs are server-only.
  AI_ALLOWED_ACCOUNT_IDS: z
    .string()
    .default("")
    .transform((value) => (value ? value.split(",") : []))
    .pipe(z.array(z.uuid())),
  AI_ACCOUNT_TOTAL_CALL_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1),
  // Separate new hosted authorization; never replaces the exhausted diagnostic cap. The ceiling stays far below the
  // free tier's 500 requests per day for the allowlisted model.
  GEMINI_HOSTED_ATTEMPT_LIMIT: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .default(0),
  AI_PROVIDER: z.enum(["gemini", "openrouter"]).default("gemini"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z
    .literal("gemini-3.5-flash-lite")
    .default("gemini-3.5-flash-lite"),
  // Application floor prevents inheriting the exhausted 256-token diagnostic
  // setting; the ceiling is this allowlisted model's documented output limit.
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65536)
    .default(4096),
  GEMINI_FREE_TIER_CONFIRMED: z.enum(["true", "false"]).default("false"),
  GEMINI_VALIDATION_ID: z.union([z.uuid(), z.literal("")]).default(""),
  GEMINI_VALIDATION_CALL_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().max(100).default(""),
  AI_DAILY_CALL_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AI_DAILY_BUDGET_USD: z.coerce.number().min(0).max(100).default(0),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().min(0).max(1000).default(0),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).max(1000).default(0),
});

export function registrationOpen() {
  const parsed = z
    .enum(["true", "false"])
    .safeParse(process.env.ALLOW_REGISTRATION ?? "true");
  return (
    process.env.VERCEL_ENV !== "preview" &&
    parsed.success &&
    parsed.data === "true"
  );
}

export function env() {
  const origin =
    process.env.APP_ORIGIN ??
    (process.env.VERCEL_URL && /^[a-z0-9.-]+$/i.test(process.env.VERCEL_URL)
      ? `https://${process.env.VERCEL_URL}`
      : undefined);
  const preview = process.env.VERCEL_ENV === "preview";
  if (preview && (!origin || !origin.startsWith("https://")))
    throw new DomainError(
      "UNAVAILABLE",
      "Preview deployments require their exact HTTPS origin.",
    );
  if (
    preview &&
    (process.env.AI_ENABLED === "true" ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.ALLOW_REGISTRATION === "true")
  )
    throw new DomainError(
      "UNAVAILABLE",
      "Preview deployments require closed registration and no live AI credentials.",
    );
  const parsed = environment.safeParse({
    ...process.env,
    APP_ORIGIN: origin,
    ...(preview ? { AI_ENABLED: "false", ALLOW_REGISTRATION: "false" } : {}),
  });
  if (!parsed.success)
    throw new DomainError(
      "UNAVAILABLE",
      "Server configuration is incomplete. Configure the local environment.",
    );
  return parsed.data;
}
