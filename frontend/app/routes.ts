import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("account", "routes/account.tsx"),
  route("account/requests", "routes/my-requests.tsx"),
  route("admin", "routes/admin.tsx", [
    index("routes/admin-overview.tsx"),
    route("users", "routes/admin-users.tsx"),
    route("companies", "routes/admin-companies.tsx"),
    route("requests", "routes/admin-requests.tsx"),
  ]),
  route("app/*", "routes/workspace.tsx"),
  route("preview/*", "routes/preview.tsx"),
] satisfies RouteConfig;
