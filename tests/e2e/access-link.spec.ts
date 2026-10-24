import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

async function seedAccessLink() {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "tests/e2e/seed-access-link.ts",
  ]);
  return JSON.parse(stdout) as { token: string; workspaceId: string };
}

test("a private access link opens the workspace without a password and survives sign-out", async ({
  page,
}) => {
  // Each test gets its own client key so local reruns never share a rate-limit window.
  await page.setExtraHTTPHeaders({ "x-real-ip": randomUUID() });
  const { token } = await seedAccessLink();
  await page.goto(`/access#${token}`);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  expect(page.url()).not.toContain(token);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto(`/access#${token}`);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
});

test("an unknown access link is refused without signing in", async ({
  page,
}) => {
  // Each test gets its own client key so local reruns never share a rate-limit window.
  await page.setExtraHTTPHeaders({ "x-real-ip": randomUUID() });
  await page.goto(`/access#${"x".repeat(43)}`);
  await expect(page.locator("p.error[role=alert]")).toHaveText(
    "This access link is invalid or has expired.",
  );
  expect((await page.request.get("/api/session")).status()).toBe(401);
});
