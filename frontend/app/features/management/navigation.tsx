import { Link, useLocation, useSearchParams, type LinkProps } from "react-router";

const viewKeys = ["view", "company", "user", "request", "candidate_q", "candidatePage", "memberPage", "returnTo"];

export function managementReturnTo(value: string | null, pathname: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://management.invalid");
    return url.origin === "https://management.invalid" && url.pathname === pathname ? `${url.pathname}${url.search}` : null;
  } catch { return null; }
}

export function managementLink(pathname: string, search: URLSearchParams, target: string) {
  const back = managementReturnTo(search.get("returnTo"), pathname);
  if (target === pathname) return back ?? pathname;
  if (!target.startsWith("?")) return target;
  const updates = new URLSearchParams(target), next = new URLSearchParams(search);
  const list = new URLSearchParams(search);
  for (const key of viewKeys) list.delete(key);
  if (pathname === "/account/requests" && ["companies", "company", "profile"].includes(search.get("view") ?? "")) {
    list.set("view", "companies");
  }
  const destinationView = updates.get("view");
  if (destinationView === "history" || destinationView === "list" || destinationView === "companies") {
    const defaultView = pathname === "/account/requests" ? "history" : "list";
    if (back && (new URL(back, "https://management.invalid").searchParams.get("view") ?? defaultView) === destinationView) return back;
    if (destinationView === "companies") list.set("view", "companies");
    else list.delete("view");
    return `${pathname}${list.size ? `?${list}` : ""}`;
  }
  // Keep list pagination and filters through all local detail/edit/review views.
  for (const key of ["company", "user", "request"])
    if (updates.has(key)) {
      for (const other of ["company", "user", "request"]) if (other !== key) next.delete(other);
    }
  for (const [key, value] of updates) next.set(key, value);
  next.set("returnTo", back ?? `${pathname}${list.size ? `?${list}` : ""}`);
  return `?${next}`;
}

export function ManagementLink({ to, ...props }: LinkProps) {
  const location = useLocation(), [search] = useSearchParams();
  return <Link {...props} to={typeof to === "string" ? managementLink(location.pathname, search, to) : to} />;
}

export function PreservedQuery({ omit = [] }: { omit?: string[] }) {
  const location = useLocation(), [search] = useSearchParams();
  return [...search].filter(([key]) => !omit.includes(key) && (key !== "returnTo" || managementReturnTo(search.get(key), location.pathname))).map(([key, value], index) => <input key={`${key}:${index}`} type="hidden" name={key} value={value} />);
}

export function clientPage<T>(items: T[], rawPage: string | null, pageSize = 20) {
  const total = items.length, lastPage = Math.max(1, Math.ceil(total / pageSize));
  const parsed = Number(rawPage);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, lastPage) : 1;
  return { data: items.slice((page - 1) * pageSize, page * pageSize), pagination: { page, page_size: pageSize, total } };
}
