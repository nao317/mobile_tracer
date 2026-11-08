import type { SessionView } from "../../lib/auth.server";
import type { NavigationGroup } from "../../components/templates/authenticated-layout";
import type { useTranslation } from "../../components/ui/display-settings";

export function settingsNavigation(t: ReturnType<typeof useTranslation>, session?: SessionView | null): NavigationGroup[] {
  return [
    { id: "home", label: t("navigation.home"), items: [{ id: "home", label: t("navigation.home"), to: "/app" }] },
    ...(session?.selected_staff_id ? [
      { id: "vehicles", label: t("navigation.vehicles"), items: [{ id: "vehicles", label: t("navigation.vehicles"), to: "/app/vehicles" }] },
      { id: "cases", label: t("navigation.cases"), items: [{ id: "cases", label: t("navigation.cases"), to: "/app/cases" }] },
    ] : []),
    { id: "settings", label: t("navigation.settings"), items: [
      { id: "settings", label: t("navigation.settings"), to: "/settings" },
      { id: "account", label: t("navigation.account"), to: "/account" },
      { id: "display", label: t("navigation.display"), to: "/settings/display" },
      { id: "requests", label: t("navigation.requests"), to: "/account/requests" },
      { id: "company", label: t("entry.myCompanies"), to: "/account/requests?view=companies" },
    ] },
    ...(session?.system_admin ? [{ id: "system", label: t("navigation.systemAdmin"), items: [
      { id: "admin", label: t("navigation.systemAdmin"), to: "/admin" },
      { id: "users", label: t("navigation.users"), to: "/admin/users" },
      { id: "companies", label: t("navigation.companies"), to: "/admin/companies" },
      { id: "review", label: t("navigation.review"), to: "/admin/requests" },
    ] }] : []),
  ];
}
