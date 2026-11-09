import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import {
  DisplayControls,
  DisplaySettingsProvider,
  useDisplaySettings,
  useTranslation,
} from "./components/ui/display-settings";
import { requireSession, sessionHeaders, type SessionView } from "./lib/auth.server";
import { AuthenticatedLayout } from "./components/templates/authenticated-layout";
import { settingsNavigation } from "./features/settings/navigation";

import type { Route } from "./+types/root";
import "./app.css";
import styles from "./app.module.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=M+PLUS+Rounded+1c:wght@400;500;700&family=Zen+Dots&display=swap",
  },
];

export const headers = sessionHeaders;
// Session-dependent navigation must refresh when moving between shared routes.
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return currentUrl.pathname !== nextUrl.pathname || defaultShouldRevalidate;
}
export async function loader({ request }: Route.LoaderArgs) {
  const cookies = request.headers.get("Cookie") || "";
  const pathname = new URL(request.url).pathname;
  let session: SessionView | null = null;
  if (!pathname.startsWith("/preview") && pathname !== "/login" && cookies) {
    try { session = (await requireSession(request)).session; }
    // Route loaders enforce authentication; display preferences must also survive
    // a session-service failure so their error boundaries use the selected locale.
    catch { session = null; }
  }
  return {
    session,
    language: /(?:^|;\s*)mt_locale=en(?:;|$)/.test(cookies)
      ? ("en" as const)
      : ("ja" as const),
    theme: /(?:^|;\s*)mt_theme=dark(?:;|$)/.test(cookies)
      ? ("dark" as const)
      : ("light" as const),
  };
}
export function Layout({ children }: { children: React.ReactNode }) {
  const settings = useRouteLoaderData<typeof loader>("root");
  return (
    <DisplaySettingsProvider
      initialLanguage={settings?.language ?? "ja"}
      initialTheme={settings?.theme ?? "light"}
    >
      <Document>{children}</Document>
    </DisplaySettingsProvider>
  );
}
function Document({ children }: { children: React.ReactNode }) {
  const { language, theme } = useDisplaySettings();
  return (
    <html lang={language} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const root = useRouteLoaderData<typeof loader>("root");
  const t = useTranslation();
  const shared = /^\/(account|settings|admin|licenses)(\/|$)/.test(pathname);
  return shared ? <AuthenticatedLayout session={root?.session} groups={settingsNavigation(t, root?.session)} title={t(pathname === "/licenses" ? "navigation.licenses" : pathname.startsWith("/admin") ? "navigation.systemAdmin" : pathname.startsWith("/account/requests") ? "navigation.requests" : pathname === "/account" ? "navigation.account" : pathname === "/settings/display" ? "navigation.display" : "navigation.settings")}><Outlet /></AuthenticatedLayout> : <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useTranslation();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className={styles["error-page"]}>
      <DisplayControls />
      <h1>{notFound ? "404" : t("error.unexpected")}</h1>
      <p>{t(notFound ? "error.notFound" : "error.retry")}</p>
    </main>
  );
}
