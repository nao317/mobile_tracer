import { test, expect } from "@playwright/test";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL || !!process.env.API_INTERNAL_URL,
  "local browser contract fixture",
);
test("case acceptance, approved work and customer incident", async ({
  browser,
  baseURL,
}) => {
  const business = await browser.newContext({ timezoneId: "Asia/Tokyo" });
  const customer = await browser.newContext({ timezoneId: "Asia/Tokyo" });
  await business.addCookies([
    { name: "ui_fixture_session", value: "1", url: baseURL! },
    { name: "ui_fixture_casework", value: "business", url: baseURL! },
  ]);
  await customer.addCookies([
    { name: "ui_fixture_session", value: "1", url: baseURL! },
    { name: "ui_fixture_casework", value: "customer", url: baseURL! },
  ]);
  const staff = await business.newPage(),
    client = await customer.newPage();
  try {
    await staff.goto("/casework/new");
    await staff
      .getByLabel("顧客の登録メールアドレス")
      .fill("customer@casework.example");
    await staff
      .getByLabel("取引内容・車両状態・条件・金額")
      .fill("貸出条件を提示します");
    await staff.getByLabel("案件開始の回答期限").fill("2030-11-09T18:00");
    await staff
      .getByRole("button", { name: "案件条件を固定して顧客へ提示する" })
      .click();
    await expect(staff).toHaveURL(/\/casework\/.+\/start/);
    const casePath = new URL(staff.url()).pathname.replace(/\/start$/, "");
    await client.goto(casePath + "/start");
    await client.getByLabel("対象の内容と条件を確認しました").check();
    await client
      .getByRole("button", { name: "案件開始への回答を保存する" })
      .click();
    await expect(client.getByText("進行中", { exact: true })).toBeVisible();
    await staff.goto(casePath + "/work");
    await staff.getByLabel("件名", { exact: true }).fill("追加作業");
    await staff.getByLabel("内容・対象範囲").fill("承認した範囲だけを作業します");
    await staff.getByLabel("金額（円・整数、任意）").fill("1000");
    await staff.getByLabel("相手の回答期限").fill("2030-11-09T18:00");
    await staff
      .getByRole("button", { name: "内容を固定して相手へ提示する" })
      .click();
    await expect(staff).toHaveURL(`${baseURL}${casePath}/timeline`);
    const staffWork = staff.getByRole("region", { name: "作業提案：追加作業", exact: true });
    await expect(staffWork.getByText("回答待ち", { exact: true })).toBeVisible();
    await expect(
      staff.getByRole("button", { name: "承認済みの範囲に着手する" }),
    ).toHaveCount(0);
    await client.goto(casePath + "/timeline");
    const clientWork = client.getByRole("region", { name: "作業提案：追加作業", exact: true });
    await clientWork.getByLabel("対象の内容と条件を確認しました").check();
    await clientWork.getByRole("button", { name: "相手への回答を保存する" }).click();
    await expect(clientWork.getByText("承認済み", { exact: true })).toBeVisible();
    await staff.reload();
    await staffWork.getByLabel("対象の内容を確認しました", { exact: true }).check();
    await staffWork.getByRole("button", { name: "承認済みの範囲に着手する" }).click();
    await expect(staffWork.getByText("進行中", { exact: true })).toBeVisible();
    await staffWork
      .getByLabel("対応結果", { exact: true })
      .fill("対応が完了しました");
    await staffWork.getByLabel("対象の内容を確認しました", { exact: true }).check();
    await staffWork.getByRole("button", { name: "対応結果を顧客へ報告する" }).click();
    await expect(staffWork.getByText("顧客の完了確認待ち", { exact: true })).toBeVisible();
    await client.reload();
    await clientWork.getByLabel("対象の内容を確認しました", { exact: true }).check();
    await clientWork.getByRole("button", { name: "対応の完了を確認する" }).click();
    await expect(clientWork.getByText("完了", { exact: true })).toBeVisible();
    await client.goto(casePath + "/incident");
    await client.getByLabel("件名", { exact: true }).fill("車両の異音");
    await client
      .getByLabel("内容・対象範囲")
      .fill("走行時に異音がします。確認をお願いします。");
    await client.getByLabel("相手の回答期限").fill("2030-11-09T18:00");
    await client
      .getByRole("button", { name: "内容を固定して相手へ提示する" })
      .click();
    await expect(client).toHaveURL(`${baseURL}${casePath}/timeline`);
    const clientIncident = client.getByRole("region", { name: "インシデント報告：車両の異音", exact: true });
    await expect(clientIncident.getByText("回答待ち", { exact: true })).toBeVisible();
    await expect(
      client.getByRole("button", { name: "相手への回答を保存する" }),
    ).toHaveCount(0);
    await staff.reload();
    const staffIncident = staff.getByRole("region", { name: "インシデント報告：車両の異音", exact: true });
    await staffIncident.getByLabel("対象の内容と条件を確認しました").check();
    await staffIncident.getByRole("button", { name: "相手への回答を保存する" }).click();
    await expect(staffIncident.getByText("承認済み", { exact: true })).toBeVisible();
    await staff.setViewportSize({ width: 390, height: 844 });
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await staff.screenshot({
      path: "/tmp/mobile-tracer-casework-mobile.png",
      fullPage: true,
    });
  } finally {
    await customer.close();
    await business.close();
  }
});
