import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test("申請、管理者の承認、企業作成、拒否とユーザー管理", async ({
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(60_000);
  test.skip(
    !!process.env.PLAYWRIGHT_BASE_URL ||
      !!process.env.API_INTERNAL_URL ||
      process.env.TEST_FIREBASE_BROWSER === "1",
    "Loopback UI fixture only; actual API behavior has PostgreSQL integration tests.",
  );
  const contexts: BrowserContext[] = [];
  const reset = await request.post(`http://127.0.0.1:${process.env.PLAYWRIGHT_FIXTURE_PORT || "18781"}/__fixture/reset-management`);
  expect(reset.ok()).toBe(true);
  const errors: string[] = [];
  async function rolePage(role: string) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
    });
    contexts.push(context);
    await context.addCookies([
      { name: "ui_fixture_session", value: "1", url: baseURL! },
      { name: "ui_fixture_role", value: role, url: baseURL! },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  async function review(
    admin: Page,
    kind: string,
    decision: "承認する" | "拒否する",
    reason: string,
  ) {
    await admin.goto("/admin/requests?status=pending");
    const [requestKind, applicant] = kind.split(" / ");
    const row = admin.getByRole("row").filter({ hasText: applicant })
      .filter({ has: admin.getByRole("link", { name: requestKind, exact: true }) });
    await row.getByRole("link", { name: requestKind, exact: true }).click();
    await expect(admin).toHaveURL(/view=detail/);
    await expect(admin.getByRole("region", { name: kind, exact: true })).toBeVisible();
    await admin.getByRole("main").getByRole("link", { name: "申請を審査", exact: true }).click();
    await expect(admin).toHaveURL(/view=review/);
    const form = admin.getByRole("main").locator("form").filter({ has: admin.getByLabel("審査理由", { exact: true }) });
    await form.getByLabel("審査理由").fill(reason);
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: decision, exact: true }).click();
    await expect(
      admin.getByText("処理を完了しました。最新の状態を確認してください。"),
    ).toBeVisible();
  }
  try {
    const general = await rolePage("general"),
      admin = await rolePage("admin");
    await general.goto("/admin/users");
    await expect(
      general.getByText("システム管理者の権限が必要です", { exact: true }),
    ).toBeVisible();
    await general.goto("/account/requests");
    await general.getByRole("main").getByRole("link", { name: "業者ユーザーへの変更申請", exact: true }).click();
    await expect(general).toHaveURL(/view=upgrade/);
    await general.getByLabel("業者としての表示名").fill("承認対象の担当者");
    await general
      .getByLabel("変更を申請する理由")
      .fill("企業の管理を始めるため");
    await general
      .getByRole("button", { name: "業者ユーザーへの変更を申請", exact: true })
      .click();
    await expect(
      general.getByText("業者ユーザーへの変更は承認待ちです。", {
        exact: false,
      }),
    ).toBeVisible();
    await review(
      admin,
      "業者ユーザーへの変更 / general@management.example.com",
      "承認する",
      "担当者を確認しました",
    );
    await general.reload();
    await expect(
      general.getByText("業者ユーザーへの変更は承認済みです。", { exact: true }),
    ).toBeVisible();
    await general.getByRole("main").getByRole("link", { name: "企業・プロファイルの作成申請", exact: true }).click();
    await expect(general).toHaveURL(/view=new-company/);
    const companyForm = general
      .getByRole("region", { name: "企業・プロファイルの作成申請" })
      .locator("form");
    await companyForm.getByLabel("企業の表示名").fill("ブラウザ確認企業");
    await companyForm.getByLabel("正式な企業名").fill("ブラウザ確認株式会社");
    await companyForm
      .getByLabel("レンタカー・カーシェア", { exact: true })
      .check();
    await companyForm
      .getByRole("button", {
        name: "企業・プロファイルの作成を申請",
        exact: true,
      })
      .click();
    await expect(
      general.getByText("企業作成の申請は承認待ちです。"),
    ).toBeVisible();
    await review(
      admin,
      "企業・プロファイル作成 / general@management.example.com",
      "承認する",
      "企業情報を確認しました",
    );
    await general.reload();
    await general.getByRole("main").getByRole("link", { name: "所属する企業", exact: true }).click();
    await expect(general).toHaveURL(/view=companies/);
    const company = general.getByRole("region", { name: "所属する企業", exact: true })
      .getByRole("link", { name: "ブラウザ確認企業", exact: true });
    await expect(company).toBeVisible();
    await company.click();
    await expect(general).toHaveURL(/view=company&/);
    await expect(general.getByRole("region", { name: "ブラウザ確認企業", exact: true })).toContainText("ブラウザ確認株式会社");
    await general.getByRole("main").getByRole("link", { name: "この企業のプロファイル変更を申請", exact: true }).click();
    await expect(general).toHaveURL(/view=profile/);
    const profileForm = general
      .getByRole("region", { name: "ブラウザ確認企業 のプロファイル変更申請" })
      .locator("form");
    await profileForm.getByLabel("企業の表示名").fill("審査で拒否される変更");
    await profileForm
      .getByRole("button", { name: "プロファイル変更を申請", exact: true })
      .click();
    await expect(general.getByText("処理を完了しました。最新の状態を確認してください。")).toBeVisible();
    await expect(general.getByText("この企業のプロファイル変更は承認待ちです。")).toBeVisible();
    await review(
      admin,
      "企業プロファイル変更 / general@management.example.com",
      "拒否する",
      "正式な企業名を再確認してください",
    );
    await general.reload();
    await expect(general.getByLabel("企業の表示名", { exact: true })).toHaveValue("ブラウザ確認企業");
    await general.getByRole("main").getByRole("link", { name: "自分の申請履歴", exact: true }).click();
    const rejected = general.getByRole("row").filter({ hasText: "拒否" })
      .filter({ has: general.getByRole("link", { name: "企業プロファイル変更", exact: true }) });
    await rejected.getByRole("link", { name: "企業プロファイル変更", exact: true }).click();
    await expect(general).toHaveURL(/view=detail/);
    await expect(
      general.getByText("審査理由：正式な企業名を再確認してください", {
        exact: true,
      }),
    ).toBeVisible();
    await admin.goto("/admin/users");
    await admin
      .getByRole("link", { name: "承認対象の担当者", exact: true })
      .click();
    await expect(admin).toHaveURL(/view=detail/);
    await admin.getByRole("main").getByRole("link", { name: "ユーザー情報を編集", exact: true }).click();
    await expect(admin).toHaveURL(/view=edit/);
    await expect(admin.getByLabel("表示名", { exact: true })).toHaveValue(
      "承認対象の担当者",
    );
    for (const path of [
      "/admin",
      "/admin/users",
      "/admin/companies",
      "/admin/requests",
    ]) {
      await admin.goto(path);
      await expect(admin.getByRole("main")).toBeVisible();
      expect(
        await admin.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        path,
      ).toBe(true);
      await admin.getByRole("button", { name: "メニューを開く", exact: true }).click();
      const drawer = admin.getByRole("dialog", { name: "メインナビゲーション" });
      await expect(drawer.getByRole("navigation").locator('a[aria-current="page"]')).toHaveCount(1);
      await admin.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});
