import { expect, test, type Page } from "@playwright/test";
import { screenDefinitions } from "../app/features/workspace/screens";
import { demoCaseIds, demoId } from "../app/features/workspace/preview-data";


async function navigateInSidebar(page: Page, href: string) {
  const navigation = page.getByRole("navigation", { name: "メインナビゲーション" });
  const link = navigation.locator(`a[href="${href}"], a[href^="${href}?"]`);
  if (!(await link.isVisible())) {
    await link.locator("..").locator("..").getByRole("button").click();
  }
  await link.click();
  await expect(page.getByRole("main")).toBeFocused();
}

test.describe("UI preview", () => {
  test.skip(
    !!process.env.PLAYWRIGHT_BASE_URL,
    "Preview is opt-in and is disabled in public deployments.",
  );
  const sample: Record<string, string> = {
    vehicleId: demoId(11),
    caseId: demoCaseIds[0],
    recordId: demoId(32),
    shareId: demoId(91),
    answerId: demoId(71),
  };
  test("every screen loads at phone width without a horizontal page scrollbar or runtime errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const definition of screenDefinitions) {
      const path = definition.path.replace(
        /:(\w+)/g,
        (_, key: string) => sample[key],
      );
      const response = await page.goto(`/preview/${path}`);
      expect(response?.status(), definition.title).toBe(200);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(
        page.locator("summary").filter({ hasText: "UIプレビュー" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        definition.title,
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    await page.goto("/preview");
    await page.screenshot({
      path: "/tmp/mobile-tracer-phone.png",
      fullPage: true,
    });
  });
  for (const [index, business] of [
    "レンタカー",
    "販売店",
    "整備・修理",
  ].entries()) {
    test(`${business}: edit a draft, submit, answer, and compare records`, async ({
      page,
    }) => {
      const caseId = demoCaseIds[index],
        recordId = demoId(32 + index * 2),
        versionId = demoId(42 + index * 2);
      await page.goto(
        `/preview/cases/${caseId}/records/${recordId}/edit?version=${versionId}`,
      );
      await page.getByLabel("走行距離（km）（提出時に必須）").fill("12345");
      await page
        .getByRole("button", { name: "下書きを保存", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "プレビューに反映" }),
      ).toBeVisible();
      await page.getByRole("main").getByRole("link", { name: "記録の詳細へ" }).click();
      await page.getByRole("main").getByRole("link", { name: "提出前確認へ" }).click();
      await page
        .getByLabel("提出する版と、入力・写真の内容を確認しました")
        .check();
      await page
        .getByRole("button", { name: "この内容で提出", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "記録の内容", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("提出済み", { exact: true })).toBeVisible();
      await navigateInSidebar(page, `/preview/cases/${caseId}/answers`);
      await page.getByLabel("対象の記録版").selectOption(versionId);
      await page.getByRole("main").getByRole("link", { name: "新規作成", exact: true }).click();
      await page.getByLabel("回答者名（プレビュー用）").fill("テスト利用者");
      await page
        .getByLabel("確認種別", { exact: true })
        .selectOption("状態同意");
      await page.getByLabel("回答", { exact: true }).selectOption("拒否");
      await page.getByLabel("対象版・確認文面・回答内容を確認しました").check();
      await page.getByRole("button", { name: "この版への回答を記録" }).click();
      await page.getByRole("main").getByRole("link", { name: "履歴", exact: true }).click();
      await expect(
        page.getByText("状態同意：拒否", { exact: true }),
      ).toBeVisible();
      await navigateInSidebar(page, `/preview/cases/${caseId}/compare`);
      await expect(
        page.getByRole("heading", { name: "項目の比較" }),
      ).toBeVisible();
      await expect(
        page.getByText("12345", { exact: false }).first(),
      ).toBeVisible();
    });
  }
  test("creates a vehicle, a case and a record using shared forms", async ({
    page,
  }) => {
    await page.goto("/preview/vehicles/new");
    await page.getByLabel("車種名", { exact: true }).fill("E2Eテスト車両");
    await page.getByLabel("識別情報", { exact: true }).fill("E2E-1234");
    await page.getByRole("button", { name: "車両を登録", exact: true }).click();
    await expect(
      page.getByRole("main").getByText("E2Eテスト車両", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "この車両で案件を作成" }).click();
    await page.getByLabel("業態", { exact: true }).selectOption("rental");
    await page.getByRole("button", { name: "案件を作成", exact: true }).click();
    await expect(page).toHaveURL(/\/preview\/cases\/[^/?]+$/);
    await navigateInSidebar(page, new URL(page.url()).pathname + "/records");
    await page.getByRole("link", { name: "記録を追加", exact: true }).click();
    await page
      .getByRole("button", { name: "下書きを保存", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "下書き v1" }),
    ).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "記録の詳細へ" }).click();
    await page.getByRole("main").getByRole("link", { name: "提出前確認へ" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "未入力" }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "未完了の撮影箇所" }),
    ).toBeVisible();
  });
  test("correction leaves old answers on the original version", async ({
    page,
  }) => {
    const caseId = demoCaseIds[0],
      recordId = demoId(31),
      versionId = demoId(41);
    await page.goto(
      `/preview/cases/${caseId}/records/${recordId}/correct?version=${versionId}`,
    );
    await page.getByLabel("理由・対象箇所").fill("走行距離の訂正");
    await page.getByRole("button", { name: "新しい下書きを作成" }).click();
    await expect(
      page.getByRole("heading", { name: "下書き v2" }),
    ).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "記録の詳細へ" }).click();
    await expect(page.getByText("未回答", { exact: true })).toBeVisible();
    await navigateInSidebar(page, `/preview/cases/${caseId}/records/${recordId}/history`);
    await page.getByRole("link", { name: "v1・提出済み" }).click();
    await expect(page.getByText(/受領[:：]\s*受領/)).toBeVisible();
  });
  test("revoked shares and expired shares stop displaying the record", async ({
    page,
  }) => {
    await page.goto(
      `/preview/cases/${demoCaseIds[0]}/sharing?version=${demoId(41)}`,
    );
    await page.getByRole("link", { name: "共有を取り消す", exact: true }).first().click();
    await page.locator("summary").filter({ hasText: "共有を取り消す" }).click();
    await page
      .getByLabel(
        "新しいアクセスを停止します。本人控えと取得済み帳票は別に扱います。",
      )
      .check();
    await page
      .getByRole("button", { name: "共有を取り消す", exact: true })
      .click();
    await page.getByRole("link", { name: "共有先の表示を確認" }).click();
    await expect(
      page.getByRole("heading", { name: "この共有は取り消されました" }),
    ).toBeVisible();
    await page.goto(`/preview/recipient/${demoId(91)}?expired=1`);
    await expect(
      page.getByRole("heading", { name: "共有期限が切れています" }),
    ).toBeVisible();
  });
  test("role and scenario controls change the available operations", async ({
    page,
  }) => {
    await page.goto("/preview/vehicles");
    await page.locator("summary").filter({ hasText: "UIプレビュー" }).click();
    await page.getByLabel("プレビューの役割").selectOption("auditor");
    await expect(page.getByRole("link", { name: "車両を登録" })).toHaveCount(0);
    await page
      .getByLabel("表示状態", { exact: true })
      .selectOption("forbidden");
    await expect(
      page.getByRole("heading", { name: "この操作を行う権限がありません。" }),
    ).toBeVisible();
    await page.getByLabel("表示状態", { exact: true }).selectOption("normal");
    await expect(page.getByRole("main").getByRole("link", { name: "車両を登録", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("この操作を行う権限がありません。");
  });
  test("desktop home shows history and keeps page links in the sidebar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/preview");
    await expect(
      page.getByRole("navigation", { name: "メインナビゲーション" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { name: "操作履歴" })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "メインナビゲーション" });
    await navigation.getByRole("button", { name: "案件", exact: true }).click();
    await expect(navigation.getByRole("link", { name: "案件", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "案件", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/mobile-tracer-desktop.png",
      fullPage: true,
    });
  });
  test("an unsaved draft remains available when navigation is cancelled", async ({
    page,
  }) => {
    await page.goto(
      `/preview/cases/${demoCaseIds[0]}/records/${demoId(32)}/edit`,
    );
    await page.getByLabel("走行距離（km）（提出時に必須）").fill("999");
    await page.getByRole("main").getByRole("link", { name: "記録の詳細へ" }).click();
    await expect(
      page.getByText("保存していない入力があります。移動しますか？", {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "編集を続ける", exact: true })
      .click();
    await expect(page.getByLabel("走行距離（km）（提出時に必須）")).toHaveValue(
      "999",
    );
    await page
      .getByRole("button", { name: "下書きを保存", exact: true })
      .click();
    await page.getByRole("main").getByRole("link", { name: "記録の詳細へ" }).click();
    await expect(
      page.getByRole("region", { name: "記録の内容", exact: true }),
    ).toBeVisible();
  });
  test("a photo upload can fail and is then blocked from submission", async ({
    page,
  }) => {
    await page.goto(
      `/preview/cases/${demoCaseIds[0]}/records/${demoId(32)}/photos`,
    );
    await page.getByRole("main").getByRole("link", { name: "写真を追加", exact: true }).click();
    await page.getByLabel("写真原本", { exact: true }).setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByRole("button", { name: "写真をプレビューに反映" }).click();
    await page.getByRole("main").getByRole("link", { name: "撮影一覧", exact: true }).click();
    await expect(page.getByRole("img", { name: "正面の撮影原本", exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "送信を再試行", exact: true }).click();
    await page.getByLabel("写真原本", { exact: true }).setInputFiles({
      name: "sample.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=", "base64"),
    });
    await page.getByLabel("送信失敗の表示を試す（プレビュー用）").check();
    await page.getByRole("button", { name: "写真をプレビューに反映" }).click();
    await page.getByRole("main").getByRole("link", { name: "撮影一覧", exact: true }).click();
    await expect(page.getByText("送信失敗", { exact: true })).toBeVisible();
    await navigateInSidebar(page, `/preview/cases/${demoCaseIds[0]}/records/${demoId(32)}`);
    await page.getByRole("main").getByRole("link", { name: "提出前確認へ" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "未完了の撮影箇所：正面" }),
    ).toBeVisible();
  });
  test("a recipient can retrieve a presented version without answering", async ({
    page,
  }) => {
    await page.goto(`/preview/recipient/${demoId(91)}`);
    await page
      .getByRole("link", {
        name: "提示された版の本人控えを取得（未回答でも可）",
      })
      .click();
    await expect(
      page.getByText("未回答です。提示された版を控えとして取得できます。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "本人控えを取得", exact: true }),
    ).toBeVisible();
  });
});

test("anonymous users cannot enter the live workspace", async ({ page }) => {
  await page.goto("/app/cases");
  await expect(page).toHaveURL(/\/login$/);
});

test("live routes create and reopen a draft through the HTTP API with session and CSRF", async ({
  page,
  context,
}) => {
  test.skip(
    !!process.env.PLAYWRIGHT_BASE_URL ||
      !!process.env.API_INTERNAL_URL ||
      process.env.TEST_FIREBASE_BROWSER === "1",
    "Uses the loopback-only API fixture.",
  );
  await context.addCookies([
    { name: "ui_fixture_session", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/app/vehicles/new");
  await page.getByLabel("車種名", { exact: true }).fill("HTTP接続テスト車両");
  await page.getByLabel("識別情報", { exact: true }).fill("HTTP-TEST");
  await page.getByRole("button", { name: "車両を登録", exact: true }).click();
  await expect(
    page.getByRole("main").getByText("HTTP接続テスト車両", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "この車両で案件を作成" }).click();
  await page.getByLabel("業態", { exact: true }).selectOption("rental");
  await page.getByRole("button", { name: "案件を作成", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/cases\/[^/?]+$/);
  await navigateInSidebar(page, new URL(page.url()).pathname + "/records");
  await page.getByRole("main").getByRole("link", { name: "記録を追加", exact: true }).click();
  await page.getByLabel("走行距離（km）（提出時に必須）").fill("25000");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.getByRole("region", { name: "記録の内容", exact: true })).toBeVisible();
  await expect(
    page.getByText("現在は確認できません", { exact: true }),
  ).toHaveCount(3);
  await page.getByRole("main").getByRole("link", { name: "下書きを編集", exact: true }).click();
  await expect(page.getByLabel("走行距離（km）（提出時に必須）")).toHaveValue(
    "25000",
  );
  await page.getByLabel("走行距離（km）（提出時に必須）").fill("25010");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "保存しました。" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("走行距離（km）（提出時に必須）")).toHaveValue(
    "25010",
  );
});
