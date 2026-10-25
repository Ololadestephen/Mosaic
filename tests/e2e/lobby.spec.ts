import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

async function seedLobby() {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "tests/e2e/seed-lobby.ts",
  ]);
  return JSON.parse(stdout) as { token: string };
}

test("one lobby link: claim a seat, sign out, return to the same seat; others see it in use", async ({
  browser,
}) => {
  const { token } = await seedLobby();
  const judge = await browser.newContext({
    extraHTTPHeaders: { "x-real-ip": randomUUID() },
  });
  const page = await judge.newPage();
  await page.goto(`/lobby#${token}`);
  await page.getByRole("button", { name: /Seat 1/ }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Active workspace" }),
  ).toHaveValue(/.+/);
  await expect(
    page
      .getByRole("combobox", { name: "Active workspace" })
      .locator("option:checked"),
  ).toHaveText("Seat 1 workspace");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto(`/lobby#${token}`);
  await expect(
    page
      .getByRole("combobox", { name: "Active workspace" })
      .locator("option:checked"),
  ).toHaveText("Seat 1 workspace");

  const other = await browser.newContext({
    extraHTTPHeaders: { "x-real-ip": randomUUID() },
  });
  const second = await other.newPage();
  await second.goto(`/lobby#${token}`);
  await expect(second.getByRole("button", { name: /Seat 1/ })).toBeDisabled();
  await expect(second.getByRole("button", { name: /Seat 1/ })).toContainText(
    "In use",
  );
  await expect(second.getByRole("button", { name: /Seat 2/ })).toBeEnabled();
  await judge.close();
  await other.close();
});

test("an unknown lobby link is refused", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": randomUUID() });
  await page.goto(`/lobby#${"x".repeat(43)}`);
  await expect(page.locator("p.error[role=alert]")).toHaveText(
    "This lobby link is invalid or has expired.",
  );
});

test("the lobby removes its link from the address bar and survives a refresh", async ({
  browser,
}) => {
  const { token } = await seedLobby();
  const judge = await browser.newContext({
    extraHTTPHeaders: { "x-real-ip": randomUUID() },
  });
  const page = await judge.newPage();
  await page.goto(`/lobby#${token}`);
  await expect(page.getByRole("button", { name: /Seat 2/ })).toBeEnabled();
  expect(page.url()).not.toContain("#");
  expect(page.url()).not.toContain(token);
  await page.reload();
  await expect(page.getByRole("button", { name: /Seat 2/ })).toBeEnabled();
  expect(page.url()).not.toContain(token);
  await page.getByRole("button", { name: /Seat 2/ }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("mosaic:lobby-link")),
  ).toBeNull();
  await judge.close();
});

test("a made-up lobby link is also removed from the address bar", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": randomUUID() });
  await page.goto("/lobby#not-a-real-link");
  await expect(page.locator("p.error[role=alert]")).toHaveText(
    "This lobby link is invalid or has expired.",
  );
  expect(page.url()).not.toContain("not-a-real-link");
});
