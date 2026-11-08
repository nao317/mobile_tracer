// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTranslator } from "../../../i18n";
import { createPreviewData, demoId } from "../preview-data";
import { createPreviewManagementReviewData, previewViewRoutes } from "./view-catalog";

describe("preview review catalog", () => {
  it("creates deterministic representative IDs without changing initial data or IDs", () => {
    const source = createPreviewData();
    const before = structuredClone(source);
    const seeded = createPreviewManagementReviewData(source);
    expect(source).toEqual(before);
    expect(seeded.workflow!.management.filter((item) => !before.workflow!.management.some((previous) => previous.id === item.id)).map((item) => [item.kind, item.id])).toEqual([
      ["configuration", demoId(900)], ["deletion", demoId(901)], ["import", demoId(902)],
    ]);
    expect(seeded.workflow!.audit.slice(0, 3).map((entry) => entry.id)).toEqual([demoId(912), demoId(911), demoId(910)]);
    for (const item of before.workflow!.management)
      expect(seeded.workflow!.management.find((entry) => entry.id === item.id)).toEqual(item);
    expect(createPreviewManagementReviewData(seeded)).toEqual(seeded);
  });
  it("lists all query views with resolvable IDs and localized semantic labels", () => {
    const snapshot = createPreviewManagementReviewData();
    const routes = previewViewRoutes(snapshot);
    expect(new Set(routes.map((route) => route.id)).size).toBe(routes.length);
    expect(routes).toHaveLength(60);
    expect(routes.some((route) => route.requiresItem)).toBe(false);
    const validIds = new Set([
      ...snapshot.workflow!.management.map((item) => item.id),
      ...snapshot.workflow!.shares.map((item) => item.id),
      ...snapshot.workflow!.disputes.map((item) => item.id),
    ]);
    for (const route of routes) {
      const url = new URL(route.to, "http://preview.example");
      expect(url.pathname).toMatch(/^\/preview\//);
      expect(url.searchParams.get("view")).toBeTruthy();
      const item = url.searchParams.get("item");
      if (item) expect(validIds.has(item)).toBe(true);
      for (const language of ["ja", "en"] as const) expect(createTranslator(language)(route.labelKey)).toBeTruthy();
    }
    expect(routes.find((route) => route.id === "organization:stores-edit")!.to).toContain(demoId(4));
    expect(routes.find((route) => route.id === "configuration:preview")!.to).toContain(demoId(900));
    expect(routes.find((route) => route.id === "deletion:detail")!.to).toContain(demoId(901));
    expect(routes.find((route) => route.id === "imports:detail")!.to).toContain(demoId(902));
    expect(routes.map((route) => route.id)).toEqual(expect.arrayContaining([
      "organization:stores-new", "organization:staff-new", "organization:stores-history", "organization:staff-history",
      "configuration:current", "configuration:edit", "configuration:history-item", "support:new", "support:edit",
      "environments:templates", "environments:new", "imports:preview", "operations:summary", "operations:capacity",
      "support-access:record", "photos:exception", "sharing:revoke", "disputes:history", "answers:request", "verification:check",
    ]));
  });
});
