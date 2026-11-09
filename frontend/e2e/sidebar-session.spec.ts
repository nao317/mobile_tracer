import { expect, test } from "@playwright/test";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL || !!process.env.API_INTERNAL_URL, "Local auth fixture only");

test("business navigation survives transitions from preview to licenses and home", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "ui_fixture_session", value: "1", url: baseURL! }]);
  // Preview has its own business context and deliberately no root session.
  await page.goto("/preview/cases");
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  await nav.getByRole("link", { name: "OSSライセンス", exact: true }).click();
  await expect(page).toHaveURL(/\/licenses$/);
  await expect(nav.getByRole("link", { name: "車両", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "案件", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(nav.getByRole("link", { name: "車両", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "案件", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "車両", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/vehicles$/);
  await nav.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(nav.getByRole("link", { name: "案件", exact: true })).toBeVisible();
});

test("a session established after an anonymous page is reflected on licenses", async ({ page, context, baseURL }) => {
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  await expect(nav.getByRole("link", { name: "車両", exact: true })).toHaveCount(0);
  await context.addCookies([{ name: "ui_fixture_session", value: "1", url: baseURL! }]);
  await nav.getByRole("link", { name: "OSSライセンス", exact: true }).click();
  await expect(nav.getByRole("link", { name: "車両", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "案件", exact: true })).toBeVisible();
});
