import { expect, test } from "@playwright/test";

test("visitors can try review and undo without signing in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/")
    )
      writes.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Open demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await page.getByRole("link", { name: "See the supporting excerpt" }).click();
  await expect(page.locator("#demo-source mark")).toContainText(
    "phishing emails",
  );
  await page.getByText("Example apply receipt").click();
  await expect(
    page.getByText(/Before: no employee reminder task/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Try apply and undo" }).click();
  const demo = page.getByRole("region", { name: "Try a review" });
  const apply = demo.getByRole("button", { name: "Apply selected change" });
  await expect(apply).toBeDisabled();
  await demo.getByRole("checkbox").check();
  await apply.click();
  await expect(demo.getByRole("status")).toContainText("Demo receipt");
  await demo.getByRole("button", { name: "Undo demo change" }).click();
  await expect(demo.getByRole("checkbox")).not.toBeChecked();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("the demo shows a recorded SERV coverage result without calling anything", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.hostname.includes("openserv"))
      calls.push(request.url());
  });
  await page.goto("/demo");
  await page.getByRole("link", { name: "Coverage" }).click();
  const coverage = page.getByRole("region", {
    name: "Check coverage with SERV",
  });
  await expect(coverage.getByRole("status")).toHaveText(
    "7 changes classified · 2 uncovered",
  );
  await expect(
    coverage.getByText(/Recorded result, not a live call/),
  ).toBeVisible();
  const first = coverage.locator(".coverage-list li").first();
  await expect(first).toHaveAttribute("data-status", "uncovered");
  await expect(first).toContainText("Block malicious domains.");
  await coverage.getByText("The 8 tasks it checked against").click();
  await expect(coverage.getByText(/not a real team’s plan/)).toBeVisible();
  expect(calls).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
