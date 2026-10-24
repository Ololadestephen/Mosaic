import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { accessLinkInput, credentials } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { db } from "../db/client";
import { registrationOpen } from "../env";
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
      registrationOpen(),
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
  return startSession(account);
}

async function startSession(account: Account, notAfter?: Date) {
  const token = randomBytes(32).toString("base64url");
  await db()`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${digest(token)}, ${account.id}, LEAST(now() + interval '7 days', ${notAfter ?? null}::timestamptz))`;
  return { account, token };
}

// Access-link rows share the sessions table under a separate key namespace: digest() output is hex, so a link key
// never matches a session cookie lookup, and a session token never matches a link lookup.
const linkKey = (token: string) => `link:${digest(token)}`;
const refusedLink = () =>
  new DomainError(
    "UNAUTHENTICATED",
    "This access link is invalid or has expired.",
  );

export async function issueAccessLink(userId: string, expiresAt: Date) {
  requireCondition(
    expiresAt.getTime() > Date.now(),
    "INVALID_INPUT",
    "An access link must expire in the future.",
  );
  const token = randomBytes(32).toString("base64url");
  const [issued] = await db()<{ user_id: string }[]>`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    SELECT ${linkKey(token)}, id, ${expiresAt} FROM users WHERE id = ${userId}
    RETURNING user_id`;
  requireCondition(issued, "NOT_FOUND", "Account not found.");
  return token;
}

// Exchanges a private access link for an ordinary session that ends no later than the link itself. Signing out ends
// only that browser session. Attempts are limited per client; the 256-bit token makes guessing impractical.
export async function signInWithLink(
  raw: unknown,
  client: string,
): Promise<{ account: Account; token: string }> {
  await rateLimit(`link-client:${client}`);
  const input = accessLinkInput.safeParse(raw);
  if (!input.success) throw refusedLink();
  const [link] = await db()<(Account & { expires_at: Date })[]>`
    SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${linkKey(input.data.token)} AND s.expires_at > now()`;
  if (!link) throw refusedLink();
  return startSession(
    { id: link.id, email: link.email, name: link.name },
    link.expires_at,
  );
}

// Ends all access for an account: its access links and every session, including sessions started from a link.
export async function revokeAccess(userId: string) {
  const removed = await db()`DELETE FROM sessions WHERE user_id = ${userId}`;
  return removed.count;
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
