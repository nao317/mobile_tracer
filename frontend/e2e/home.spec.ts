import { expect, test } from "@playwright/test";

test("the home page redirects guests to the dashboard with sign-in options", async ({
  page,
}) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByText("データを表示するには、ログインまたは新規登録が必要です。"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ログイン", exact: true }),
  ).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "新規登録" })).toHaveAttribute(
    "href", "/login?mode=register",
  );
  let authEnabled = true;
  if (process.env.PLAYWRIGHT_BASE_URL) {
    const config = await page.request.get("/api/auth/config");
    expect(config.ok()).toBe(true);
    const { data } = await config.json();
    expect(typeof data.enabled).toBe("boolean");
    authEnabled = data.enabled;
  }
  await page.getByRole("link", { name: "新規登録" }).click();
  await expect(page).toHaveURL(/\/login\?mode=register$/);
  if (authEnabled) {
    await expect(page.getByRole("tab", { name: "新規登録" })).toHaveAttribute(
      "aria-selected", "true",
    );
  } else {
    await expect(page.getByRole("status")).toContainText(
      "ログインの準備ができていません。管理者にお問い合わせください。",
    );
    await expect(page.getByRole("tab", { name: "新規登録" })).toHaveCount(0);
  }
});

test("guest dashboard display preferences persist", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("display preferences work on workspace screens", async ({ page }) => {
  test.skip(
    !!process.env.PLAYWRIGHT_BASE_URL,
    "Preview is disabled in public deployments.",
  );
  await page.goto("/preview/cases");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Cases", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkInput = await page.getByLabel("Search", { exact: true }).evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkInput).not.toBe("rgb(255, 255, 255)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("signed-in users without a company can open the dashboard", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(
    !!process.env.PLAYWRIGHT_BASE_URL ||
      !!process.env.API_INTERNAL_URL ||
      process.env.TEST_FIREBASE_BROWSER === "1",
    "Loopback auth fixture only",
  );
  await context.addCookies([
    { name: "ui_fixture_session", value: "1", url: baseURL! },
    { name: "ui_fixture_role", value: "general", url: baseURL! },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByText(
      "業務データを表示するには、アカウント画面で所属を選択してください。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "アカウント・所属を確認" }),
  ).toHaveAttribute("href", "/account");
});

test("an unknown URL displays the 404 page", async ({ page }) => {
  const response = await page.goto("/not-a-real-page");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByText("対象が見つかりません。"),
  ).toBeVisible();
});

test("the browser can call the API on the same origin through Nginx", async ({
  page,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "requires the Compose environment",
  );
  await page.goto("/");
  const results = await page.evaluate(async () => {
    return Promise.all(
      ["/api/health", "/api/ready"].map(async (path) => {
        const response = await fetch(path);
        return { status: response.status, body: await response.json() };
      }),
    );
  });
  expect(results).toEqual([
    { status: 200, body: { status: "ok" } },
    { status: 200, body: { status: "ok" } },
  ]);
});
