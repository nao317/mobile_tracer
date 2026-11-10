import { requireSession } from "../lib/auth.server";
import type { Route } from "./+types/location-search";

const cache = new Map<string, { expires: number; data: unknown }>();
export async function loader({ request }: Route.LoaderArgs) {
  if (!(process.env.APP_ENV === "development" && process.env.ENABLE_UI_PREVIEW === "1"))
    await requireSession(request);
  const url = new URL(request.url);
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return Response.json({ error: "地図検索は設定待ちです。GEOAPIFY_API_KEY を設定してください。" }, { status: 503 });
  if (url.searchParams.get("map") === "1") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return Response.json({ error: "位置を確認してください。" }, { status: 400 });
    const upstream = new URL("https://maps.geoapify.com/v1/staticmap");
    upstream.search = new URLSearchParams({ style: "osm-bright", width: "720", height: "360", center: `lonlat:${lon},${lat}`, zoom: "15", marker: `lonlat:${lon},${lat};color:#d33`, apiKey }).toString();
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return Response.json({ error: "地図を表示できませんでした。" }, { status: 502 });
    return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") || "image/png", "Cache-Control": "private, max-age=300" } });
  }
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2 || query.length > 120) return Response.json({ error: "2〜120文字で検索してください。" }, { status: 400 });
  const cached = cache.get(query);
  if (cached && cached.expires > Date.now()) return Response.json({ data: cached.data });
  const upstream = new URL("https://api.geoapify.com/v1/geocode/search");
  upstream.search = new URLSearchParams({ text: query, format: "json", limit: "6", lang: "ja", apiKey }).toString();
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return Response.json({ error: "撮影場所を検索できませんでした。時間をおいて再試行してください。" }, { status: 502 });
    const body = await response.json() as { results?: Array<Record<string, unknown>> };
    const data = (body.results ?? []).flatMap(row => {
      const latitude = Number(row.lat), longitude = Number(row.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [{ name: String(row.name || row.formatted || "検索結果"), address: String(row.formatted || ""), latitude, longitude }];
    });
    if (cache.size >= 100) cache.delete(cache.keys().next().value ?? "");
    cache.set(query, { expires: Date.now() + 5 * 60_000, data });
    return Response.json({ data });
  } catch {
    return Response.json({ error: "撮影場所を検索できませんでした。入力内容は保持されています。" }, { status: 502 });
  }
}
