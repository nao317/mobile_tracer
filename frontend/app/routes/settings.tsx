import { Link, useRouteLoaderData } from "react-router";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import { useTranslation } from "../components/ui/display-settings";
import { settingsNavigation } from "../features/settings/navigation";
import type { loader as rootLoader } from "../root";
import styles from "../components/templates/authenticated-layout.module.css";
import type { Route } from "./+types/settings";
import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
export function meta({ matches }: Route.MetaArgs) { return [{ title: `${createTranslator(routeLocale(matches))("navigation.settings")} | Mobile Tracer` }]; }
export const headers = sessionHeaders;
export async function loader({ request }: { request: Request }) { const auth = await requireSession(request); return new Response(null, { headers: auth.headers }); }
export default function Settings() {
  const t = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return <div>{settingsNavigation(t, root?.session).filter(group => ["settings", "system"].includes(group.id)).map(group => <section key={group.id}>{group.id === "system" && <h2>{group.label}</h2>}{group.items.filter(item => item.to !== "/settings").map(item => <Link className={styles.link} to={item.to} key={item.id}>{item.label}</Link>)}</section>)}</div>;
}
