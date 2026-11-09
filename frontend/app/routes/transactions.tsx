import uiStyles from "../components/ui/ui.module.css";
import { data, Form, Link } from "react-router";
import type { Route } from "./+types/transactions";
import { requireSession, sessionHeaders } from "../lib/auth.server";
import { managementRead } from "../features/management/api.server";
import { transactionListSchema } from "../features/transactions/model";
import { AuthenticatedLayout } from "../components/templates/authenticated-layout";
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
  const query = new URL(request.url).searchParams;
  const result = await managementRead(
    request,
    auth,
    `/api/transactions?${query}`,
    transactionListSchema,
  );
  return data(
    {
      ...result,
      session: auth.session,
      q: query.get("q") ?? "",
      vehicle: query.get("vehicle_id") ?? "",
    },
    { headers: auth.headers },
  );
}
export default function Transactions({ loaderData }: Route.ComponentProps) {
  return (
    <AuthenticatedLayout
      session={loaderData.session}
      title="取引・車両記録"
      groups={[
        {
          id: "transactions",
          label: "取引",
          items: [
            { id: "list", label: "取引一覧", to: "/transactions" },
            { id: "account", label: "アカウント", to: "/account" },
          ],
        },
      ]}
    >
      <div className={uiStyles["ui-stack"]}>
        <PageHeader
          title="取引・車両記録"
          description="権限のある取引と記録版を表示します。"
        />
        <Form method="get">
          <TextField
            id="q"
            name="q"
            label="車種名で検索"
            defaultValue={loaderData.q}
          />
          {loaderData.vehicle && (
            <input type="hidden" name="vehicle_id" value={loaderData.vehicle} />
          )}
          <Button type="submit">検索</Button>
        </Form>
        <Panel title="取引一覧">
          {loaderData.data.map((row) => (
            <p key={row.version_id}>
              <Link to={`/transactions/${row.version_id}/photos`}>
                {row.model_name ?? "車種未登録"} / 第{row.version_no}版 /{" "}
                {row.status === "draft" ? "下書き" : "提出済み"}
              </Link>
            </p>
          ))}
          {!loaderData.data.length && (
            <EmptyState title="参照可能な取引はありません" />
          )}
          <Pagination pagination={loaderData.pagination} />
        </Panel>
      </div>
    </AuthenticatedLayout>
  );
}
