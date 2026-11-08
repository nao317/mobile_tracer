import {
  CarFront,
  ClipboardList,
  FileCheck2,
  Clock3,
  ArrowRight,
  Plus,
  Search,
} from "lucide-react";
import { Form, Link, useSearchParams } from "react-router";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  TextField,
  Textarea,
} from "../../components/ui/primitives";
import {
  businessTypes,
  canManage,
  canWrite,
  fieldLabels,
  formatDate,
  isTenantAdmin,
  plateNumber,
  rulesFor,
  stageLabels,
  vehicleName,
  type BusinessCase,
  type FieldRule,
  type Version,
} from "./model";
import { CommandForm, CommandSubmit } from "./command-form";
import { useWorkspace } from "./workspace-context";
import { RouteTabs } from "./route-tabs";

export function CaseTable({ items }: { items: BusinessCase[] }) {
  const { snapshot, base } = useWorkspace();
  if (!items.length)
    return (
      <EmptyState title="案件がありません">
        検索条件を変更するか、新しい案件を作成してください。
      </EmptyState>
    );
  return (
    <table className="ui-table ui-table--responsive">
      <thead>
        <tr>
          <th>車両・案件</th>
          <th>業態</th>
          <th>店舗</th>
          <th>業務段階</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td data-label="車両・案件">
              <Link to={`${base}/cases/${item.id}`}>
                {vehicleName(
                  snapshot.vehicles.find((v) => v.id === item.vehicle_id),
                )}
              </Link>
              <span className="workspace-table-subtitle">
                {plateNumber(
                  snapshot.vehicles.find((v) => v.id === item.vehicle_id),
                )}{" "}
                / {item.id.slice(-6)}
              </span>
            </td>
            <td data-label="業態">{businessTypes[item.case_type]}</td>
            <td data-label="店舗">
              {snapshot.context.stores.find((s) => s.id === item.store_id)
                ?.name ?? "所属店舗"}
            </td>
            <td data-label="業務段階">
              {stageLabels[item.stage] ?? item.stage}
            </td>
            <td data-label="状態">
              <Badge
                tone={
                  item.status === "completed"
                    ? "success"
                    : item.status === "cancelled"
                      ? "neutral"
                      : "info"
                }
              >
                {item.status === "completed"
                  ? "完了"
                  : item.status === "cancelled"
                    ? "中止"
                    : "進行中"}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DashboardScreen() {
  const { snapshot, base, mode } = useWorkspace();
  const stats = [
    {
      label: "進行中の案件",
      value: snapshot.cases.filter((c) => c.status === "in_progress").length,
      icon: ClipboardList,
    },
    { label: "登録車両", value: snapshot.vehicles.length, icon: CarFront },
    {
      label: "未解決の異議",
      value: snapshot.workflow?.disputes.filter((d) => d.status !== "解決")
        .length,
      icon: Clock3,
    },
    {
      label: "登録待ち・失敗",
      value: snapshot.workflow
        ? Object.values(snapshot.workflow.registration).filter(
            (s) => s !== "登録済み",
          ).length
        : undefined,
      icon: FileCheck2,
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="ホーム"
        description="今日の業務と、確認が必要な記録をまとめて確認できます。"
        actions={
          canWrite(snapshot.context) && (
            <Link className="ui-link-button" to={`${base}/cases/new`}>
              <Plus size={16} aria-hidden="true" />
              案件を作成
            </Link>
          )
        }
      />
      <div className="ui-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <Panel key={label}>
            <div className="workspace-stat">
              <div>
                <p>{label}</p>
                <strong>
                  {value === undefined
                    ? "—"
                    : new Intl.NumberFormat("ja-JP").format(value)}
                </strong>
                <p>
                  {value === undefined
                    ? "集計は現在利用できません"
                    : mode === "live"
                      ? "取得済みの直近100件以内"
                      : "サンプルデータ"}
                </p>
              </div>
              <span className="workspace-stat-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
            </div>
          </Panel>
        ))}
      </div>
      <Panel
        title="進行中の案件"
        actions={
          <Link className="ui-text-link" to={`${base}/cases`}>
            すべての案件{" "}
            <ArrowRight size={14} className="inline" aria-hidden="true" />
          </Link>
        }
      >
        <CaseTable
          items={snapshot.cases
            .filter((c) => c.status === "in_progress")
            .slice(0, 5)}
        />
      </Panel>
      <div className="ui-grid">
        <Panel title="記録をはじめる">
          <p className="ui-muted">
            車両を検索し、貸出・販売・修理の案件に記録を追加します。
          </p>
          <Link className="ui-text-link" to={`${base}/vehicles`}>
            車両一覧へ
          </Link>
        </Panel>
        <Panel title="確認が必要なこと">
          <p className="ui-muted">
            未回答、異議、共有期限、登録の失敗を確認します。
          </p>
          <Link className="ui-text-link" to={`${base}/tasks`}>
            未対応一覧へ
          </Link>
        </Panel>
      </div>
    </>
  );
}

function Pagination({
  total,
  page,
  pageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
}) {
  const [search] = useSearchParams();
  const href = (n: number) => {
    const next = new URLSearchParams(search);
    next.set("page", String(n));
    return `?${next}`;
  };
  return (
    <nav className="workspace-pagination" aria-label="ページ切り替え">
      <span className="ui-muted ui-number">
        {total}件 / {page}ページ
      </span>
      {page > 1 && <Link to={href(page - 1)}>前へ</Link>}
      {page * pageSize < total && <Link to={href(page + 1)}>次へ</Link>}
    </nav>
  );
}
function ListFilters({ cases = false }: { cases?: boolean }) {
  const [search] = useSearchParams();
  return (
    <Form method="get" className="workspace-filter">
      <Field id="search-q" label="検索">
        <Input
          id="search-q"
          name="q"
          placeholder={cases ? "車種名で検索…" : "車種名・識別情報で検索…"}
          defaultValue={search.get("q") ?? ""}
          maxLength={200}
        />
      </Field>
      {cases && (
        <>
          <Field id="case-type" label="業態">
            <Select
              id="case-type"
              name="case_type"
              defaultValue={search.get("case_type") ?? ""}
            >
              <option value="">すべての業態</option>
              {Object.entries(businessTypes).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="case-status" label="案件の状態">
            <Select
              id="case-status"
              name="status"
              defaultValue={search.get("status") ?? ""}
            >
              <option value="">すべての状態</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
              <option value="cancelled">中止</option>
            </Select>
          </Field>
        </>
      )}
      <Button type="submit" variant="secondary">
        <Search size={16} aria-hidden="true" />
        検索する
      </Button>
    </Form>
  );
}
export function VehiclesScreen() {
  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const q = (search.get("q") ?? "").toLowerCase();
  const filtered =
    mode === "preview"
      ? snapshot.vehicles.filter((v) =>
          `${v.model_name} ${v.identifiers.map((i) => i.value).join(" ")}`
            .toLowerCase()
            .includes(q),
        )
      : snapshot.vehicles;
  const page = Math.max(1, Number(search.get("page")) || 1),
    items =
      mode === "preview"
        ? filtered.slice((page - 1) * 20, page * 20)
        : filtered;
  return (
    <>
      <PageHeader
        eyebrow="Vehicles"
        title="車両"
        description="ナンバーや車種名から、車両とこれまでの記録を探します。"
        actions={
          isTenantAdmin(snapshot.context) && (
            <Link className="ui-link-button" to={`${base}/vehicles/new`}>
              <Plus size={16} aria-hidden="true" />
              車両を登録
            </Link>
          )
        }
      />
      <Panel>
        <ListFilters />
      </Panel>
      <Panel title="車両一覧">
        {items.length ? (
          <table className="ui-table ui-table--responsive">
            <thead>
              <tr>
                <th>車両</th>
                <th>ナンバー</th>
                <th>識別情報</th>
                <th>登録日時</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id}>
                  <td data-label="車両">
                    <Link to={`${base}/vehicles/${v.id}`}>
                      {vehicleName(v)}
                    </Link>
                    <span className="workspace-table-subtitle">
                      {v.id.slice(-6)}
                    </span>
                  </td>
                  <td data-label="ナンバー">{plateNumber(v)}</td>
                  <td data-label="識別情報">
                    <Badge
                      tone={
                        v.identifiers.some((i) => i.verified_at)
                          ? "success"
                          : "warning"
                      }
                    >
                      {v.identifiers.some((i) => i.verified_at)
                        ? "確認済み"
                        : "未確認"}
                    </Badge>
                  </td>
                  <td data-label="登録日時">{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="車両が見つかりません">
            検索条件を変更してください。
          </EmptyState>
        )}
        <Pagination
          total={snapshot.pagination?.total ?? filtered.length}
          page={snapshot.pagination?.page ?? page}
          pageSize={20}
        />
      </Panel>
    </>
  );
}
export function VehicleFormScreen({ vehicleId }: { vehicleId?: string }) {
  const { snapshot, base } = useWorkspace();
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (!isTenantAdmin(snapshot.context))
    return (
      <EmptyState title="企業管理者の権限が必要です">
        登録済みの車両は、車両一覧から確認できます。
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title={vehicle ? "車両情報の編集" : "車両登録"}
        description="識別情報は未確認として登録します。車両の内部IDは登録後も変わりません。"
      />
      <Panel>
        <CommandForm
          intent={vehicle ? "updateVehicle" : "createVehicle"}
          hidden={vehicle ? { vehicleId: vehicle.id } : {}}
          guard
        >
          <TextField
            id="model_name"
            name="model_name"
            label="車種名"
            maxLength={200}
            defaultValue={vehicle?.model_name ?? ""}
          />
          {!vehicle && (
            <>
              <Field id="identifier-kind" label="識別情報の種類">
                <Select id="identifier-kind" name="kind">
                  <option value="plate_number">ナンバー</option>
                  <option value="chassis_number">車台番号</option>
                  <option value="vin">VIN</option>
                </Select>
              </Field>
              <TextField
                id="identifier"
                name="identifier"
                label="識別情報"
                maxLength={100}
                hint="不明な場合は空欄のまま登録できます。"
              />
            </>
          )}
          <div className="ui-actions">
            <CommandSubmit>
              {vehicle ? "車種名を保存" : "車両を登録"}
            </CommandSubmit>
            <Link className="ui-text-link" to={`${base}/vehicles`}>
              車両一覧へ戻る
            </Link>
          </div>
        </CommandForm>
      </Panel>
    </>
  );
}
export function VehicleScreen({ vehicleId }: { vehicleId: string }) {
  const { snapshot, base } = useWorkspace();
  const item = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (!item) return <EmptyState title="車両が見つかりません" />;
  return (
    <>
      <PageHeader
        eyebrow="Vehicle details"
        title={vehicleName(item)}
        description={plateNumber(item)}
        actions={
          canWrite(snapshot.context) && (
            <Link
              className="ui-link-button"
              to={`${base}/cases/new?vehicle=${item.id}`}
            >
              この車両で案件を作成
            </Link>
          )
        }
      />
      <Panel title="車両情報">
        <dl className="workspace-summary">
          <div>
            <dt>内部ID</dt>
            <dd>{item.id}</dd>
          </div>
          <div>
            <dt>登録日時</dt>
            <dd>{formatDate(item.created_at)}</dd>
          </div>
          <div>
            <dt>識別情報</dt>
            <dd>
              {item.identifiers.map((i) => (
                <p key={i.id}>
                  {i.value}{" "}
                  <Badge tone={i.verified_at ? "success" : "warning"}>
                    {i.verified_at ? "確認済み" : "未確認"}
                  </Badge>
                </p>
              ))}
            </dd>
          </div>
        </dl>
        <div className="ui-actions mt-5">
          <Link
            className="ui-text-link"
            to={`${base}/vehicles/${item.id}/history`}
          >
            識別情報・所有者の履歴
          </Link>
        </div>
        {isTenantAdmin(snapshot.context) && (
          <details className="workspace-details">
            <summary>車種名を変更する</summary>
            <CommandForm intent="updateVehicle" hidden={{ vehicleId: item.id }}>
              <TextField
                id="model_name"
                name="model_name"
                label="車種名"
                defaultValue={item.model_name ?? ""}
                maxLength={200}
              />
              <CommandSubmit>車種名を保存</CommandSubmit>
            </CommandForm>
          </details>
        )}
      </Panel>
      <Panel title="この車両の案件">
        <CaseTable
          items={snapshot.cases.filter((c) => c.vehicle_id === item.id)}
        />
      </Panel>
    </>
  );
}
export function CasesScreen() {
  const { snapshot, base, mode } = useWorkspace();
  const [search] = useSearchParams();
  const q = (search.get("q") ?? "").toLowerCase();
  const filtered =
    mode === "preview"
      ? snapshot.cases.filter(
          (c) =>
            vehicleName(snapshot.vehicles.find((v) => v.id === c.vehicle_id))
              .toLowerCase()
              .includes(q) &&
            (!search.get("case_type") ||
              search.get("case_type") === c.case_type) &&
            (!search.get("status") || search.get("status") === c.status),
        )
      : snapshot.cases;
  const page = Math.max(1, Number(search.get("page")) || 1);
  return (
    <>
      <PageHeader
        eyebrow="Cases"
        title="案件"
        description="貸出・販売・修理の案件と、記録の進み具合を確認します。"
        actions={
          canWrite(snapshot.context) && (
            <Link className="ui-link-button" to={`${base}/cases/new`}>
              <Plus size={16} aria-hidden="true" />
              案件を作成
            </Link>
          )
        }
      />
      <Panel>
        <ListFilters cases />
      </Panel>
      <Panel title="案件一覧">
        <CaseTable
          items={
            mode === "preview"
              ? filtered.slice((page - 1) * 20, page * 20)
              : filtered
          }
        />
        <Pagination
          total={snapshot.pagination?.total ?? filtered.length}
          page={snapshot.pagination?.page ?? page}
          pageSize={20}
        />
      </Panel>
    </>
  );
}
export function CaseCreateScreen() {
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  if (!canWrite(snapshot.context))
    return <EmptyState title="案件を作成する権限がありません" />;
  if (
    !snapshot.context.configuration ||
    !Object.keys(snapshot.context.configuration.settings.businesses).length
  )
    return (
      <EmptyState title="利用できる設定がありません">
        管理者に業態設定の反映を依頼してください。
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title="案件作成"
        description="店舗・車両・業態を選びます。作成時の設定版を案件に保持します。"
      />
      <Panel>
        <CommandForm intent="createCase" guard>
          <Field id="store_id" label="担当店舗">
            <Select id="store_id" name="store_id" required>
              {snapshot.context.stores.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="vehicle_id" label="車両">
            <Select
              id="vehicle_id"
              name="vehicle_id"
              required
              defaultValue={search.get("vehicle") ?? ""}
            >
              <option value="">車両を選択してください</option>
              {snapshot.vehicles.map((v) => (
                <option value={v.id} key={v.id}>
                  {vehicleName(v)} / {plateNumber(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="case_type" label="業態">
            <Select id="case_type" name="case_type" required>
              <option value="">業態を選択してください</option>
              {Object.entries(businessTypes)
                .filter(
                  ([key]) =>
                    snapshot.context.configuration?.settings.businesses[key],
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </Select>
          </Field>
          <label className="workspace-check">
            <input
              type="checkbox"
              name="assign_self"
              value="1"
              defaultChecked
            />
            自分を担当者にする
          </label>
          <p className="ui-hint">
            ほかの担当者への変更は、選択可能な担当者の取得機能が利用可能になってから対応します。
          </p>
          <div className="ui-actions">
            <CommandSubmit>案件を作成</CommandSubmit>
            <Link className="ui-text-link" to={`${base}/cases`}>
              案件一覧へ戻る
            </Link>
          </div>
        </CommandForm>
      </Panel>
    </>
  );
}
export function CaseHeader({ item }: { item: BusinessCase }) {
  const { snapshot } = useWorkspace();
  return (
    <PageHeader
      eyebrow={`${businessTypes[item.case_type]} / ${item.id.slice(-6)}`}
      title={vehicleName(
        snapshot.vehicles.find((v) => v.id === item.vehicle_id),
      )}
      description={`${plateNumber(snapshot.vehicles.find((v) => v.id === item.vehicle_id))} ・ ${snapshot.context.stores.find((s) => s.id === item.store_id)?.name ?? "所属店舗"}`}
      actions={
        <Badge tone={item.status === "completed" ? "success" : "info"}>
          {item.status === "completed"
            ? "業務完了"
            : item.status === "cancelled"
              ? "中止"
              : (stageLabels[item.stage] ?? item.stage)}
        </Badge>
      }
    />
  );
}
export function CaseTabs({
  caseId,
  section,
}: {
  caseId: string;
  section: string;
}) {
  const { base } = useWorkspace();
  const tabs = [
    ["", "記録・概要"],
    ["compare", "比較"],
    ["answers", "確認・回答"],
    ["disputes", "異議"],
    ["sharing", "共有"],
    ["verification", "登録・検証"],
    ["exports", "出力"],
  ];
  const selected = tabs.some(([path]) => path === section) ? section : "";
  const to = (path: string) =>
    `${base}/cases/${caseId}${path ? `/${path}` : ""}`;
  return (
    <RouteTabs
      label="案件の操作"
      items={tabs.map(([path, label]) => ({ to: to(path), label }))}
      activeTo={to(selected)}
    />
  );
}
export function CaseScreen({ item }: { item: BusinessCase }) {
  const { snapshot, base, mode } = useWorkspace();
  const records = snapshot.records.filter((r) => r.case_id === item.id);
  const rules = rulesFor(snapshot, item),
    editable = canWrite(snapshot.context, item);
  return (
    <>
      <Panel title="業務の進み具合">
        <div className="workspace-step">
          {rules?.stages.map((stage) => (
            <span key={stage}>
              {stageLabels[stage] ?? stage}
              {stage === item.stage ? "（現在）" : ""}
            </span>
          ))}
        </div>
        <dl className="workspace-summary mt-5">
          <div>
            <dt>担当者</dt>
            <dd>
              {item.assignee_id === snapshot.context.principal.staff_id
                ? "自分"
                : item.assignee_id
                  ? "担当者設定済み"
                  : "未指定"}
            </dd>
          </div>
          <div>
            <dt>作成日時</dt>
            <dd>{formatDate(item.created_at)}</dd>
          </div>
          <div>
            <dt>設定版</dt>
            <dd>{item.configuration_version_id.slice(-8)}</dd>
          </div>
        </dl>
        {item.cancel_reason && (
          <Alert tone="warning">中止理由：{item.cancel_reason}</Alert>
        )}
        {editable && canManage(snapshot.context, item.store_id) && (
          <details className="workspace-details">
            <summary>担当者を変更する</summary>
            <CommandForm intent="assignCase" hidden={{ caseId: item.id }}>
              <Field id="assignment" label="担当者">
                <Select
                  id="assignment"
                  name="assignment"
                  defaultValue={
                    item.assignee_id === snapshot.context.principal.staff_id
                      ? "self"
                      : "unassigned"
                  }
                >
                  <option value="self">自分</option>
                  <option value="unassigned">未指定</option>
                </Select>
              </Field>
              <CommandSubmit>担当者を変更</CommandSubmit>
            </CommandForm>
          </details>
        )}
        {editable && rules && (
          <details className="workspace-details">
            <summary>業務段階を変更する</summary>
            <CommandForm intent="updateCase" hidden={{ caseId: item.id }}>
              <Field id="stage" label="次の段階">
                <Select id="stage" name="stage" required>
                  <option value="">段階を選択してください</option>
                  {rules.transitions[item.stage]?.map((stage) => (
                    <option key={stage} value={stage}>
                      {stageLabels[stage] ?? stage}
                    </option>
                  ))}
                </Select>
              </Field>
              <CommandSubmit>段階を変更</CommandSubmit>
            </CommandForm>
          </details>
        )}
      </Panel>
      <Panel
        title="記録"
        actions={
          editable &&
          rules && (
            <Link
              className="ui-link-button"
              to={`${base}/cases/${item.id}/records/new`}
            >
              <Plus size={16} aria-hidden="true" />
              記録を追加
            </Link>
          )
        }
      >
        {records.length ? (
          <table className="ui-table ui-table--responsive">
            <thead>
              <tr>
                <th>記録</th>
                <th>作成日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td data-label="記録">
                    {r.record_kind === "inspection"
                      ? "状態・点検記録"
                      : r.record_kind}
                    <span className="workspace-table-subtitle">
                      {r.id.slice(-6)}
                    </span>
                  </td>
                  <td data-label="作成日時">{formatDate(r.created_at)}</td>
                  <td data-label="操作">
                    <Link to={`${base}/cases/${item.id}/records/${r.id}`}>
                      記録を開く
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="記録はまだありません">
            受付時の状態から記録をはじめましょう。
          </EmptyState>
        )}
      </Panel>
      <Panel title="関係者">
        {mode === "preview" ? (
          <>
            <ManagementParticipants caseId={item.id} />
            <p className="ui-hint">
              所有者・依頼者・承認者の資格と関与期間は、共有許可とは別に管理します。
            </p>
          </>
        ) : (
          <p className="ui-muted">関係者の登録は現在利用できません。</p>
        )}
      </Panel>
      {canManage(snapshot.context, item.store_id) && editable && (
        <Panel title="案件の終了">
          <details>
            <summary className="cursor-pointer">
              中止理由を入力して案件を中止する
            </summary>
            <CommandForm intent="cancelCase" hidden={{ caseId: item.id }}>
              <Field id="reason" label="中止理由">
                <Textarea id="reason" name="reason" maxLength={2000} required />
              </Field>
              <label className="workspace-check">
                <input type="checkbox" required />
                記録を残したまま案件を中止します
              </label>
              <CommandSubmit variant="danger">案件を中止</CommandSubmit>
            </CommandForm>
          </details>
          {mode === "preview" && (
            <details className="workspace-details">
              <summary>業務を完了する</summary>
              <CommandForm intent="completeCase" hidden={{ caseId: item.id }}>
                <Alert tone="warning">
                  完了後も、未回答・異議・登録失敗は残ります。
                </Alert>
                <label className="workspace-check">
                  <input type="checkbox" required />
                  業務完了を確認しました
                </label>
                <CommandSubmit>業務を完了</CommandSubmit>
              </CommandForm>
            </details>
          )}
        </Panel>
      )}
    </>
  );
}
function ManagementParticipants({ caseId }: { caseId: string }) {
  const { snapshot } = useWorkspace();
  return (
    <div className="ui-stack">
      {snapshot.workflow?.management
        .filter((m) => m.kind === `participant:${caseId}`)
        .map((p) => (
          <p key={p.id}>
            {p.name} / {p.detail} <Badge>{p.status}</Badge>
          </p>
        ))}
      {canManage(
        snapshot.context,
        snapshot.cases.find((c) => c.id === caseId)?.store_id,
      ) && (
        <CommandForm
          intent="manage"
          hidden={{ kind: `participant:${caseId}`, status: "有効" }}
        >
          <TextField
            id="participant-name"
            name="name"
            label="関係者名"
            required
          />
          <TextField
            id="participant-detail"
            name="detail"
            label="資格・関与期間"
            placeholder="例：所有者、受付から引き渡しまで…"
            required
          />
          <CommandSubmit>関係者を追加</CommandSubmit>
        </CommandForm>
      )}
    </div>
  );
}

export function selectedVersion(
  versions: Version[],
  recordId: string,
  versionId: string | null,
) {
  const items = versions
    .filter((v) => v.record_id === recordId)
    .sort((a, b) => b.version_no - a.version_no);
  return versionId ? items.find((v) => v.id === versionId) : items[0];
}
export function RecordFormScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId?: string;
}) {
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const record = snapshot.records.find((r) => r.id === recordId),
    version = recordId
      ? selectedVersion(snapshot.versions, recordId, search.get("version"))
      : undefined;
  const rules = rulesFor(snapshot, item);
  const [kind, setKind] = useState(
    record?.record_kind ?? Object.keys(rules?.record_kinds ?? {})[0] ?? "",
  );
  if (!canWrite(snapshot.context, item))
    return <EmptyState title="記録を編集する権限がありません" />;
  if (!rules)
    return (
      <EmptyState title="案件開始時の設定版を取得できません">
        設定を確認できるまで編集を停止しています。
      </EmptyState>
    );
  if (recordId && (!record || !version))
    return <EmptyState title="記録版が見つかりません" />;
  if (version?.status === "submitted")
    return (
      <EmptyState
        title="提出済みの版は編集できません"
        actions={
          <Link
            className="ui-link-button"
            to={`${base}/cases/${item.id}/records/${recordId}/correct?version=${version.id}`}
          >
            訂正・補足を作成
          </Link>
        }
      >
        元の内容を残し、新しい版を作成してください。
      </EmptyState>
    );
  return (
    <Panel title={recordId ? `下書き v${version?.version_no}` : "記録の作成"}>
      <CommandForm
        key={version ? version.id : kind}
        intent={recordId ? "updateDraft" : "createRecord"}
        hidden={{
          caseId: item.id,
          ...(recordId && version
            ? {
                recordId,
                versionId: version.id,
                lock_version: version.lock_version,
              }
            : {}),
        }}
        guard
      >
        {recordId ? (
          <input type="hidden" name="record_kind" value={kind} />
        ) : (
          <Field id="record_kind" label="記録種別">
            <Select
              id="record_kind"
              name="record_kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {Object.keys(rules.record_kinds).map((k) => (
                <option key={k} value={k}>
                  {k === "inspection" ? "状態・点検記録" : k}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Alert>
          必須項目が未入力でも下書き保存できます。提出時に不足を確認します。
        </Alert>
        {Object.entries(rules.record_kinds[kind]?.fields ?? {}).map(
          ([key, rule]) => (
            <RecordField
              key={key}
              name={key}
              rule={rule}
              value={version?.entries[key]}
            />
          ),
        )}
        <div className="ui-actions">
          <CommandSubmit>下書きを保存</CommandSubmit>
          {recordId && version && (
            <Link
              className="ui-text-link"
              to={`${base}/cases/${item.id}/records/${recordId}?version=${version.id}`}
            >
              記録の詳細へ
            </Link>
          )}
        </div>
      </CommandForm>
    </Panel>
  );
}
function RecordField({
  name,
  rule,
  value,
}: {
  name: string;
  rule: FieldRule;
  value?: Version["entries"][string];
}) {
  const id = `entry-${name}`,
    inputName = `entry:${name}`,
    label = `${fieldLabels[name] ?? name}${rule.required ? "（提出時に必須）" : ""}`;
  const props = {
    id,
    name: inputName,
    defaultValue: value === null || value === undefined ? "" : String(value),
    "aria-describedby": `${id}-hint`,
  };
  return (
    <div className="ui-stack gap-2">
      <Field
        id={id}
        label={label}
        hint={
          rule.type === "integer" || rule.type === "number"
            ? `${rule.minimum ?? "制限なし"}〜${rule.maximum ?? "制限なし"}`
            : `文字数上限：${rule.max_length ?? "制限なし"}`
        }
      >
        {rule.type === "boolean" ? (
          <Select {...props}>
            <option value="">未入力</option>
            <option value="true">実施</option>
            <option value="false">未実施</option>
          </Select>
        ) : rule.enum ? (
          <Select {...props}>
            <option value="">未選択</option>
            {rule.enum.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        ) : rule.type === "string" ? (
          <Textarea {...props} maxLength={rule.max_length} rows={3} />
        ) : (
          <Input
            {...props}
            type="text"
            inputMode={rule.type === "integer" ? "numeric" : "decimal"}
          />
        )}
      </Field>
      <div className="ui-actions">
        <label className="workspace-check ui-hint">
          <input type="checkbox" name={`remove:${name}`} value="1" />
          この項目の値を除去する
        </label>
        {rule.nullable && (
          <label className="workspace-check ui-hint">
            <input
              type="checkbox"
              name={`null:${name}`}
              value="1"
              defaultChecked={value === null}
            />
            値なし（null）として保存
          </label>
        )}
      </div>
    </div>
  );
}
export function VersionDetails({ version }: { version: Version }) {
  return (
    <>
      <dl className="workspace-summary">
        <div>
          <dt>記録版</dt>
          <dd>
            v{version.version_no}{" "}
            <Badge
              tone={version.status === "submitted" ? "success" : "warning"}
            >
              {version.status === "submitted" ? "提出済み" : "下書き"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>提出日時</dt>
          <dd>{formatDate(version.submitted_at)}</dd>
        </div>
        <div>
          <dt>版のID</dt>
          <dd>{version.id}</dd>
        </div>
      </dl>
      <table className="ui-table mt-5">
        <tbody>
          {Object.entries(version.entries).map(([key, value]) => (
            <tr key={key}>
              <th scope="row">{fieldLabels[key] ?? key}</th>
              <td>
                {value === null
                  ? "値なし（null）"
                  : typeof value === "boolean"
                    ? value
                      ? "実施"
                      : "未実施"
                    : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
export function RecordScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const version = selectedVersion(
    snapshot.versions,
    recordId,
    search.get("version"),
  );
  if (!version) return <EmptyState title="記録版が見つかりません" />;
  const path = `${base}/cases/${item.id}/records/${recordId}`;
  const answers =
    snapshot.workflow?.answers.filter((a) => a.versionId === version.id) ?? [];
  return (
    <>
      <Panel
        title="記録の内容"
        actions={
          canWrite(snapshot.context, item) && (
            <Link
              className="ui-link-button"
              to={`${path}/${version.status === "draft" ? "edit" : "correct"}?version=${version.id}`}
            >
              {version.status === "draft" ? "下書きを編集" : "訂正・補足"}
            </Link>
          )
        }
      >
        <VersionDetails version={version} />
        <div className="workspace-statuses mt-5">
          <div>
            <small>相手の回答</small>
            <Badge tone="warning">
              {!snapshot.workflow
                ? "現在は確認できません"
                : answers.length
                  ? answers.map((a) => `${a.kind}：${a.response}`).join(" / ")
                  : "未回答"}
            </Badge>
          </div>
          <div>
            <small>外部登録</small>
            <Badge>
              {snapshot.workflow
                ? (snapshot.workflow.registration[version.id] ?? "未登録")
                : "現在は確認できません"}
            </Badge>
          </div>
          <div>
            <small>内容の照合</small>
            <Badge>
              {snapshot.workflow
                ? (snapshot.workflow.verification[version.id] ?? "未実施")
                : "現在は確認できません"}
            </Badge>
          </div>
        </div>
        {version.change_reason && (
          <Alert>訂正・補足の理由：{version.change_reason}</Alert>
        )}
      </Panel>
      <Panel title="写真・提出">
        <div className="ui-actions">
          <Link
            className="ui-text-link"
            to={`${path}/photos?version=${version.id}`}
          >
            撮影・写真を確認
          </Link>
          {version.status === "draft" && canWrite(snapshot.context, item) && (
            <Link
              className="ui-link-button"
              to={`${path}/submit?version=${version.id}`}
            >
              提出前確認へ
            </Link>
          )}
        </div>
      </Panel>
      <Panel title="版履歴">
        <ol className="workspace-timeline">
          {snapshot.versions
            .filter((v) => v.record_id === recordId)
            .sort((a, b) => b.version_no - a.version_no)
            .map((v) => (
              <li key={v.id}>
                <Link className="ui-text-link" to={`${path}?version=${v.id}`}>
                  v{v.version_no}・
                  {v.status === "submitted" ? "提出済み" : "下書き"}
                </Link>
                <p className="ui-muted">
                  {v.change_reason || "最初の記録"} / {formatDate(v.created_at)}
                </p>
              </li>
            ))}
        </ol>
      </Panel>
    </>
  );
}
