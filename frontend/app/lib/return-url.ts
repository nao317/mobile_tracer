const allowed = /^\/(?:app|preview|account|settings|admin)(?:\/|\?|$)/;

/** Only retain a same-app path, never a network URL or an action endpoint. */
export function returnURL(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return fallback;
  try {
    const url = new URL(value, "http://mobile-tracer.invalid");
    if (url.origin !== "http://mobile-tracer.invalid" || !allowed.test(url.pathname) || url.pathname === "/app/actions") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function detailURL(path: string, listURL: string): string {
  const url = new URL(path, "http://mobile-tracer.invalid");
  url.searchParams.set("returnTo", returnURL(listURL, "/app"));
  return `${url.pathname}${url.search}`;
}
