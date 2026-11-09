import { expect, test } from "@playwright/test";

test("public licenses show ten entries, original notices and working pagination", async ({ page }) => {
  await page.goto("/licenses");
  await expect(page.getByRole("navigation", { name: "メインナビゲーション" })).toBeVisible();
  await expect(page.getByRole("link", { name: "OSSライセンス", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OSSライセンス", exact: true })).toHaveCount(0);
  const sidebar = page.getByRole("navigation", { name: "メインナビゲーション" });
  const settings = sidebar.getByRole("button", { name: "設定", exact: true });
  await expect(settings.locator("..").locator("xpath=following-sibling::*[1]").getByRole("link", { name: "OSSライセンス", exact: true })).toBeVisible();
  const main = page.getByRole("main");
  const panels = main.getByRole("region").filter({ has: page.getByRole("link", { name: "配布元", exact: true }) });
  await expect(panels).toHaveCount(10);
  const first = await panels.first().getByRole("heading", { level: 2 }).textContent();
  expect(await panels.first().getByRole("heading", { level: 2 }).evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Google Sans/);
  await panels.first().getByText("著作権表示・ライセンス原文を表示").click();
  await expect(panels.first().locator("pre").first()).toBeVisible();
  await expect(panels.first().locator("pre").first()).toContainText("Copyright");
  expect(await panels.first().locator("pre").first().evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^"?Google Sans/);
  const pagination = main.getByRole("navigation", { name: "ページ切り替え" });
  await pagination.getByRole("link", { name: "次へ", exact: true }).click();
  await expect(page).toHaveURL(/\/licenses\?page=2$/);
  await expect(panels).toHaveCount(10);
  await expect(panels.first().getByRole("heading", { level: 2 })).not.toHaveText(first!);
  await pagination.getByRole("link", { name: "前へ", exact: true }).click();
  await expect(panels.first().getByRole("heading", { level: 2 })).toHaveText(first!);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/mobile-tracer-licenses-mobile.png", fullPage: true });
});

test("licenses are top-level sidebar links and support English", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "mt_locale", value: "en", url: baseURL! }]);
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Open-source licenses", exact: true })).toHaveCount(0);
  await page.goto("/app");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("link", { name: "Open-source licenses", exact: true }).click();
  await expect(page).toHaveURL(/\/licenses$/);
  await expect(page).toHaveTitle("Open-source licenses | Mobile Tracer");
  await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText("1–10 of");
});
