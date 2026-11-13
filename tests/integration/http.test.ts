import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prepareDatabase, account, workspace } from "./helpers";
import { handleRequest } from "@/server/http";
import { GET as health } from "@/app/api/health/route";
import { GET as route } from "@/app/api/[...path]/route";
import { sessionCookie } from "@/server/auth/accounts";
import { closeLobby, openLobby } from "@/server/auth/lobby";

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

describe("http shell", () => {
  it("rejects a foreign origin and an anonymous session", async () => {
    jar.value.clear();
    const foreign = await handleRequest(
      new Request("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: {
          origin: "https://elsewhere.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      ["workspaces"],
    );
    expect(foreign.status).toBe(403);
    const anonymous = await route(
      new Request("http://localhost:3000/api/workspaces"),
      { params: Promise.resolve({ path: ["workspaces"] }) },
    );
    expect(anonymous.status).toBe(401);
  });

  it("reports ready when migrations are present and accepts the session cookie", async () => {
    const ready = await health();
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({ status: "ready" });
    const owner = await account();
    jar.value.set(sessionCookie, owner.token);
    const session = await handleRequest(
      new Request("http://localhost:3000/api/session"),
      ["session"],
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      id: owner.account.id,
    });
  });

  it("replays a source creation sent with the same operation header", async () => {
    const owner = await workspace();
    jar.value.set(sessionCookie, owner.token);
    const key = randomUUID();
    const send = () =>
      handleRequest(
        new Request(
          `http://localhost:3000/api/workspaces/${owner.workspaceId}/sources`,
          {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              "x-operation-key": key,
            },
            body: JSON.stringify({
              title: "Idempotent source",
              text: "One saved source",
            }),
          },
        ),
        ["workspaces", owner.workspaceId, "sources"],
      );
    const first = await send();
    expect(first.status).toBe(200);
    const created = await first.json();
    const second = await send();
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual(created);
  });

  it("accepts a source creation without an operation header", async () => {
    const owner = await workspace();
    jar.value.set(sessionCookie, owner.token);
    const response = await handleRequest(
      new Request(
        `http://localhost:3000/api/workspaces/${owner.workspaceId}/sources`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "Unkeyed source",
            text: "Saved without an operation header",
          }),
        },
      ),
      ["workspaces", owner.workspaceId, "sources"],
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceId: expect.any(String),
      versionId: expect.any(String),
    });
  });
});

it("opens a configured public demo seat without a token in the request or response", async () => {
  const operator = await account();
  const demo = await workspace();
  const unrelated = await workspace();
  const send = (action: string, body = {}, origin = "http://localhost:3000") =>
    handleRequest(
      new Request(`http://localhost:3000/api/auth/${action}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-real-ip": randomUUID(),
        },
        body: JSON.stringify(body),
      }),
      ["auth", action],
    );
  jar.value.clear();
  await closeLobby();
  try {
    vi.stubEnv("PUBLIC_DEMO_LOBBY_TOKEN", "");
    expect((await send("demo-seats")).status).toBe(404);
    const token = await openLobby(
      operator.account.id,
      [demo.account.id, unrelated.account.id],
      new Date(Date.now() + 60_000),
    );
    vi.stubEnv("PUBLIC_DEMO_LOBBY_TOKEN", token);
    expect(
      (await send("demo-enter", { seat: 1 }, "https://elsewhere.example"))
        .status,
    ).toBe(403);
    const listing = await send("demo-seats");
    expect(listing.status).toBe(200);
    await expect(listing.json()).resolves.toEqual({
      seats: [
        { seat: 1, available: true },
        { seat: 2, available: true },
      ],
      yours: null,
    });
    const entry = await send("demo-enter", { seat: 1 });
    expect(entry.status).toBe(200);
    const body = await entry.text();
    expect(body).not.toContain(token);
    expect(JSON.parse(body)).toMatchObject({
      seat: 1,
      workspaceId: demo.workspaceId,
    });
    const session = entry.cookies.get(sessionCookie);
    expect(session?.httpOnly).toBe(true);
    jar.value.set(sessionCookie, session!.value);
    expect(
      (
        await handleRequest(
          new Request(
            `http://localhost:3000/api/workspaces/${unrelated.workspaceId}`,
          ),
          ["workspaces", unrelated.workspaceId],
        )
      ).status,
    ).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_ORIGIN", "https://preview.example");
    vi.stubEnv("ALLOW_REGISTRATION", "false");
    expect(
      (await send("demo-enter", { seat: 2 }, "https://preview.example")).status,
    ).toBe(404);
  } finally {
    jar.value.clear();
    vi.unstubAllEnvs();
    await closeLobby();
  }
});
