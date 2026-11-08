import { describe, expect, it } from "vitest";
import { detailURL, returnURL } from "./return-url";

describe("list return URLs", () => {
  it("retains list search and page without allowing external navigation", () => {
    const list = "/app/cases?q=vehicle&page=4&status=in_progress";
    const detail = new URL(detailURL("/app/cases/one?version=two", list), "http://local");
    expect(detail.searchParams.get("version")).toBe("two");
    expect(returnURL(detail.searchParams.get("returnTo"), "/app/cases")).toBe(list);
  });
  it.each(["https://elsewhere.example", "//elsewhere.example", "/\\elsewhere.example", "/\n/elsewhere.example", "/app/actions", "/login", "/app/../../login"])("rejects %s", value => {
    expect(returnURL(value, "/app/cases")).toBe("/app/cases");
  });
});
