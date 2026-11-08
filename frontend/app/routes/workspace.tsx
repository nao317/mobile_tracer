import { data, isRouteErrorResponse, Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/workspace";
import {
  loadWorkspace,
  mutateWorkspace,
} from "../features/workspace/api.server";
import { WorkspaceProvider } from "../features/workspace/workspace-context";
import { WorkspaceView } from "../features/workspace/workspace-view";
import { EmptyState, Panel } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  useTranslation,
} from "../components/ui/display-settings";
import { AuthenticatedLayout } from "../components/templates/authenticated-layout";
import { settingsNavigation } from "../features/settings/navigation";
import type { loader as rootLoader } from "../root";
import styles from "../components/ui/ui.module.css";
import { screenTitle } from "../i18n";
import { routeLocale } from "../i18n/route-locale";

export const headers = sessionHeaders;
export function meta({ matches, loaderData }: Route.MetaArgs) {
  return [{ title: `${screenTitle(routeLocale(matches), loaderData && "screen" in loaderData ? loaderData.screen.key : "dashboard")} | Mobile Tracer` }];
}
export async function loader({ request, params }: Route.LoaderArgs) {
  const path = params["*"] ?? "";
  try {
    return await loadWorkspace(request, path);
  } catch (error) {
    if (
      !path &&
      error instanceof Response &&
      error.status === 302 &&
      ["/login", "/account"].includes(error.headers.get("Location") ?? "")
    )
      return data(
        {
          guest: true as const,
          needsMembership: error.headers.get("Location") === "/account",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
export async function action({ request }: Route.ActionArgs) {
  return mutateWorkspace(request);
}
export default function Workspace({ loaderData }: Route.ComponentProps) {
  const t = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  if ("guest" in loaderData)
    return (
      <AuthenticatedLayout session={root?.session} groups={settingsNavigation(t, root?.session)} title={t("navigation.home")}>
          <Panel
            title={t("entry.noData")}
          >
            <p>
              {t(loaderData.needsMembership ? "entry.selectCompany" : "entry.signInRequired")}
            </p>
            <div className={styles["ui-actions"]}>
              {loaderData.needsMembership ? (
                <Link className={styles["ui-link-button"]} to="/account">
                  {t("entry.account")}
                </Link>
              ) : (
                <>
                  <Link className={styles["ui-link-button"]} to="/login">
                    {t("entry.signIn")}
                  </Link>
                  <Link
                    className={`${styles["ui-button"]} ${styles["ui-button--secondary"]}`}
                    to="/login?mode=register"
                  >
                    {t("entry.register")}
                  </Link>
                </>
              )}
            </div>
          </Panel>
          {root?.session && <Link to="/settings">{t("navigation.settings")}</Link>}
      </AuthenticatedLayout>
    );
  return (
    <WorkspaceProvider
      value={{
        mode: "live",
        base: "/app",
        snapshot: loaderData.snapshot,
        csrf: loaderData.csrf,
        email: loaderData.email,
        previewAvailable: loaderData.preview,
      }}
    >
      <WorkspaceView screen={loaderData.screen} />
    </WorkspaceProvider>
  );
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useTranslation();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return (
    <AuthenticatedLayout session={root?.session} groups={settingsNavigation(t, root?.session)}>
      <Panel>
        <EmptyState
          title={
            status === 404
              ? t("error.notFound")
              : status === 403
                ? t("error.forbidden")
                : status === 400
                  ? t("entry.invalid")
                  : t("error.retry")
          }
          actions={
            <>
              <Link className={styles["ui-link-button"]} to="/app">
                {t("entry.home")}
              </Link>
              <Link className={styles["ui-text-link"]} to="/account">
                {t("entry.company")}
              </Link>
            </>
          }
        >
          {t("entry.connection")}
        </EmptyState>
      </Panel>
    </AuthenticatedLayout>
  );
}
