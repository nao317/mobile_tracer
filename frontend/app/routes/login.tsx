import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { data } from "react-router";
import { LockKeyhole, Mail, Moon, Sun } from "lucide-react";
import type { Route } from "./+types/login";
import { firebaseConfig, sessionHeaders, type FirebaseConfig } from "../lib/auth.server";
import { firebaseAuth } from "../lib/firebase.client";
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";

export const headers = sessionHeaders;
const errors: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  unavailable: "現在ログインを利用できません。",
};
export function meta() { return [{ title: "ログイン | Mobile Tracer" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  const initialLanguage: Language = /(?:^|;\s*)mt_locale=en(?:;|$)/.test(request.headers.get("Cookie") || "") ? "en" : "ja";
  const initialTheme: Theme = /(?:^|;\s*)mt_theme=dark(?:;|$)/.test(request.headers.get("Cookie") || "") ? "dark" : "light";
  return data({ config: await firebaseConfig(request), initialLanguage, initialTheme, error: errors[new URL(request.url).searchParams.get("error") || ""] || "" }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
const copy = {
  ja: {
    dark: "ダークテーマに切り替え", light: "ライトテーマに切り替え", settings: "表示設定",
    login: "ログイン", register: "新規登録", create: "アカウント登録", reset: "再設定メールを送信",
    tabs: "アカウントへのアクセス", emailLabel: "ログインID", email: "メールアドレス", password: "パスワード",
    busy: "処理中…", google: "Googleでログイン", googleRegister: "Googleで登録",
    forgot: "パスワードを忘れた場合", back: "ログインに戻る", resetTitle: "パスワードの再設定",
    home: "ホームへ", unavailable: "ログインの準備ができていません。管理者にお問い合わせください。",
    verification: "確認メールを送信しました。メール内のリンクで確認を完了し、再度ログインしてください。",
    resetSent: "登録されたアドレスには、パスワード再設定のメールが届きます。",
    cancelled: "ログインがキャンセルされました。", authUnavailable: "現在ログインを利用できません。",
    popup: "ポップアップを許可してから、もう一度お試しください。",
    weak: "パスワードが要件を満たしていません。管理者が設定したパスワードポリシーを確認してください。",
    rate: "試行回数が多いため、しばらく待ってからお試しください。",
    failed: "認証できませんでした。入力内容とログイン方法を確認してください。",
  },
  en: {
    dark: "Switch to dark theme", light: "Switch to light theme", settings: "Display settings",
    login: "Sign in", register: "Sign up", create: "Create account", reset: "Send reset email",
    tabs: "Account access", emailLabel: "Email address", email: "Email address", password: "Password",
    busy: "Please wait…", google: "Sign in with Google", googleRegister: "Sign up with Google",
    forgot: "Forgot password?", back: "Back to sign in", resetTitle: "Reset your password",
    home: "Back to home", unavailable: "Sign-in is not available yet. Please contact your administrator.",
    verification: "Verification email sent. Follow the link in your email, then sign in again.",
    resetSent: "If this address is registered, you will receive a password reset email.",
    cancelled: "Sign-in was cancelled.", authUnavailable: "Sign-in is currently unavailable.",
    popup: "Allow pop-ups, then try again.",
    weak: "Your password does not meet the requirements. Check the password policy set by your administrator.",
    rate: "Too many attempts. Please wait and try again.",
    failed: "Authentication failed. Check your details and sign-in method.",
  },
} as const;
type Language = keyof typeof copy;
type Theme = "light" | "dark";
type Failure = "cancelled" | "authUnavailable" | "popup" | "weak" | "rate" | "failed" | "";
function authError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "cancelled";
  if (code === "auth/popup-blocked") return "popup";
  if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") return "weak";
  if (code === "auth/too-many-requests") return "rate";
  return "failed";
}
async function exchange(user: User) {
  const challenge = await fetch("/api/auth/login-challenge", { credentials: "same-origin", cache: "no-store" });
  if (!challenge.ok) throw new Error("challenge failed");
  const body = await challenge.json();
  const response = await fetch("/api/auth/session", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": body.data.csrf_token },
    body: JSON.stringify({ id_token: await user.getIdToken(true) }),
  });
  if (!response.ok) throw new Error("session failed");
}
export function LoginView({ config, error, initialLanguage = "ja", initialTheme = "light" }: { config: FirebaseConfig | null; error: string; initialLanguage?: Language; initialTheme?: Theme }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = copy[language];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [message, setMessage] = useState<"verification" | "resetSent" | "">("");
  const [failure, setFailure] = useState<Failure>(error === errors.cancelled ? "cancelled" : error === errors.unavailable ? "authUnavailable" : error ? "failed" : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${t.login} | Mobile Tracer`;
  }, [language, t.login]);
  function changeLanguage(next: Language) {
    setLanguage(next);
    document.cookie = `mt_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function changeTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.cookie = `mt_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function changeMode(next: typeof mode) {
    setMode(next); setPassword(""); setMessage(""); setFailure("");
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: "login" | "register") {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "login" : event.key === "End" ? "register" : current === "login" ? "register" : "login";
    changeMode(next);
    document.getElementById(`login-tab-${next}`)?.focus();
  }
  async function authenticate(google = false) {
    if (!config?.enabled || busy) return;
    setBusy(true); setFailure(""); setMessage("");
    try {
      const auth = await firebaseAuth(config);
      auth.languageCode = language;
      try {
        if (!google && mode === "reset") {
          await sendPasswordResetEmail(auth, email);
          setMessage("resetSent");
          return;
        }
        const credential = google ? await signInWithPopup(auth, new GoogleAuthProvider()) : mode === "register" ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password);
        setPassword("");
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          setMode("login");
          setMessage("verification");
          return;
        }
        await exchange(credential.user);
        window.location.assign("/account");
      } finally { await signOut(auth); }
    } catch (error) { setFailure(authError(error)); }
    finally { setPassword(""); setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void authenticate(); }
  const submitLabel = mode === "register" ? t.create : mode === "reset" ? t.reset : t.login;
  const activeTab = mode === "register" ? "register" : "login";
  return <main className="login-page" lang={language} data-theme={theme}>
    <section className="login-shell" aria-labelledby="login-title">
      <header className="login-header">
        <h1 id="login-title" className="login-brand" translate="no">Mobile Tracer</h1>
        <div className="login-display-controls" role="group" aria-label={t.settings}>
          <button type="button" className="login-display-button" lang={language === "ja" ? "en" : "ja"} aria-label={language === "ja" ? "English" : "日本語"} title={language === "ja" ? "English" : "日本語"} onClick={() => changeLanguage(language === "ja" ? "en" : "ja")}>{language === "ja" ? "EN" : "JA"}</button>
          <button type="button" className="login-display-button" aria-label={theme === "light" ? t.dark : t.light} title={theme === "light" ? t.dark : t.light} onClick={changeTheme}>
            {theme === "light" ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          </button>
        </div>
      </header>
      {config?.enabled ? <>
        <div className="login-tabs" role="tablist" aria-label={t.tabs}>
          {(["login", "register"] as const).map((tab) => <button key={tab} type="button" role="tab" id={`login-tab-${tab}`} aria-controls="login-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} disabled={busy} onClick={() => changeMode(tab)} onKeyDown={(event) => tabKey(event, tab)}>{t[tab]}</button>)}
        </div>
        <div className="login-panel" id="login-panel" role="tabpanel" aria-labelledby={`login-tab-${activeTab}`}>
        {mode === "reset" && <h2 className="login-reset-title">{t.resetTitle}</h2>}
        <form className="login-form" onSubmit={submit} aria-busy={busy}>
          <div className="login-field-group">
            <label className="login-label" htmlFor="login-email">{t.emailLabel}</label>
            <div className="login-input-frame">
              <span className="login-icon-slot" aria-hidden="true">
                <Mail size={20} aria-hidden="true" />
              </span>
              <input
                id="login-email"
                className="login-input"
                type="email"
                aria-label={t.email}
                autoComplete="email"
                placeholder={t.email}
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          {mode !== "reset" && <div className="login-field-group">
            <label className="login-label" htmlFor="login-password">{t.password}</label>
            <div className="login-input-frame">
              <span className="login-icon-slot login-icon-slot--lock" aria-hidden="true">
                <LockKeyhole size={20} aria-hidden="true" />
              </span>
              <input
                id="login-password"
                className="login-input"
                type="password"
                aria-label={t.password}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                placeholder={t.password}
                required
                minLength={mode === "register" ? 6 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </div>
          </div>}
          <button className="login-primary-button" type="submit" disabled={busy}>
            {busy ? t.busy : submitLabel}
          </button>
        </form>
        {failure && <p role="alert" className="login-feedback login-feedback--error">{t[failure]}</p>}
        {message && <p role="status" className="login-feedback">{t[message]}</p>}
        <div className="login-secondary-actions">
          <button type="button" className="login-google-button" onClick={() => void authenticate(true)} disabled={busy}>
            <img className="login-google-logo" src="/assets/login/google-g.png" alt="" width="200" height="204" aria-hidden="true" />
            <span>{busy ? t.busy : mode === "register" ? t.googleRegister : t.google}</span>
          </button>
          <div className="login-text-actions">
            <button type="button" disabled={busy} onClick={() => changeMode(mode === "reset" ? "login" : "reset")}>{mode === "reset" ? t.back : t.forgot}</button>
          </div>
          <a className="login-home-link" href="/">{t.home}</a>
        </div>
        </div>
      </> : <p role="status" className="login-unavailable">{t.unavailable}</p>}
    </section>
  </main>;
}
export default function Login({ loaderData }: Route.ComponentProps) { return <LoginView {...loaderData} />; }
