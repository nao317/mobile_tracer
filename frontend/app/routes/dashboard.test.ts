// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "react-router";
import { loader } from "./dashboard";
import { apiFetch, requireSession } from "../lib/auth.server";
import type { AuthContext } from "../lib/auth.server";

vi.mock("../lib/auth.server", () => ({ apiFetch: vi.fn(), requireSession: vi.fn(), sessionHeaders: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const request = () => ({ request: new Request("https://app.example/app?page=2") }) as never;

describe("home transaction history", () => {
  it("loads persisted history for users without a selected business membership", async () => {
    vi.mocked(requireSession).mockResolvedValue({ headers: new Headers(), cookie: "session=example", session: { selected_staff_id: null } } as AuthContext);
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ data: [], pagination: { page: 2, page_size: 20, total: 21 } }));
    const result = await loader(request());
    expect(result.data.history?.pagination).toEqual({ page: 2, page_size: 20, total: 21 });
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBe("/api/me/history?page=2&page_size=20");
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });
  it("keeps sign-in options available for guests", async () => {
    vi.mocked(requireSession).mockRejectedValue(redirect("/login"));
    const result = await loader(request());
    expect(result.data.history).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("does not replace a history API failure with an empty history", async () => {
    vi.mocked(requireSession).mockResolvedValue({ headers: new Headers(), cookie: "session=example" } as AuthContext);
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(loader(request())).rejects.toMatchObject({ status: 503 });
  });
});
