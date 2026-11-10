// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loader } from "./location-search";

vi.mock("../lib/auth.server", () => ({ requireSession: vi.fn(async () => ({})) }));
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEOAPIFY_API_KEY; });

describe("location search proxy", () => {
  it("reports configuration state without returning invented results", async () => {
    const response = await loader({ request: new Request("https://app.example/api/location-search?q=Hakata") } as never);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("GEOAPIFY_API_KEY") });
  });

  it("keeps the key server-side and returns only display fields and coordinates", async () => {
    process.env.GEOAPIFY_API_KEY = "secret-key";
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe("api.geoapify.com");
      expect(url.searchParams.get("apiKey")).toBe("secret-key");
      return Response.json({ results: [{ name: "博多駅", formatted: "福岡県福岡市博多区", lat: 33.59, lon: 130.42, internal: "not exposed" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await loader({ request: new Request("https://app.example/api/location-search?q=Hakata") } as never);
    await expect(response.json()).resolves.toEqual({ data: [{ name: "博多駅", address: "福岡県福岡市博多区", latitude: 33.59, longitude: 130.42 }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
