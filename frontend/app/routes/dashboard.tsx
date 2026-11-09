import { data, Link } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import { managementReadPage } from "../features/management/api.server";
import { historyPageSchema } from "../features/history/model";
import { HistoryList } from "../features/history/history-list";
import { settingsNavigation } from "../features/settings/navigation";
import { AuthenticatedLayout } from "../components/templates/authenticated-layout";
import { Panel } from "../components/ui/primitives";
import { useTranslation } from "../components/ui/display-settings";
import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";

export const headers = sessionHeaders;
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.home")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  let auth;
  try { auth = await requireSession(request); }
  catch (error) {
    if (error instanceof Response && error.status === 302 && error.headers.get("Location") === "/login")
      return data({ history: null, session: null }, { headers: { "Cache-Control": "no-store" } });
    throw error;
  }
  const search = new URL(request.url).searchParams;
  const query = new URLSearchParams({ page: search.get("page") || "1", page_size: "20" });
  const history = await managementReadPage(request, auth, `/api/me/history?${query}`, historyPageSchema);
  return data({ history, session: auth.session }, { headers: auth.headers });
}
export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const t = useTranslation();
  return <AuthenticatedLayout title={t("navigation.home")} session={loaderData.session} groups={settingsNavigation(t, loaderData.session)}>
    {loaderData.history ? <HistoryList {...loaderData.history} /> : <Panel title={t("entry.noData")}>
      <p>{t("entry.signInRequired")}</p>
      <Link to="/login">{t("entry.signIn")}</Link>{" · "}<Link to="/login?mode=register">{t("entry.register")}</Link>
    </Panel>}
  </AuthenticatedLayout>;
}
