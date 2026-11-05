import { useState, type FormEvent } from "react";
import { data } from "react-router";
import type { Route } from "./+types/login";
import { firebaseConfig, sessionHeaders, type FirebaseConfig } from "../lib/auth.server";
import { firebaseAuth } from "../lib/firebase.client";
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";

export const headers = sessionHeaders;
const errors: Record<string, string> = {
  cancelled: "ログインがキャンセルされました。",
  unavailable: "現在ログインを利用できません。",
};
export function meta() { return [{ title: "ログイン | MobilTracer" }]; }
export async function loader({ request }: Route.LoaderArgs) {
  return data({ config: await firebaseConfig(request), error: errors[new URL(request.url).searchParams.get("error") || ""] || "" }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function authError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "ログインがキャンセルされました。";
  if (code === "auth/popup-blocked") return "ポップアップを許可してから、もう一度お試しください。";
  if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") return "パスワードが要件を満たしていません。管理者が設定したパスワードポリシーを確認してください。";
  if (code === "auth/too-many-requests") return "試行回数が多いため、しばらく待ってからお試しください。";
  return "認証できませんでした。入力内容とログイン方法を確認してください。";
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
export function LoginView({ config, error }: { config: FirebaseConfig | null; error: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState(error);
  const [busy, setBusy] = useState(false);
  async function authenticate(google = false) {
    if (!config?.enabled || busy) return;
    setBusy(true); setFailure(""); setMessage("");
    try {
      const auth = await firebaseAuth(config);
      try {
        if (!google && mode === "reset") {
          await sendPasswordResetEmail(auth, email);
          setMessage("登録されたアドレスには、パスワード再設定のメールが届きます。");
          return;
        }
        const credential = google ? await signInWithPopup(auth, new GoogleAuthProvider()) : mode === "register" ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password);
        setPassword("");
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          setMessage("確認メールを送信しました。メール内のリンクで確認を完了し、再度ログインしてください。");
          return;
        }
        await exchange(credential.user);
        window.location.assign("/account");
      } finally { await signOut(auth); }
    } catch (error) { setFailure(authError(error)); }
    finally { setPassword(""); setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void authenticate(); }
  const button = "rounded bg-blue-700 px-5 py-3 text-white disabled:opacity-50";
  return <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
    <p className="text-sm text-gray-500">MobilTracer</p>
    <h1 className="text-3xl font-semibold">ログイン</h1>
    <p>メールアドレスとパスワード、またはGoogleアカウントで認証できます。</p>
    {failure && <p role="alert" className="rounded border border-red-300 p-4">{failure}</p>}
    {message && <p role="status" className="rounded border p-4">{message}</p>}
    {config?.enabled ? <>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">メールアドレス<input className="mt-1 block w-full rounded border p-3" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
        {mode !== "reset" && <label className="block">パスワード<input className="mt-1 block w-full rounded border p-3" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 6 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>}
        <button className={button} type="submit" disabled={busy}>{mode === "register" ? "アカウント登録" : mode === "reset" ? "再設定メールを送信" : "メールアドレスでログイン"}</button>
      </form>
      <div className="flex flex-wrap gap-4">
        <button type="button" className="underline" disabled={busy} onClick={() => { setMode(mode === "register" ? "login" : "register"); setPassword(""); setMessage(""); }}>{mode === "register" ? "ログインに戻る" : "新規登録"}</button>
        <button type="button" className="underline" disabled={busy} onClick={() => { setMode(mode === "reset" ? "login" : "reset"); setPassword(""); setMessage(""); }}>{mode === "reset" ? "ログインに戻る" : "パスワードを忘れた場合"}</button>
      </div>
      <button type="button" className={button} onClick={() => void authenticate(true)} disabled={busy}>Googleでログイン</button>
    </> : <p role="status">ログインの準備ができていません。管理者にお問い合わせください。</p>}
    <p className="text-sm text-gray-500">メールアドレスの確認が必要です。業務機能を使うには、アカウントと担当者の事前の紐付けも必要です。</p>
    <a className="block underline" href="/">ホームへ</a>
  </main>;
}
export default function Login({ loaderData }: Route.ComponentProps) { return <LoginView {...loaderData} />; }
