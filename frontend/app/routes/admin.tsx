import { useI18n } from "../components/ui/display-settings";
import uiStyles from "../components/ui/ui.module.css";
import { z } from "zod";
import {
  data,
  isRouteErrorResponse,
  Link,
  Outlet,
} from "react-router";
import type { Route } from "./+types/admin";
import { EmptyState, Panel } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementRead,
  managementSession,
} from "../features/management/api.server";
import { overviewSchema } from "../features/management/model";

export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true);
  const counts = await managementRead(
    request,
    auth,
    "/api/admin/overview",
    z.object({ data: overviewSchema }),
  );
  return data(
    { email: auth.session.user.email, counts: counts.data },
    { headers: auth.headers },
  );
}
export default function Admin({ loaderData }: Route.ComponentProps) {
  return <Outlet context={loaderData} />;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) { const i18n = useI18n();
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return (
    <div className={uiStyles["ui-stack"]}>
      <Panel>
        <EmptyState
          title={
            status === 403
              ? i18n.t("management.adminRequired")
              : status === 404
                ? i18n.t("management.notFound")
                : i18n.t("management.adminLoadFailed")
          }
          actions={
            <Link className={uiStyles["ui-link-button"]} to="/account">
              {i18n.t("management.backToAccount")}</Link>
          }
        >
          {i18n.t("management.checkConnection")}</EmptyState>
      </Panel>
    </div>
  );
}
