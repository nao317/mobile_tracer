import { expect, test } from "@playwright/test";

const labels = {
  ja: { navigation: "メインナビゲーション", open: "メニューを開く", close: "メニューを閉じる", vehicles: "車両", cases: "案件" },
  en: { navigation: "Main navigation", open: "Open menu", close: "Close menu", vehicles: "Vehicles", cases: "Cases" },
};

test.describe("shared navigation shell", () => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "Preview is disabled in public deployments.");

  for (const language of ["ja", "en"] as const) {
    test(`${language}: mobile drawer supports keyboard, focus restoration and route focus`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "mt_locale", value: language, url: baseURL! }]);
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/preview/cases");
      const text = labels[language];
      const open = page.getByRole("button", { name: text.open, exact: true });
      const drawer = page.getByRole("dialog", { name: text.navigation });
      await expect(drawer).not.toBeVisible();
      await expect(open).toHaveAttribute("aria-expanded", "false");
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(drawer).toBeVisible();
      await expect(open).toHaveAttribute("aria-expanded", "true");
      const close = drawer.getByRole("button", { name: text.close, exact: true });
      await expect(close).toBeFocused();
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      // Native modal focus must wrap in both directions without reaching the page behind it.
      for (const key of ["Shift+Tab", "Tab", "Tab"]) {
        await page.keyboard.press(key);
        await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await expect(open).toBeFocused();
      await expect(open).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      await open.press("Space");
      await close.click();
      await expect(open).toBeFocused();
      await open.click();
      const navigation = drawer.getByRole("navigation", { name: text.navigation });
      await navigation.getByRole("button", { name: text.vehicles, exact: true }).click();
      await navigation.getByRole("link", { name: text.vehicles, exact: true }).click();
      await expect(page).toHaveURL(/\/preview\/vehicles$/);
      await expect(drawer).not.toBeVisible();
      await expect(page.getByRole("main")).toBeFocused();
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
      await open.click();
      await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute("href", "/preview/vehicles");
      await page.setViewportSize({ width: 768, height: 1000 });
      await expect(drawer).not.toBeVisible();
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    });

    for (const width of [768, 1440]) {
      test(`${language}: ${width}px sidebar collapses and preserves active navigation`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: "mt_locale", value: language, url: baseURL! }]);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/preview/cases");
        const text = labels[language];
        const navigation = page.getByRole("navigation", { name: text.navigation });
        await expect(navigation).toBeVisible();
        const group = navigation.getByRole("button", { name: text.cases, exact: true });
        await expect(group).toHaveAttribute("aria-expanded", "true");
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute("href", "/preview/cases");
        await group.press("Enter");
        await expect(group).toHaveAttribute("aria-expanded", "false");
        await expect(navigation.getByRole("link", { name: text.cases, exact: true })).not.toBeVisible();
        await group.press("Space");
        await expect(group).toHaveAttribute("aria-expanded", "true");
        await page.getByRole("button", { name: text.close, exact: true }).click();
        await expect(navigation).not.toBeVisible();
        const open = page.getByRole("button", { name: text.open, exact: true });
        await expect(open).toHaveAttribute("aria-expanded", "false");
        await open.press("Enter");
        await expect(navigation).toBeVisible();
        await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute("href", "/preview/cases");
      });
    }
  }
});

test("display settings persist across shell routes, login, reload and a new tab", async ({ page, context, baseURL }) => {
  test.skip(!!process.env.PLAYWRIGHT_BASE_URL || !!process.env.API_INTERNAL_URL || process.env.TEST_FIREBASE_BROWSER === "1", "Loopback auth fixture only.");
  await context.addCookies([{ name: "ui_fixture_session", value: "1", url: baseURL! }]);
  await page.goto("/settings/display");
  await page.getByLabel("言語", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("dark");
  for (const path of ["/account", "/preview/cases"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  }
  const tab = await context.newPage();
  try {
    await tab.goto("/settings/display");
    await expect(tab.getByLabel("Theme", { exact: true })).toHaveValue("dark");
    await tab.getByLabel("Theme", { exact: true }).selectOption("light");
    await tab.getByLabel("Language", { exact: true }).selectOption("ja");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Keep preference cookies while removing only the fixture's authentication cookie.
    await context.clearCookies({ name: "ui_fixture_session" });
    await page.goto("/login");
    await expect(page.getByLabel("メールアドレス")).toBeVisible();
    await expect(page.getByRole("main")).toHaveAttribute("data-theme", "light");
  } finally {
    await tab.close();
  }
});
