import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prepareDatabase, account, workspace } from "./helpers";
import { handleRequest } from "@/server/http";
import { GET as health } from "@/app/api/health/route";
import { GET as route } from "@/app/api/[...path]/route";
import { sessionCookie } from "@/server/auth/accounts";

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
