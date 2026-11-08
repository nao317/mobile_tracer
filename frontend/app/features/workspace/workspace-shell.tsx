import {
  CarFront,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { Link, NavLink, useNavigation, useSearchParams } from "react-router";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Select,
} from "../../components/ui/primitives";
import { roleLabels, type Role } from "./model";
import { useWorkspace } from "./workspace-context";
import {
  BrandMark,
  useTranslation,
} from "../../components/ui/display-settings";
import type { Screen } from "./screens";

const navigation = [
  { path: "", label: "ホーム", icon: LayoutDashboard },
  { path: "tasks", label: "未対応一覧", icon: ListChecks },
  { path: "vehicles", label: "車両", icon: CarFront },
  { path: "cases", label: "案件", icon: ClipboardList },
  { path: "settings/organization", label: "顧客管理", icon: Settings },
  { path: "operations/status", label: "提供側運用", icon: ShieldCheck },
];
export function WorkspaceShell({
  children,
  screen,
}: {
  children: ReactNode;
  screen: Screen;
}) {
  const { base, mode, email, snapshot, reset, changeRole, previewAvailable } =
    useWorkspace();
  const pending = useNavigation().state !== "idle";
  const [search, setSearch] = useSearchParams();
  const scenario = search.get("scenario") ?? "normal";
  const t = useTranslation();
  return (
    <div className="workspace">
      <a href="#workspace-main" className="ui-skip">
        {t("本文へ移動")}
      </a>
      <aside className="workspace-sidebar">
        <Link to={base} className="workspace-logo" translate="no">
          <BrandMark />
        </Link>
        <div className="workspace-tenant">
          <span className="workspace-tenant-icon">M</span>
          <div>
            <strong>
              {t(mode === "preview" ? "サンプル企業" : "業務ワークスペース")}
            </strong>
            <span>{snapshot.context.stores.length}店舗</span>
          </div>
        </div>
        <p className="workspace-nav-label">{t("ワークスペース")}</p>
        <nav aria-label={t("メインナビゲーション")}>
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={`${base}/${path}`} end={!path}>
              <Icon size={18} aria-hidden="true" />
              {t(label)}
            </NavLink>
          ))}
        </nav>
        {mode === "preview" && (
          <NavLink className="workspace-catalog" to={`${base}/screens`}>
            <Layers size={18} aria-hidden="true" />
            {t("全画面を確認")}
          </NavLink>
        )}
        <div className="workspace-sidebar-footer">
          <Badge tone={mode === "preview" ? "warning" : "info"}>
            {t(mode === "preview" ? "UIプレビュー" : "業務環境")}
          </Badge>
          <Link to="/account">
            {t("アカウント")} <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb">
            {t("ワークスペース")} <span>/</span>{" "}
            <strong>{t(screen.title)}</strong>
          </div>
          <div className="workspace-person">
            <span className="workspace-avatar">M</span>
            <span>{email}</span>
          </div>
        </header>
        {mode === "preview" && (
          <div className="workspace-preview-bar">
            <strong>架空データのプレビュー</strong>
            <span>
              変更はこの画面内のみ。再読み込みすると初期状態に戻ります。
            </span>
            <label>
              役割
              <Select
                aria-label="プレビューの役割"
                value={snapshot.context.principal.roles[0]?.role}
                onChange={(event) => changeRole?.(event.target.value as Role)}
              >
                {Object.entries(roleLabels).map(([role, label]) => (
                  <option value={role} key={role}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              表示状態
              <Select
                aria-label="表示状態"
                value={scenario}
                onChange={(event) => {
                  const next = new URLSearchParams(search);
                  if (event.target.value === "normal") next.delete("scenario");
                  else next.set("scenario", event.target.value);
                  setSearch(next);
                }}
              >
                {Object.entries({
                  normal: "通常",
                  loading: "読み込み中",
                  empty: "データなし",
                  error: "通信失敗",
                  forbidden: "権限不足",
                  "not-found": "対象なし",
                  conflict: "保存競合",
                  unknown: "保存結果未確定",
                }).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="ghost" onClick={() => reset?.()}>
              初期状態に戻す
            </Button>
          </div>
        )}
        <div className="workspace-loading" role="status" aria-live="polite">
          {pending ? "読み込み中…" : ""}
        </div>
        <main
          id="workspace-main"
          className="workspace-main ui-stack"
          tabIndex={-1}
          aria-busy={pending}
        >
          {snapshot.notice && <Alert tone="warning">{snapshot.notice}</Alert>}
          <ScenarioBoundary scenario={mode === "preview" ? scenario : "normal"}>
            {children}
          </ScenarioBoundary>
          {mode === "live" && previewAvailable && (
            <p className="ui-muted">
              <Link className="ui-text-link" to="/preview/screens">
                開発用の画面プレビューを開く
              </Link>
            </p>
          )}
        </main>
        <footer className="workspace-footer">
          <BrandMark />
          <span>車両の記録を、次の確認へ。</span>
        </footer>
      </div>
    </div>
  );
}
function ScenarioBoundary({
  scenario,
  children,
}: {
  scenario: string;
  children: ReactNode;
}) {
  if (scenario === "loading")
    return (
      <section aria-busy="true" className="ui-stack">
        <Alert>情報を読み込んでいます…</Alert>
        <div className="workspace-skeleton" />
      </section>
    );
  if (scenario === "empty")
    return (
      <EmptyState title="表示するデータがありません">
        条件を変更するか、新しい記録を作成してください。
      </EmptyState>
    );
  if (scenario === "forbidden")
    return (
      <EmptyState title="表示する権限がありません">
        所属と担当範囲を確認してください。
      </EmptyState>
    );
  if (scenario === "not-found")
    return (
      <EmptyState title="対象が見つかりません">
        一覧へ戻り、対象を選び直してください。
      </EmptyState>
    );
  return (
    <>
      {scenario === "error" && (
        <Alert tone="danger">
          通信に失敗しました。入力内容はこの画面に残っています。接続を確認してください。
        </Alert>
      )}
      {scenario === "conflict" && (
        <Alert tone="warning">
          別の更新が保存されています。入力を控え、最新の版との差分を確認してから再編集してください。
        </Alert>
      )}
      {scenario === "unknown" && (
        <Alert tone="warning">
          保存結果が未確定です。一覧・詳細で結果を確認してから再操作してください。
        </Alert>
      )}
      {children}
    </>
  );
}
