import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import {
  DisplayControls,
  DisplaySettingsProvider,
  useDisplaySettings,
} from "./components/ui/display-settings";

import type { Route } from "./+types/root";
import "./app.css";

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

export function loader({ request }: Route.LoaderArgs) {
  const cookies = request.headers.get("Cookie") || "";
  return {
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
  const isLogin = useLocation().pathname === "/login";
  return (
    <html lang={language} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {!isLogin && (
          <header className="global-display-bar">
            <DisplayControls />
          </header>
        )}
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
