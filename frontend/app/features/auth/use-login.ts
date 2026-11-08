import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase.client";
import type { FirebaseConfig } from "../../lib/auth.server";
import { copy, type Language, type Theme, type Failure } from "./messages";
import { useDisplaySettings } from "../../components/ui/display-settings";

function authError(error: unknown): Exclude<Failure, ""> {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  )
    return "cancelled";
  if (code === "auth/popup-blocked") return "popup";
  if (
    code === "auth/weak-password" ||
    code === "auth/password-does-not-meet-requirements"
  )
    return "weak";
  if (code === "auth/too-many-requests") return "rate";
  return "failed";
}
async function exchange(user: User) {
  const challenge = await fetch("/api/auth/login-challenge", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!challenge.ok) throw new Error("challenge failed");
  const body = await challenge.json();
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": body.data.csrf_token,
    },
    body: JSON.stringify({ id_token: await user.getIdToken(true) }),
  });
  if (!response.ok) throw new Error("session failed");
}
export type LoginProps = {
  config: FirebaseConfig | null;
  error: string;
  initialLanguage?: Language;
  initialTheme?: Theme;
  initialMode?: "login" | "register";
};
export function useLogin({
  config,
  error,
  initialLanguage = "ja",
  initialTheme = "light",
  initialMode = "login",
}: LoginProps) {
  const display = useDisplaySettings();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const t = copy[language];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "reset">(initialMode);
  const [message, setMessage] = useState<"verification" | "resetSent" | "">("");
  const [failure, setFailure] = useState<Failure>(
    error === "ログインがキャンセルされました。"
      ? "cancelled"
      : error === "現在ログインを利用できません。"
        ? "authUnavailable"
        : error
          ? "failed"
          : "",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${t.login} | Mobile Tracer`;
  }, [language, t.login]);
  function changeLanguage(next: Language) {
    setLanguage(next);
    display.setLanguage(next);
    document.cookie = `mt_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function changeTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    display.setTheme(next);
    document.cookie = `mt_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  }
  function changeMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setMessage("");
    setFailure("");
  }
  function tabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    current: "login" | "register",
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "login"
        : event.key === "End"
          ? "register"
          : current === "login"
            ? "register"
            : "login";
    changeMode(next);
    document.getElementById(`login-tab-${next}`)?.focus();
  }
  async function authenticate(google = false) {
    if (!config?.enabled || busy) return;
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      const auth = await firebaseAuth(config);
      auth.languageCode = language;
      try {
        if (!google && mode === "reset") {
          await sendPasswordResetEmail(auth, email);
          setMessage("resetSent");
          return;
        }
        const credential = google
          ? await signInWithPopup(auth, new GoogleAuthProvider())
          : mode === "register"
            ? await createUserWithEmailAndPassword(auth, email, password)
            : await signInWithEmailAndPassword(auth, email, password);
        setPassword("");
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          setMode("login");
          setMessage("verification");
          return;
        }
        await exchange(credential.user);
        window.location.assign("/account");
      } finally {
        await signOut(auth);
      }
    } catch (error) {
      setFailure(authError(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void authenticate();
  }
  const submitLabel =
    mode === "register" ? t.create : mode === "reset" ? t.reset : t.login;
  const activeTab = mode === "register" ? "register" : "login";
  return {
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
  };
}
