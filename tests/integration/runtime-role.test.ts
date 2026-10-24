import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prepareDatabase, account } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import {
  issueAccessLink,
  resolveSession,
  revokeAccess,
  signInWithLink,
  signOut,
} from "@/server/auth/accounts";
import {
  closeLobby,
  enterLobby,
  lobbySeats,
  openLobby,
  releaseSeat,
  revokeSeat,
} from "@/server/auth/lobby";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// Mirrors the production runtime role's table privileges, read from production on 2026-10-24. The superuser
// used by other tests can do things production cannot, such as row locks that need UPDATE on sessions.
const runtimeGrants: Record<string, string> = {
  analysis_runs: "SELECT, INSERT, UPDATE",
  change_events: "SELECT, INSERT",
  change_sets: "SELECT, INSERT, UPDATE",
  decisions: "SELECT, INSERT, UPDATE",
  execution_batches: "SELECT, INSERT",
  memberships: "SELECT, INSERT, UPDATE",
  rate_limits: "SELECT, INSERT, UPDATE",
  schema_migrations: "SELECT",
  sessions: "SELECT, INSERT, DELETE",
  source_versions: "SELECT, INSERT",
  sources: "SELECT, INSERT",
  task_evidence: "SELECT, INSERT",
  tasks: "SELECT, INSERT, UPDATE",
  users: "SELECT, INSERT",
  workspaces: "SELECT, INSERT, UPDATE",
};
const role = "mosaic_runtime_probe";
let superuserUrl: string;
let seats: string[];

beforeAll(async () => {
  await prepareDatabase();
  superuserUrl = process.env.DATABASE_URL!;
  const owner = await account("Probe owner");
  seats = [
    (await account("Probe seat one")).account.id,
    (await account("Probe seat two")).account.id,
  ];
  process.env.PROBE_OWNER = owner.account.id;
  const password = randomBytes(18).toString("hex");
  const sql = db();
  await sql.unsafe(
    `DO $$ BEGIN CREATE ROLE ${role} LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  );
  await sql.unsafe(`ALTER ROLE ${role} PASSWORD '${password}'`);
  await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  for (const [table, privileges] of Object.entries(runtimeGrants))
    await sql.unsafe(`GRANT ${privileges} ON ${table} TO ${role}`);
  await closeDatabase();
  const url = new URL(superuserUrl);
  url.username = role;
  url.password = password;
  process.env.DATABASE_URL = url.href;
});

afterAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = superuserUrl;
});

describe("access flows under the production runtime privileges", () => {
  it("runs the full lobby lifecycle", async () => {
    await closeLobby();
    const lobby = await openLobby(
      process.env.PROBE_OWNER!,
      seats,
      new Date(Date.now() + 60 * 60 * 1000),
    );
    const entered = await enterLobby({ token: lobby, seat: 1 }, "probe-a");
    expect((await resolveSession(entered.token))?.id).toBe(seats[0]);
    await signOut(entered.token);
    const back = await enterLobby({ token: lobby }, "probe-a", entered.resume);
    expect(back.seat).toBe(1);
    expect(
      (await lobbySeats({ token: lobby }, "probe-b")).seats[0].available,
    ).toBe(false);
    await releaseSeat(1);
    await revokeSeat(2);
    await closeLobby();
    expect(await resolveSession(back.token)).toBeNull();
  });

  it("runs the access link lifecycle", async () => {
    const link = await issueAccessLink(
      seats[0],
      new Date(Date.now() + 60 * 60 * 1000),
    );
    const session = await signInWithLink({ token: link }, "probe-c");
    expect((await resolveSession(session.token))?.id).toBe(seats[0]);
    await revokeAccess(seats[0]);
    expect(await resolveSession(session.token)).toBeNull();
  });
});
