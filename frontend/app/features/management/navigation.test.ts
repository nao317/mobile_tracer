import { describe, expect, it } from "vitest";
import { clientPage, managementLink, managementReturnTo } from "./navigation";

describe("management list navigation", () => {
  it("preserves filters and page through details, edit, and back", () => {
    const source = new URLSearchParams("q=rent&status=active&page=4");
    const detail = managementLink("/admin/companies", source, "?company=company-id&view=detail");
    const search = new URLSearchParams(detail);
    expect(search.get("q")).toBe("rent");
    expect(search.get("page")).toBe("4");
    expect(search.get("status")).toBe("active");
    expect(search.get("returnTo")).toBe("/admin/companies?q=rent&status=active&page=4");
    const edited = new URLSearchParams(managementLink("/admin/companies", search, "?company=company-id&view=edit"));
    expect(managementLink("/admin/companies", edited, "/admin/companies")).toBe("/admin/companies?q=rent&status=active&page=4");
  });
  it.each(["https://evil.example/admin/users", "//evil.example/admin/users", "/\\evil.example/admin/users", "/admin/companies", "/admin/users/other"])("rejects untrusted return destination %s", value => {
    expect(managementReturnTo(value, "/admin/users")).toBeNull();
  });
  it("returns to the owned-company list and selected page after details and profile editing", () => {
    const pathname = "/account/requests";
    const source = new URLSearchParams("view=companies&companyPage=3");
    const detail = new URLSearchParams(managementLink(pathname, source, "?view=company&company=company-id"));
    const destination = "/account/requests?companyPage=3&view=companies";
    expect(detail.get("returnTo")).toBe(destination);
    const profile = new URLSearchParams(managementLink(pathname, detail, "?view=profile&company=company-id"));
    expect(managementLink(pathname, profile, pathname)).toBe(destination);
    expect(managementLink(pathname, profile, "?view=companies")).toBe(destination);
    const history = new URL(managementLink(pathname, profile, "?view=history"), "https://app.example");
    expect(history.searchParams.get("view")).not.toBe("companies");
    expect(history.searchParams.has("company")).toBe(false);
  });
  it("uses the selected client page and clamps invalid or stale pages", () => {
    const items = Array.from({ length: 45 }, (_, index) => index);
    expect(clientPage(items, "2").data).toEqual(items.slice(20, 40));
    expect(clientPage(items, "999").pagination).toEqual({ page: 3, page_size: 20, total: 45 });
    expect(clientPage(items, "invalid").data).toEqual(items.slice(0, 20));
    expect(clientPage([], "999").pagination.page).toBe(1);
  });
});
