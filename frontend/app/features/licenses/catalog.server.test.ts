// @vitest-environment node
import { describe, expect, it } from "vitest";
import { licensePage } from "./catalog.server";

const page = (value = "") => licensePage(new Request(`https://app.example/licenses${value}`));

describe("public license catalog pagination", () => {
  it("returns ten entries and retrieves a different next page", () => {
    const first = page(), second = page("?page=2");
    expect(first.pagination).toMatchObject({ page: 1, page_size: 10 });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(10);
    expect(second.data.some(item => first.data.some(previous => previous.id === item.id))).toBe(false);
    expect(JSON.stringify(first)).not.toContain('"inputs"');
  });

  it.each(["abc", "0", "-1", "1.5"])("normalizes an invalid page %s", (value) => {
    expect(page(`?page=${value}`).pagination.page).toBe(1);
  });

  it("clamps overflow to the final page without losing or duplicating entries", () => {
    const { pagination } = page();
    const all = Array.from({ length: Math.ceil(pagination.total / 10) }, (_, i) => page(`?page=${i + 1}`).data).flat();
    expect(new Set(all.map(item => item.id)).size).toBe(pagination.total);
    const last = page("?page=999999");
    expect(last.pagination.page).toBe(Math.ceil(pagination.total / 10));
    expect(last.data).toEqual(all.slice((last.pagination.page - 1) * 10));
    expect(new Set(all.map(item => item.ecosystem))).toEqual(new Set(["npm", "go", "font", "infrastructure"]));
    expect(all.every(item => item.license && item.licenseUrl.startsWith("https://"))).toBe(true);
  });
});
