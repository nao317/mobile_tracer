import { expect, test } from "@playwright/test";

test("login has a safe error message and does not reflect query content", async ({ page }) => {
  await page.goto("/login?error=cancelled&code=must-not-be-rendered");
  await expect(page.getByRole("heading", { name: "Mobile Tracer", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("キャンセル");
  await expect(page.locator("body")).not.toContainText("must-not-be-rendered");
});
for (const path of ["/account", "/admin"]) {
  test(`anonymous users cannot open ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Mobile Tracer", exact: true })).toBeVisible();
  });
}

test("login and registration share a form, and the selected language survives reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("review@example.com");
  await page.getByRole("tab", { name: "新規登録" }).click();
  await expect(page.getByRole("tab", { name: "新規登録" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("メールアドレス")).toHaveValue("review@example.com");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Sign up", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Sign in", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send reset email", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.getByRole("button", { name: "再設定メールを送信" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});

test("compact header stays aligned and themes persist without changing the form", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("review@example.com");
  const title = await page.getByRole("heading", { name: "Mobile Tracer" }).boundingBox();
  const language = await page.getByRole("button", { name: "English", exact: true }).boundingBox();
  expect(title).not.toBeNull();
  expect(language).not.toBeNull();
  expect(Math.abs(title!.y + title!.height / 2 - language!.y - language!.height / 2)).toBeLessThan(1);
  const home = await page.getByRole("link", { name: "ホームへ" }).boundingBox();
  expect(home!.y + home!.height).toBeLessThanOrEqual(568);
  await page.getByRole("button", { name: "ダークテーマに切り替え" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("メールアドレス")).toHaveValue("review@example.com");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-theme", "light");
});
