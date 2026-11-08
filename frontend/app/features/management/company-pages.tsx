import { useI18n } from "../../components/ui/display-settings";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "../../features/workspace/workspace.module.css";
import { ManagementLink as Link, PreservedQuery, clientPage } from "./navigation";
import { Pagination } from "../../components/molecules/pagination";
import type { Pagination as PaginationData } from "../workspace/model";
import { Form, useSearchParams } from "react-router";
import { Badge, EmptyState, Field, Input, Panel, Select, TextField } from "../../components/ui/primitives";
import { CSRF, CompanyDetails, CompanyFields, ManagementFilters, ManagementPagination, ManagementSubmit, StatusFilter } from "./shared";
import { companyStatusLabels, type Company, type Member, type ManagedUser, type CompaniesPage } from "./model";

type Detail = { company: Company; members: Member[] };

export function CompanyListPage({ page }: { page: CompaniesPage }) { const i18n = useI18n(); return (<>
      <Panel>
        <ManagementFilters>
          <StatusFilter label={i18n.t("management.companyStatus")} values={companyStatusLabels} />
        </ManagementFilters>
      </Panel>
      <Panel title={i18n.t("management.companies")}>
        {page.data.length ? (
          <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}>
            <thead>
              <tr>
                <th>{i18n.t("management.company")}</th>
                <th>{i18n.t("management.legalName")}</th>
                <th>{i18n.t("management.status")}</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((company) => (
                <tr key={company.id}>
                  <td data-label={i18n.t("management.company")}>
                    <Link to={`?company=${company.id}&view=detail`}>{company.name}</Link>
                  </td>
                  <td data-label={i18n.t("management.legalName")}>
                    {company.profile.legal_name || i18n.t("management.unregistered")}
                  </td>
                  <td data-label={i18n.t("management.status")}>
                    <Badge
                      tone={company.status === "active" ? "success" : "warning"}
                    >
                      {i18n.enumLabel("companyStatus", company.status)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={i18n.t("management.noMatchingCompanies")} />
        )}
        <ManagementPagination pagination={page.pagination} />
      </Panel>

</>); }
export function CompanyDetailPage({ company }: { company: Company }) { return <Panel title={company.name}><CompanyDetails company={company} /></Panel>; }
export function CompanyEditPage({ detail, csrf }: { detail: Detail; csrf: string }) { const i18n = useI18n(); return (<Panel title={i18n.t("management.editCompanyProfile")}>
            <Form
              key={`${detail.company.id}:${detail.company.version}`}
              method="post"
              className={uiStyles["ui-form"]}
            >
              <CSRF token={csrf} intent="updateCompany" />
              <input
                type="hidden"
                name="company_id"
                value={detail.company.id}
              />
              <input
                type="hidden"
                name="version"
                value={detail.company.version}
              />
              <CompanyFields company={detail.company} />
              <Field id="company-status" label={i18n.t("management.companyStatus")}>
                <Select
                  id="company-status"
                  name="status"
                  defaultValue={detail.company.status}
                >
                  {Object.keys(companyStatusLabels).map((key) => (
                    <option key={key} value={key}>
                      {i18n.enumLabel("companyStatus", key)}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" required />
                {i18n.t("management.confirmCompanyChanges")}</label>
              <ManagementSubmit>{i18n.t("management.saveCompany")}</ManagementSubmit>
            </Form>
          </Panel>); }
function CandidateSearch() { const i18n = useI18n(); const [search] = useSearchParams(); return (      <Panel title={i18n.t("management.findBusinessUsers")}>
        <Form method="get" className={workspaceStyles["workspace-filter"]}>
          <PreservedQuery omit={["candidate_q", "candidatePage"]} />
          <Field id="candidate-q" label={i18n.t("management.businessUserSearch")}>
            <Input id="candidate-q" name="candidate_q" defaultValue={search.get("candidate_q") ?? ""} maxLength={200} />
          </Field>
          <ManagementSubmit>{i18n.t("management.searchCandidates")}</ManagementSubmit>
        </Form>
        <p className={uiStyles["ui-hint"]}>
          {i18n.t("management.candidateHint")}</p>
      </Panel>
); }
function CandidateOptions({ candidates }: { candidates: ManagedUser[] }) { return candidates.map(user => <option key={user.id} value={user.id}>{user.display_name || user.email} / {user.email}</option>); }
export function CompanyMembersPage({ detail, candidates, candidatePagination, csrf }: { detail: Detail; candidates: ManagedUser[]; candidatePagination: PaginationData; csrf: string }) { const i18n = useI18n(); const [search] = useSearchParams(); const members = clientPage(detail.members, search.get("memberPage")); const options = <CandidateOptions candidates={candidates} />; return (<><CandidateSearch /><Panel title={i18n.t("management.businessMembers")}>
            {detail.members.length ? (
              <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}>
                <thead>
                  <tr>
                    <th>{i18n.t("management.businessUser")}</th>
                    <th>{i18n.t("management.companyRole")}</th>
                    <th>{i18n.t("management.membershipStatus")}</th>
                    <th>{i18n.t("management.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.map((member) => (
                    <tr key={`${member.id}:${member.role}`}>
                      <td data-label={i18n.t("management.businessUser")}>
                        <Link to={`/admin/users?user=${member.user_id}`}>
                          {member.display_name || member.email}
                        </Link>
                        <span className={workspaceStyles["workspace-table-subtitle"]}>
                          {member.email}
                        </span>
                      </td>
                      <td data-label={i18n.t("management.role")}>
                        {i18n.enumLabel("role", member.role)}
                      </td>
                      <td data-label={i18n.t("management.membershipStatus")}>
                        {member.revoked_at ? i18n.t("management.revoked") : i18n.t("management.member")}
                      </td>
                      <td data-label={i18n.t("management.actions")}>
                        {!member.revoked_at && (
                          <details>
                            <summary>{i18n.t("management.revokeMembership")}</summary>
                            <Form method="post" className={uiStyles["ui-form"]}>
                              <CSRF token={csrf} intent="revokeMember" />
                              <input
                                type="hidden"
                                name="company_id"
                                value={detail.company.id}
                              />
                              <input
                                type="hidden"
                                name="link_id"
                                value={member.id}
                              />
                              <TextField
                                id={`revoke-${member.id}-${member.role}`}
                                name="reason"
                                label={i18n.t("management.revokeReason")}
                                maxLength={2000}
                                required
                              />
                              <ManagementSubmit variant="danger">
                                {i18n.t("management.revokeThisMembership")}</ManagementSubmit>
                            </Form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title={i18n.t("management.noBusinessMembers")} />
            )}
            <Pagination pagination={members.pagination} pageKey="memberPage" />
            <Pagination pagination={candidatePagination} pageKey="candidatePage" />
            <details className={workspaceStyles["workspace-details"]}>
              <summary>{i18n.t("management.addBusinessMember")}</summary>
              <Form method="post" className={uiStyles["ui-form"]}>
                <CSRF token={csrf} intent="addMember" />
                <input
                  type="hidden"
                  name="company_id"
                  value={detail.company.id}
                />
                <Field id="member-user" label={i18n.t("management.businessUserToAdd")}>
                  <Select id="member-user" name="user_id" required>
                    <option value="">{i18n.t("management.selectBusinessUser")}</option>
                    {options}
                  </Select>
                </Field>
                <Field id="member-role" label={i18n.t("management.companyRole")}>
                  <Select id="member-role" name="role">
                    <option value="staff">{i18n.t("management.staff")}</option>
                    <option value="tenant_admin">{i18n.t("management.companyAdmin")}</option>
                    <option value="auditor">{i18n.t("management.auditor")}</option>
                  </Select>
                </Field>
                <ManagementSubmit>{i18n.t("management.addMembership")}</ManagementSubmit>
              </Form>
            </details>
          </Panel></>); }
export function CompanyNewPage({ candidates, candidatePagination, csrf }: { candidates: ManagedUser[]; candidatePagination: PaginationData; csrf: string }) { const i18n = useI18n(); const options = <CandidateOptions candidates={candidates} />; return (<><CandidateSearch /><Pagination pagination={candidatePagination} pageKey="candidatePage" /><Panel title={i18n.t("management.directCompanyCreation")}><Form method="post" className={uiStyles["ui-form"]}>
            <CSRF token={csrf} intent="createCompany" />
            <CompanyFields />
            <Field
              id="company-owner"
              label={i18n.t("management.firstCompanyAdmin")}
            >
              <Select id="company-owner" name="owner_user_id" required>
                <option value="">{i18n.t("management.selectBusinessUser")}</option>
                {options}
              </Select>
            </Field>
            <ManagementSubmit>{i18n.t("management.createCompany")}</ManagementSubmit>
</Form></Panel></>); }
