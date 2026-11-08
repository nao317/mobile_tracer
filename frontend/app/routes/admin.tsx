import { z } from "zod";
import {
  data,
  isRouteErrorResponse,
  Link,
  Outlet,
  useLocation,
} from "react-router";
import type { Route } from "./+types/admin";
import { EmptyState, Panel } from "../components/ui/primitives";
import { RouteTabs } from "../features/workspace/route-tabs";
import { BrandMark, useTranslation } from "../components/ui/display-settings";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementRead,
  managementSession,
} from "../features/management/api.server";
import { overviewSchema } from "../features/management/model";

export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true);
  const counts = await managementRead(
    request,
    auth,
    "/api/admin/overview",
    z.object({ data: overviewSchema }),
  );
  return data(
    { email: auth.session.user.email, counts: counts.data },
    { headers: auth.headers },
  );
}
export default function Admin({ loaderData }: Route.ComponentProps) {
  const t = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: "/admin", label: "概要" },
    { to: "/admin/users", label: "ユーザー管理" },
    { to: "/admin/companies", label: "企業・プロファイル管理" },
    { to: "/admin/requests", label: "申請の一元管理" },
  ];
  const activeTo =
    items.slice(1).find((item) => pathname.startsWith(item.to))?.to ?? "/admin";
  return (
    <div className="workspace">
      <a className="ui-skip" href="#management-main">
        本文へ移動
      </a>
      <header className="landing-header">
        <Link className="workspace-logo" to="/admin" translate="no">
          <BrandMark /> <span>{t("システム管理")}</span>
        </Link>
        <div className="ui-actions">
          <span className="ui-muted">{loaderData.email}</span>
          <Link className="ui-text-link" to="/account">
            アカウント
          </Link>
        </div>
      </header>
      <main id="management-main" className="management-main ui-stack">
        <RouteTabs
          label="システム管理の操作"
          items={items}
          activeTo={activeTo}
        />
        <Outlet context={loaderData} />
      </main>
    </div>
  );
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 503;
  return (
    <main className="ui-standalone">
      <Panel>
        <EmptyState
          title={
            status === 403
              ? "システム管理者の権限が必要です"
              : status === 404
                ? "対象が見つかりません"
                : "管理情報を取得できませんでした"
          }
          actions={
            <Link className="ui-link-button" to="/account">
              アカウントへ戻る
            </Link>
          }
        >
          所属・ログイン状態と接続を確認してください。
        </EmptyState>
      </Panel>
    </main>
  );
}
