import { useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { useDisplaySettings } from "../ui/display-settings";
import { Pagination } from "../molecules/pagination";

type Activity = { path: string; title: string; at: string };
export function activityKey(email: string | undefined, preview: boolean) {
  return `mt_activity:${preview ? "preview" : "live"}:${email ?? "guest"}`;
}
export function readActivity(key: string): Activity[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is Activity =>
      item && typeof item.path === "string" && /^\/(app|preview|account|admin|settings)(\/|\?|$)/.test(item.path) &&
      typeof item.title === "string" && typeof item.at === "string" && Number.isFinite(Date.parse(item.at))) : [];
  } catch { return []; }
}
export function recordActivity(key: string, path: string, title: string) {
  try {
    const entries = readActivity(key);
    if (entries[0]?.path === path) return;
    localStorage.setItem(key, JSON.stringify([{ path, title, at: new Date().toISOString() }, ...entries].slice(0, 1000)));
    window.dispatchEvent(new Event("mt-activity"));
  } catch { /* Storage may be disabled. */ }
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("mt-activity", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("mt-activity", listener); };
}
export function ActivityHistory({ storageKey }: { storageKey: string }) {
  const stored = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(storageKey) ?? "[]"; } catch { return "[]"; }
  }, () => "[]");
  const entries = stored === "[]" ? [] : readActivity(storageKey);
  const [search] = useSearchParams();
  const { language } = useDisplaySettings();
  const requested = Number(search.get("page") ?? 1);
  const page = Math.min(Math.max(1, Number.isSafeInteger(requested) ? requested : 1), Math.max(1, Math.ceil(entries.length / 20)));
  return <section>
    <h2>{language === "ja" ? "操作履歴" : "Activity history"}</h2>
    <p>{language === "ja" ? "このブラウザーで閲覧したページの履歴です。" : "Pages you have visited in this browser."}</p>
    {entries.length ? <ol>{entries.slice((page - 1) * 20, page * 20).map((entry, index) => <li key={`${entry.at}-${index}`}>
      <Link to={entry.path}>{entry.title}</Link>{" · "}<time dateTime={entry.at}>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(entry.at))}</time>
    </li>)}</ol> : <p>{language === "ja" ? "操作履歴はまだありません。" : "No activity yet."}</p>}
    <Pagination pagination={{ page, page_size: 20, total: entries.length }} />
  </section>;
}
