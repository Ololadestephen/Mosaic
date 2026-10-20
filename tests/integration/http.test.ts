import { beforeAll, describe, expect, it, vi } from "vitest";
import { prepareDatabase, account } from "./helpers";
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
});
