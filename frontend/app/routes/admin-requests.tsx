import { data, Form, Link } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin-requests";
import { managementRevalidate } from "../features/management/model";
import {
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Textarea,
} from "../components/ui/primitives";
import { sessionHeaders } from "../lib/auth.server";
import {
  managementSession,
  managementRead,
  managementWrite,
  managementQuery,
  validID,
  formString,
} from "../features/management/api.server";
import {
  requestLabels,
  requestStatusLabels,
  requestsPageSchema,
  type ManagementResult,
} from "../features/management/model";
import {
  ActionNotice,
  CSRF,
  ManagementFilters,
  ManagementPagination,
  ManagementSubmit,
  RequestDetails,
  StatusFilter,
} from "../features/management/shared";

export const headers = sessionHeaders;
export const shouldRevalidate = managementRevalidate;
export function meta() {
  return [{ title: "申請の一元管理 | Mobile Tracer" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await managementSession(request, true);
  const page = await managementRead(
    request,
    auth,
    `/api/admin/requests?${managementQuery(request, ["kind"])}`,
    requestsPageSchema,
  );
  return data(
    { page, csrf: auth.session.csrf_token },
    { headers: auth.headers },
  );
}
export async function action({ request }: Route.ActionArgs) {
  const auth = await managementSession(request, true),
    form = await request.formData();
  const parsed = z
    .object({
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      decision: formString(form, "decision"),
      reason: formString(form, "reason"),
    });
  if (formString(form, "intent") !== "decide" || !parsed.success)
    return data<ManagementResult>(
      { error: "承認・拒否と、審査理由を入力してください。" },
      { status: 400, headers: auth.headers },
    );
  return managementWrite(
    request,
    auth,
    `/api/admin/requests/${validID(formString(form, "request_id"))}/decision`,
    formString(form, "_csrf"),
    parsed.data,
  );
}
export default function AdminRequests({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { page, csrf } = loaderData;
  return (
    <>
      <PageHeader
        title="申請の一元管理"
        description="申請内容を確認し、承認または拒否します。審査後の内容と理由は履歴として保持します。"
      />
      <ActionNotice result={actionData} />
      <Panel>
        <ManagementFilters>
          <StatusFilter label="審査状態" values={requestStatusLabels} />
          <StatusFilter name="kind" label="申請種別" values={requestLabels} />
        </ManagementFilters>
      </Panel>
      {page.data.map((request) => (
        <Panel
          key={request.id}
          title={`${requestLabels[request.kind]} / ${request.requester_email || "申請者"}`}
        >
          <RequestDetails request={request} />
          {request.company_id && (
            <p className="mt-4">
              <Link
                className="ui-text-link"
                to={`/admin/companies?company=${request.company_id}`}
              >
                対象企業を確認
              </Link>
            </p>
          )}
          {request.status === "pending" && (
            <Form method="post" className="ui-form mt-5">
              <CSRF token={csrf} intent="decide" />
              <input type="hidden" name="request_id" value={request.id} />
              <Field id={`review-${request.id}`} label="審査理由">
                <Textarea
                  id={`review-${request.id}`}
                  name="reason"
                  required
                  maxLength={2000}
                />
              </Field>
              <label className="workspace-check">
                <input type="checkbox" required />
                申請者・対象・申請内容を確認しました
              </label>
              <div className="ui-actions">
                <ManagementSubmit name="decision" value="approved">
                  承認する
                </ManagementSubmit>
                <ManagementSubmit
                  name="decision"
                  value="rejected"
                  variant="danger"
                >
                  拒否する
                </ManagementSubmit>
              </div>
            </Form>
          )}
        </Panel>
      ))}
      {!page.data.length && (
        <Panel>
          <EmptyState title="該当する申請はありません" />
        </Panel>
      )}
      <ManagementPagination pagination={page.pagination} />
    </>
  );
}
