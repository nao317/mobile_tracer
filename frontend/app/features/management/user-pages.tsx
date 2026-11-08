import { useI18n } from "../../components/ui/display-settings";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "../../features/workspace/workspace.module.css";
import { Pagination } from "../../components/molecules/pagination";
import { ManagementLink as Link, clientPage } from "./navigation";
import { Form, useSearchParams } from "react-router";
import { Alert, Badge, EmptyState, Field, Panel, Select, TextField } from "../../components/ui/primitives";
import { CSRF, CompanyDetails, ManagementFilters, ManagementPagination, ManagementSubmit, StatusFilter } from "./shared";
import { accountLabels, type Company, type ManagedUser, type UsersPage } from "./model";
type Detail = { user: ManagedUser; companies: Company[] };
export function UserListPage({ page }: { page: UsersPage }) { const i18n = useI18n(); return (<>      <Panel>
        <ManagementFilters>
          <StatusFilter
            name="account_type"
            label={i18n.t("management.accountType")}
            values={accountLabels}
          />
          <StatusFilter
            label={i18n.t("management.accountStatus")}
            values={{ active: i18n.t("management.active"), suspended: i18n.t("management.suspended") }}
          />
        </ManagementFilters>
      </Panel>
      <Panel title={i18n.t("management.users")}>
        {page.data.length ? (
          <table className={`${uiStyles["ui-table"]} ${uiStyles["ui-table--responsive"]}`}>
            <thead>
              <tr>
                <th>{i18n.t("management.user")}</th>
                <th>{i18n.t("management.type")}</th>
                <th>{i18n.t("management.status")}</th>
                <th>{i18n.t("management.emailVerification")}</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((user) => (
                <tr key={user.id}>
                  <td data-label={i18n.t("management.user")}>
                    <Link to={`?user=${user.id}&view=detail`}>
                      {user.display_name || user.email || i18n.t("management.displayNameUnset")}
                    </Link>
                    <span className={workspaceStyles["workspace-table-subtitle"]}>
                      {user.email}
                    </span>
                  </td>
                  <td data-label={i18n.t("management.type")}>{i18n.enumLabel("accountType", user.account_type)}</td>
                  <td data-label={i18n.t("management.status")}>
                    <Badge
                      tone={user.status === "active" ? "success" : "warning"}
                    >
                      {user.status === "active" ? i18n.t("management.active") : i18n.t("management.suspended")}
                    </Badge>
                  </td>
                  <td data-label={i18n.t("management.emailVerification")}>
                    {user.email_verified ? i18n.t("management.verified") : i18n.t("management.unverified")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={i18n.t("management.noUsers")} />
        )}
        <ManagementPagination pagination={page.pagination} />
      </Panel>
</>); }
export function UserDetailPage({ detail }: { detail: Detail }) { const i18n = useI18n(); const [search] = useSearchParams(); const companies = clientPage(detail.companies, search.get("companyPage")); return <>
<Panel title={detail.user.display_name || detail.user.email}><dl className={workspaceStyles["workspace-summary"]}>
<div><dt>{i18n.t("management.email")}</dt><dd>{detail.user.email}</dd></div>
<div><dt>{i18n.t("management.accountType")}</dt><dd>{i18n.enumLabel("accountType", detail.user.account_type)}</dd></div>
<div><dt>{i18n.t("management.accountStatus")}</dt><dd>{detail.user.status === "active" ? i18n.t("management.active") : i18n.t("management.suspended")}</dd></div>
<div><dt>{i18n.t("management.emailVerification")}</dt><dd>{detail.user.email_verified ? i18n.t("management.verified") : i18n.t("management.unverified")}</dd></div>
</dl></Panel><Panel title={i18n.t("management.memberCompanies")}>
            {detail.companies.length ? (
              <div className={uiStyles["ui-stack"]}>
                {companies.data.map((company) => (
                  <div key={company.id}>
                    <CompanyDetails company={company} />
                    <Link
                      className={uiStyles["ui-text-link"]}
                      to={`/admin/companies?company=${company.id}`}
                    >
                      {i18n.t("management.manageCompany")}</Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={i18n.t("management.noCompanies")} />
            )}
            <Pagination pagination={companies.pagination} pageKey="companyPage" />
          </Panel></>; }
export function UserEditPage({ detail, csrf, self }: { detail: Detail; csrf: string; self: string }) { const i18n = useI18n(); return (<Panel title={i18n.t("management.editUserTitle", { email: detail.user.email })}> 
            <Form
              method="post"
              className={uiStyles["ui-form"]}
              key={`${detail.user.id}:${detail.user.version}`}
            >
              <CSRF token={csrf} intent="updateUser" />
              <input type="hidden" name="user_id" value={detail.user.id} />
              <input type="hidden" name="version" value={detail.user.version} />
              <TextField
                id="display-name"
                name="display_name"
                label={i18n.t("management.displayName")}
                defaultValue={detail.user.display_name}
                maxLength={200}
              />
              <Field id="user-account-type" label={i18n.t("management.accountType")}>
                <Select
                  id="user-account-type"
                  name="account_type"
                  defaultValue={detail.user.account_type}
                >
                  {Object.keys(accountLabels).map((key) => (
                    <option key={key} value={key}>
                      {i18n.enumLabel("accountType", key)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="user-status" label={i18n.t("management.accountStatus")}>
                <Select
                  id="user-status"
                  name="status"
                  defaultValue={detail.user.status}
                >
                  <option value="active">{i18n.t("management.active")}</option>
                  <option value="suspended" disabled={detail.user.id === self}>
                    {i18n.t("management.suspended")}</option>
                </Select>
              </Field>
              <Alert tone="warning">
                {i18n.t("management.accountChangeWarning")}</Alert>
              <label className={workspaceStyles["workspace-check"]}>
                <input type="checkbox" required />
                {i18n.t("management.confirmUserChanges")}</label>
              <ManagementSubmit>{i18n.t("management.saveUser")}</ManagementSubmit>
            </Form>
          </Panel>); }
