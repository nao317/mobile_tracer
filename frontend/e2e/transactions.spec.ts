import { test, expect } from "@playwright/test";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL || !!process.env.API_INTERNAL_URL,
  "read-only fixture contract",
);
test("transaction screens are separated by function", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "ui_fixture_session", value: "1", url: "http://127.0.0.1:4173" },
  ]);
  await page.goto("/transactions");
  await expect(
    page.getByRole("heading", { name: "取引・車両記録" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /下書き/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "写真を撮影・保存" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "顧客へ提示", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "顧客へ提示", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "顧客へ提示", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "顧客の登録メールアドレス" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "写真を撮影・保存" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "登録・検証", exact: true }).click();
  await expect(page.getByRole("heading", { name: "改ざん検証" })).toBeVisible();
  await expect(
    page.getByText("未登録（顧客承認待ち、または提示前）", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/mobile-tracer-transactions-mobile.png",
    fullPage: true,
  });
});
