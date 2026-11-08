import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
import { useI18n } from "../components/ui/display-settings";
import type { Route } from "./+types/admin-overview";
import uiStyles from "../components/ui/ui.module.css";
import workspaceStyles from "../features/workspace/workspace.module.css";
import { Link, useOutletContext } from "react-router";
import { PageHeader, Panel } from "../components/ui/primitives";
import type { z } from "zod";
import type { overviewSchema } from "../features/management/model";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("navigation.systemAdmin")} | Mobile Tracer` }];
}
export default function AdminOverview() {
  const i18n = useI18n();
  const { counts } = useOutletContext<{
    counts: z.infer<typeof overviewSchema>;
  }>();
  return (
    <>
      <PageHeader
        title={i18n.t("management.adminTitle")}
        description={i18n.t("management.adminDescription")}
      />
      <div className={uiStyles["ui-grid"]}>
        {[
          { label: i18n.t("management.user"), value: counts.users, to: "/admin/users" },
          {
            label: i18n.t("management.businessAccount"),
            value: counts.business_users,
            to: "/admin/users?account_type=business",
          },
          { label: i18n.t("management.company"), value: counts.companies, to: "/admin/companies" },
          {
            label: i18n.t("management.pendingApplications"),
            value: counts.pending_requests,
            to: "/admin/requests?status=pending",
          },
        ].map((item) => (
          <Panel key={item.label}>
            <div className={workspaceStyles["workspace-stat"]}>
              <div>
                <p>{item.label}</p>
                <strong>{i18n.formatNumber(item.value)}</strong>
                <Link className={uiStyles["ui-text-link"]} to={item.to}>
                  {i18n.t("management.openList")}</Link>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <Panel title={i18n.t("management.reviewApplication")}>
        <p className={uiStyles["ui-muted"]}>
          {i18n.t("management.reviewDescription")}</p>
        <Link className={uiStyles["ui-link-button"]} to="/admin/requests?status=pending">
          {i18n.t("management.reviewPending")}</Link>
      </Panel>
    </>
  );
}
