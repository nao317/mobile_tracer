import { data, Form, Link } from "react-router";
import type { Route } from "./+types/casework";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import { managementRead } from "../features/management/api.server";
import { caseworkListSchema, labels } from "../features/casework/model";
import { CaseworkLayout } from "../features/casework/shared";
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  TextField,
} from "../components/ui/primitives";
import { Pagination } from "../components/molecules/pagination";
export const headers = sessionHeaders;
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireSession(request);
  const result = await managementRead(
    request,
    auth,
    `/api/casework?${new URL(request.url).searchParams}`,
    caseworkListSchema,
  );
  return data(
    {
      ...result,
      session: auth.session,
      q: new URL(request.url).searchParams.get("q") ?? "",
    },
    { headers: auth.headers },
  );
}
export default function CaseworkList({ loaderData }: Route.ComponentProps) {
  return (
    <CaseworkLayout session={loaderData.session} title="案件一覧">
      <PageHeader
        title="案件一覧"
        description="案件の開始条件と、提案・報告・依頼への回答を確認します。"
      />
      <Form method="get">
        <TextField
          id="q"
          name="q"
          label="車種名で検索"
          defaultValue={loaderData.q}
        />
        <Button type="submit">検索する</Button>
      </Form>
      <Panel title="案件">
        {loaderData.data.map((item) => (
          <p key={item.id}>
            <Link
              to={
                item.has_start
                  ? `/casework/${item.id}/start`
                  : item.status === "awaiting_customer"
                    ? `/casework/new?case=${item.id}`
                    : `/app/cases/${item.id}`
              }
            >
              {item.case_type} / {labels[item.status] ?? item.status} /{" "}
              {item.created_at}
            </Link>
          </p>
        ))}
        {!loaderData.data.length && (
          <EmptyState title="参照できる案件はありません" />
        )}
        <Pagination pagination={loaderData.pagination} />
      </Panel>
    </CaseworkLayout>
  );
}
