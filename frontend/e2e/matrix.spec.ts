import { expect, test, type APIRequestContext } from "@playwright/test";
import { screenDefinitions } from "../app/features/workspace/screens";
import { demoCaseIds, demoId } from "../app/features/workspace/preview-data";

import { previewViewRoutes, createPreviewManagementReviewData } from "../app/features/workspace/preview-management/view-catalog";

const samples: Record<string, string> = {
  vehicleId: demoId(11), caseId: demoCaseIds[0], recordId: demoId(32),
  shareId: demoId(91), answerId: demoId(71),
};
const outputDirectory = process.env.E2E_SCREENSHOT_DIR;

for (const language of ["ja", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 768, 1440]) {
      test(`all preview screens: ${language} ${theme} ${width}px`, async ({ page, context, baseURL }, testInfo) => {
        test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "Preview is disabled in public deployments.");
        test.setTimeout(240_000);
        await page.setViewportSize({ width, height: width === 360 ? 780 : 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await context.addCookies([
          { name: "mt_locale", value: language, url: baseURL! },
          { name: "mt_theme", value: theme, url: baseURL! },
        ]);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
        for (const definition of screenDefinitions) {
          const path = definition.path.replace(/:(\w+)/g, (_, key: string) => samples[key]);
          const response = await page.goto(`/preview/${path}`);
          expect.soft(response?.status(), `${definition.key}: status`).toBe(200);
          await expect.soft(page.getByRole("main"), definition.key).toBeVisible();
          await expect.soft(page.locator("html"), definition.key).toHaveAttribute("lang", language);
          await expect.soft(page.locator("html"), definition.key).toHaveAttribute("data-theme", theme);
          expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${definition.key}: horizontal overflow`).toBe(true);
          await expect.soft(page.getByRole("dialog")).not.toBeVisible();
          if (["dashboard", "cases", "record-edit", "recipient"].includes(definition.key)) {
            const filename = `${definition.key}-${language}-${theme}-${width}.png`;
            await page.screenshot({ path: outputDirectory ? `${outputDirectory}/${filename}` : testInfo.outputPath(filename), fullPage: true });
          }
        }
        for (const route of previewViewRoutes(createPreviewManagementReviewData())) {
          if (route.screen === "imports" && new URL(route.to, baseURL).searchParams.get("view") === "preview") {
            await page.goto("/preview/operations/imports?view=new");
            await page.getByLabel(language === "ja" ? "CSVの内容" : "CSV content", { exact: true }).fill("model_name,plate_number\nMatrix car,MATRIX-001");
            await page.getByRole("button", { name: language === "ja" ? "試行して行ごとに確認" : "Run trial and review rows", exact: true }).click();
            await expect(page).toHaveURL(/view=preview/);
            await expect(page.getByRole("main").getByText("Matrix car", { exact: true })).toBeVisible();
          } else {
            const response = await page.goto(route.to);
            expect.soft(response?.status(), route.id).toBe(200);
          }
          await expect.soft(page.getByRole("main"), route.id).toBeVisible();
          await expect.soft(page.locator("html"), route.id).toHaveAttribute("lang", language);
          await expect.soft(page.locator("html"), route.id).toHaveAttribute("data-theme", theme);
          expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route.id}: horizontal overflow`).toBe(true);
          if (route.requiresItem) throw new Error(`Missing seeded preview item for ${route.id}`);
        }
        // Login is outside the shared shell and must honor the same persisted cookies.
        await page.goto("/login");
        await expect(page.getByRole("heading", { name: "Mobile Tracer", exact: true })).toBeVisible();
        await expect(page.getByRole("main")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const loginFilename = `login-${language}-${theme}-${width}.png`;
        await page.screenshot({ path: outputDirectory ? `${outputDirectory}/${loginFilename}` : testInfo.outputPath(loginFilename), fullPage: true });
        expect(errors).toEqual([]);
      });

      test(`account, management and settings screens: ${language} ${theme} ${width}px`, async ({ page, context, baseURL }) => {
        test.skip(!!process.env.PLAYWRIGHT_BASE_URL || !!process.env.API_INTERNAL_URL || process.env.TEST_FIREBASE_BROWSER === "1", "Loopback auth fixture only.");
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: width === 360 ? 780 : 1000 });
        await context.addCookies([
          { name: "ui_fixture_session", value: "1", url: baseURL! },
          { name: "ui_fixture_role", value: "admin", url: baseURL! },
          { name: "mt_locale", value: language, url: baseURL! },
          { name: "mt_theme", value: theme, url: baseURL! },
        ]);
        const { companyId, requestId } = await seedManagementViews(page.request, baseURL!, `${language}-${theme}-${width}`);
        const userId = "10000000-0000-4000-8000-000000000002";
        const queryViews = [
          `/admin/users?view=detail&user=${userId}`, `/admin/users?view=edit&user=${userId}`,
          "/admin/companies?view=new",
          ...["detail", "edit", "members"].map(view => `/admin/companies?view=${view}&company=${companyId}`),
          ...["detail", "review"].map(view => `/admin/requests?view=${view}&request=${requestId}`),
          "/account/requests?view=upgrade", "/account/requests?view=new-company",
          ...["company", "profile"].map(view => `/account/requests?view=${view}&company=${companyId}`),
          `/account/requests?view=detail&request=${requestId}`,
        ];
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
        for (const path of ["/app", "/account", "/account/requests", "/account/requests?view=companies", "/settings", "/settings/display", "/admin", "/admin/users", "/admin/companies", "/admin/requests", ...queryViews]) {
          const response = await page.goto(path);
          expect.soft(response?.status(), path).toBe(200);
          await expect.soft(page.getByRole("main"), path).toBeVisible();
          await expect.soft(page.locator("html"), path).toHaveAttribute("lang", language);
          await expect.soft(page.locator("html"), path).toHaveAttribute("data-theme", theme);
          expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path}: horizontal overflow`).toBe(true);
          if (width >= 768) {
            await expect.soft(page.getByRole("navigation", { name: language === "ja" ? "メインナビゲーション" : "Main navigation" }), path).toBeVisible();
          } else {
            await expect.soft(page.getByRole("button", { name: language === "ja" ? "メニューを開く" : "Open menu", exact: true }), path).toBeVisible();
          }
        }
        expect(errors).toEqual([]);
      });
    }
  }
}

async function seedManagementViews(request: APIRequestContext, origin: string, name: string) {
  const fixtureURL = "http://127.0.0.1:18781";
  async function post(path: string, body: object) {
    const response = await request.post(fixtureURL + path, {
      headers: { Origin: origin, "X-CSRF-Token": "fixture-csrf" }, data: body,
    });
    expect(response.ok(), path).toBeTruthy();
    return (await response.json()).data;
  }
  // Only the administrator fixture is changed; the general user's approval journey remains isolated.
  const upgrade = await post("/api/me/requests", { kind: "business_upgrade", request_key: crypto.randomUUID(), payload: { display_name: "システム管理者", reason: "Matrix setup" } });
  await post(`/api/admin/requests/${upgrade.id}/decision`, { decision: "approved", reason: "Matrix setup" });
  const payload = { name: `Matrix ${name}`, profile: { legal_name: `Matrix ${name}`, description: "", website: "", phone: "", address: "", contact_email: "", business_types: ["rental"] } };
  const creation = await post("/api/me/requests", { kind: "company_create", request_key: crypto.randomUUID(), payload });
  const approved = await post(`/api/admin/requests/${creation.id}/decision`, { decision: "approved", reason: "Matrix setup" });
  // A pending request belonging to this company makes detail/review and own detail available.
  const pending = await post("/api/me/requests", { kind: "company_profile_update", company_id: approved.company_id, request_key: crypto.randomUUID(), payload: { ...payload, version: 0 } });
  return { companyId: approved.company_id, requestId: pending.id };
}
