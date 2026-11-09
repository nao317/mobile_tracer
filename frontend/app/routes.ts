import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("app", "routes/dashboard.tsx"),
  route("casework", "routes/casework.tsx"),
  route("casework/new", "routes/casework-new.tsx"),
  route("casework/inbox", "routes/casework-inbox.tsx"),
  route("casework/:caseId/:feature", "routes/casework-detail.tsx"),
  route("login", "routes/login.tsx"),
  route("history-shares", "routes/history-shares.tsx"),
  route("transactions", "routes/transactions.tsx"),
  route("transactions/:versionId/:feature", "routes/transaction-detail.tsx"),
  route("account", "routes/account.tsx"),
  route("account/requests", "routes/my-requests.tsx"),
  route("settings", "routes/settings.tsx"),
  route("settings/display", "routes/settings-display.tsx"),
  route("licenses", "routes/licenses.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin-overview.tsx"),
    route("users", "routes/admin-users.tsx"),
    route("companies", "routes/admin-companies.tsx"),
    route("requests", "routes/admin-requests.tsx"),
  ]),
  route("app/*", "routes/workspace.tsx"),
  route("preview/*", "routes/preview.tsx"),
] satisfies RouteConfig;
