// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedPost, firebaseConfig, requireSession, sessionHeaders } from "./auth.server";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.com", email_verified: true };
const session = { user, memberships: [], selected_staff_id: null, system_admin: false, csrf_token: "csrf" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(cookie = "mt_session=firebase-session; mt_csrf=csrf", init: RequestInit = {}) { return new Request("http://app.example/account", { ...init, headers: { Cookie: cookie, ...init.headers } }); }

describe("SSR authentication", () => {
  it("redirects anonymous users without calling the backend", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await requireSession(request("")).catch((e: unknown) => e);
    expect(response).toBeInstanceOf(Response); expect((response as Response).headers.get("Location")).toBe("/login"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards cookies and keeps credentials out of loader data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: session })); vi.stubGlobal("fetch", fetcher);
    const auth = await requireSession(request());
    expect(auth.session).toEqual(session); expect(new Headers(fetcher.mock.calls[0][1].headers).get("Cookie")).toContain("mt_session=firebase-session");
    expect(JSON.stringify(auth.session)).not.toContain("mt_session");
  });
  it("redirects expired Firebase sessions without refreshing credentials", async () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:401}));vi.stubGlobal("fetch",fetcher);
    const response=await requireSession(request()).catch((error: unknown)=>error);
    expect((response as Response).headers.get("Location")).toBe("/login");expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts the existing tenant and staff UUID format", async () => {
    const membership = { tenant_id: "00000000-0000-0000-0000-000000000001", tenant_name: "企業A", staff_id: "00000000-0000-0000-0000-000000000101", display_name: "担当者" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { ...session, memberships: [membership], selected_staff_id: membership.staff_id } })));
    expect((await requireSession(request())).session.memberships).toEqual([membership]);
  });
  it("passes the submitted CSRF token and browser Origin through to mutations", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {} })); vi.stubGlobal("fetch", fetcher);
    const incoming = request(undefined, { method: "POST", headers: { Origin: "https://evil.example" } });
    await authenticatedPost(incoming, { session, cookie: "mt_csrf=csrf", headers: new Headers() }, "/api/auth/logout", "forged");
    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get("Origin")).toBe("https://evil.example"); expect(headers.get("X-CSRF-Token")).toBe("forged");
  });
  it("sets no-store and relays cookies on document responses", () => {
    const source = new Headers({ "Set-Cookie": "mt_session=rotated; HttpOnly; Path=/" });
    const result = new Headers(sessionHeaders({ loaderHeaders: source, actionHeaders: new Headers(), errorHeaders: undefined, parentHeaders: new Headers() }));
    expect(result.get("Cache-Control")).toBe("no-store"); expect(result.getSetCookie()).toHaveLength(1);
  });
  it("does not enable Firebase login on malformed or unavailable configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { enabled: "true" } })));
    expect(await firebaseConfig(request())).toBe(null);
  });
});
