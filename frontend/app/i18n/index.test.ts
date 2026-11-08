import { describe, expect, it } from "vitest";
import { createI18n, createTranslator, defineMessages, messages, type Translator } from "./index";
import { coreMessages } from "./core";
import { entryMessages } from "./entry";
import { errorMessages } from "./errors";
import { managementMessages } from "./management";
import { previewManagementMessages } from "./preview-management";
import { workflowMessages } from "./workflow";
import { corePageMessages } from "../features/workspace/pages/core-messages";
import { screenDefinitions } from "../features/workspace/screens";

// Kept in tsc as compile-time contract checks; this function is never executed.
function translationTypeChecks(t: Translator) {
  t("navigation.home");
  t("navigation.pageSummary", { page: 1, pages: 2 });
  // @ts-expect-error Japanese strings are not semantic keys.
  t("ホーム");
  // @ts-expect-error Interpolation parameters are required.
  t("navigation.pageSummary");
  // @ts-expect-error Placeholder names must match the catalog.
  t("navigation.pageSummary", { current: 1, pages: 2 });
  // @ts-expect-error Extra locale keys are not allowed.
  defineMessages({ ja: { "test.title": "題名" }, en: { "test.title": "Title", "test.extra": "Extra" } });
  // @ts-expect-error Every Japanese key needs an English translation.
  defineMessages({ ja: { "test.title": "題名" }, en: {} });
  // @ts-expect-error Both locales must interpolate the same names.
  defineMessages({ ja: { "test.title": "{name}" }, en: { "test.title": "{other}" } });
}
void translationTypeChecks;

describe("semantic i18n", () => {
  it("has no duplicate keys across the global and feature catalogs", () => {
    const catalogs = { coreMessages, entryMessages, errorMessages, managementMessages, previewManagementMessages, workflowMessages, corePageMessages };
    for (const language of ["ja", "en"] as const) {
      const owners = new Map<string, string>();
      for (const [name, catalog] of Object.entries(catalogs)) {
        for (const key of Object.keys(catalog[language])) {
          expect(owners.get(key), `${language}:${key} occurs in ${owners.get(key)} and ${name}`).toBeUndefined();
          owners.set(key, name);
        }
      }
    }
  });
  it("has an explicit title in both locales for every registered screen", () => {
    for (const language of ["ja", "en"] as const) {
      const i18n = createI18n(language);
      for (const screen of screenDefinitions) {
        expect(Object.hasOwn(messages[language], `screen.${screen.key}`), `${language}:screen.${screen.key}`).toBe(true);
        expect(i18n.screenTitle(screen.key)).not.toBe(i18n.t("common.unknown"));
      }
    }
  });
  it("has exactly the same locale keys and named placeholders", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ja).sort());
    for (const key of Object.keys(messages.ja) as (keyof typeof messages.ja)[]) {
      const placeholders = (value: string) => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
      expect(placeholders(messages.en[key]), key).toEqual(placeholders(messages.ja[key]));
      expect(key).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/);
    }
  });
  it("translates named values and formats numbers without interpreting user text", () => {
    const t = createTranslator("en");
    expect(t("navigation.paginationSummary", { from: 1, to: 20, total: 1200 })).toBe("1–20 of 1,200");
    expect(t("common.fieldError", { field: "<name>", message: "{untrusted}" })).toBe("<name>: {untrusted}");
  });
  it("uses the locale with Tokyo time even when callers request another timezone", () => {
    const i18n = createI18n("en");
    expect(i18n.formatDate("2026-11-08T18:30:00Z", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", timeZone: "UTC" })).toBe("11/09/2026, 03");
    expect(i18n.formatDate("invalid")).toBe("—");
    expect(i18n.formatDate(null)).toBe("—");
    expect(i18n.formatNumber(1234.5)).toBe("1,234.5");
  });
  it("localizes stable error codes and hides unknown provider text", () => {
    const i18n = createI18n("en");
    expect(i18n.errorMessage("forbidden")).toContain("permission");
    expect(i18n.errorMessage("last_admin_required")).toContain("last company administrator");
    expect(i18n.errorMessage("result_unknown")).toContain("uncertain");
    expect(i18n.errorMessage("internal private detail")).toBe(i18n.t("error.generic"));
    expect(i18n.errorMessage(undefined, { uncertain: true })).toBe(i18n.t("error.uncertain"));
    expect(i18n.fieldError("入力形式を確認してください。")).toBe("Check this field.");
  });
  it("uses explicit enum codes and semantic screen IDs", () => {
    const i18n = createI18n("en");
    expect(i18n.enumLabel("role", "tenant_admin")).toBe("Company administrator");
    expect(i18n.enumLabel("role", "future_role")).toBe("Unknown");
    expect(i18n.screenTitle("vehicle-new")).toBe("Add vehicle");
    expect(i18n.screenTitle("future_screen")).toBe("Unknown");
  });
});
