import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GET as open } from "@/app/open/route";
import { resolveSession, sessionCookie } from "@/server/auth/accounts";
import { handleRequest } from "@/server/http";
import { setMember } from "@/server/workspaces";
import { account, prepareDatabase, workspace } from "./helpers";

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
afterEach(() => {
  jar.value.clear();
  vi.unstubAllEnvs();
});

const enter = () =>
  open(
    new Request("http://localhost:3000/open", {
      headers: { "x-real-ip": randomUUID() },
    }),
  );

async function shared() {
  const owner = await workspace();
  const visitor = await account("Visitor");
  await setMember(owner.actor, owner.workspaceId, {
    email: visitor.account.email,
    role: "editor",
  });
  return { owner, visitor };
}

const call = (path: string[], method = "GET", body?: unknown) =>
  handleRequest(
    new Request(`http://localhost:3000/api/${path.join("/")}`, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-operation-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    path,
  );

it("stays closed unless a visitor account is configured, and always on previews", async () => {
  const response = await enter();
  expect(response.headers.get("location")).toMatch(/\/demo\?open=unavailable$/);
  expect(response.cookies.get(sessionCookie)).toBeUndefined();

  const { visitor } = await shared();
  vi.stubEnv("OPEN_APP_ACCOUNT_ID", visitor.account.id);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("APP_ORIGIN", "https://preview.example");
  vi.stubEnv("ALLOW_REGISTRATION", "false");
  expect((await enter()).cookies.get(sessionCookie)).toBeUndefined();
});

it("refuses an account that owns a workspace or belongs to more than one", async () => {
  const owner = await workspace();
  vi.stubEnv("OPEN_APP_ACCOUNT_ID", owner.account.id);
  expect((await enter()).cookies.get(sessionCookie)).toBeUndefined();

  const { visitor } = await shared();
  await setMember(owner.actor, owner.workspaceId, {
    email: visitor.account.email,
    role: "editor",
  });
  vi.stubEnv("OPEN_APP_ACCOUNT_ID", visitor.account.id);
  expect((await enter()).cookies.get(sessionCookie)).toBeUndefined();
});

it("opens the shared workspace without a sign-in and limits what visitors can do", async () => {
  const { owner, visitor } = await shared();
  const unrelated = await workspace();
  vi.stubEnv("OPEN_APP_ACCOUNT_ID", visitor.account.id);

  const response = await enter();
  expect(response.headers.get("location")).toMatch(/\/app$/);
  const session = response.cookies.get(sessionCookie);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("strict");
  await expect(resolveSession(session!.value)).resolves.toMatchObject({
    id: visitor.account.id,
  });

  jar.value.set(sessionCookie, session!.value);
  expect((await enter()).cookies.get(sessionCookie)).toBeUndefined();
  expect((await call(["workspaces", owner.workspaceId])).status).toBe(200);
  expect((await call(["workspaces", unrelated.workspaceId])).status).toBe(404);
  expect(
    (await call(["workspaces"], "POST", { name: "Visitor space" })).status,
  ).toBe(403);
  expect(
    (
      await call(["workspaces", owner.workspaceId, "members"], "POST", {
        email: unrelated.account.email,
        role: "editor",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(["workspaces", owner.workspaceId, "analyze"], "POST", {
        sourceVersionId: randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(["workspaces", owner.workspaceId, "tasks"], "POST", {
        title: "Visitor task",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      })
    ).status,
  ).toBe(200);
});
