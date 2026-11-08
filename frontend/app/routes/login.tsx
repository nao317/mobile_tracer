import { data } from "react-router";
import type { Route } from "./+types/login";
import { firebaseConfig, sessionHeaders } from "../lib/auth.server";
import { LoginView } from "../features/auth/login-view";
import type { Language, Theme } from "../features/auth/messages";
import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
export { LoginView } from "../features/auth/login-view";

export const headers = sessionHeaders;
const errors: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  unavailable: "現在ログインを利用できません。",
};
export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${createTranslator(routeLocale(matches))("entry.signIn")} | Mobile Tracer` }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const initialLanguage: Language = /(?:^|;\s*)mt_locale=en(?:;|$)/.test(
    request.headers.get("Cookie") || "",
  )
    ? "en"
    : "ja";
  const initialTheme: Theme = /(?:^|;\s*)mt_theme=dark(?:;|$)/.test(
    request.headers.get("Cookie") || "",
  )
    ? "dark"
    : "light";
  return data(
    {
      config: await firebaseConfig(request),
      initialLanguage,
      initialTheme,
      initialMode:
        new URL(request.url).searchParams.get("mode") === "register"
          ? ("register" as const)
          : ("login" as const),
      error: errors[new URL(request.url).searchParams.get("error") || ""] || "",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
export default function Login({ loaderData }: Route.ComponentProps) {
  return <LoginView {...loaderData} />;
}
