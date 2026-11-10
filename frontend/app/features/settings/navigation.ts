import type { SessionView } from "../../lib/auth.server";
import type { NavigationGroup } from "../../components/templates/authenticated-layout";
import type { useTranslation } from "../../components/ui/display-settings";

export function settingsNavigation(t: ReturnType<typeof useTranslation>, session?: SessionView | null): NavigationGroup[] {
  return [
    { id: "home", label: t("navigation.home"), items: [{ id: "home", label: t("navigation.home"), to: "/app" }] },
    ...(session ? [
      { id: "cases", label: t("navigation.cases"), items: [
        ...(session.selected_staff_id ? [
          { id: "cases", label: t("navigation.caseRecords"), to: "/app/cases" },
        ] : []),
        { id: "casework", label: t("navigation.caseworkList"), to: "/casework" },
        { id: "casework-inbox", label: t("navigation.caseworkInbox"), to: "/casework/inbox" },
        ...(session.user.account_type === "business" && session.selected_staff_id ? [
          { id: "casework-new", label: t("navigation.caseworkNew"), to: "/casework/new" },
        ] : []),
      ] },
      { id: "transactions", label: t("navigation.transactions"), items: [
        ...(session.selected_staff_id ? [
          { id: "vehicles", label: t("screen.vehicles"), to: "/app/vehicles" },
        ] : []),
        { id: "transactions", label: t("navigation.transactionList"), to: "/transactions" },
        { id: "history-shares", label: t("navigation.sharedHistory"), to: "/history-shares" },
      ] },
    ] : []),
    { id: "settings", label: t("navigation.settings"), items: [
      { id: "settings", label: t("navigation.settings"), to: "/settings" },
      { id: "account", label: t("navigation.account"), to: "/account" },
      { id: "display", label: t("navigation.display"), to: "/settings/display" },
      { id: "requests", label: t("navigation.requests"), to: "/account/requests" },
      { id: "company", label: t("entry.myCompanies"), to: "/account/requests?view=companies" },
    ] },
    { id: "licenses", label: t("navigation.licenses"), items: [{ id: "licenses", label: t("navigation.licenses"), to: "/licenses" }] },
    ...(session?.system_admin ? [{ id: "system", label: t("navigation.systemAdmin"), items: [
      { id: "admin", label: t("navigation.systemAdmin"), to: "/admin" },
      { id: "users", label: t("navigation.users"), to: "/admin/users" },
      { id: "companies", label: t("navigation.companies"), to: "/admin/companies" },
      { id: "review", label: t("navigation.review"), to: "/admin/requests" },
    ] }] : []),
  ];
}
