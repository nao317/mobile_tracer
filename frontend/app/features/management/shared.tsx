import type { EnumGroup } from "../../i18n";
import { useI18n } from "../../components/ui/display-settings";
import appStyles from "../../app.module.css";
import uiStyles from "../../components/ui/ui.module.css";
import workspaceStyles from "../../features/workspace/workspace.module.css";
import { Pagination as PaginationControl } from "../../components/molecules/pagination";
import { Form, useNavigation, useSearchParams } from "react-router";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  TextField,
  Textarea,
} from "../../components/ui/primitives";
import { businessTypes, type Pagination } from "../workspace/model";
import { type Company, type CompanyProfile, type ManagementRequest, type ManagementResult } from "./model";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { NavigationGuard } from "../../components/ui/navigation-guard";

export function ManagementSubmit({
  children,
  name,
  value,
  variant = "primary",
}: {
  children: ReactNode;
  name?: string;
  value?: string;
  variant?: "primary" | "secondary" | "danger";
}) { const i18n = useI18n();
  const pending = useNavigation().state !== "idle";
  return (
    <Button
      type="submit"
      variant={variant}
      name={name}
      value={value}
      disabled={pending}
    >
      {pending ? i18n.t("management.processing") : children}
    </Button>
  );
}
export function ActionNotice({ result }: { result?: ManagementResult }) { const i18n = useI18n();
  const notice = useRef<HTMLDivElement>(null),
    submitted = useRef<HTMLFormElement | null>(null);
  const changed = useRef(new Set<HTMLFormElement>()),
    submitting = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  useEffect(() => {
    const main = notice.current?.closest("main") ?? notice.current?.parentElement;
    function change(event: Event) {
      const form = (event.target as HTMLElement).closest("form");
      if (form?.method.toLowerCase() === "post") {
        changed.current.add(form);
        (event.target as HTMLElement).removeAttribute("aria-invalid");
      }
    }
    function submit(event: Event) {
      const form = event.target as HTMLFormElement;
      if (form.method.toLowerCase() === "post") {
        submitted.current = form;
        submitting.current = true;
      }
    }
    main?.addEventListener("input", change);
    main?.addEventListener("change", change);
    main?.addEventListener("submit", submit, true);
    return () => {
      main?.removeEventListener("input", change);
      main?.removeEventListener("change", change);
      main?.removeEventListener("submit", submit, true);
    };
  }, []);
  useEffect(() => {
    if (busy) return;
    submitting.current = false;
    if (result?.message && submitted.current) {
      changed.current.delete(submitted.current);
      for (const form of changed.current)
        if (!form.isConnected) changed.current.delete(form);
    }
    if (result?.error) {
      const key = Object.keys(result.fields ?? {})[0]?.replace(
        /^profile\./,
        "",
      );
      const control = key ? submitted.current?.elements.namedItem(key) : null;
      if (control instanceof HTMLElement) {
        control.setAttribute("aria-invalid", "true");
        control.focus();
      } else
        notice.current
          ?.querySelector<HTMLElement>('[role="alert"], [role="status"]')
          ?.focus();
    }
  }, [result, busy]);
  return (
    <div ref={notice}>
      <NavigationGuard
        unsaved={() => changed.current.size > 0}
        busy={busy}
        submitting={submitting}
        onDiscard={() => {
          changed.current.clear();
        }}
      />
      {result?.message && <Alert tone="success">{i18n.t("common.completed")}</Alert>}
      {result?.error && (
        <Alert tone={result.uncertain ? "warning" : "danger"}>
          {i18n.errorMessage(result.code, { uncertain: result.uncertain })}
          {Object.entries(result.fields ?? {}).map(([key, messages]) => (
            <p key={key}>
              {i18n.t("common.fieldError", { field: i18n.fieldLabel(key), message: [...new Set(messages.map(message => i18n.fieldError(message)))].join(" ") })}
            </p>
          ))}
        </Alert>
      )}
    </div>
  );
}
export function CSRF({ token, intent }: { token: string; intent: string }) {
  return (
    <>
      <input type="hidden" name="_csrf" value={token} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
}
export function CompanyFields({
  company,
  profile = company?.profile,
}: {
  company?: Company;
  profile?: CompanyProfile;
}) { const i18n = useI18n();
  const prefix = useId();
  return (
    <>
      <TextField
        id={`${prefix}-company-name`}
        name="name"
        label={i18n.t("management.companyDisplayName")}
        defaultValue={company?.name ?? ""}
        maxLength={200}
        required
      />
      <TextField
        id={`${prefix}-legal-name`}
        name="legal_name"
        label={i18n.t("management.legalCompanyName")}
        defaultValue={profile?.legal_name ?? ""}
        maxLength={200}
        required
      />
      <Field id={`${prefix}-company-description`} label={i18n.t("management.companyDescription")}>
        <Textarea
          id={`${prefix}-company-description`}
          name="description"
          defaultValue={profile?.description ?? ""}
          maxLength={4000}
        />
      </Field>
      <fieldset className={`${uiStyles["ui-stack"]} ${appStyles["gap-2"]}`}>
        <legend className={`${appStyles["font-semibold"]} ${appStyles["mb-2"]}`}>{i18n.t("management.selectBusinessTypes")}</legend>
        {Object.keys(businessTypes).map((key) => (
          <label className={workspaceStyles["workspace-check"]} key={key}>
            <input
              type="checkbox"
              name="business_types"
              value={key}
              defaultChecked={
                profile?.business_types.includes(
                  key as keyof typeof businessTypes,
                ) ?? false
              }
            />
            {i18n.enumLabel("business", key)}
          </label>
        ))}
      </fieldset>
      <TextField
        id={`${prefix}-company-website`}
        name="website"
        type="url"
        label={i18n.t("management.website")}
        defaultValue={profile?.website ?? ""}
        maxLength={2000}
        placeholder="https://example.com…"
      />
      <TextField
        id={`${prefix}-company-phone`}
        name="phone"
        type="tel"
        label={i18n.t("management.phone")}
        defaultValue={profile?.phone ?? ""}
        maxLength={100}
      />
      <TextField
        id={`${prefix}-company-address`}
        name="address"
        label={i18n.t("management.address")}
        defaultValue={profile?.address ?? ""}
        maxLength={1000}
      />
      <TextField
        id={`${prefix}-company-email`}
        name="contact_email"
        type="email"
        spellCheck={false}
        label={i18n.t("management.companyEmail")}
        defaultValue={profile?.contact_email ?? ""}
        maxLength={320}
      />
    </>
  );
}
export function CompanyDetails({ company }: { company: Company }) { const i18n = useI18n();
  return (
    <dl className={workspaceStyles["workspace-summary"]}>
      <div>
        <dt>{i18n.t("management.companyName")}</dt>
        <dd>{company.name}</dd>
      </div>
      <div>
        <dt>{i18n.t("management.legalName")}</dt>
        <dd>{company.profile.legal_name || i18n.t("management.unregistered")}</dd>
      </div>
      <div>
        <dt>{i18n.t("management.status")}</dt>
        <dd>
          <Badge tone={company.status === "active" ? "success" : "warning"}>
            {i18n.enumLabel("companyStatus", company.status)}
          </Badge>
        </dd>
      </div>
      <div>
        <dt>{i18n.t("management.businessType")}</dt>
        <dd>
          {company.profile.business_types.length ? i18n.formatList(company.profile.business_types.map((type) => i18n.enumLabel("business", type))) : i18n.t("management.unregistered")}
        </dd>
      </div>
      <div>
        <dt>{i18n.t("management.address")}</dt>
        <dd>{company.profile.address || i18n.t("management.unregistered")}</dd>
      </div>
      <div>
        <dt>{i18n.t("management.contact")}</dt>
        <dd>
          {company.profile.contact_email || company.profile.phone || i18n.t("management.unregistered")}
        </dd>
      </div>
    </dl>
  );
}
export function RequestDetails({ request }: { request: ManagementRequest }) { const i18n = useI18n();
  const payload = request.payload,
    profile =
      typeof payload.profile === "object" && payload.profile
        ? (payload.profile as Record<string, unknown>)
        : null;
  const labels: Record<string, string> = {
    display_name: i18n.t("management.businessDisplayName"),
    reason: i18n.t("management.applicationReason"),
    name: i18n.t("management.companyDisplayName"),
    legal_name: i18n.t("management.legalCompanyName"),
    description: i18n.t("management.companyDescription"),
    website: i18n.t("management.website"),
    phone: i18n.t("management.phone"),
    address: i18n.t("management.address"),
    contact_email: i18n.t("management.contactEmail"),
    business_types: i18n.t("management.businessType"),
    version: i18n.t("management.applicationVersion"),
  };
  return (
    <div className={uiStyles["ui-stack"]}>
      <dl className={workspaceStyles["workspace-summary"]}>
        <div>
          <dt>{i18n.t("management.requestKind")}</dt>
          <dd>{i18n.enumLabel("requestKind", request.kind)}</dd>
        </div>
        <div>
          <dt>{i18n.t("management.requestedAt")}</dt>
          <dd>{i18n.formatDate(request.created_at)}</dd>
        </div>
        <div>
          <dt>{i18n.t("management.reviewStatus")}</dt>
          <dd>
            <Badge
              tone={
                request.status === "approved"
                  ? "success"
                  : request.status === "rejected"
                    ? "danger"
                    : "warning"
              }
            >
              {i18n.enumLabel("requestStatus", request.status)}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>{i18n.t("management.reviewedAt")}</dt>
          <dd>{i18n.formatDate(request.decided_at)}</dd>
        </div>
      </dl>
      <dl className={`${uiStyles["ui-stack"]} ${appStyles["gap-3"]}`}>
        {Object.entries({ ...payload, ...(profile ?? {}) })
          .filter(([key]) => key !== "profile")
          .map(([key, value]) => (
            <div key={key}>
              <dt className={uiStyles["ui-muted"]}>{labels[key] ?? key}</dt>
              <dd>
                {Array.isArray(value)
                  ? i18n.formatList(value.map((v) => i18n.enumLabel("business", String(v))))
                  : typeof value === "object"
                    ? "—"
                    : String(value ?? "—")}
              </dd>
            </div>
          ))}
      </dl>
      {request.decision_reason && (
        <Alert tone={request.status === "rejected" ? "warning" : "info"}>
          <p>{i18n.t("management.reviewerLabel")}{request.decider_email || i18n.t("management.systemAdmin")}</p>
          <p>{i18n.t("management.reviewReasonLabel")}{request.decision_reason}</p>
        </Alert>
      )}
    </div>
  );
}
export function ManagementPagination({ pagination }: { pagination: Pagination }) {
  return <PaginationControl pagination={pagination} />;
}
export function ManagementFilters({ children }: { children?: ReactNode }) { const i18n = useI18n();
  const [search] = useSearchParams();
  return (
    <Form method="get" className={workspaceStyles["workspace-filter"]}>
      <Field id="management-q" label={i18n.t("management.search")}>
        <Input
          id="management-q"
          name="q"
          defaultValue={search.get("q") ?? ""}
          maxLength={200}
          placeholder={i18n.t("management.searchPlaceholder")}
        />
      </Field>
      {children}
      <Button type="submit" variant="secondary">
        {i18n.t("management.searchAction")}</Button>
    </Form>
  );
}
export function StatusFilter({
  label,
  values,
  name = "status",
  enumGroup,
}: {
  label: string;
  values: Record<string, string>;
  enumGroup?: EnumGroup;
  name?: string;
}) { const i18n = useI18n();
  const [search] = useSearchParams();
  return (
    <Field id={`filter-${name}`} label={label}>
      <Select
        id={`filter-${name}`}
        name={name}
        defaultValue={search.get(name) ?? ""}
      >
        <option value="">{i18n.t("management.all")}</option>
        {Object.keys(values).map((key) => (
          <option key={key} value={key}>
            {i18n.enumLabel(enumGroup ?? (name === "account_type" ? "accountType" : name === "kind" ? "requestKind" : "companyStatus"), key)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
