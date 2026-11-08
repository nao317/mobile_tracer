import { useDisplaySettings, useTranslation } from "../components/ui/display-settings";
import { Field, Select } from "../components/ui/primitives";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import styles from "../features/settings/display.module.css";
import type { Route } from "./+types/settings-display";
import { createTranslator } from "../i18n";
import { routeLocale } from "../i18n/route-locale";
export function meta({ matches }: Route.MetaArgs) { return [{ title: `${createTranslator(routeLocale(matches))("navigation.display")} | Mobile Tracer` }]; }
export const headers = sessionHeaders;
export async function loader({ request }: { request: Request }) { const auth = await requireSession(request); return new Response(null, { headers: auth.headers }); }
export default function DisplaySettings() {
  const t = useTranslation();
  const { language, theme, setLanguage, setTheme } = useDisplaySettings();
  return <div className={styles.form}>
    <Field id="display-locale" label={t("navigation.language")}><Select id="display-locale" value={language} onChange={event => setLanguage(event.target.value as "ja" | "en")}><option value="ja">日本語</option><option value="en">English</option></Select></Field>
    <Field id="display-theme" label={t("navigation.theme")}><Select id="display-theme" value={theme} onChange={event => setTheme(event.target.value as "light" | "dark")}><option value="light">{t("navigation.light")}</option><option value="dark">{t("navigation.dark")}</option></Select></Field>
  </div>;
}
