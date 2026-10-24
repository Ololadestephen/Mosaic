import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { prepareDatabase, account } from "./helpers";
import { handleRequest } from "@/server/http";
import {
  digest,
  issueAccessLink,
  resolveSession,
  revokeAccess,
  sessionCookie,
  signInWithLink,
  signOut,
} from "@/server/auth/accounts";
import { DomainError } from "@/domain/errors";
import { db } from "@/server/db/client";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

beforeAll(prepareDatabase);

const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);
const client = () => randomUUID();
const refused = {
  code: "UNAUTHENTICATED",
  message: "This access link is invalid or has expired.",
};
const sessionExpiry = async (token: string) => {
  const [row] = await db()<{ expires_at: Date }[]>`
    SELECT expires_at FROM sessions WHERE token_hash = ${digest(token)}`;
  return row.expires_at;
};

describe("private access links", () => {
  it("exchanges a link for a separate session that sign-out ends without revoking the link", async () => {
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(48));
    const first = await signInWithLink({ token: link }, client());
    expect(first.account.id).toBe(owner.account.id);
    expect(first.token).not.toBe(link);
    await signOut(first.token);
    expect(await resolveSession(first.token)).toBeNull();
    const second = await signInWithLink({ token: link }, client());
    expect((await resolveSession(second.token))?.id).toBe(owner.account.id);
  });

  it("keeps link credentials and session credentials separate", async () => {
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(48));
    expect(await resolveSession(link)).toBeNull();
    await expect(
      signInWithLink({ token: owner.token }, client()),
    ).rejects.toMatchObject(refused);
  });

  it("never lets a session from a link outlive the link", async () => {
    const owner = await account();
    const deadline = hours(1);
    const link = await issueAccessLink(owner.account.id, deadline);
    const session = await signInWithLink({ token: link }, client());
    expect((await sessionExpiry(session.token)).getTime()).toBeLessThanOrEqual(
      deadline.getTime(),
    );
    const ordinary = await sessionExpiry(owner.token);
    expect(ordinary.getTime()).toBeGreaterThan(hours(24 * 6).getTime());
  });

  it("revocation removes the link and every session of the account", async () => {
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(48));
    const session = await signInWithLink({ token: link }, client());
    expect(await revokeAccess(owner.account.id)).toBeGreaterThanOrEqual(3);
    expect(await resolveSession(session.token)).toBeNull();
    expect(await resolveSession(owner.token)).toBeNull();
    await expect(
      signInWithLink({ token: link }, client()),
    ).rejects.toMatchObject(refused);
  });

  it("gives expired, unknown and malformed links the same refusal", async () => {
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(48));
    await db()`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${owner.account.id} AND token_hash LIKE 'link:%'`;
    for (const raw of [
      { token: link },
      { token: randomBytes(32).toString("base64url") },
      { token: "short" },
      { token: link, extra: true },
      "not an object",
    ])
      await expect(signInWithLink(raw, client())).rejects.toMatchObject(
        refused,
      );
  });

  it("refuses past expiry dates and unknown accounts when issuing", async () => {
    const owner = await account();
    await expect(
      issueAccessLink(owner.account.id, new Date(Date.now() - 1000)),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      issueAccessLink("00000000-0000-4000-8000-000000000000", hours(1)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("limits attempts per client across different tokens", async () => {
    const source = client();
    for (let attempt = 0; attempt < 15; attempt++)
      await expect(
        signInWithLink(
          { token: randomBytes(32).toString("base64url") },
          source,
        ),
      ).rejects.toMatchObject(refused);
    await expect(
      signInWithLink({ token: randomBytes(32).toString("base64url") }, source),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(1));
    await expect(
      signInWithLink({ token: link }, client()),
    ).resolves.toBeTruthy();
  });

  it("sets only a session cookie over HTTP and requires the application origin", async () => {
    const owner = await account();
    const link = await issueAccessLink(owner.account.id, hours(48));
    const request = (origin: string) =>
      new Request("http://localhost:3000/api/auth/link", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": client(),
        },
        body: JSON.stringify({ token: link }),
      });
    const foreign = await handleRequest(request("https://elsewhere.example"), [
      "auth",
      "link",
    ]);
    expect(foreign.status).toBe(403);
    const response = await handleRequest(request("http://localhost:3000"), [
      "auth",
      "link",
    ]);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(owner.account.id);
    expect(body).not.toContain(link);
    const cookie = response.cookies.get(sessionCookie);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.value).not.toBe(link);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
  });
});
