import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError, requireCondition } from "@/domain/errors";
import { db, type Transaction } from "../db/client";
import { type Account, digest, rateLimit, startSession } from "./accounts";

// One shared lobby link lets judges pick a seat: a prepared account with its own workspaces and AI allowance.
// Lobby, seat, claim and resume records live in the sessions table under their own key namespaces, so none of them can
// act as a session cookie. Every session started here ends no later than the lobby.
export const seatCookie = "mosaic_seat";
const token = z.string().regex(/^[A-Za-z0-9_-]{43,100}$/);
const enterInput = z
  .object({ token, seat: z.number().int().min(1).max(20).optional() })
  .strict();
const listInput = z.object({ token }).strict();
const lobbyKey = (value: string) => `lobby:${digest(value)}`;
const resumeKey = (value: string) => `resume:${digest(value)}`;
const refused = () =>
  new DomainError(
    "UNAUTHENTICATED",
    "This lobby link is invalid or has expired.",
  );

type Seat = { seat: number; userId: string; claimed: boolean };

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const input = schema.safeParse(raw);
  if (!input.success) throw refused();
  return input.data;
}

export async function lobbySeats(
  raw: unknown,
  client: string,
  resume?: string,
) {
  await rateLimit(`lobby-client:${client}`);
  const data = parse(listInput, raw);
  const [lobby] =
    await db()`SELECT 1 FROM sessions WHERE token_hash = ${lobbyKey(data.token)} AND expires_at > now()`;
  if (!lobby) throw refused();
  const seats = await db()<Seat[]>`
    SELECT substr(s.token_hash, 6)::int AS seat, s.user_id AS "userId",
      EXISTS (SELECT 1 FROM sessions c WHERE c.token_hash = 'claim:' || substr(s.token_hash, 6)) AS claimed
    FROM sessions s WHERE s.token_hash LIKE 'seat:%' AND s.expires_at > now() ORDER BY 1`;
  const [holder] =
    resume && token.safeParse(resume).success
      ? await db()<{ user_id: string }[]>`
          SELECT user_id FROM sessions WHERE token_hash = ${resumeKey(resume)} AND expires_at > now()`
      : [];
  const yours = seats.find(
    (seat) => seat.claimed && seat.userId === holder?.user_id,
  );
  return {
    seats: seats.map(({ seat, claimed }) => ({ seat, available: !claimed })),
    yours: yours?.seat ?? null,
  };
}

// A browser that already holds a seat always returns to it; otherwise it claims the requested seat atomically.
// Shared locks on the lobby row and then the seat row make close, release and revoke wait for this entry (and
// remove what it created), or make this entry see that the lobby or seat is gone.
export async function enterLobby(
  raw: unknown,
  client: string,
  resume?: string,
): Promise<{
  account: Account;
  token: string;
  seat: number;
  resume?: string;
  expiresAt: Date;
}> {
  await rateLimit(`lobby-client:${client}`);
  const data = parse(enterInput, raw);
  return db().begin(async (tx) => {
    const [lobby] = await tx<{ expires_at: Date }[]>`
      SELECT expires_at FROM sessions WHERE token_hash = ${lobbyKey(data.token)} AND expires_at > now() FOR SHARE`;
    if (!lobby) throw refused();
    const [held] =
      resume && token.safeParse(resume).success
        ? await tx<{ seat: number; user_id: string }[]>`
            SELECT substr(st.token_hash, 6)::int AS seat, st.user_id FROM sessions r
            JOIN sessions st ON st.user_id = r.user_id AND st.token_hash LIKE 'seat:%' AND st.expires_at > now()
            WHERE r.token_hash = ${resumeKey(resume)} AND r.expires_at > now()
              AND EXISTS (SELECT 1 FROM sessions c WHERE c.token_hash = 'claim:' || substr(st.token_hash, 6))
            FOR SHARE OF st`
        : [];
    let seat: number;
    let userId: string;
    let issued: string | undefined;
    if (held) {
      ({ seat, user_id: userId } = held);
    } else {
      requireCondition(data.seat, "INVALID_INPUT", "Choose an available seat.");
      seat = data.seat;
      const [row] = await tx<{ user_id: string }[]>`
        SELECT user_id FROM sessions WHERE token_hash = ${`seat:${seat}`} AND expires_at > now() FOR SHARE`;
      requireCondition(row, "INVALID_INPUT", "Choose an available seat.");
      userId = row.user_id;
      const [claim] = await tx`
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (${`claim:${seat}`}, ${userId}, ${lobby.expires_at})
        ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash`;
      requireCondition(
        claim,
        "CONFLICT",
        `Seat ${seat} is already in use. Choose another seat.`,
      );
      issued = randomBytes(32).toString("base64url");
      await tx`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${resumeKey(issued)}, ${userId}, ${lobby.expires_at})`;
    }
    const [account] = await tx<
      Account[]
    >`SELECT id, email, name FROM users WHERE id = ${userId}`;
    const session = await startSession(account, lobby.expires_at, tx);
    return { ...session, seat, resume: issued, expiresAt: lobby.expires_at };
  });
}

// Operator actions. Ordinary sessions use a bare hex digest; every namespaced record contains a colon.
export async function openLobby(
  ownerId: string,
  seatUserIds: string[],
  expiresAt: Date,
) {
  requireCondition(
    expiresAt.getTime() > Date.now(),
    "INVALID_INPUT",
    "A lobby must expire in the future.",
  );
  requireCondition(
    seatUserIds.length >= 1 && seatUserIds.length <= 20,
    "INVALID_INPUT",
    "Open between 1 and 20 seats.",
  );
  const value = randomBytes(32).toString("base64url");
  await db().begin(async (tx) => {
    const [existing] =
      await tx`SELECT 1 FROM sessions WHERE token_hash LIKE 'lobby:%' AND expires_at > now()`;
    requireCondition(
      !existing,
      "CONFLICT",
      "A lobby is already open. Close it first.",
    );
    await tx`DELETE FROM sessions WHERE token_hash LIKE 'lobby:%' OR token_hash LIKE 'seat:%' OR token_hash LIKE 'claim:%'`;
    await tx`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${lobbyKey(value)}, ${ownerId}, ${expiresAt})`;
    for (const [index, userId] of seatUserIds.entries())
      await tx`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${`seat:${index + 1}`}, ${userId}, ${expiresAt})`;
  });
  return value;
}

// Each takes an exclusive lock first, then deletes in a separate statement so that the delete sees anything an
// in-flight entry committed while the lock was awaited.
async function lockSeat(tx: Transaction, seat: number) {
  const [row] = await tx<
    { user_id: string }[]
  >`SELECT user_id FROM sessions WHERE token_hash = ${`seat:${seat}`} FOR UPDATE`;
  requireCondition(row, "NOT_FOUND", `Seat ${seat} does not exist.`);
  return row.user_id;
}

const clearSeat = async (tx: Transaction, seat: number, userId: string) =>
  (
    await tx`
      DELETE FROM sessions WHERE token_hash = ${`claim:${seat}`}
        OR (user_id = ${userId} AND token_hash NOT LIKE 'seat:%' AND token_hash NOT LIKE 'lobby:%')`
  ).count;

// Frees an abandoned seat: removes its claim, its resume record and every session of the seat's account.
// The seat's workspaces and any analyses already used are kept; the next judge sees them.
export async function releaseSeat(seat: number) {
  return db().begin(async (tx) =>
    clearSeat(tx, seat, await lockSeat(tx, seat)),
  );
}

export async function revokeSeat(seat: number) {
  return db().begin(async (tx) => {
    const removed = await clearSeat(tx, seat, await lockSeat(tx, seat));
    await tx`DELETE FROM sessions WHERE token_hash = ${`seat:${seat}`}`;
    return removed + 1;
  });
}

// Closes the lobby and ends every seat's access, including sessions already started from it.
export async function closeLobby() {
  return db().begin(async (tx) => {
    await tx`SELECT 1 FROM sessions WHERE token_hash LIKE 'lobby:%' FOR UPDATE`;
    await tx`SELECT 1 FROM sessions WHERE token_hash LIKE 'seat:%' FOR UPDATE`;
    const removed = await tx`
      DELETE FROM sessions WHERE token_hash LIKE 'lobby:%' OR token_hash LIKE 'claim:%'
        OR user_id IN (SELECT user_id FROM sessions WHERE token_hash LIKE 'seat:%')`;
    return removed.count;
  });
}
