import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError, requireCondition } from "@/domain/errors";
import { db } from "../db/client";
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

async function openSeats(raw: unknown, schema: z.ZodType, client: string) {
  await rateLimit(`lobby-client:${client}`);
  const input = schema.safeParse(raw);
  if (!input.success) throw refused();
  const data = input.data as { token: string; seat?: number };
  const [lobby] = await db()<{ expires_at: Date }[]>`
    SELECT expires_at FROM sessions WHERE token_hash = ${lobbyKey(data.token)} AND expires_at > now()`;
  if (!lobby) throw refused();
  const seats = await db()<Seat[]>`
    SELECT substr(s.token_hash, 6)::int AS seat, s.user_id AS "userId",
      EXISTS (SELECT 1 FROM sessions c WHERE c.token_hash = 'claim:' || substr(s.token_hash, 6)) AS claimed
    FROM sessions s WHERE s.token_hash LIKE 'seat:%' AND s.expires_at > now() ORDER BY 1`;
  return { data, expiresAt: lobby.expires_at, seats };
}

async function resumedSeat(seats: Seat[], resume?: string) {
  if (!resume || !token.safeParse(resume).success) return null;
  const [row] = await db()<{ user_id: string }[]>`
    SELECT user_id FROM sessions WHERE token_hash = ${resumeKey(resume)} AND expires_at > now()`;
  return (
    seats.find((seat) => seat.claimed && seat.userId === row?.user_id) ?? null
  );
}

export async function lobbySeats(
  raw: unknown,
  client: string,
  resume?: string,
) {
  const { seats } = await openSeats(raw, listInput, client);
  const yours = await resumedSeat(seats, resume);
  return {
    seats: seats.map(({ seat, claimed }) => ({ seat, available: !claimed })),
    yours: yours?.seat ?? null,
  };
}

// A browser that already holds a seat always returns to it; otherwise it claims the requested seat atomically.
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
  const { data, expiresAt, seats } = await openSeats(raw, enterInput, client);
  const held = await resumedSeat(seats, resume);
  const chosen = held ?? seats.find((seat) => seat.seat === data.seat);
  requireCondition(chosen, "INVALID_INPUT", "Choose an available seat.");
  let issued: string | undefined;
  if (!held) {
    issued = randomBytes(32).toString("base64url");
    const resumeToken = issued;
    await db().begin(async (tx) => {
      const [claim] = await tx`
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (${`claim:${chosen.seat}`}, ${chosen.userId}, ${expiresAt})
        ON CONFLICT (token_hash) DO NOTHING RETURNING token_hash`;
      requireCondition(
        claim,
        "CONFLICT",
        `Seat ${chosen.seat} is already in use. Choose another seat.`,
      );
      await tx`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${resumeKey(resumeToken)}, ${chosen.userId}, ${expiresAt})`;
    });
  }
  const [account] = await db()<
    Account[]
  >`SELECT id, email, name FROM users WHERE id = ${chosen.userId}`;
  const session = await startSession(account, expiresAt);
  return { ...session, seat: chosen.seat, resume: issued, expiresAt };
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

async function seatUser(seat: number) {
  const [row] = await db()<
    { user_id: string }[]
  >`SELECT user_id FROM sessions WHERE token_hash = ${`seat:${seat}`}`;
  requireCondition(row, "NOT_FOUND", `Seat ${seat} does not exist.`);
  return row.user_id;
}

// Frees an abandoned seat: removes its claim, its resume record and every session of the seat's account.
export async function releaseSeat(seat: number) {
  const userId = await seatUser(seat);
  const removed = await db()`
    DELETE FROM sessions WHERE token_hash = ${`claim:${seat}`}
      OR (user_id = ${userId} AND token_hash NOT LIKE 'seat:%' AND token_hash NOT LIKE 'lobby:%')`;
  return removed.count;
}

export async function revokeSeat(seat: number) {
  const removed = await releaseSeat(seat);
  await db()`DELETE FROM sessions WHERE token_hash = ${`seat:${seat}`}`;
  return removed + 1;
}

// Closes the lobby and ends every seat's access, including sessions already started from it.
export async function closeLobby() {
  const removed = await db()`
    DELETE FROM sessions WHERE token_hash LIKE 'lobby:%' OR token_hash LIKE 'claim:%'
      OR user_id IN (SELECT user_id FROM sessions WHERE token_hash LIKE 'seat:%')`;
  return removed.count;
}
