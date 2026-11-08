import { Link, useOutletContext } from "react-router";
import { PageHeader, Panel } from "../components/ui/primitives";
import type { z } from "zod";
import type { overviewSchema } from "../features/management/model";

export function meta() {
  return [{ title: "システム管理 | Mobile Tracer" }];
}
export default function AdminOverview() {
  const { counts } = useOutletContext<{
    counts: z.infer<typeof overviewSchema>;
  }>();
  return (
    <>
      <PageHeader
        title="システム管理"
        description="ユーザー・所属企業・企業プロファイルと、すべての申請を管理します。"
      />
      <div className="ui-grid">
        {[
          { label: "ユーザー", value: counts.users, to: "/admin/users" },
          {
            label: "業者ユーザー",
            value: counts.business_users,
            to: "/admin/users?account_type=business",
          },
          { label: "企業", value: counts.companies, to: "/admin/companies" },
          {
            label: "承認待ちの申請",
            value: counts.pending_requests,
            to: "/admin/requests?status=pending",
          },
        ].map((item) => (
          <Panel key={item.label}>
            <div className="workspace-stat">
              <div>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
                <Link className="ui-text-link" to={item.to}>
                  一覧を開く
                </Link>
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <Panel title="申請の審査">
        <p className="ui-muted">
          一般ユーザーから業者ユーザーへの変更、企業・プロファイルの作成、企業プロファイルの変更を一つの申請一覧で審査します。承認・拒否の理由と担当者・日時を記録します。
        </p>
        <Link className="ui-link-button" to="/admin/requests?status=pending">
          承認待ちの申請を確認
        </Link>
      </Panel>
    </>
  );
}
