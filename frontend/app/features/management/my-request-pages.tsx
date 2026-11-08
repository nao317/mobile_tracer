import { useI18n } from "../../components/ui/display-settings";
import uiStyles from "../../components/ui/ui.module.css";
import { Pagination } from "../../components/molecules/pagination";
import { ManagementLink as Link, clientPage } from "./navigation";
import { Form, useSearchParams } from "react-router";
import { Alert, EmptyState, Field, Panel, TextField, Textarea } from "../../components/ui/primitives";
import { CSRF, CompanyDetails, CompanyFields, ManagementPagination, ManagementSubmit, RequestDetails } from "./shared";
import { type Company, type ManagementRequest, type RequestsPage } from "./model";

type RequestFormProps = { pending: ManagementRequest[]; csrf: string; requestKey: string };

export function MyHistoryPage({ requests }: { requests: RequestsPage }) { const i18n = useI18n(); return <Panel title={i18n.t("management.myHistory")}>
{requests.data.length ? <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}><thead><tr><th>{i18n.t("management.requestKind")}</th><th>{i18n.t("management.reviewStatus")}</th><th>{i18n.t("management.requestedAt")}</th></tr></thead><tbody>{requests.data.map(request => <tr key={request.id}>
<td data-label={i18n.t("management.requestKind")}><Link to={`?view=detail&request=${request.id}`}>{i18n.enumLabel("requestKind", request.kind)}</Link></td>
<td data-label={i18n.t("management.reviewStatus")}>{i18n.enumLabel("requestStatus", request.status)}</td><td data-label={i18n.t("management.requestedAt")}>{i18n.formatDate(request.created_at)}</td>
</tr>)}</tbody></table> : <EmptyState title={i18n.t("management.noApplications")} />}
<ManagementPagination pagination={requests.pagination} /></Panel>; }
export function MyRequestDetailPage({ request }: { request: ManagementRequest }) { const i18n = useI18n(); return <Panel title={i18n.enumLabel("requestKind", request.kind)}><RequestDetails request={request} /></Panel>; }
export function UpgradeRequestPage({ pending, csrf, requestKey, user }: RequestFormProps & { user: { display_name?: string } }) { const i18n = useI18n(); return (<Panel title={i18n.t("management.upgradeRequest")}>
            {pending.some((item) => item.kind === "business_upgrade") ? (
              <Alert>
                {i18n.t("management.upgradePending")}</Alert>
            ) : (
              <Form method="post" className={uiStyles["ui-form"]}>
                <CSRF token={csrf} intent="upgradeRequest" />
                <input
                  type="hidden"
                  name="request_key"
                  value={requestKey}
                />
                <TextField
                  id="upgrade-name"
                  name="display_name"
                  label={i18n.t("management.businessDisplayName")}
                  defaultValue={user.display_name ?? ""}
                  maxLength={200}
                  required
                />
                <Field id="upgrade-reason" label={i18n.t("management.upgradeReason")}>
                  <Textarea
                    id="upgrade-reason"
                    name="reason"
                    maxLength={2000}
                    required
                  />
                </Field>
                <ManagementSubmit>{i18n.t("management.applyUpgrade")}</ManagementSubmit>
              </Form>
            )}
</Panel>); }
export function CompanyCreateRequestPage({ pending, csrf, requestKey }: RequestFormProps) { const i18n = useI18n(); return (<Panel title={i18n.t("management.companyCreationRequest")}>
              {pending.some((item) => item.kind === "company_create") ? (
                <Alert>{i18n.t("management.companyCreationPending")}</Alert>
              ) : (
                <Form method="post" className={uiStyles["ui-form"]}>
                  <CSRF token={csrf} intent="companyRequest" />
                  <input
                    type="hidden"
                    name="request_key"
                    value={requestKey}
                  />
                  <CompanyFields />
                  <Alert>
                    {i18n.t("management.companyCreationExplanation")}</Alert>
                  <ManagementSubmit>
                    {i18n.t("management.applyCompanyCreation")}</ManagementSubmit>
                </Form>
              )}
</Panel>); }
export function MyCompaniesPage({ companies }: { companies: Company[] }) { const i18n = useI18n(); const [search] = useSearchParams(); const page = clientPage(companies, search.get("companyPage")); return <Panel title={i18n.t("management.memberCompanies")}>{companies.length ? <ul className={uiStyles["ui-stack"]}>{page.data.map(company => <li key={company.id}><Link className={uiStyles["ui-text-link"]} to={`?view=company&company=${company.id}`}>{company.name}</Link></li>)}</ul> : <EmptyState title={i18n.t("management.noCompanies")}>{i18n.t("management.companyWillAppear")}</EmptyState>}<Pagination pagination={page.pagination} pageKey="companyPage" /></Panel>; }
export function MyCompanyPage({ company }: { company: Company }) { const i18n = useI18n(); return <Panel title={company.name}><CompanyDetails company={company} /><Link className={uiStyles["ui-link-button"]} to={`?view=profile&company=${company.id}`}>{i18n.t("management.applyThisCompanyProfile")}</Link></Panel>; }
export function ProfileRequestPage({ pending, csrf, requestKey, company }: RequestFormProps & { company: Company }) { const i18n = useI18n(); return (<Panel title={i18n.t("management.profileRequestTitle", { company: company.name })}> 
                {company.status !== "active" ? (
                  <Alert>{i18n.t("management.companyNotAcceptingChanges")}</Alert>
                ) : pending.some(
                    (item) =>
                      item.kind === "company_profile_update" &&
                      item.company_id === company.id,
                  ) ? (
                  <Alert>{i18n.t("management.profileChangePending")}</Alert>
                ) : (
                  <Form
                    key={`${company.id}:${company.version}`}
                    method="post"
                    className={uiStyles["ui-form"]}
                  >
                    <CSRF token={csrf} intent="profileRequest" />
                    <input
                      type="hidden"
                      name="request_key"
                      value={requestKey}
                    />
                    <input type="hidden" name="company_id" value={company.id} />
                    <input
                      type="hidden"
                      name="version"
                      value={company.version}
                    />
                    <CompanyFields company={company} />
                    <ManagementSubmit>{i18n.t("management.applyProfileChange")}</ManagementSubmit>
                  </Form>
                )}
</Panel>); }
