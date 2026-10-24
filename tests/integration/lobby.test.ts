import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { prepareDatabase, account } from "./helpers";
import { handleRequest } from "@/server/http";
import {
  digest,
  resolveSession,
  sessionCookie,
  signOut,
} from "@/server/auth/accounts";
import {
  closeLobby,
  enterLobby,
  lobbySeats,
  openLobby,
  releaseSeat,
  revokeSeat,
  seatCookie,
} from "@/server/auth/lobby";
import { db } from "@/server/db/client";

const jar = vi.hoisted(() => ({ value: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.value.get(name);
      return value ? { value } : undefined;
    },
  }),
}));

beforeAll(prepareDatabase);

const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);
const client = () => randomUUID();
const refused = {
  code: "UNAUTHENTICATED",
  message: "This lobby link is invalid or has expired.",
};
let lobby: string;
let seatIds: string[];

async function open(expiresAt = hours(48)) {
  const owner = await account("Lobby owner");
  const seats = await Promise.all([1, 2, 3].map(() => account("Seat")));
  seatIds = seats.map((seat) => seat.account.id);
  lobby = await openLobby(owner.account.id, seatIds, expiresAt);
}

beforeEach(async () => {
  jar.value.clear();
  await closeLobby();
  await open();
});

describe("shared judge lobby", () => {
  it("claims an available seat, signs in as that seat and lets the browser resume it", async () => {
    const entered = await enterLobby({ token: lobby, seat: 1 }, client());
    expect(entered.account.id).toBe(seatIds[0]);
    expect(entered.resume).toBeTruthy();
    expect((await resolveSession(entered.token))?.id).toBe(seatIds[0]);
    expect(await lobbySeats({ token: lobby }, client())).toEqual({
      seats: [
        { seat: 1, available: false },
        { seat: 2, available: true },
        { seat: 3, available: true },
      ],
      yours: null,
    });
    expect(
      (await lobbySeats({ token: lobby }, client(), entered.resume)).yours,
    ).toBe(1);
  });

  it("gives a contested seat to exactly one of two simultaneous claims", async () => {
    const results = await Promise.allSettled([
      enterLobby({ token: lobby, seat: 2 }, client()),
      enterLobby({ token: lobby, seat: 2 }, client()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason).toMatchObject({
      code: "CONFLICT",
      message: "Seat 2 is already in use. Choose another seat.",
    });
  });

  it("returns a signed-out judge to their own seat and never hands them a second one", async () => {
    const first = await enterLobby({ token: lobby, seat: 1 }, client());
    await signOut(first.token);
    expect(await resolveSession(first.token)).toBeNull();
    const back = await enterLobby({ token: lobby }, client(), first.resume);
    expect(back.account.id).toBe(seatIds[0]);
    expect(back.resume).toBeUndefined();
    const greedy = await enterLobby(
      { token: lobby, seat: 3 },
      client(),
      first.resume,
    );
    expect(greedy.seat).toBe(1);
    expect(
      (await lobbySeats({ token: lobby }, client())).seats[2].available,
    ).toBe(true);
  });

  it("never lets a seat session outlive the lobby", async () => {
    await closeLobby();
    const deadline = hours(1);
    await open(deadline);
    const entered = await enterLobby({ token: lobby, seat: 1 }, client());
    const [row] = await db()<{ expires_at: Date }[]>`
      SELECT expires_at FROM sessions WHERE token_hash = ${digest(entered.token)}`;
    expect(row.expires_at.getTime()).toBeLessThanOrEqual(deadline.getTime());
  });

  it("gives unknown, malformed and expired lobby links the same refusal", async () => {
    for (const raw of [
      { token: randomBytes(32).toString("base64url") },
      { token: "short" },
      { token: lobby, extra: true },
      "not an object",
    ])
      await expect(enterLobby(raw, client())).rejects.toMatchObject(refused);
    await db()`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash LIKE 'lobby:%'`;
    await expect(lobbySeats({ token: lobby }, client())).rejects.toMatchObject(
      refused,
    );
  });

  it("releases an abandoned seat: its sessions and resume end and it becomes available", async () => {
    const entered = await enterLobby({ token: lobby, seat: 2 }, client());
    expect(await releaseSeat(2)).toBeGreaterThanOrEqual(3);
    expect(await resolveSession(entered.token)).toBeNull();
    expect(
      (await lobbySeats({ token: lobby }, client(), entered.resume)).yours,
    ).toBeNull();
    const next = await enterLobby({ token: lobby, seat: 2 }, client());
    expect(next.account.id).toBe(seatIds[1]);
  });

  it("revoking a seat removes it and ends its sessions", async () => {
    const entered = await enterLobby({ token: lobby, seat: 3 }, client());
    await revokeSeat(3);
    expect(await resolveSession(entered.token)).toBeNull();
    expect(
      (await lobbySeats({ token: lobby }, client())).seats.map((s) => s.seat),
    ).toEqual([1, 2]);
    await expect(
      enterLobby({ token: lobby, seat: 3 }, client()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("closing the lobby ends every seat session and refuses the link", async () => {
    const one = await enterLobby({ token: lobby, seat: 1 }, client());
    const two = await enterLobby({ token: lobby, seat: 2 }, client());
    await closeLobby();
    expect(await resolveSession(one.token)).toBeNull();
    expect(await resolveSession(two.token)).toBeNull();
    await expect(
      enterLobby({ token: lobby }, client(), one.resume),
    ).rejects.toMatchObject(refused);
  });

  it("refuses a second lobby while one is open and limits attempts per client", async () => {
    const owner = await account();
    await expect(
      openLobby(owner.account.id, [owner.account.id], hours(1)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const source = client();
    for (let attempt = 0; attempt < 15; attempt++)
      await expect(
        lobbySeats({ token: randomBytes(32).toString("base64url") }, source),
      ).rejects.toMatchObject(refused);
    await expect(lobbySeats({ token: lobby }, source)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("sets HttpOnly session and seat cookies over HTTP and resumes from the seat cookie", async () => {
    const request = (route: string, body: object) =>
      new Request(`http://localhost:3000/api/auth/${route}`, {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-real-ip": client(),
        },
        body: JSON.stringify(body),
      });
    const response = await handleRequest(
      request("lobby", { token: lobby, seat: 1 }),
      ["auth", "lobby"],
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: seatIds[0],
      seat: 1,
    });
    const session = response.cookies.get(sessionCookie);
    const seat = response.cookies.get(seatCookie);
    for (const cookie of [session, seat]) {
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("strict");
    }
    jar.value.set(seatCookie, seat!.value);
    const seats = await handleRequest(
      request("lobby-seats", { token: lobby }),
      ["auth", "lobby-seats"],
    );
    await expect(seats.json()).resolves.toMatchObject({ yours: 1 });
  });
});
