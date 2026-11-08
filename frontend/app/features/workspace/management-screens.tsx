import { Link } from "react-router";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Select,
  TextField,
  Textarea,
} from "../../components/ui/primitives";
import {
  businessTypes,
  canManage,
  formatDate,
  isTenantAdmin,
  roleLabels,
  type ManagementItem,
} from "./model";
import { CommandForm, CommandSubmit } from "./command-form";
import { useWorkspace } from "./workspace-context";
import { demoCaseIds, demoId } from "./preview-data";
import { coreScreens, screenDefinitions } from "./screens";
import { VersionDetails } from "./core-screens";

function ManagementList({
  items,
  actions = [],
}: {
  items: ManagementItem[];
  actions?: string[];
}) {
  const { snapshot } = useWorkspace();
  if (!items.length) return <EmptyState title="登録はまだありません" />;
  return (
    <div className="ui-stack">
      {items.map((m) => (
        <article key={m.id}>
          <div className="ui-actions">
            <strong>{m.name}</strong>
            <Badge
              tone={
                m.status === "停止" || m.status === "取消済み"
                  ? "warning"
                  : "info"
              }
            >
              {m.status}
            </Badge>
          </div>
          <p className="ui-muted">{m.detail}</p>
          {m.history.length > 0 && (
            <ol className="workspace-timeline">
              {m.history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
          )}
          {actions.length > 0 && canManage(snapshot.context) && (
            <details className="workspace-details">
              <summary>状態・経緯を更新</summary>
              <CommandForm intent="manage" hidden={{ managementId: m.id }}>
                <Field id={`status-${m.id}`} label="次の状態">
                  <Select id={`status-${m.id}`} name="status">
                    {actions.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <TextField
                  id={`note-${m.id}`}
                  name="note"
                  label="理由・対象範囲・確認者"
                  required
                />
                <label className="workspace-check">
                  <input type="checkbox" required />
                  対象と変更内容を確認しました
                </label>
                <CommandSubmit>状態を更新</CommandSubmit>
              </CommandForm>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
export function OrganizationScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="店舗">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "store",
          )}
        />
        {isTenantAdmin(snapshot.context) && (
          <details className="workspace-details">
            <summary>店舗を追加</summary>
            <CommandForm
              intent="manage"
              hidden={{ kind: "store", status: "有効" }}
            >
              <TextField id="store-name" name="name" label="店舗名" required />
              <TextField
                id="store-detail"
                name="detail"
                label="担当する業態"
                required
              />
              <CommandSubmit>店舗を追加</CommandSubmit>
            </CommandForm>
          </details>
        )}
      </Panel>
      <Panel title="担当者・権限">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "staff",
          )}
          actions={["有効", "停止", "招待取消し"]}
        />
        {isTenantAdmin(snapshot.context) && (
          <details className="workspace-details">
            <summary>担当者を招待・役割を付与</summary>
            <CommandForm
              intent="manage"
              hidden={{ kind: "staff", status: "招待中" }}
            >
              <TextField
                id="staff-email"
                name="name"
                type="email"
                label="担当者のメールアドレス"
                required
              />
              <Field id="staff-role" label="役割と対象範囲">
                <Select id="staff-role" name="detail">
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <option value={label} key={role}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="staff-store" label="担当店舗">
                <Select id="staff-store" name="store_id">
                  {snapshot.context.stores.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <CommandSubmit>招待内容を確認して作成</CommandSubmit>
            </CommandForm>
          </details>
        )}
      </Panel>
    </>
  );
}
export function ConfigurationScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="反映済みの設定">
        <p className="ui-muted">構成版：{snapshot.context.configuration?.id}</p>
        <div className="ui-grid">
          {Object.entries(
            snapshot.context.configuration?.settings.businesses ?? {},
          ).map(([key, rules]) => (
            <div key={key}>
              <h3 className="font-semibold">
                {businessTypes[key as keyof typeof businessTypes] ?? key}
              </h3>
              <p className="ui-muted">段階：{rules.stages.join(" → ")}</p>
              <p>記録種別：{Object.keys(rules.record_kinds).join("、")}</p>
              {Object.entries(rules.record_kinds.inspection?.fields ?? {}).map(
                ([key, rule]) => (
                  <p key={key}>
                    {key}：{rule.type} {rule.required ? "提出時に必須" : "任意"}
                  </p>
                ),
              )}
            </div>
          ))}
        </div>
      </Panel>
      {isTenantAdmin(snapshot.context) && (
        <Panel title="設定変更を試行">
          <CommandForm intent="previewConfiguration">
            <TextField id="config-name" name="name" label="構成名" required />
            <Field id="config-business" label="変更する業態">
              <Select id="config-business" name="business">
                {Object.entries(businessTypes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="workspace-check">
              <input
                type="checkbox"
                name="required_odometer"
                value="1"
                defaultChecked
              />
              走行距離を提出時の必須項目にする
            </label>
            <TextField
              id="config-reason"
              name="reason"
              label="変更理由"
              required
            />
            <Alert>
              既存案件の設定版は保持し、新しい案件に適用する変更を試行します。
            </Alert>
            <CommandSubmit>試行して差分を確認</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
      <Panel title="構成の試行・反映履歴">
        {snapshot
          .workflow!.management.filter((m) => m.kind === "configuration")
          .map((m) => (
            <article key={m.id} className="ui-stack">
              <h3 className="font-semibold">
                {m.name} <Badge>{m.status}</Badge>
              </h3>
              <pre className="workspace-export">{m.history.join("\n")}</pre>
              {isTenantAdmin(snapshot.context) && (
                <CommandForm
                  intent="applyConfiguration"
                  hidden={{ managementId: m.id }}
                >
                  <label className="workspace-check">
                    <input type="checkbox" required />
                    差分・対象・試行結果を確認し、新しい案件へ反映します
                  </label>
                  <CommandSubmit>この構成版を反映</CommandSubmit>
                </CommandForm>
              )}
            </article>
          ))}
        {!snapshot.workflow!.management.some(
          (m) => m.kind === "configuration",
        ) && <EmptyState title="試行した構成はありません" />}
      </Panel>
    </>
  );
}
export function UsageScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="利用状況">
        <dl className="workspace-summary">
          <div>
            <dt>案件数</dt>
            <dd>{snapshot.cases.length}</dd>
          </div>
          <div>
            <dt>車両数</dt>
            <dd>{snapshot.vehicles.length}</dd>
          </div>
          <div>
            <dt>写真数</dt>
            <dd>{snapshot.workflow!.photos.length}</dd>
          </div>
          <div>
            <dt>登録失敗</dt>
            <dd>
              {
                Object.values(snapshot.workflow!.registration).filter(
                  (s) => s === "失敗",
                ).length
              }
            </dd>
          </div>
        </dl>
        <p className="ui-muted mt-5">
          架空データの集計です。記録容量・利用人数の実測値は取得していません。
        </p>
      </Panel>
      <Panel title="容量・集計時刻">
        <Alert tone="warning">
          容量の測定値はありません。容量超過や受付可否は、実測した値を接続した後に表示します。
        </Alert>
      </Panel>
    </>
  );
}
export function AuditScreen() {
  const { snapshot } = useWorkspace();
  const [filter, setFilter] = useState("");
  const audit = snapshot.workflow!.audit.filter((a) =>
    `${a.actor} ${a.action} ${a.target}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <Panel title="操作・アクセスの履歴">
      <TextField
        id="audit-filter"
        label="実行者・操作・対象で絞り込み"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <table className="ui-table ui-table--responsive mt-5">
        <thead>
          <tr>
            <th>日時</th>
            <th>実行者</th>
            <th>操作</th>
            <th>対象</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((a) => (
            <tr key={a.id}>
              <td data-label="日時">{formatDate(a.at)}</td>
              <td data-label="実行者">{a.actor}</td>
              <td data-label="操作">{a.action}</td>
              <td data-label="対象">{a.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!audit.length && <EmptyState title="条件に合う履歴はありません" />}
    </Panel>
  );
}
export function SupportScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="サポート許可">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "support",
          )}
          actions={["取消済み", "期限切れ"]}
        />
      </Panel>
      {isTenantAdmin(snapshot.context) && (
        <Panel title="範囲・期間を限定して許可">
          <CommandForm
            intent="manage"
            hidden={{ kind: "support", status: "許可中" }}
          >
            <TextField
              id="support-name"
              name="name"
              label="サポートの目的"
              required
            />
            <Field id="support-detail" label="対象案件・担当者・有効期間">
              <Textarea
                id="support-detail"
                name="detail"
                required
                placeholder="対象案件、サポート担当者、開始・終了日時を入力…"
              />
            </Field>
            <Alert>
              初期の許可は閲覧に限定します。提供側の管理権限だけでは顧客の本文を閲覧できません。
            </Alert>
            <label className="workspace-check">
              <input type="checkbox" required />
              顧客の管理者として、対象と許可期間を確認しました
            </label>
            <CommandSubmit>閲覧を限定して許可</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
    </>
  );
}
export function DeletionScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="個別の削除申請">
        <Alert>
          記録は継続保存を基本とします。共有期限の終了は記録の削除とは別に扱います。
        </Alert>
        {isTenantAdmin(snapshot.context) && (
          <CommandForm
            intent="manage"
            hidden={{ kind: "deletion", status: "承認待ち" }}
          >
            <TextField
              id="deletion-name"
              name="name"
              label="削除が必要な理由"
              required
            />
            <Field id="deletion-detail" label="対象・保存方針・異議の有無">
              <Textarea id="deletion-detail" name="detail" required />
            </Field>
            <label className="workspace-check">
              <input type="checkbox" required />
              原本消去後は検証不能となること、承認・実行の経緯を残すことを確認しました
            </label>
            <CommandSubmit>削除を申請</CommandSubmit>
          </CommandForm>
        )}
      </Panel>
      <Panel title="申請・承認・実行履歴">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "deletion",
          )}
          actions={[
            "承認済み",
            "異議対応のため保留",
            "差し戻し",
            "実行済み（サンプル）",
          ]}
        />
      </Panel>
    </>
  );
}
export function EnvironmentsScreen() {
  const { snapshot } = useWorkspace();
  return (
    <>
      <Panel title="利用環境">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "environment",
          )}
          actions={["試行中", "顧客確認待ち", "利用中", "作成失敗"]}
        />
      </Panel>
      <Panel title="利用環境・業態テンプレートを作成">
        <CommandForm
          intent="manage"
          hidden={{ kind: "environment", status: "顧客確認待ち" }}
        >
          <TextField
            id="environment-name"
            name="name"
            label="顧客名・利用環境名"
            required
          />
          <Field id="environment-template" label="適用する業態テンプレート">
            <Select id="environment-template" name="detail">
              <option>三業態共通テンプレート</option>
              {Object.values(businessTypes).map((label) => (
                <option key={label}>{label}</option>
              ))}
            </Select>
          </Field>
          <label className="workspace-check">
            <input type="checkbox" required />
            架空の試行データを使用し、顧客の利用開始確認を別途行います
          </label>
          <CommandSubmit>利用環境を作成</CommandSubmit>
        </CommandForm>
      </Panel>
    </>
  );
}
type CsvRow = {
  line: number;
  model: string;
  identifier: string;
  error: string;
};
export function inspectCsv(source: string): CsvRow[] {
  const lines = source.trim().split(/\r?\n/);
  if (lines[0] !== "model_name,plate_number")
    return [
      {
        line: 1,
        model: "",
        identifier: "",
        error: "ヘッダーは model_name,plate_number を指定してください。",
      },
    ];
  const seen = new Set<string>();
  return lines.slice(1, 101).map((line, index) => {
    const columns = line.split(","),
      [model = "", identifier = ""] = columns;
    const error =
      columns.length !== 2 || !model.trim() || !identifier.trim()
        ? "車種名・ナンバーを確認してください。"
        : seen.has(identifier)
          ? "CSV内に同じナンバーがあります。"
          : "";
    seen.add(identifier);
    return { line: index + 2, model, identifier, error };
  });
}
export function ImportsScreen() {
  const { snapshot } = useWorkspace();
  const [source, setSource] = useState(
    "model_name,plate_number\nサンプル車両,サンプル A号\nサンプル車両2,サンプル B号",
  );
  const [preview, setPreview] = useState<CsvRow[] | null>(null);
  return (
    <>
      <Panel title="少量CSVの取込を試行">
        <p className="ui-muted">
          車種名とナンバーの2列を確認します。プレビューでは100行まで、カンマ・改行を含まない値を使用してください。
        </p>
        <Field id="csv-source" label="CSVの内容">
          <Textarea
            id="csv-source"
            rows={6}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <div className="ui-actions mt-4">
          <Button onClick={() => setPreview(inspectCsv(source))}>
            試行して行ごとに確認
          </Button>
        </div>
      </Panel>
      {preview && (
        <Panel title="試行結果">
          <table className="ui-table ui-table--responsive">
            <thead>
              <tr>
                <th>行</th>
                <th>車種名</th>
                <th>ナンバー</th>
                <th>結果</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.line}>
                  <td data-label="行">{row.line}</td>
                  <td data-label="車種名">{row.model}</td>
                  <td data-label="ナンバー">{row.identifier}</td>
                  <td data-label="結果">
                    <Badge tone={row.error ? "danger" : "success"}>
                      {row.error || "取込可能"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <CommandForm
            intent="manage"
            hidden={{
              kind: "import",
              name: "車両CSVの取込",
              detail: `${preview.filter((r) => !r.error).length}件正常 / ${preview.filter((r) => r.error).length}件除外`,
              status: "確認済み・取込結果サンプル",
            }}
          >
            <label className="workspace-check">
              <input type="checkbox" required />
              対象・重複・不正行を確認し、除外件数を記録します
            </label>
            <CommandSubmit>確認済みの取込結果を記録</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
      <Panel title="取込履歴">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "import",
          )}
        />
      </Panel>
    </>
  );
}
export function OperationsScreen() {
  const { snapshot, base } = useWorkspace();
  return (
    <>
      <UsageScreen />
      <Panel title="提供側の運用">
        <p className="ui-muted">
          顧客ごとの件数・容量・失敗状況を確認します。集計を閲覧する権限と、業務本文の閲覧許可は別です。
        </p>
        <div className="ui-actions">
          <Link className="ui-text-link" to={`${base}/operations/environments`}>
            利用環境・テンプレート
          </Link>
          <Link className="ui-text-link" to={`${base}/operations/imports`}>
            CSV取込
          </Link>
          <Link className="ui-text-link" to={`${base}/operations/support`}>
            許可されたサポートアクセス
          </Link>
        </div>
        <p className="ui-hint mt-5">
          サンプル企業：案件{snapshot.cases.length}件 / 失敗
          {
            Object.values(snapshot.workflow!.registration).filter(
              (s) => s === "失敗",
            ).length
          }
          件
        </p>
      </Panel>
    </>
  );
}
export function SupportAccessScreen() {
  const { snapshot } = useWorkspace();
  const [opened, setOpened] = useState(false);
  const permission = snapshot.workflow!.management.find(
    (m) => m.kind === "support" && m.status === "許可中",
  );
  const version = snapshot.versions.find((v) => v.id === demoId(41));
  return (
    <>
      <Panel title="顧客から許可されたアクセス">
        <ManagementList
          items={snapshot.workflow!.management.filter(
            (m) => m.kind === "support",
          )}
        />
        <Alert tone="warning">
          許可された案件・期間・閲覧範囲でアクセスします。自己承認や顧客名義の更新は行えません。
        </Alert>
      </Panel>
      <Panel title="サポート対象を確認">
        <p className="ui-muted">
          サンプル許可：受付記録の閲覧のみ。実際の権限制御はAPI接続後に検証します。
        </p>
        {permission ? (
          <>
            <Button onClick={() => setOpened(true)}>
              許可された記録を閲覧する
            </Button>
            {opened && version && (
              <div className="mt-5">
                <Badge>サポート資格・閲覧限定</Badge>
                <VersionDetails version={version} />
              </div>
            )}
          </>
        ) : (
          <EmptyState title="有効なサポート許可がありません" />
        )}
      </Panel>
    </>
  );
}
export function CatalogScreen() {
  const { base } = useWorkspace();
  const sample: Record<string, string> = {
    vehicleId: demoId(11),
    caseId: demoCaseIds[0],
    recordId: demoId(32),
    shareId: demoId(91),
    answerId: demoId(71),
  };
  return (
    <>
      <PageHeader
        title="画面一覧"
        description="画面ごとの表示・操作を確認できます。上部の役割・表示状態を切り替えると、権限不足や通信失敗も確認できます。"
      />
      <div className="ui-grid">
        {screenDefinitions
          .filter((s) => s.key !== "catalog")
          .map((screen) => (
            <Panel key={screen.key}>
              <div className="workspace-catalog-card">
                <p className="ui-eyebrow">{screen.group}</p>
                <Link
                  to={`${base}/${screen.path.replace(/:(\w+)/g, (_, key: string) => sample[key])}`}
                >
                  {screen.title}
                </Link>
                <Badge tone={coreScreens.has(screen.key) ? "info" : "warning"}>
                  {coreScreens.has(screen.key)
                    ? "実API接続あり"
                    : "プレビューで操作確認"}
                </Badge>
              </div>
            </Panel>
          ))}
      </div>
      <Panel title="三業態の代表フロー">
        <div className="ui-actions">
          {Object.values(businessTypes).map((label, i) => (
            <Link
              key={label}
              className="ui-link-button"
              to={`${base}/cases/${demoCaseIds[i]}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
