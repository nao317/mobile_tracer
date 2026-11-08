import { useI18n } from "../../components/ui/display-settings";
import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "../../features/workspace/workspace.module.css";
import { ManagementLink as Link } from "./navigation";
import { Form } from "react-router";
import { EmptyState, Field, Panel, Textarea } from "../../components/ui/primitives";
import { CSRF, ManagementFilters, ManagementPagination, ManagementSubmit, RequestDetails, StatusFilter } from "./shared";
import { requestLabels, requestStatusLabels, type ManagementRequest, type RequestsPage } from "./model";

export function RequestListPage({ page }: { page: RequestsPage }) { const i18n = useI18n(); return <>
<Panel><ManagementFilters>
<StatusFilter enumGroup="requestStatus" label={i18n.t("management.reviewStatus")} values={requestStatusLabels} />
<StatusFilter name="kind" label={i18n.t("management.requestKind")} values={requestLabels} />
</ManagementFilters></Panel>
<Panel title={i18n.t("management.applications")}>{page.data.length ? <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}><thead><tr><th>{i18n.t("management.requestKind")}</th><th>{i18n.t("management.applicant")}</th><th>{i18n.t("management.reviewStatus")}</th><th>{i18n.t("management.requestedAt")}</th></tr></thead><tbody>{page.data.map(request => <tr key={request.id}>
<td data-label={i18n.t("management.requestKind")}><Link to={`?request=${request.id}&view=detail`}>{i18n.enumLabel("requestKind", request.kind)}</Link></td>
<td data-label={i18n.t("management.applicant")}>{request.requester_email || i18n.t("management.applicant")}</td>
<td data-label={i18n.t("management.reviewStatus")}>{i18n.enumLabel("requestStatus", request.status)}</td>
<td data-label={i18n.t("management.requestedAt")}>{i18n.formatDate(request.created_at)}</td>
</tr>)}</tbody></table> : <EmptyState title={i18n.t("management.noMatchingApplications")} />}
<ManagementPagination pagination={page.pagination} /></Panel></>; }
export function RequestDetailPage({ request }: { request: ManagementRequest }) { const i18n = useI18n(); return <Panel title={`${i18n.enumLabel("requestKind", request.kind)} / ${request.requester_email || i18n.t("management.applicant")}`}>
<RequestDetails request={request} />
{request.company_id && <Link className={uiStyles["ui-text-link"]} to={`/admin/companies?company=${request.company_id}`}>{i18n.t("management.viewTargetCompany")}</Link>}
</Panel>; }
export function RequestReviewPage({ request, csrf }: { request: ManagementRequest; csrf: string }) { const i18n = useI18n(); return <>
<RequestDetailPage request={request} />
{request.status === "pending" && <Panel title={i18n.t("management.reviewApplication")}><Form method="post" className={`${uiStyles["ui-form"]} ${appStyles["mt-5"]}`}>
              <CSRF token={csrf} intent="decide" />
              <input type="hidden" name="request_id" value={request.id} />
              <Field id={`review-${request.id}`} label={i18n.t("management.reviewReason")}>
                <Textarea
                  id={`review-${request.id}`}
                  name="reason"
                  required
                  maxLength={2000}
                />
              </Field>
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" required />
                {i18n.t("management.confirmApplication")}</label>
              <div className={uiStyles["ui-actions"]}>
                <ManagementSubmit name="decision" value="approved">
                  {i18n.t("management.approve")}</ManagementSubmit>
                <ManagementSubmit
                  name="decision"
                  value="rejected"
                  variant="danger"
                >
                  {i18n.t("management.reject")}</ManagementSubmit>
              </div>
</Form></Panel>}
</>; }
