import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { credentials } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { db } from "../db/client";
import { env } from "../env";
import { hashPassword, verifyPassword } from "./password";

export const sessionCookie = "mosaic_session";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type Account = { id: string; email: string; name: string };

async function rateLimit(key: string) {
  const [row] = await db()<{ attempts: number }[]>`
    INSERT INTO rate_limits (key) VALUES (${digest(key)})
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN rate_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE rate_limits.attempts + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - interval '15 minutes' THEN now() ELSE rate_limits.window_start END
    RETURNING attempts`;
  requireCondition(
    row.attempts <= 15,
    "RATE_LIMITED",
    "Too many sign-in attempts. Try again in 15 minutes.",
  );
}

export async function signIn(
  raw: unknown,
  register: boolean,
): Promise<{ account: Account; token: string }> {
  const input = credentials.parse(raw);
  await rateLimit(`signin:${input.email}`);
  let account: Account;
  if (register) {
    requireCondition(
      env().ALLOW_REGISTRATION === "true",
      "FORBIDDEN",
      "Registration is currently closed.",
    );
    requireCondition(input.name, "INVALID_INPUT", "Your name is required.");
    const hash = await hashPassword(input.password);
    const [created] = await db()<
      Account[]
    >`INSERT INTO users (id, email, name, password_hash) VALUES (${randomUUID()}, ${input.email}, ${input.name}, ${hash}) ON CONFLICT (email) DO NOTHING RETURNING id, email, name`;
    requireCondition(
      created,
      "CONFLICT",
      "An account already exists for this email. Sign in instead.",
    );
    account = created;
  } else {
    const [found] = await db()<
      (Account & { password_hash: string })[]
    >`SELECT id, email, name, password_hash FROM users WHERE email = ${input.email}`;
    // Equal-cost derivation also runs when the account does not exist.
    const fallback =
      "scrypt$00000000000000000000000000000000$" + "00".repeat(64);
    const valid = await verifyPassword(
      input.password,
      found?.password_hash ?? fallback,
    );
    if (!found || !valid)
      throw new DomainError(
        "UNAUTHENTICATED",
        "Email or password is incorrect.",
      );
    account = { id: found.id, email: found.email, name: found.name };
  }
  const token = randomBytes(32).toString("base64url");
  await db()`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${digest(token)}, ${account.id}, now() + interval '7 days')`;
  return { account, token };
}

export async function resolveSession(token?: string): Promise<Account | null> {
  if (!token || token.length > 100) return null;
  const [account] = await db()<
    Account[]
  >`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${digest(token)} AND s.expires_at > now()`;
  return account ?? null;
}

export async function signOut(token: string) {
  await db()`DELETE FROM sessions WHERE token_hash = ${digest(token)}`;
}
