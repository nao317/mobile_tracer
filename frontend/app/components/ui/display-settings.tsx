import appStyles from "../../app.module.css";
import workspaceStyles from "../../features/workspace/workspace.module.css";
import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

import { createI18n, type Language, type Theme } from "../../i18n";
export type { Language, Theme } from "../../i18n";

type Settings = {
  language: Language;
  theme: Theme;
  setLanguage: (v: Language) => void;
  setTheme: (v: Theme) => void;
};
const defaultSettings: Settings = {
  language: "ja",
  theme: "light",
  setLanguage: () => {},
  setTheme: () => {},
};
const SettingsContext = createContext<Settings | null>(null);
export function DisplaySettingsProvider({
  children,
  initialLanguage,
  initialTheme,
}: {
  children: ReactNode;
  initialLanguage: Language;
  initialTheme: Theme;
}) {
  const [language, updateLanguage] = useState(initialLanguage),
    [theme, updateTheme] = useState(initialTheme);
  const save = (key: string, value: string) => {
    document.cookie = `${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  };
  return (
    <SettingsContext
      value={{
        language,
        theme,
        setLanguage: (value) => {
          updateLanguage(value);
          save("mt_locale", value);
        },
        setTheme: (value) => {
          updateTheme(value);
          save("mt_theme", value);
        },
      }}
    >
      {children}
    </SettingsContext>
  );
}
export function useDisplaySettings() {
  return useOptionalDisplaySettings() ?? defaultSettings;
}
/** Standalone consumers may keep their own initial preferences without a provider. */
export function useOptionalDisplaySettings() {
  return use(SettingsContext);
}
export function useI18n() {
  const { language } = useDisplaySettings();
  return useMemo(() => createI18n(language), [language]);
}
export function useTranslation() {
  return useI18n().t;
}
export function DisplayControls() {
  const { language, theme, setLanguage, setTheme } = useDisplaySettings();
  const t = useTranslation();
  return (
    <div
      className={appStyles["global-display-controls"]}
      role="group"
      aria-label={t("display.title")}
    >
      <button
        className={appStyles["global-display-button"]}
        type="button"
        lang={language === "ja" ? "en" : "ja"}
        aria-label={language === "ja" ? "English" : "日本語"}
        onClick={() => setLanguage(language === "ja" ? "en" : "ja")}
      >
        {language === "ja" ? "EN" : "JA"}
      </button>
      <button
        className={appStyles["global-display-button"]}
        type="button"
        aria-label={t(theme === "light" ? "display.darkTheme" : "display.lightTheme")}
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? (
          <Moon size={19} aria-hidden="true" />
        ) : (
          <Sun size={19} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
export function BrandMark() {
  return (
    <span
      className={workspaceStyles["workspace-logo-mark"]}
      translate="no"
      aria-label="Mobile Tracer"
    >
      MT
    </span>
  );
}
