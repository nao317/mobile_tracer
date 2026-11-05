import { expect, test } from "@playwright/test";

// Enable with a running Auth Emulator and Go API, and API_INTERNAL_URL for SSR.
const enabled = process.env.TEST_FIREBASE_BROWSER === "1";
const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:18081";

test.describe("Firebase Authentication", () => {
  test.skip(!enabled, "requires the Firebase Auth Emulator and the Go API");
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const response = await route.fetch({ url: api + path });
      await route.fulfill({ response });
    });
  });
  test("non-Google email and password login, SSR session, and logout", async ({ page, request }) => {
    const email = `browser-${Date.now()}@company.example`;
    const created = await request.post(`http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { data: { email, password: "test-password-123!", returnSecureToken: true } });
    expect(created.ok()).toBeTruthy();
    const { localId } = await created.json();
    try {
      const verified = await request.post(`http://${emulator}/identitytoolkit.googleapis.com/v1/projects/demo-mobile-tracer/accounts:update`, { headers: { Authorization: "Bearer owner" }, data: { localId, emailVerified: true } });
      expect(verified.ok()).toBeTruthy();
      await page.goto("/login");
      await page.getByLabel("メールアドレス").fill(email);
      await page.getByLabel("パスワード").fill("wrong-password");
      await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
      await expect(page.getByRole("alert")).toContainText("認証できませんでした");
      await page.getByLabel("パスワード").fill("test-password-123!");
      await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      const cookies = await page.context().cookies();
      expect(cookies.find((c) => c.name === "mt_session")?.httpOnly).toBe(true);
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
      await page.getByRole("button", { name: "ログアウト" }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/account");
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await request.post(`http://${emulator}/identitytoolkit.googleapis.com/v1/projects/demo-mobile-tracer/accounts:delete`, { headers: { Authorization: "Bearer owner" }, data: { localId } });
    }
  });
  test("registration requires email verification and password reset changes the password", async ({ page, request }) => {
    const email = `registration-${Date.now()}@company.example`;
    await page.goto("/login");
    await page.getByRole("button", { name: "新規登録" }).click();
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill("test-password-123!");
    await page.getByRole("button", { name: "アカウント登録" }).click();
    await expect(page.getByRole("status")).toContainText("確認メールを送信しました");
    expect((await page.context().cookies()).some((cookie) => cookie.name === "mt_session" && cookie.value)).toBe(false);
    async function codeFor(type: string) {
      const response = await request.get(`http://${emulator}/emulator/v1/projects/demo-mobile-tracer/oobCodes`);
      expect(response.ok()).toBeTruthy();
      const { oobCodes } = await response.json();
      const code = oobCodes.find((code: { email: string; requestType: string; oobCode: string }) => code.email === email && code.requestType === type);
      expect(code).toBeTruthy();
      return code.oobCode;
    }
    const verified = await request.post(`http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, { data: { oobCode: await codeFor("VERIFY_EMAIL") } });
    expect(verified.ok()).toBeTruthy();
    await page.getByRole("button", { name: "パスワードを忘れた場合" }).click();
    await page.getByRole("button", { name: "再設定メールを送信" }).click();
    await expect(page.getByRole("status")).toContainText("パスワード再設定");
    const reset = await request.post(`http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-api-key`, { data: { oobCode: await codeFor("PASSWORD_RESET"), newPassword: "reset-password-456!" } });
    expect(reset.ok()).toBeTruthy();
    await page.getByRole("button", { name: "ログインに戻る" }).click();
    await page.getByLabel("パスワード").fill("reset-password-456!");
    await page.getByRole("button", { name: "メールアドレスでログイン" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });
  test("Google login uses the Firebase emulator popup", async ({ page }) => {
    await page.goto("/login");
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Googleでログイン" }).click();
    const popup = await popupPromise;
    await expect(popup.getByText("Google", { exact: false }).first()).toBeVisible();
    await popup.getByRole("button", { name: "Add new account" }).click();
    await popup.getByLabel("Email").fill(`google-${Date.now()}@gmail.com`);
    await popup.getByRole("button", { name: "Sign in with Google.com" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
