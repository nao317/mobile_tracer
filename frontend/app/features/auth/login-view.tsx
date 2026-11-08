import styles from "./auth.module.css";
import { LockKeyhole, Mail, Moon, Sun } from "lucide-react";
import { Alert, Button, TextField } from "../../components/ui/primitives";
import SplitText from "../../components/ui/split-text";
import { useLogin, type LoginProps } from "./use-login";

export function LoginView(props: LoginProps) {
  const {
    language,
    theme,
    t,
    email,
    setEmail,
    password,
    setPassword,
    mode,
    message,
    failure,
    busy,
    changeLanguage,
    changeTheme,
    changeMode,
    tabKey,
    authenticate,
    submit,
    submitLabel,
    activeTab,
  } = useLogin(props);
  const { config } = props;
  return (
    <main className={styles["login-page"]} lang={language} data-theme={theme}>
      <section className={styles["login-shell"]} aria-labelledby="login-title">
        <header className={styles["login-header"]}>
          <SplitText
            id="login-title"
            className={styles["login-brand"]}
            tag="h1"
            text="Mobile Tracer"
            trigger="load"
            delay={180}
            duration={1.4}
          />
          <div
            className={styles["login-display-controls"]}
            role="group"
            aria-label={t.settings}
          >
            <Button
              type="button"
              className={styles["login-display-button"]}
              lang={language === "ja" ? "en" : "ja"}
              aria-label={language === "ja" ? "English" : "日本語"}
              title={language === "ja" ? "English" : "日本語"}
              onClick={() => changeLanguage(language === "ja" ? "en" : "ja")}
            >
              {language === "ja" ? "EN" : "JA"}
            </Button>
            <Button
              type="button"
              className={styles["login-display-button"]}
              aria-label={theme === "light" ? t.dark : t.light}
              title={theme === "light" ? t.dark : t.light}
              onClick={changeTheme}
            >
              {theme === "light" ? (
                <Moon size={19} aria-hidden="true" />
              ) : (
                <Sun size={19} aria-hidden="true" />
              )}
            </Button>
          </div>
        </header>
        {config?.enabled ? (
          <div className={styles["login-card"]}>
            <div className={styles["login-tabs"]} role="tablist" aria-label={t.tabs}>
              {(["login", "register"] as const).map((tab) => (
                <Button
                  key={tab}
                  className={styles["login-tab"]}
                  type="button"
                  role="tab"
                  id={`login-tab-${tab}`}
                  aria-controls="login-panel"
                  aria-selected={activeTab === tab}
                  tabIndex={activeTab === tab ? 0 : -1}
                  disabled={busy}
                  onClick={() => changeMode(tab)}
                  onKeyDown={(event) => tabKey(event, tab)}
                >
                  {t[tab]}
                </Button>
              ))}
            </div>
            <div
              className={styles["login-panel"]}
              id="login-panel"
              role="tabpanel"
              aria-labelledby={`login-tab-${activeTab}`}
            >
              {mode === "reset" && (
                <h2 className={styles["login-reset-title"]}>{t.resetTitle}</h2>
              )}
              <form className={styles["login-form"]} onSubmit={submit} aria-busy={busy}>
                <TextField
                  appearance="login"
                  id="login-email"
                  name="email"
                  label={t.emailLabel}
                  icon={<Mail size={20} aria-hidden="true" />}
                  type="email"
                  aria-label={t.email}
                  autoComplete="email"
                  spellCheck={false}
                  placeholder={t.email}
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
                {mode !== "reset" && (
                  <TextField
                    appearance="login"
                    id="login-password"
                    name="password"
                    label={t.password}
                    icon={<LockKeyhole size={20} aria-hidden="true" />}
                    type="password"
                    aria-label={t.password}
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    placeholder={t.password}
                    required
                    minLength={mode === "register" ? 6 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
                )}
                <Button
                  className={styles["login-primary-button"]}
                  type="submit"
                  disabled={busy}
                >
                  {busy ? t.busy : submitLabel}
                </Button>
              </form>
              {failure && (
                <Alert
                  tone="danger"
                  className={styles["login-feedback"] + " " + styles["login-feedback--error"]}
                >
                  {t[failure]}
                </Alert>
              )}
              {message && (
                <Alert className={styles["login-feedback"]}>{t[message]}</Alert>
              )}
              <div className={styles["login-secondary-actions"]}>
                <Button
                  type="button"
                  className={styles["login-google-button"]}
                  onClick={() => void authenticate(true)}
                  disabled={busy}
                >
                  <img
                    className={styles["login-google-logo"]}
                    src="/assets/login/google-g.png"
                    alt=""
                    width="200"
                    height="204"
                    aria-hidden="true"
                  />
                  <span>
                    {busy
                      ? t.busy
                      : mode === "register"
                        ? t.googleRegister
                        : t.google}
                  </span>
                </Button>
                <div className={styles["login-text-actions"]}>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      changeMode(mode === "reset" ? "login" : "reset")
                    }
                  >
                    {mode === "reset" ? t.back : t.forgot}
                  </Button>
                </div>
                <a className={styles["login-home-link"]} href="/">
                  {t.home}
                </a>
              </div>
            </div>
          </div>
        ) : (
          <>
            {failure && (
              <Alert
                tone="danger"
                className={styles["login-feedback"] + " " + styles["login-feedback--error"]}
              >
                {t[failure]}
              </Alert>
            )}
            <Alert className={styles["login-unavailable"]}>{t.unavailable}</Alert>
          </>
        )}
      </section>
    </main>
  );
}
