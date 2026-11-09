import { data, Link } from "react-router";
import type { Route } from "./+types/casework-inbox";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import { managementRead } from "../features/management/api.server";
import { startInboxSchema, labels } from "../features/casework/model";
import { CaseworkLayout } from "../features/casework/shared";
import { PageHeader, Panel } from "../components/ui/primitives";
export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  const result = await managementRead(
    request,
    auth,
    "/api/casework/starts",
    startInboxSchema,
  );
  return data({ ...result, session: auth.session }, { headers: auth.headers });
}
export default function CaseworkInbox({ loaderData }: Route.ComponentProps) {
  return (
    <CaseworkLayout session={loaderData.session} title="開始条件の受信履歴">
      <PageHeader title="開始条件の受信履歴" />
      {loaderData.data.map(({ request, terms }) => (
        <Panel
          key={request.id}
          title={`${terms.vehicle.model_name ?? "車両"} / 条件の第${request.version_no}版`}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>{terms.terms}</p>
          <p>
            回答：{request.decision ? labels[request.decision] : "未回答"} /{" "}
            {request.responded_at ?? "―"}
          </p>
          <Link to={`/casework/${request.case_id}/start`}>
            現在の開始条件へ
          </Link>
        </Panel>
      ))}
    </CaseworkLayout>
  );
}
