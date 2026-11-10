import { PageHeader, Alert } from "../components/ui/primitives";
import { useSearchParams } from "react-router";
import type { Route } from "./+types/casework-detail";
import { sessionHeaders } from "../lib/auth.server";
import { loadCasework, caseworkAction } from "../features/casework/api.server";
import { CaseworkLayout } from "../features/casework/shared";
import { StartPage } from "../features/casework/start-page";
import { EventCreatePage } from "../features/casework/event-create-page";
import { EventTimelinePage } from "../features/casework/event-timeline-page";
import { CaseVerificationPage } from "../features/casework/verification-page";
const features = [
  "start",
  "work",
  "report",
  "incident",
  "request",
  "timeline",
  "verification",
];
export const headers = sessionHeaders;
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!features.includes(params.feature))
    throw new Response("対象が見つかりません。", { status: 404 });
  return loadCasework(request, params.caseId);
}
export async function action({ request, params }: Route.ActionArgs) {
  return caseworkAction(request, params.caseId);
}
export default function CaseworkDetail({
  loaderData,
  actionData,
  params,
}: Route.ComponentProps) {
  const { item, session, requestKey, now } = loaderData;
  const [search] = useSearchParams();
  const feedback = actionData as
    | { error?: string; message?: string; result?: { result?: string } }
    | undefined;
  const props = { item, csrf: session.csrf_token, requestKey };
  const caseActions = item.case.status !== "in_progress" ? [] : item.can_manage ? [
    { id: "work", label: "作業を提案", to: `/casework/${item.case.id}/work` },
    { id: "report", label: "進捗を報告", to: `/casework/${item.case.id}/report` },
  ] : item.start.customer_id === session.user.id ? [
    { id: "incident", label: "インシデントを報告", to: `/casework/${item.case.id}/incident` },
    { id: "request", label: "対応を依頼", to: `/casework/${item.case.id}/request` },
  ] : [];
  return (
    <CaseworkLayout session={session} caseID={item.case.id} caseActions={caseActions} title="案件の進行">
      <PageHeader
        title={item.vehicle.model_name ?? "案件の車両"}
        description={`案件の段階：${item.case.stage}`}
      />
      {feedback?.error && <Alert tone="danger">{feedback.error}</Alert>}
      {feedback?.message && <Alert tone="success">{feedback.message}</Alert>}
      {params.feature === "start" && (
        <StartPage {...props} userID={session.user.id} now={now} />
      )}
      {params.feature === "timeline" && (
        <EventTimelinePage {...props} userID={session.user.id} now={now} />
      )}
      {["work", "report", "incident", "request"].includes(params.feature) && (
        <EventCreatePage
          {...props}
          canCustomer={item.start.customer_id === session.user.id}
          kind={
            params.feature === "report"
              ? "progress_report"
              : (params.feature as "work" | "incident" | "request")
          }
          supersedesID={search.get("supersedes") ?? undefined}
          parentID={search.get("parent") ?? undefined}
        />
      )}
      {params.feature === "verification" && (
        <CaseVerificationPage {...props} result={feedback?.result?.result} />
      )}
    </CaseworkLayout>
  );
}
