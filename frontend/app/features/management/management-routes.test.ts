import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, requireSession, type AuthContext } from "../../lib/auth.server";
import { loader as companiesLoader } from "../../routes/admin-companies";
import { loader as myLoader, action as myAction } from "../../routes/my-requests";
import { action as reviewAction } from "../../routes/admin-requests";
import { managementReadPage, managementRequestDetail, managementWrite } from "./api.server";
import { requestsPageSchema, usersPageSchema } from "./model";

vi.mock("../../lib/auth.server", () => ({ apiFetch: vi.fn(), requireSession: vi.fn(), sessionHeaders: vi.fn() }));
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const stamp = "2026-11-08T00:00:00Z";
const company = { id: id(4), name: "Company", status: "active", profile: { legal_name: "Company Inc", description: "", website: "", phone: "", address: "", contact_email: "", business_types: ["rental"] }, version: 3, created_at: stamp };
const requestRow = (number: number, kind = "business_upgrade", status = "pending", companyID: string | null = null) => ({ id: id(number), requester_id: id(1), request_key: id(number + 1000), kind, company_id: companyID, payload: {}, status, created_at: stamp, decided_by: null, decided_at: null, decision_reason: "" });
let auth: AuthContext;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const page = (data: unknown[], pageNumber = 1, total = data.length, size = 20) => ({ data, pagination: { page: pageNumber, page_size: size, total } });
const readRequest = (query = "") => new Request(`https://app.example/account/requests${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  auth = { cookie: "session=secret", headers: new Headers(), session: { user: { id: id(1), email: "user@example.com", email_verified: true, account_type: "business", display_name: "User" }, memberships: [], selected_staff_id: null, system_admin: true, csrf_token: "csrf-token" } };
  vi.mocked(requireSession).mockResolvedValue(auth);
});

describe("management loaders", () => {
  it.each(["", `?company=${id(4)}&view=detail`, `?company=${id(4)}&view=edit`])("does not fetch candidates for company list/detail/edit %s", async query => {
    vi.mocked(apiFetch).mockImplementation(async (_request, path) => json(path.includes(`/companies/${id(4)}`) ? { data: { company, members: [] } } : page([company])));
    await companiesLoader({ request: new Request(`https://app.example/admin/companies${query}`) } as never);
    expect(vi.mocked(apiFetch).mock.calls.every(([, path]) => !path.startsWith("/api/admin/users"))).toBe(true);
    expect(vi.mocked(apiFetch).mock.calls).toHaveLength(1);
  });
  it.each([`?view=new`, `?view=members&company=${id(4)}`])("fetches the chosen candidate page only for membership/create %s", async query => {
    vi.mocked(apiFetch).mockImplementation(async (_request, path) => json(path.includes(`/companies/${id(4)}`) ? { data: { company, members: [] } } : page([], 3, 60)));
    const result = await companiesLoader({ request: new Request(`https://app.example/admin/companies${query}&candidatePage=3&candidate_q=target`) } as never);
    const candidateCall = vi.mocked(apiFetch).mock.calls.find(([, path]) => path.startsWith("/api/admin/users"))!;
    const search = new URL(candidateCall[1], "https://api.example").searchParams;
    expect(Object.fromEntries(search)).toEqual({ account_type: "business", status: "active", page_size: "20", page: "3", q: "target" });
    expect(result.data.candidatePagination?.page).toBe(3);
    expect(vi.mocked(apiFetch).mock.calls.every(([, path]) => !path.startsWith("/api/admin/companies?"))).toBe(true);
  });
  it.each(["upgrade", "new-company", "profile"])("detects pending requests past page 1 independently of displayed history in %s", async view => {
    vi.mocked(apiFetch).mockImplementation(async (_request, path) => {
      if (path === "/api/me/companies") return json({ data: [company] });
      const search = new URL(path, "https://api.example").searchParams;
      expect(search.get("status")).toBe("pending");
      expect(search.get("page_size")).toBe("100");
      return json(search.get("page") === "1" ? page(Array.from({ length: 100 }, (_, i) => requestRow(i + 10, "company_profile_update", "pending", id(99))), 1, 103, 100) : page([requestRow(111, "business_upgrade"), requestRow(112, "company_create"), requestRow(113, "company_profile_update", "pending", company.id)], 2, 103, 100));
    });
    const result = await myLoader({ request: readRequest(`?view=${view}&page=9&company=${company.id}`) } as never);
    expect(result.data.requests).toBeNull();
    expect(result.data.pending).toHaveLength(103);
    expect(result.data.pending.some(row => row.kind === "business_upgrade")).toBe(true);
    expect(result.data.pending.some(row => row.kind === "company_create")).toBe(true);
    expect(result.data.pending.some(row => row.company_id === company.id)).toBe(true);
  });
  it("loads only the selected history page without unrelated companies or candidates", async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(page([requestRow(2, "business_upgrade", "approved")], 2, 21)));
    const result = await myLoader({ request: readRequest("?page=2") } as never);
    expect(result.data.requests?.pagination.page).toBe(2);
    expect(vi.mocked(apiFetch).mock.calls.map(([, path]) => path)).toEqual(["/api/me/requests?page=2"]);
  });
  it("resolves request details independently of the source status filter and page", async () => {
    const target = requestRow(300, "company_create", "approved");
    vi.mocked(apiFetch).mockImplementation(async (_request, path) => json(new URL(path, "https://api.example").searchParams.get("page") === "1" ? page([requestRow(200)], 1, 101, 100) : page([target], 2, 101, 100)));
    expect(await managementRequestDetail(readRequest("?status=pending&page=50"), auth, "/api/admin/requests", target.id)).toEqual(target);
    expect(vi.mocked(apiFetch).mock.calls.every(([, path]) => !path.includes("status="))).toBe(true);
  });
  it("rejects non-admin access before reading management data", async () => {
    auth.session.system_admin = false;
    await expect(companiesLoader({ request: new Request("https://app.example/admin/companies") } as never)).rejects.toMatchObject({ status: 403 });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("management pagination normalization", () => {
  it.each(["0", "-1", "bad", "1.5", "Infinity"])("normalizes invalid page %s before calling the API", async raw => {
    vi.mocked(apiFetch).mockResolvedValue(json(page([])));
    await managementReadPage(readRequest(), auth, `/api/admin/users?page=${raw}&q=hello`, usersPageSchema);
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBe("/api/admin/users?page=1&q=hello");
  });
  it("refetches the last available page once while preserving other filters", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(page([], 999, 41))).mockResolvedValueOnce(json(page([requestRow(2)], 3, 41)));
    const result = await managementReadPage(readRequest(), auth, "/api/me/requests?page=999&status=approved", requestsPageSchema);
    expect(result.pagination.page).toBe(3);
    expect(result.data).toHaveLength(1);
    expect(vi.mocked(apiFetch).mock.calls[1][1]).toBe("/api/me/requests?page=3&status=approved");
    expect(vi.mocked(apiFetch).mock.calls).toHaveLength(2);
  });
  it("normalizes an empty result to page one", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(page([], 999, 0))).mockResolvedValueOnce(json(page([], 1, 0)));
    const result = await managementReadPage(readRequest(), auth, "/api/admin/users?page=999", usersPageSchema);
    expect(result.pagination.page).toBe(1);
  });
});

function post(form: Record<string, string>) {
  return new Request("https://app.example/account/requests?view=profile", { method: "POST", headers: { Origin: "https://app.example", Referer: "https://app.example/account/requests" }, body: new URLSearchParams(form) });
}
describe("management action contracts", () => {
  it("preserves request idempotency keys, company version, CSRF, and origin", async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ data: { id: id(88) } }));
    await myAction({ request: post({ intent: "profileRequest", _csrf: "csrf-token", request_key: id(77), company_id: company.id, version: "3", name: "Updated", legal_name: "Updated Inc", business_types: "rental" }) } as never);
    const [, path, cookie, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe("/api/me/requests");
    expect(cookie).toBe("session=secret");
    expect(init?.headers).toMatchObject({ "X-CSRF-Token": "csrf-token", Origin: "https://app.example", Referer: "https://app.example/account/requests" });
    expect(JSON.parse(init!.body as string)).toMatchObject({ kind: "company_profile_update", request_key: id(77), company_id: company.id, payload: { version: 3, name: "Updated", profile: { legal_name: "Updated Inc", business_types: ["rental"] } } });
  });
  it("preserves the request review action and rejects missing reasons", async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ data: { id: id(88) } }));
    await reviewAction({ request: post({ intent: "decide", _csrf: "csrf-token", request_id: id(88), decision: "rejected", reason: "Please correct the company name" }) } as never);
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBe(`/api/admin/requests/${id(88)}/decision`);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0][3]!.body as string)).toEqual({ decision: "rejected", reason: "Please correct the company name" });
    vi.mocked(apiFetch).mockClear();
    const invalid = await reviewAction({ request: post({ intent: "decide", request_id: id(88), decision: "approved", reason: "" }) } as never);
    expect(invalid.data.code).toBe("validation");
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("retains stable API error codes and marks unknown results", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json({ error: { code: "conflict", message: "競合しました", fields: { name: ["invalid"] } } }, 409));
    const result = await managementWrite(post({}), auth, "/api/me/requests", "csrf-token", {});
    expect(result.data).toMatchObject({ code: "conflict", fields: { name: ["invalid"] } });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("network"));
    expect((await managementWrite(post({}), auth, "/api/me/requests", "csrf-token", {})).data).toMatchObject({ code: "result_unknown", uncertain: true });
  });
});
