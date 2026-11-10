import { VersionDetails } from "../features/workspace/pages/shared";
import uiStyles from "../components/ui/ui.module.css";
import { Link } from "react-router";
import type { Route } from "./+types/transaction-detail";
import { sessionHeaders } from "../lib/auth.server";
import {
  loadTransaction,
  transactionAction,
} from "../features/transactions/api.server";
import { AuthenticatedLayout } from "../components/templates/authenticated-layout";
import { Alert, PageHeader, Panel } from "../components/ui/primitives";
import { PhotoPage } from "../features/transactions/photo-page";
import { PresentationPage } from "../features/transactions/presentation-page";
import { ApprovalPage } from "../features/transactions/approval-page";
import { VerificationPage } from "../features/transactions/verification-page";
import { HistoryPage } from "../features/transactions/history-page";
import { CorrectionPage } from "../features/transactions/correction-page";
import { settingsNavigation } from "../features/settings/navigation";
import { useTranslation } from "../components/ui/display-settings";
const features = [
  "photos",
  "present",
  "approval",
  "verification",
  "history",
  "correct",
] as const;
const names = [
  "写真",
  "顧客へ提示",
  "確認・承認",
  "登録・検証",
  "車両履歴",
  "訂正",
];
export const headers = sessionHeaders;
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!features.includes(params.feature as (typeof features)[number]))
    throw new Response("対象が見つかりません。", { status: 404 });
  return loadTransaction(request, params.versionId);
}
export async function action({ request, params }: Route.ActionArgs) {
  return transactionAction(request, params.versionId);
}
export default function TransactionDetail({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const t = useTranslation();
  const { item, csrf, requestKey, owners, user, session } = loaderData;
  const feedback = actionData as
    | {
        error?: string;
        message?: string;
        result?: string;
      }
    | undefined;
  return (
    <AuthenticatedLayout
      session={session}
      title="取引の確認"
      groups={[
        {
          id: "record",
          label: "記録",
          items: features.map((feature, i) => ({
            id: feature,
            label: names[i],
            to: `/transactions/${params.versionId}/${feature}`,
          })),
        },
        ...settingsNavigation(t, session),
      ]}
    >
      <div className={uiStyles["ui-stack"]}>
        <PageHeader
          title={`${item.content.vehicle.model_name ?? "車両"} / 第${item.content.version.version_no}版`}
        />
        {feedback?.error && <Alert tone="danger">{feedback.error}</Alert>}
        {feedback?.message && <Alert tone="success">{feedback.message}</Alert>}
        <Panel title="提示対象の記録">
          <VersionDetails
            version={{
              ...item.content.version,
              submitted_at: item.content.presented_at,
            }}
          />
          {item.content.version.change_reason && (
            <p>訂正理由：{item.content.version.change_reason}</p>
          )}
          {item.can_manage && item.content.version.status === "draft" && (
            <Link
              to={`/app/cases/${item.content.case.id}/records/${item.content.version.record_id}/edit?version=${params.versionId}`}
            >
              下書きを編集
            </Link>
          )}
        </Panel>
        {params.feature === "photos" && (
          <PhotoPage item={item} csrf={csrf} requestKey={requestKey} />
        )}
        {params.feature === "present" && (
          <PresentationPage item={item} csrf={csrf} requestKey={requestKey} />
        )}
        {params.feature === "approval" && (
          <ApprovalPage
            item={item}
            csrf={csrf}
            userID={user.id}
            now={loaderData.now}
          />
        )}
        {params.feature === "verification" && (
          <VerificationPage item={item} csrf={csrf} result={feedback?.result} />
        )}
        {params.feature === "history" && (
          <HistoryPage item={item} csrf={csrf} owners={owners} />
        )}
        {params.feature === "correct" && (
          <CorrectionPage item={item} csrf={csrf} />
        )}
      </div>
    </AuthenticatedLayout>
  );
}
