import { data, isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/workspace";
import {
  loadWorkspace,
  mutateWorkspace,
} from "../features/workspace/api.server";
import { WorkspaceProvider } from "../features/workspace/workspace-context";
import { WorkspaceView } from "../features/workspace/workspace-view";
import { EmptyState, Panel } from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  BrandMark,
  useDisplaySettings,
} from "../components/ui/display-settings";

export const headers = sessionHeaders;
export function meta() {
  return [{ title: "ワークスペース | Mobile Tracer" }];
}
export async function loader({ request, params }: Route.LoaderArgs) {
  const path = params["*"] ?? "";
  try {
    return await loadWorkspace(request, path);
  } catch (error) {
    if (
      !path &&
      error instanceof Response &&
      error.status === 302 &&
      ["/login", "/account"].includes(error.headers.get("Location") ?? "")
    )
      return data(
        {
          guest: true as const,
          needsMembership: error.headers.get("Location") === "/account",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
export async function action({ request }: Route.ActionArgs) {
  return mutateWorkspace(request);
}
export default function Workspace({ loaderData }: Route.ComponentProps) {
  const { language } = useDisplaySettings();
  if ("guest" in loaderData)
    return (
      <div className="workspace">
        <header className="landing-header">
          <Link to="/app" className="workspace-logo">
            <BrandMark />
          </Link>
        </header>
        <main className="management-main ui-stack">
          <h1 className="dashboard-title">
            {language === "ja" ? "ダッシュボード" : "Dashboard"}
          </h1>
          <Panel
            title={
              language === "ja" ? "データがありません" : "No data available"
            }
          >
            <p>
              {loaderData.needsMembership
                ? language === "ja"
                  ? "業務データを表示するには、アカウント画面で所属を選択してください。"
                  : "Select a company in your account to view business data."
                : language === "ja"
                  ? "データを表示するには、ログインまたは新規登録が必要です。"
                  : "Sign in or create an account to view your data."}
            </p>
            <div className="ui-actions">
              {loaderData.needsMembership ? (
                <Link className="ui-link-button" to="/account">
                  {language === "ja"
                    ? "アカウント・所属を確認"
                    : "View account and companies"}
                </Link>
              ) : (
                <>
                  <Link className="ui-link-button" to="/login">
                    {language === "ja" ? "ログイン" : "Sign in"}
                  </Link>
                  <Link
                    className="ui-button ui-button--secondary"
                    to="/login?mode=register"
                  >
                    {language === "ja" ? "新規登録" : "Sign up"}
                  </Link>
                </>
              )}
            </div>
          </Panel>
        </main>
      </div>
    );
  return (
    <WorkspaceProvider
      value={{
        mode: "live",
        base: "/app",
        snapshot: loaderData.snapshot,
        csrf: loaderData.csrf,
        email: loaderData.email,
        previewAvailable: loaderData.preview,
      }}
    >
      <WorkspaceView screen={loaderData.screen} />
    </WorkspaceProvider>
  );
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return (
    <main className="ui-standalone ui-stack">
      <Panel>
        <EmptyState
          title={
            status === 404
              ? "対象が見つかりません"
              : status === 403
                ? "表示する権限がありません"
                : status === 400
                  ? "入力・検索条件を確認してください"
                  : "情報を取得できませんでした"
          }
          actions={
            <>
              <Link className="ui-link-button" to="/app">
                ホームへ戻る
              </Link>
              <Link className="ui-text-link" to="/account">
                所属を確認する
              </Link>
            </>
          }
        >
          接続状態と所属を確認し、もう一度お試しください。
        </EmptyState>
      </Panel>
    </main>
  );
}
