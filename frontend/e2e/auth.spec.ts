import { expect, test } from "@playwright/test";

test("login has a safe error message and does not reflect query content", async ({ page }) => {
  await page.goto("/login?error=cancelled&code=must-not-be-rendered");
  await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("キャンセル");
  await expect(page.locator("body")).not.toContainText("must-not-be-rendered");
});
for (const path of ["/account", "/admin"]) {
  test(`anonymous users cannot open ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "ログイン", exact: true })).toBeVisible();
  });
}
