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
  await page.getByRole("link", { name: "Try the walkthrough" }).click();
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
