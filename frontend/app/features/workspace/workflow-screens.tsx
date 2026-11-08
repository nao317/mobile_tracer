import { CarFront, CheckCircle2, CircleAlert, Camera } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Panel,
  Select,
  TextField,
  Textarea,
} from "../../components/ui/primitives";
import {
  canManage,
  canWrite,
  fieldLabels,
  formatDate,
  rulesFor,
  type BusinessCase,
  type Photo,
  type Version,
} from "./model";
import { CommandForm, CommandSubmit } from "./command-form";
import { photoPositions } from "./preview-data";
import { VersionDetails } from "./core-screens";
import { useWorkspace } from "./workspace-context";

export function useCaseVersion(item: BusinessCase, recordId?: string) {
  const { snapshot } = useWorkspace();
  const [search] = useSearchParams();
  const versions = snapshot.versions
    .filter(
      (v) => v.case_id === item.id && (!recordId || v.record_id === recordId),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.version_no - a.version_no,
    );
  const id = search.get("version");
  const version = id
    ? versions.find((v) => v.id === id)
    : (versions.find((v) => v.status === "draft") ?? versions[0]);
  return { versions, version };
}
export function VersionPicker({
  versions,
  selected,
  name = "version",
  label = "対象の記録版",
}: {
  versions: Version[];
  selected?: Version;
  name?: string;
  label?: string;
}) {
  const [search, setSearch] = useSearchParams();
  return (
    <Field id={`select-${name}`} label={label}>
      <Select
        id={`select-${name}`}
        value={selected?.id ?? ""}
        onChange={(event) => {
          const next = new URLSearchParams(search);
          next.set(name, event.target.value);
          setSearch(next);
        }}
      >
        <option value="" disabled>
          記録版を選択してください
        </option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.record_id.slice(-6)} / v{v.version_no} /{" "}
            {v.status === "submitted" ? "提出済み" : "下書き"}
          </option>
        ))}
      </Select>
    </Field>
  );
}
export function PhotoCard({
  photo,
  position,
  variant = "internal",
}: {
  photo?: Photo;
  position: string;
  variant?: "internal" | "public";
}) {
  const { snapshot } = useWorkspace();
  const masked =
    variant === "public" &&
    !!photo &&
    snapshot.workflow?.publicMasks?.[photo.id];
  return (
    <article className="workspace-photo">
      <div className="workspace-photo-visual">
        {masked ? (
          <span>公開用マスク表示</span>
        ) : photo?.src ? (
          <img
            src={photo.src}
            alt={`${position}の撮影原本`}
            width={640}
            height={480}
            className="w-full h-40 object-cover"
            loading="lazy"
          />
        ) : (
          <CarFront aria-hidden="true" />
        )}
      </div>
      <div className="workspace-photo-caption">
        <div className="ui-actions">
          <strong>{position}</strong>
          <Badge
            tone={
              !photo || photo.status === "failed"
                ? "danger"
                : photo.status === "exception"
                  ? "warning"
                  : "success"
            }
          >
            {!photo
              ? "未撮影"
              : photo.status === "failed"
                ? "送信失敗"
                : photo.status === "exception"
                  ? "撮影不能・承認済み"
                  : "保存済み"}
          </Badge>
        </div>
        <p>{photo?.note || "箇所の状態が分かるように撮影してください。"}</p>
        {photo && variant === "internal" && (
          <details>
            <summary>原本・撮影情報</summary>
            <p>{photo.name}</p>
            <p>サーバー受信日時（サンプル）：{formatDate(photo.receivedAt)}</p>
            <p>撮影日時：端末申告なし</p>
            {photo.src && (
              <a
                className="ui-text-link"
                href={photo.src}
                target="_blank"
                rel="noreferrer"
              >
                原本を開く
              </a>
            )}
            {photo.status === "exception" && <p>承認者：サンプル責任者</p>}
          </details>
        )}
      </div>
    </article>
  );
}
export function PhotosScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item, recordId);
  if (!version) return <EmptyState title="記録版が見つかりません" />;
  const photos = snapshot.workflow!.photos.filter(
      (p) => p.versionId === version.id,
    ),
    editable = version.status === "draft" && canWrite(snapshot.context, item);
  return (
    <>
      <Panel title="撮影・点検">
        <VersionPicker versions={versions} selected={version} />
        <p className="ui-muted mt-4">
          各箇所の全体と傷が分かる写真を記録します。原本と注釈は分けて扱います。
        </p>
        <div className="ui-grid mt-5">
          {photoPositions[item.case_type].map((position) => (
            <PhotoCard
              key={position}
              position={position}
              photo={photos.find((p) => p.position === position)}
            />
          ))}
        </div>
      </Panel>
      {editable && (
        <Panel title="写真の追加・撮り直し">
          <CommandForm
            intent="photo"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <Field id="photo-position" label="撮影箇所">
              <Select id="photo-position" name="position">
                {photoPositions[item.case_type].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field
              id="photo"
              label="写真原本"
              hint="JPEG・PNG・WebP、1枚10MB以内。端末内のファイルを選択できます。"
            >
              <input
                id="photo"
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="ui-input"
              />
            </Field>
            <TextField
              id="photo-note"
              name="note"
              label="状態・傷の説明／撮影不能の理由"
              maxLength={2000}
            />
            {canManage(snapshot.context, item.store_id) && (
              <label className="workspace-check">
                <input type="checkbox" name="exception" value="1" />
                撮影不能の理由を確認し、責任者として例外を承認する
              </label>
            )}
            <label className="workspace-check">
              <input type="checkbox" name="simulateFailure" value="1" />
              送信失敗の表示を試す（プレビュー用）
            </label>
            <CommandSubmit>写真をプレビューに反映</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
    </>
  );
}
export function SubmitScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { snapshot, base } = useWorkspace();
  const { version } = useCaseVersion(item, recordId);
  const record = snapshot.records.find((r) => r.id === recordId);
  if (!version || !record) return <EmptyState title="記録版が見つかりません" />;
  const required = Object.entries(
    rulesFor(snapshot, item)?.record_kinds[record.record_kind]?.fields ?? {},
  ).filter(([, rule]) => rule.required);
  const missing = required.filter(
    ([key]) =>
      version.entries[key] === undefined ||
      version.entries[key] === null ||
      version.entries[key] === "",
  );
  const photos = snapshot.workflow!.photos.filter(
    (p) => p.versionId === version.id,
  );
  const photoMissing = photoPositions[item.case_type].filter(
    (position) =>
      !photos.some((p) => p.position === position && p.status !== "failed"),
  );
  return (
    <>
      <Panel title="提出前確認">
        <VersionDetails version={version} />
        <div className="ui-stack mt-5">
          <div className="ui-actions">
            {missing.length || photoMissing.length ? (
              <CircleAlert size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )}
            <strong>
              {missing.length || photoMissing.length
                ? "提出に必要な内容が不足しています"
                : "入力・撮影内容を確認できます"}
            </strong>
          </div>
          {missing.length > 0 && (
            <Alert tone="danger">
              未入力：
              {missing.map(([key]) => fieldLabels[key] ?? key).join("、")}
            </Alert>
          )}
          {photoMissing.length > 0 && (
            <Alert tone="danger">
              未完了の撮影箇所：{photoMissing.join("、")}
            </Alert>
          )}
          <p className="ui-muted">
            提出するとこの版の内容を固定します。相手の回答は提出後に別途記録します。署名拒否・無回答でも提出版は保持します。
          </p>
        </div>
      </Panel>
      {version.status === "draft" && canWrite(snapshot.context, item) ? (
        <Panel title="提出する">
          <CommandForm
            intent="submitRecord"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <label className="workspace-check">
              <input type="checkbox" required />
              提出する版と、入力・写真の内容を確認しました
            </label>
            <CommandSubmit>この内容で提出</CommandSubmit>
          </CommandForm>
        </Panel>
      ) : (
        <Alert>この版は提出済み、または提出権限がありません。</Alert>
      )}
      <Link
        className="ui-text-link"
        to={`${base}/cases/${item.id}/records/${recordId}/edit?version=${version.id}`}
      >
        下書きの内容を確認する
      </Link>
    </>
  );
}
export function CorrectScreen({
  item,
  recordId,
}: {
  item: BusinessCase;
  recordId: string;
}) {
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item, recordId);
  return (
    <>
      <Panel title="元の提出版">
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" && (
          <div className="mt-5">
            <VersionDetails version={version} />
          </div>
        )}
      </Panel>
      {version?.status === "submitted" && canWrite(snapshot.context, item) && (
        <Panel title="訂正・補足の作成">
          <CommandForm
            intent="correctRecord"
            hidden={{ caseId: item.id, recordId, versionId: version.id }}
          >
            <Field id="change_kind" label="変更の種類">
              <Select id="change_kind" name="change_kind">
                <option value="correction">訂正</option>
                <option value="supplement">補足</option>
              </Select>
            </Field>
            <Field id="change-reason" label="理由・対象箇所">
              <Textarea
                id="change-reason"
                name="reason"
                required
                maxLength={2000}
              />
            </Field>
            <Alert>
              元の提出版と回答を残して、新しい下書きを作成します。新版には改めて回答を求めます。
            </Alert>
            <CommandSubmit>新しい下書きを作成</CommandSubmit>
          </CommandForm>
        </Panel>
      )}
    </>
  );
}
export function CompareScreen({ item }: { item: BusinessCase }) {
  const { snapshot } = useWorkspace();
  const [search] = useSearchParams();
  const versions = snapshot.versions.filter((v) => v.case_id === item.id),
    before = versions.find((v) => v.id === search.get("before")) ?? versions[0],
    after = versions.find((v) => v.id === search.get("after")) ?? versions[1];
  const fields = [
    ...new Set([
      ...Object.keys(before?.entries ?? {}),
      ...Object.keys(after?.entries ?? {}),
    ]),
  ];
  return (
    <>
      <Panel title="比較する記録版">
        <div className="ui-grid">
          <VersionPicker
            name="before"
            label="比較元"
            versions={versions}
            selected={before}
          />
          <VersionPicker
            name="after"
            label="比較先"
            versions={versions}
            selected={after}
          />
        </div>
      </Panel>
      {!before || !after || before.id === after.id ? (
        <EmptyState title="異なる二つの記録版を選んでください">
          同じ案件の記録を二つ以上作成すると比較できます。
        </EmptyState>
      ) : (
        <>
          <Panel title="項目の比較">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>
                    比較元 v{before.version_no}
                    <span className="workspace-table-subtitle">
                      {before.record_id.slice(-6)} / {before.status}
                    </span>
                  </th>
                  <th>
                    比較先 v{after.version_no}
                    <span className="workspace-table-subtitle">
                      {after.record_id.slice(-6)} / {after.status}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((key) => (
                  <tr key={key}>
                    <th scope="row">{fieldLabels[key] ?? key}</th>
                    <td>{String(before.entries[key] ?? "未記録")}</td>
                    <td>
                      {String(after.entries[key] ?? "未記録")}{" "}
                      {before.entries[key] !== after.entries[key] && (
                        <Badge tone="warning">差分あり</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="写真の比較">
            <div className="ui-stack">
              {photoPositions[item.case_type].map((position) => {
                const a = snapshot.workflow!.photos.find(
                    (p) => p.versionId === before.id && p.position === position,
                  ),
                  b = snapshot.workflow!.photos.find(
                    (p) => p.versionId === after.id && p.position === position,
                  );
                return (
                  <section key={position}>
                    <h3 className="font-semibold mb-3">{position}</h3>
                    <div className="ui-grid">
                      <PhotoCard photo={a} position={`比較元・${position}`} />
                      <PhotoCard photo={b} position={`比較先・${position}`} />
                    </div>
                    {(!a ||
                      !b ||
                      a.status !== "saved" ||
                      b.status !== "saved") && (
                      <Alert tone="warning">
                        比較不能：両方の原本写真がそろっていません。
                      </Alert>
                    )}
                  </section>
                );
              })}
            </div>
          </Panel>
          {canWrite(snapshot.context, item) && (
            <Panel title="担当者の判定">
              <CommandForm
                intent="manage"
                hidden={{
                  kind: "comparison",
                  name: `${before.id} → ${after.id}`,
                  status: "判定記録",
                }}
              >
                <Field id="comparison-detail" label="差分の判定と根拠">
                  <Textarea id="comparison-detail" name="detail" required />
                </Field>
                <CommandSubmit>判定を記録</CommandSubmit>
              </CommandForm>
              {snapshot
                .workflow!.management.filter((m) => m.kind === "comparison")
                .map((m) => (
                  <p key={m.id} className="ui-muted mt-4">
                    {m.detail}
                  </p>
                ))}
            </Panel>
          )}
        </>
      )}
    </>
  );
}
export function AnswersScreen({ item }: { item: BusinessCase }) {
  const { snapshot, base } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  const [kind, setKind] = useState("受領");
  const options: Record<string, string[]> = {
    閲覧: ["閲覧", "拒否", "保留"],
    受領: ["受領", "拒否", "保留"],
    状態同意: ["同意", "拒否", "保留"],
    作業承認: ["承認", "拒否", "保留"],
  };
  const submitted = versions.filter((v) => v.status === "submitted");
  return (
    <>
      <Panel title="確認の対象">
        <VersionPicker
          versions={submitted}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" ? (
          <div className="mt-5">
            <VersionDetails version={version} />
          </div>
        ) : (
          <p className="ui-muted">提出済みの版を選択してください。</p>
        )}
      </Panel>
      {version?.status === "submitted" && (
        <>
          <Panel title="確認依頼">
            <CommandForm
              intent="requestConfirmation"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="request-person"
                name="person"
                label="依頼先"
                required
              />
              <Field id="request-kind" label="確認の種別">
                <Select id="request-kind" name="kind">
                  {Object.keys(options).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <TextField
                id="request-deadline"
                name="deadline"
                type="datetime-local"
                label="回答期限"
                required
              />
              <CommandSubmit>確認依頼を作成</CommandSubmit>
            </CommandForm>
          </Panel>
          <Panel title="回答を記録">
            <CommandForm
              intent="answer"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="answer-person"
                name="person"
                label="回答者名（プレビュー用）"
                required
              />
              <Field id="answer-kind" label="確認種別">
                <Select
                  id="answer-kind"
                  name="kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  {Object.keys(options).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              <Field id="answer-response" label="回答">
                <Select key={kind} id="answer-response" name="response">
                  {options[kind].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              <Field id="answer-text" label="提示する確認文面">
                <Textarea
                  id="answer-text"
                  name="text"
                  key={kind}
                  defaultValue={`${kind}の対象は、この画面で指定した記録版です。${kind === "受領" ? "受領は状態への同意・作業承認を含みません。" : kind === "作業承認" ? `作業範囲：${version.entries.work_scope ?? "未記録"}、金額：${version.entries.estimate ?? "未記録"}円。` : ""}`}
                  required
                />
              </Field>
              <label className="workspace-check">
                <input type="checkbox" required />
                対象版・確認文面・回答内容を確認しました
              </label>
              <CommandSubmit>この版への回答を記録</CommandSubmit>
            </CommandForm>
          </Panel>
          <Panel title="この版への回答履歴">
            {snapshot.workflow!.answers.filter(
              (a) => a.versionId === version.id,
            ).length ? (
              <ol className="workspace-timeline">
                {snapshot
                  .workflow!.answers.filter((a) => a.versionId === version.id)
                  .map((a) => (
                    <li key={a.id}>
                      <strong>{a.person}</strong>{" "}
                      <Badge
                        tone={
                          a.response === "拒否"
                            ? "danger"
                            : a.response === "保留"
                              ? "warning"
                              : "info"
                        }
                      >
                        {a.kind}：{a.response}
                      </Badge>
                      <p>{a.text}</p>
                      <p className="ui-muted">{formatDate(a.at)}</p>
                      <Link
                        className="ui-text-link"
                        to={`${base}/receipts/${a.id}`}
                      >
                        本人控えを開く
                      </Link>
                    </li>
                  ))}
              </ol>
            ) : (
              <EmptyState title="この版は未回答です">
                旧版への回答を、この版の回答として扱いません。
              </EmptyState>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
export function DisputesScreen({ item }: { item: BusinessCase }) {
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  return (
    <>
      <Panel title="異議を登録">
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" && (
          <CommandForm
            intent="newDispute"
            hidden={{ caseId: item.id, versionId: version.id }}
          >
            <Field id="dispute-text" label="異議・確認したい内容">
              <Textarea id="dispute-text" name="text" required />
            </Field>
            <CommandSubmit>異議を登録</CommandSubmit>
          </CommandForm>
        )}
      </Panel>
      {snapshot
        .workflow!.disputes.filter((d) => d.caseId === item.id)
        .map((d) => (
          <Panel
            key={d.id}
            title={d.text}
            actions={
              <Badge tone={d.status === "解決" ? "success" : "warning"}>
                {d.status}
              </Badge>
            }
          >
            <p className="ui-muted">対象版：{d.versionId}</p>
            <ol className="workspace-timeline">
              {d.history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
            {canManage(snapshot.context, item.store_id) && (
              <details className="workspace-details">
                <summary>対応・再確認の経緯を追加する</summary>
                <CommandForm
                  intent="advanceDispute"
                  hidden={{ caseId: item.id, disputeId: d.id }}
                >
                  <Field id={`dispute-status-${d.id}`} label="対応状態">
                    <Select id={`dispute-status-${d.id}`} name="status">
                      {["対応中", "再確認待ち", "解決", "再開"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  </Field>
                  <TextField
                    id={`dispute-note-${d.id}`}
                    name="note"
                    label="対応内容・担当者"
                    required
                  />
                  <CommandSubmit>経緯を追加</CommandSubmit>
                </CommandForm>
              </details>
            )}
          </Panel>
        ))}
    </>
  );
}
export function SharingScreen({ item }: { item: BusinessCase }) {
  const { snapshot, base } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  return (
    <>
      <Panel title="共有する版・範囲">
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
        {version?.status === "submitted" &&
          canManage(snapshot.context, item.store_id) && (
            <CommandForm
              intent="share"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <TextField
                id="recipient"
                name="recipient"
                label="共有相手"
                required
              />
              <TextField
                id="expires"
                name="expires"
                type="datetime-local"
                label="共有期限"
                required
              />
              <Field id="scope" label="共有範囲">
                <Select id="scope" name="scope">
                  <option>状態記録・写真（個人情報を除く）</option>
                  <option>状態記録のみ（個人情報を除く）</option>
                </Select>
              </Field>
              <Alert>
                過去の利用者の氏名・連絡先・署名は共有しません。写真の個人情報は公開前に確認してください。
              </Alert>
              <label className="workspace-check">
                <input type="checkbox" required />
                共有先の画面で、公開する項目とマスキングを確認しました
              </label>
              <CommandSubmit>限定共有を作成</CommandSubmit>
            </CommandForm>
          )}
      </Panel>
      {version?.status === "submitted" &&
        canManage(snapshot.context, item.store_id) && (
          <Panel title="公開前の写真確認">
            <p className="ui-muted">
              原本を保持したまま、共有先に表示する範囲を確認します。プレビューでは選んだ写真を非公開の表示に置き換えます。
            </p>
            <div className="ui-grid">
              {snapshot
                .workflow!.photos.filter(
                  (photo) => photo.versionId === version.id,
                )
                .map((photo) => (
                  <div className="ui-stack" key={photo.id}>
                    <PhotoCard photo={photo} position={photo.position} />
                    <CommandForm
                      intent="maskPhoto"
                      hidden={{
                        caseId: item.id,
                        versionId: version.id,
                        photoId: photo.id,
                      }}
                    >
                      <label className="workspace-check">
                        <input
                          type="checkbox"
                          name="masked"
                          value="1"
                          defaultChecked={
                            snapshot.workflow!.publicMasks?.[photo.id] ?? false
                          }
                        />
                        この写真を共有先で非公開にする
                      </label>
                      <CommandSubmit>公開表示に反映</CommandSubmit>
                    </CommandForm>
                  </div>
                ))}
            </div>
          </Panel>
        )}
      <Panel title="共有履歴">
        <div className="ui-stack">
          {snapshot
            .workflow!.shares.filter((s) =>
              snapshot.versions.some(
                (v) => v.id === s.versionId && v.case_id === item.id,
              ),
            )
            .map((s) => (
              <div key={s.id}>
                <strong>{s.recipient}</strong>{" "}
                <Badge tone={s.status === "active" ? "info" : "warning"}>
                  {s.status === "active"
                    ? "共有中"
                    : s.status === "revoked"
                      ? "取消済み"
                      : "期限切れ"}
                </Badge>
                <p className="ui-muted">
                  {s.scope} / 期限：{formatDate(s.expires)}
                </p>
                <div className="ui-actions">
                  <Link
                    className="ui-text-link"
                    to={`${base}/recipient/${s.id}`}
                  >
                    共有先の表示を確認
                  </Link>
                  {s.status === "active" &&
                    canManage(snapshot.context, item.store_id) && (
                      <details>
                        <summary>共有を取り消す</summary>
                        <CommandForm
                          intent="revokeShare"
                          hidden={{ caseId: item.id, shareId: s.id }}
                        >
                          <label className="workspace-check">
                            <input type="checkbox" required />
                            新しいアクセスを停止します。本人控えと取得済み帳票は別に扱います。
                          </label>
                          <CommandSubmit variant="danger">
                            共有を取り消す
                          </CommandSubmit>
                        </CommandForm>
                      </details>
                    )}
                </div>
              </div>
            ))}
        </div>
      </Panel>
    </>
  );
}
export function VerificationScreen({ item }: { item: BusinessCase }) {
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  if (!version) return <EmptyState title="記録がありません" />;
  const registration = snapshot.workflow!.registration[version.id] ?? "未登録",
    verification = snapshot.workflow!.verification[version.id] ?? "未実施";
  return (
    <>
      <Panel title="対象版">
        <VersionPicker versions={versions} selected={version} />
        <div className="mt-5">
          <VersionDetails version={version} />
        </div>
      </Panel>
      <div className="ui-grid">
        <Panel title="外部登録">
          <Badge
            tone={
              registration === "失敗"
                ? "danger"
                : registration === "登録済み"
                  ? "success"
                  : "warning"
            }
          >
            {registration}
          </Badge>
          <p className="ui-muted mt-4">
            対象：{version.id}
            <br />
            方式：独立基準への登録（プレビュー）
          </p>
          {version.status === "submitted" &&
            canManage(snapshot.context, item.store_id) && (
              <CommandForm
                intent="retryRegistration"
                hidden={{ caseId: item.id, versionId: version.id }}
              >
                <label className="workspace-check">
                  <input type="checkbox" required />
                  既存の登録結果を照会し、二重登録がないことを確認しました
                </label>
                <CommandSubmit>結果を照会して再試行</CommandSubmit>
              </CommandForm>
            )}
        </Panel>
        <Panel title="内容の照合">
          <Badge
            tone={
              verification === "不一致"
                ? "danger"
                : verification === "一致"
                  ? "success"
                  : "warning"
            }
          >
            {verification}
          </Badge>
          <p className="ui-muted mt-4">
            一致は、撮影内容の真実性や傷の責任を証明するものではありません。
          </p>
          {version.status === "submitted" && (
            <CommandForm
              intent="verify"
              hidden={{ caseId: item.id, versionId: version.id }}
            >
              <Field id="verification-result" label="確認するサンプル">
                <Select id="verification-result" name="result">
                  <option>一致</option>
                  <option>不一致</option>
                </Select>
              </Field>
              <CommandSubmit>照合結果を確認</CommandSubmit>
            </CommandForm>
          )}
        </Panel>
      </div>
      <Panel title="処理履歴">
        <ol className="workspace-timeline">
          {snapshot
            .workflow!.audit.filter((a) => a.target === version.id)
            .map((a) => (
              <li key={a.id}>
                {a.action} / {formatDate(a.at)}
              </li>
            ))}
        </ol>
      </Panel>
    </>
  );
}
function downloadJson(name: string, content: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ExportScreen({ item }: { item: BusinessCase }) {
  const { snapshot } = useWorkspace();
  const { versions, version } = useCaseVersion(item);
  return (
    <>
      <Panel title="出力対象">
        <VersionPicker
          versions={versions.filter((v) => v.status === "submitted")}
          selected={version?.status === "submitted" ? version : undefined}
        />
      </Panel>
      {version?.status === "submitted" && (
        <Panel title="標準帳票プレビュー">
          <p className="ui-muted">
            対象版：{version.id} /
            公開範囲：状態記録・回答・異議・検証状況（担当者向けサンプル）
          </p>
          <VersionDetails version={version} />
          <h3 className="font-semibold mt-5">回答・異議・検証</h3>
          {snapshot
            .workflow!.answers.filter((a) => a.versionId === version.id)
            .map((a) => (
              <p key={a.id}>
                {a.person}：{a.kind} / {a.response}
              </p>
            ))}
          {!snapshot.workflow!.answers.some(
            (a) => a.versionId === version.id,
          ) && <p>未回答</p>}
          {snapshot
            .workflow!.disputes.filter((d) => d.versionId === version.id)
            .map((d) => (
              <p key={d.id}>
                {d.status}：{d.text}
              </p>
            ))}
          <p>
            外部登録：{snapshot.workflow!.registration[version.id] ?? "未登録"}{" "}
            / 照合：{snapshot.workflow!.verification[version.id] ?? "未実施"}
          </p>
          <div className="ui-actions mt-5">
            <Button onClick={() => window.print()}>
              標準帳票を印刷・PDF保存
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                downloadJson(`record-v${version.version_no}.json`, {
                  preview: true,
                  exportedAt: new Date().toISOString(),
                  scope: "担当者向けサンプル",
                  version,
                  answers: snapshot.workflow!.answers.filter(
                    (a) => a.versionId === version.id,
                  ),
                  disputes: snapshot.workflow!.disputes.filter(
                    (d) => d.versionId === version.id,
                  ),
                  registration:
                    snapshot.workflow!.registration[version.id] ?? "未登録",
                  verification:
                    snapshot.workflow!.verification[version.id] ?? "未実施",
                })
              }
            >
              基本データを出力
            </Button>
          </div>
        </Panel>
      )}
    </>
  );
}
export function RecipientScreen({ shareId }: { shareId: string }) {
  const { snapshot, base } = useWorkspace();
  const [search] = useSearchParams();
  const share = snapshot.workflow!.shares.find((s) => s.id === shareId),
    version = snapshot.versions.find((v) => v.id === share?.versionId);
  if (!share || !version) return <EmptyState title="共有が見つかりません" />;
  if (
    share.status !== "active" ||
    Date.parse(share.expires) <= Date.parse(snapshot.asOf ?? "1970-01-01") ||
    search.get("expired") === "1"
  )
    return (
      <EmptyState
        title={
          share.status === "revoked"
            ? "この共有は取り消されました"
            : "共有期限が切れています"
        }
      >
        記録は保持されています。必要な場合は共有元に再共有を依頼してください。
      </EmptyState>
    );
  return (
    <>
      <Panel title="共有された状態記録">
        <p className="ui-muted">
          公開範囲：{share.scope} / 有効期限：{formatDate(share.expires)}
        </p>
        <VersionDetails version={version} />
        {share.scope.includes("写真") && (
          <div className="ui-grid mt-5">
            {snapshot
              .workflow!.photos.filter((p) => p.versionId === version.id)
              .map((p) => (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  position={p.position}
                  variant="public"
                />
              ))}
          </div>
        )}
        <Alert>共有された範囲の履歴です。非掲載の記録や期間があります。</Alert>
        <Link className="ui-text-link" to={`${base}/receipts/${share.id}`}>
          提示された版の本人控えを取得（未回答でも可）
        </Link>
        <Link
          className="ui-text-link"
          to={`${base}/cases/${version.case_id}/answers?version=${version.id}`}
        >
          提示された版に回答する（プレビュー）
        </Link>
      </Panel>
    </>
  );
}
export function ReceiptScreen({ answerId }: { answerId: string }) {
  const { snapshot } = useWorkspace();
  const answer = snapshot.workflow!.answers.find((a) => a.id === answerId),
    presentation = snapshot.workflow!.shares.find(
      (share) => share.id === answerId,
    ),
    version = snapshot.versions.find(
      (v) => v.id === (answer?.versionId ?? presentation?.versionId),
    );
  if (!version) return <EmptyState title="本人控えが見つかりません" />;
  return (
    <Panel title="提示内容と自分の回答">
      <VersionDetails version={version} />
      <h3 className="font-semibold mt-5">自分の回答</h3>
      {answer ? (
        <>
          <p>
            {answer.kind}：{answer.response}
          </p>
          <p>{answer.text}</p>
          <p className="ui-muted">回答日時：{formatDate(answer.at)}</p>
        </>
      ) : (
        <Alert>未回答です。提示された版を控えとして取得できます。</Alert>
      )}
      <div className="ui-actions mt-5">
        <Button onClick={() => window.print()}>本人控えを印刷・PDF保存</Button>
        <Button
          variant="secondary"
          onClick={() =>
            downloadJson("my-receipt.json", { preview: true, version, answer })
          }
        >
          本人控えを取得
        </Button>
      </div>
    </Panel>
  );
}

export function TasksScreen() {
  const { snapshot, base } = useWorkspace();
  const tasks = [
    ...snapshot
      .workflow!.disputes.filter((d) => d.status !== "解決")
      .map((d) => ({
        id: d.id,
        title: d.text,
        status: d.status,
        kind: "異議",
        href: `cases/${d.caseId}/disputes`,
      })),
    ...Object.entries(snapshot.workflow!.registration)
      .filter(([, status]) => status !== "登録済み")
      .map(([id, status]) => ({
        id,
        title: "記録の外部登録",
        status,
        kind: "検証",
        href: `cases/${snapshot.versions.find((v) => v.id === id)?.case_id}/verification?version=${id}`,
      })),
    ...snapshot
      .workflow!.management.filter(
        (m) => m.kind === "confirmation" && m.status === "未回答",
      )
      .map((m) => ({
        id: m.id,
        title: `確認依頼：${m.name}`,
        status: m.status,
        kind: "回答",
        href: `cases/${snapshot.versions.find((v) => m.detail.startsWith(v.id))?.case_id}/answers`,
      })),
  ];
  return (
    <Panel title="未対応の事項">
      {tasks.length ? (
        <table className="ui-table ui-table--responsive">
          <thead>
            <tr>
              <th>内容</th>
              <th>区分</th>
              <th>状態</th>
              <th>担当・期限</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td data-label="内容">
                  <Link to={`${base}/${t.href}`}>{t.title}</Link>
                </td>
                <td data-label="区分">{t.kind}</td>
                <td data-label="状態">
                  <Badge tone="warning">{t.status}</Badge>
                </td>
                <td data-label="担当・期限">サンプル担当者 / 要確認</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState title="未対応事項はありません" />
      )}
    </Panel>
  );
}

export function VehicleHistoryScreen({ vehicleId }: { vehicleId: string }) {
  const { snapshot } = useWorkspace();
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return <EmptyState title="車両が見つかりません" />;
  return (
    <>
      <Panel title="識別情報の履歴">
        <p className="ui-muted">内部ID：{vehicle.id}</p>
        <table className="ui-table ui-table--responsive">
          <thead>
            <tr>
              <th>識別情報</th>
              <th>開始</th>
              <th>終了</th>
              <th>確認</th>
            </tr>
          </thead>
          <tbody>
            {vehicle.identifiers.map((i) => (
              <tr key={i.id}>
                <td data-label="識別情報">
                  {i.kind}：{i.value}
                </td>
                <td data-label="開始">{formatDate(i.valid_from)}</td>
                <td data-label="終了">{formatDate(i.valid_to)}</td>
                <td data-label="確認">
                  {i.verified_at ? "確認済み" : "未確認"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {canManage(snapshot.context) && (
        <>
          <Panel title="識別情報を変更">
            <CommandForm intent="updateIdentifier" hidden={{ vehicleId }}>
              <Field id="history-kind" label="種類">
                <Select id="history-kind" name="kind">
                  <option value="plate_number">ナンバー</option>
                  <option value="chassis_number">車台番号</option>
                  <option value="vin">VIN</option>
                </Select>
              </Field>
              <TextField
                id="history-value"
                name="identifier"
                label="新しい識別情報"
                required
              />
              <CommandSubmit>有効期間を分けて登録</CommandSubmit>
            </CommandForm>
          </Panel>
          <Panel title="所有者の変更">
            <CommandForm
              intent="manage"
              hidden={{ kind: `owner:${vehicleId}`, status: "確認待ち" }}
            >
              <TextField
                id="owner-name"
                name="name"
                label="新しい所有者"
                required
              />
              <TextField
                id="owner-period"
                name="detail"
                label="有効期間・確認根拠"
                required
              />
              <Alert>
                所有者の変更によって過去の利用者情報や他社の履歴を自動公開しません。
              </Alert>
              <CommandSubmit>所有者変更を申請</CommandSubmit>
            </CommandForm>
            {snapshot
              .workflow!.management.filter(
                (m) => m.kind === `owner:${vehicleId}`,
              )
              .map((m) => (
                <p key={m.id}>
                  {m.name} / {m.detail} / {m.status}
                </p>
              ))}
          </Panel>
          <Panel title="重複候補の照合">
            <CommandForm intent="mergeVehicle" hidden={{ vehicleId }}>
              <TextField
                id="candidate"
                name="candidate"
                label="照合候補の内部ID"
                required
              />
              <TextField
                id="merge-reason"
                name="reason"
                label="照合の理由"
                required
              />
              <CommandSubmit>権限者による照合を申請</CommandSubmit>
            </CommandForm>
          </Panel>
        </>
      )}
      <Panel title="原本・点検の案内">
        <p className="ui-muted">
          <Camera size={16} className="inline" aria-hidden="true" />{" "}
          車両の各時点の写真は、それぞれの案件・記録版で確認できます。
        </p>
      </Panel>
    </>
  );
}
