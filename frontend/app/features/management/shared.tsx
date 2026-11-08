import { Form, Link, useNavigation, useSearchParams } from "react-router";
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
import { businessTypes, formatDate, type Pagination } from "../workspace/model";
import {
  companyStatusLabels,
  requestLabels,
  requestStatusLabels,
  type Company,
  type CompanyProfile,
  type ManagementRequest,
  type ManagementResult,
} from "./model";
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
}) {
  const pending = useNavigation().state !== "idle";
  return (
    <Button
      type="submit"
      variant={variant}
      name={name}
      value={value}
      disabled={pending}
    >
      {pending ? "処理中…" : children}
    </Button>
  );
}
export function ActionNotice({ result }: { result?: ManagementResult }) {
  const notice = useRef<HTMLDivElement>(null),
    submitted = useRef<HTMLFormElement | null>(null);
  const changed = useRef(new Set<HTMLFormElement>()),
    submitting = useRef(false);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  useEffect(() => {
    const main = notice.current?.closest("main");
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
      {result?.message && <Alert tone="success">{result.message}</Alert>}
      {result?.error && (
        <Alert tone={result.uncertain ? "warning" : "danger"}>
          {result.error}
          {Object.entries(result.fields ?? {}).map(([key, messages]) => (
            <p key={key}>
              {key}：{messages.join(" ")}
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
}) {
  const prefix = useId();
  return (
    <>
      <TextField
        id={`${prefix}-company-name`}
        name="name"
        label="企業の表示名"
        defaultValue={company?.name ?? ""}
        maxLength={200}
        required
      />
      <TextField
        id={`${prefix}-legal-name`}
        name="legal_name"
        label="正式な企業名"
        defaultValue={profile?.legal_name ?? ""}
        maxLength={200}
        required
      />
      <Field id={`${prefix}-company-description`} label="企業・サービスの紹介">
        <Textarea
          id={`${prefix}-company-description`}
          name="description"
          defaultValue={profile?.description ?? ""}
          maxLength={4000}
        />
      </Field>
      <fieldset className="ui-stack gap-2">
        <legend className="font-semibold mb-2">業態（1つ以上選択）</legend>
        {Object.entries(businessTypes).map(([key, label]) => (
          <label className="workspace-check" key={key}>
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
            {label}
          </label>
        ))}
      </fieldset>
      <TextField
        id={`${prefix}-company-website`}
        name="website"
        type="url"
        label="Webサイト"
        defaultValue={profile?.website ?? ""}
        maxLength={2000}
        placeholder="https://example.com…"
      />
      <TextField
        id={`${prefix}-company-phone`}
        name="phone"
        type="tel"
        label="電話番号"
        defaultValue={profile?.phone ?? ""}
        maxLength={100}
      />
      <TextField
        id={`${prefix}-company-address`}
        name="address"
        label="住所"
        defaultValue={profile?.address ?? ""}
        maxLength={1000}
      />
      <TextField
        id={`${prefix}-company-email`}
        name="contact_email"
        type="email"
        spellCheck={false}
        label="企業の連絡先メール"
        defaultValue={profile?.contact_email ?? ""}
        maxLength={320}
      />
    </>
  );
}
export function CompanyDetails({ company }: { company: Company }) {
  return (
    <dl className="workspace-summary">
      <div>
        <dt>企業名</dt>
        <dd>{company.name}</dd>
      </div>
      <div>
        <dt>正式名称</dt>
        <dd>{company.profile.legal_name || "未登録"}</dd>
      </div>
      <div>
        <dt>状態</dt>
        <dd>
          <Badge tone={company.status === "active" ? "success" : "warning"}>
            {companyStatusLabels[company.status]}
          </Badge>
        </dd>
      </div>
      <div>
        <dt>業態</dt>
        <dd>
          {company.profile.business_types
            .map((type) => businessTypes[type])
            .join("、") || "未登録"}
        </dd>
      </div>
      <div>
        <dt>住所</dt>
        <dd>{company.profile.address || "未登録"}</dd>
      </div>
      <div>
        <dt>連絡先</dt>
        <dd>
          {company.profile.contact_email || company.profile.phone || "未登録"}
        </dd>
      </div>
    </dl>
  );
}
export function RequestDetails({ request }: { request: ManagementRequest }) {
  const payload = request.payload,
    profile =
      typeof payload.profile === "object" && payload.profile
        ? (payload.profile as Record<string, unknown>)
        : null;
  const labels: Record<string, string> = {
    display_name: "業者としての表示名",
    reason: "申請理由",
    name: "企業の表示名",
    legal_name: "正式な企業名",
    description: "企業・サービスの紹介",
    website: "Webサイト",
    phone: "電話番号",
    address: "住所",
    contact_email: "連絡先メール",
    business_types: "業態",
    version: "申請時の企業情報の版",
  };
  return (
    <div className="ui-stack">
      <dl className="workspace-summary">
        <div>
          <dt>申請種別</dt>
          <dd>{requestLabels[request.kind]}</dd>
        </div>
        <div>
          <dt>申請日時</dt>
          <dd>{formatDate(request.created_at)}</dd>
        </div>
        <div>
          <dt>審査状態</dt>
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
              {requestStatusLabels[request.status]}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>審査日時</dt>
          <dd>{formatDate(request.decided_at)}</dd>
        </div>
      </dl>
      <dl className="ui-stack gap-3">
        {Object.entries({ ...payload, ...(profile ?? {}) })
          .filter(([key]) => key !== "profile")
          .map(([key, value]) => (
            <div key={key}>
              <dt className="ui-muted">{labels[key] ?? key}</dt>
              <dd>
                {Array.isArray(value)
                  ? value
                      .map(
                        (v) =>
                          businessTypes[v as keyof typeof businessTypes] ??
                          String(v),
                      )
                      .join("、")
                  : typeof value === "object"
                    ? "—"
                    : String(value ?? "—")}
              </dd>
            </div>
          ))}
      </dl>
      {request.decision_reason && (
        <Alert tone={request.status === "rejected" ? "warning" : "info"}>
          <p>審査者：{request.decider_email || "システム管理者"}</p>
          <p>審査理由：{request.decision_reason}</p>
        </Alert>
      )}
    </div>
  );
}
export function ManagementPagination({
  pagination,
}: {
  pagination: Pagination;
}) {
  const [search] = useSearchParams();
  const to = (page: number) => {
    const next = new URLSearchParams(search);
    next.set("page", String(page));
    return `?${next}`;
  };
  return (
    <nav className="workspace-pagination" aria-label="ページ切り替え">
      <span>
        {pagination.total}件 / {pagination.page}ページ
      </span>
      {pagination.page > 1 && <Link to={to(pagination.page - 1)}>前へ</Link>}
      {pagination.page * pagination.page_size < pagination.total && (
        <Link to={to(pagination.page + 1)}>次へ</Link>
      )}
    </nav>
  );
}
export function ManagementFilters({ children }: { children?: ReactNode }) {
  const [search] = useSearchParams();
  return (
    <Form method="get" className="workspace-filter">
      <Field id="management-q" label="検索">
        <Input
          id="management-q"
          name="q"
          defaultValue={search.get("q") ?? ""}
          maxLength={200}
          placeholder="名前・メールアドレスなど…"
        />
      </Field>
      {children}
      <Button type="submit" variant="secondary">
        検索する
      </Button>
    </Form>
  );
}
export function StatusFilter({
  label,
  values,
  name = "status",
}: {
  label: string;
  values: Record<string, string>;
  name?: string;
}) {
  const [search] = useSearchParams();
  return (
    <Field id={`filter-${name}`} label={label}>
      <Select
        id={`filter-${name}`}
        name={name}
        defaultValue={search.get(name) ?? ""}
      >
        <option value="">すべて</option>
        {Object.entries(values).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}
