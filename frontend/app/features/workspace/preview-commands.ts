import {
  canManage,
  canWrite,
  entriesFromForm,
  isTenantAdmin,
  rulesFor,
  settingsSchema,
  type CommandResult,
  type WorkspaceData,
} from "./model";
import { photoPositions } from "./preview-data";

const value = (form: FormData, name: string) => String(form.get(name) ?? "");
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
export function executePreview(
  source: WorkspaceData,
  form: FormData,
): { snapshot: WorkspaceData; result: CommandResult } {
  const snapshot = structuredClone(source);
  const workflow = snapshot.workflow!;
  const intent = value(form, "intent");
  const item = snapshot.cases.find((c) => c.id === value(form, "caseId"));
  const record = snapshot.records.find(
    (r) => r.id === value(form, "recordId") && (!item || r.case_id === item.id),
  );
  const version = snapshot.versions.find(
    (v) =>
      v.id === value(form, "versionId") &&
      (!record || v.record_id === record.id) &&
      (!item || v.case_id === item.id),
  );
  const fail = (
    code: string,
    error: string,
    fields?: Record<string, string[]>,
  ) => ({
    snapshot: source,
    result: { code, error, fields },
  });
  const isRecipientAnswer = intent === "answer";
  const adminCommands = [
    "manage",
    "previewConfiguration",
    "applyConfiguration",
    "updateIdentifier",
    "mergeVehicle",
    "share",
    "revokeShare",
    "advanceDispute",
    "retryRegistration",
    "assignCase",
    "maskPhoto",
  ];
  if (
    adminCommands.includes(intent) &&
    !canManage(snapshot.context, item?.store_id)
  )
    return fail("forbidden", "この操作を行う権限がありません。");
  if (
    ["createVehicle", "updateVehicle"].includes(intent) &&
    !isTenantAdmin(snapshot.context)
  )
    return fail("vehicle_admin_required", "車両の登録・更新には企業管理者の権限が必要です。");
  if (
    item &&
    !isRecipientAnswer &&
    ![
      "newDispute",
      "advanceDispute",
      "share",
      "revokeShare",
      "retryRegistration",
      "verify",
      "maskPhoto",
    ].includes(intent) &&
    !canWrite(snapshot.context, item)
  )
    return fail(
      "case_not_writable",
      "この案件を変更する権限がありません。完了・中止済みの案件は編集できません。",
    );
  let redirectTo: string | undefined;
  if (intent === "createVehicle") {
    if (
      value(form, "model_name").length > 200 ||
      value(form, "identifier").length > 100
    )
      return fail("vehicle_input_too_long", "車種名・識別情報の文字数を確認してください。");
    const id = newId(),
      identifier = value(form, "identifier");
    if (
      identifier &&
      snapshot.vehicles.some((v) =>
        v.identifiers.some((i) => i.value === identifier),
      )
    )
      return fail("duplicate_identifier", "同じ識別情報の車両があります。重複候補を確認してください。");
    snapshot.vehicles.unshift({
      id,
      model_name: value(form, "model_name") || null,
      created_at: now(),
      identifiers: identifier
        ? [
            {
              id: newId(),
              kind: value(form, "kind"),
              value: identifier,
              valid_from: now(),
              valid_to: null,
              verified_at: null,
            },
          ]
        : [],
    });
    redirectTo = `vehicles/${id}`;
  } else if (intent === "updateVehicle") {
    const vehicle = snapshot.vehicles.find(
      (v) => v.id === value(form, "vehicleId"),
    );
    if (!vehicle) return fail("vehicle_not_found", "車両が見つかりません。");
    vehicle.model_name = value(form, "model_name") || null;
  } else if (intent === "createCase") {
    if (!canWrite(snapshot.context))
      return fail("forbidden", "案件を作成する権限がありません。");
    const type = value(form, "case_type");
    if (type !== "rental" && type !== "dealer" && type !== "repair")
      return fail("business_type_required", "業態を選択してください。");
    if (
      !snapshot.vehicles.some((v) => v.id === value(form, "vehicle_id")) ||
      !snapshot.context.stores.some((s) => s.id === value(form, "store_id"))
    )
      return fail("case_selection_required", "店舗と車両を選択してください。");
    const config = snapshot.context.configuration!;
    const id = newId();
    snapshot.cases.unshift({
      id,
      vehicle_id: value(form, "vehicle_id"),
      store_id: value(form, "store_id"),
      case_type: type,
      configuration_version_id: config.id,
      stage: config.settings.businesses[type].stages[0],
      assignee_id: value(form, "assign_self")
        ? snapshot.context.principal.staff_id
        : null,
      status: "in_progress",
      created_by: snapshot.context.principal.staff_id,
      created_at: now(),
    });
    redirectTo = `cases/${id}`;
  } else if (intent === "createRecord" || intent === "updateDraft") {
    if (!item) return fail("case_not_found", "案件が見つかりません。");
    const kind =
      intent === "createRecord"
        ? value(form, "record_kind")
        : (record?.record_kind ?? "");
    const fields = rulesFor(snapshot, item)?.record_kinds[kind]?.fields;
    if (!fields) return fail("invalid_record_kind", "この案件で利用できる記録種別を選んでください。");
    if (
      intent === "updateDraft" &&
      (!version ||
        version.status !== "draft" ||
        version.lock_version !== Number(value(form, "lock_version")))
    )
      return fail(
        "version_conflict",
        "別の更新が保存されています。入力を控えてから最新の版を開き、差分を確認してください。",
      );
    const parsed = entriesFromForm(form, fields, version?.entries);
    if (Object.keys(parsed.fields).length)
      return fail("validation_error", "入力内容を確認してください。", parsed.fields);
    if (intent === "createRecord") {
      const id = newId();
      snapshot.records.unshift({
        id,
        case_id: item.id,
        record_kind: kind,
        created_by: snapshot.context.principal.staff_id,
        created_at: now(),
      });
      snapshot.versions.unshift({
        id: newId(),
        case_id: item.id,
        record_id: id,
        version_no: 1,
        status: "draft",
        lock_version: 0,
        configuration_version_id: item.configuration_version_id,
        based_on_version_id: null,
        change_reason: null,
        submitted_at: null,
        created_at: now(),
        entries: parsed.entries,
      });
      redirectTo = `cases/${item.id}/records/${id}/edit`;
    } else {
      version!.entries = parsed.entries;
      version!.lock_version++;
    }
  } else if (intent === "updateCase" && item) {
    const rules = rulesFor(snapshot, item);
    if (!rules?.transitions[item.stage]?.includes(value(form, "stage")))
      return fail("invalid_transition", "許可されていない段階移行です。");
    if (item.case_type === "repair" && value(form, "stage") === "work") {
      const latest = snapshot.versions
        .filter((v) => v.case_id === item.id && v.status === "submitted")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (
        !latest ||
        !workflow.answers.some(
          (a) =>
            a.versionId === latest.id &&
            a.kind === "作業承認" &&
            a.response === "承認",
        )
      )
        return fail("work_approval_required", "最新の見積・作業範囲に対する作業承認が必要です。");
    }
    item.stage = value(form, "stage");
  } else if (intent === "assignCase" && item) {
    item.assignee_id =
      value(form, "assignment") === "self"
        ? snapshot.context.principal.staff_id
        : null;
  } else if (intent === "cancelCase" && item) {
    if (!canManage(snapshot.context, item.store_id))
      return fail("forbidden", "案件を中止する権限がありません。");
    if (!value(form, "reason").trim())
      return fail("cancellation_reason_required", "中止理由を入力してください。", {
        reason: ["中止理由を入力してください。"],
      });
    item.status = "cancelled";
    item.cancel_reason = value(form, "reason");
  } else if (intent === "completeCase" && item) {
    item.status = "completed";
  } else if (intent === "submitRecord" && item && record && version) {
    if (version.status !== "draft")
      return fail("version_not_editable", "提出済みです。訂正は新しい版を作成してください。");
    const fields =
      rulesFor(snapshot, item)?.record_kinds[record.record_kind]?.fields ?? {};
    const missing = Object.entries(fields).filter(
      ([key, rule]) =>
        rule.required &&
        (version.entries[key] === undefined ||
          version.entries[key] === null ||
          version.entries[key] === ""),
    );
    if (missing.length)
      return fail(
        "required_fields_missing",
        `必須項目が未入力です：${missing.map(([key]) => key).join("、")}`,
      );
    const photos = workflow.photos.filter((p) => p.versionId === version.id);
    if (
      photoPositions[item.case_type].some(
        (position) =>
          !photos.some(
            (p) =>
              p.position === position &&
              (p.status === "saved" || p.status === "exception"),
          ),
      )
    )
      return fail(
        "photos_incomplete",
        "未完了の撮影箇所があります。撮影または責任者の例外承認を完了してください。",
      );
    version.status = "submitted";
    version.submitted_at = now();
    workflow.registration[version.id] = "登録待ち";
    redirectTo = `cases/${item.id}/records/${record.id}?version=${version.id}`;
  } else if (intent === "correctRecord" && item && record && version) {
    if (version.status !== "submitted" || !value(form, "reason").trim())
      return fail("correction_reason_required", "提出版と訂正・補足の理由を指定してください。");
    const id = newId();
    snapshot.versions.unshift({
      ...version,
      id,
      version_no:
        Math.max(
          ...snapshot.versions
            .filter((v) => v.record_id === record.id)
            .map((v) => v.version_no),
        ) + 1,
      lock_version: 0,
      status: "draft",
      submitted_at: null,
      based_on_version_id: version.id,
      change_reason: value(form, "reason"),
      created_at: now(),
    });
    workflow.photos.push(
      ...workflow.photos
        .filter((p) => p.versionId === version.id)
        .map((p) => ({ ...p, id: newId(), versionId: id })),
    );
    redirectTo = `cases/${item.id}/records/${record.id}/edit?version=${id}`;
  } else if (intent === "photo" && version) {
    if (version.status !== "draft")
      return fail("submitted_photo_immutable", "提出済みの写真は変更できません。");
    const file = form.get("photo");
    const exception = value(form, "exception") === "1";
    if (
      exception &&
      (!canManage(snapshot.context, item?.store_id) ||
        !value(form, "note").trim())
    )
      return fail("photo_exception_approval_required", "撮影不能の理由と責任者の承認が必要です。");
    if (
      !exception &&
      (!(file instanceof File) ||
        !file.size ||
        file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    )
      return fail("invalid_photo", "10MB以内のJPEG・PNG・WebP画像を選択してください。");
    const position = value(form, "position");
    workflow.photos = workflow.photos.filter(
      (p) => p.versionId !== version.id || p.position !== position,
    );
    workflow.photos.push({
      id: newId(),
      versionId: version.id,
      position,
      name:
        file instanceof File && file.size ? file.name : "撮影不能・責任者承認",
      status: value(form, "simulateFailure")
        ? "failed"
        : exception
          ? "exception"
          : "saved",
      note: value(form, "note"),
      receivedAt: now(),
      src: value(form, "photoSource") || undefined,
    });
  } else if (intent === "answer" && version) {
    if (version.status !== "submitted")
      return fail("submitted_version_required", "提出済みの版を選択してください。");
    const kind = value(form, "kind"),
      response = value(form, "response");
    const allowed: Record<string, string[]> = {
      閲覧: ["閲覧", "拒否", "保留"],
      受領: ["受領", "拒否", "保留"],
      状態同意: ["同意", "拒否", "保留"],
      作業承認: ["承認", "拒否", "保留"],
    };
    if (!allowed[kind]?.includes(response) || !value(form, "person").trim())
      return fail("invalid_answer", "回答者と確認種別に対応する回答を選択してください。");
    workflow.answers.push({
      id: newId(),
      versionId: version.id,
      person: value(form, "person"),
      kind,
      response,
      text: value(form, "text"),
      at: now(),
    });
  } else if (intent === "requestConfirmation" && version) {
    if (version.status !== "submitted")
      return fail("submitted_version_required", "提出済みの版を選択してください。");
    workflow.management.push({
      id: newId(),
      kind: "confirmation",
      name: value(form, "person"),
      detail: `${version.id} / ${value(form, "kind")} / ${value(form, "deadline")}`,
      status: "未回答",
      history: ["画面内の確認依頼を作成"],
    });
  } else if (intent === "newDispute" && item && version) {
    if (!value(form, "text").trim())
      return fail("dispute_text_required", "異議の内容を入力してください。");
    workflow.disputes.push({
      id: newId(),
      caseId: item.id,
      versionId: version.id,
      text: value(form, "text"),
      status: "受付",
      history: ["異議を受け付けました"],
    });
  } else if (intent === "advanceDispute") {
    const dispute = workflow.disputes.find(
      (d) => d.id === value(form, "disputeId"),
    );
    if (!dispute || !value(form, "note").trim())
      return fail("dispute_action_required", "対象と対応内容を指定してください。");
    dispute.status = value(form, "status");
    dispute.history.push(`${dispute.status}：${value(form, "note")}`);
  } else if (intent === "maskPhoto") {
    const photo = workflow.photos.find(
      (photo) =>
        photo.id === value(form, "photoId") && photo.versionId === version?.id,
    );
    if (!photo) return fail("photo_not_found", "写真が見つかりません。");
    workflow.publicMasks = {
      ...workflow.publicMasks,
      [photo.id]: value(form, "masked") === "1",
    };
  } else if (intent === "share" && version) {
    if (version.status !== "submitted")
      return fail("submitted_version_required", "提出済みの版を選んでください。");
    const expires = value(form, "expires");
    if (
      !value(form, "recipient").trim() ||
      !Number.isFinite(Date.parse(expires)) ||
      Date.parse(expires) <= Date.now()
    )
      return fail("invalid_share", "共有相手と将来の有効期限を指定してください。");
    workflow.shares.push({
      id: newId(),
      versionId: version.id,
      recipient: value(form, "recipient"),
      expires,
      scope: value(form, "scope"),
      status: "active",
    });
  } else if (intent === "revokeShare") {
    const share = workflow.shares.find((s) => s.id === value(form, "shareId"));
    if (!share) return fail("share_not_found", "共有が見つかりません。");
    share.status = "revoked";
  } else if (intent === "retryRegistration" && version) {
    workflow.registration[version.id] = "登録済み";
  } else if (intent === "verify" && version) {
    workflow.verification[version.id] =
      workflow.registration[version.id] !== "登録済み"
        ? "検証不能"
        : value(form, "result") === "不一致"
          ? "不一致"
          : "一致";
  } else if (intent === "updateIdentifier") {
    const vehicle = snapshot.vehicles.find(
      (v) => v.id === value(form, "vehicleId"),
    );
    if (!vehicle || !value(form, "identifier").trim())
      return fail("identifier_required", "車両と新しい識別情報を指定してください。");
    for (const identifier of vehicle.identifiers)
      if (identifier.kind === value(form, "kind") && !identifier.valid_to)
        identifier.valid_to = now();
    vehicle.identifiers.push({
      id: newId(),
      kind: value(form, "kind"),
      value: value(form, "identifier"),
      valid_from: now(),
      valid_to: null,
      verified_at: null,
    });
  } else if (intent === "mergeVehicle") {
    if (!value(form, "reason").trim())
      return fail("merge_reason_required", "照合・関連付けの理由を入力してください。");
    workflow.management.push({
      id: newId(),
      kind: "merge",
      name: value(form, "candidate"),
      detail: value(form, "reason"),
      status: "照合待ち",
      history: ["重複候補の照合を申請"],
    });
  } else if (intent === "previewConfiguration") {
    const current = snapshot.context.configuration!;
    const business = value(form, "business"),
      settings = structuredClone(current.settings);
    if (
      !settings.businesses[business] ||
      !value(form, "name").trim() ||
      !value(form, "reason").trim()
    )
      return fail("configuration_input_required", "構成名・業態・変更理由を指定してください。");
    const field =
      settings.businesses[business].record_kinds.inspection.fields.odometer;
    const previous = field.required ?? false;
    field.required = value(form, "required_odometer") === "1";
    workflow.management.push({
      id: newId(),
      kind: "configuration",
      name: value(form, "name"),
      detail: JSON.stringify(settings),
      status: "試行済み",
      history: [
        `変更元：${current.id}`,
        `走行距離の必須：${previous} → ${field.required}`,
        `理由：${value(form, "reason")}`,
        "新規案件のみ対象・既存案件と提出版は旧構成を保持",
      ],
    });
  } else if (intent === "applyConfiguration") {
    const configuration = workflow.management.find(
      (m) => m.id === value(form, "managementId") && m.kind === "configuration",
    );
    const parsed = settingsSchema.safeParse(
      JSON.parse(configuration?.detail ?? "null"),
    );
    if (
      !configuration ||
      !parsed.success ||
      configuration.status !== "試行済み"
    )
      return fail("configuration_trial_required", "試行済みの構成版を指定してください。");
    const current = snapshot.context.configuration!;
    snapshot.configurations = {
      ...snapshot.configurations,
      [current.id]: current.settings,
    };
    snapshot.context.configuration = {
      id: configuration.id,
      settings: parsed.data,
    };
    configuration.status = "反映済み";
    configuration.history.push(`反映日時：${now()}・承認者：サンプル管理者`);
  } else if (intent === "manage") {
    const existing = workflow.management.find(
      (m) => m.id === value(form, "managementId"),
    );
    const kind = value(form, "kind");
    if (existing) {
      if (
        existing.kind === "staff" &&
        existing.detail === "企業管理者" &&
        workflow.management.filter(
          (m) =>
            m.kind === "staff" &&
            m.detail === "企業管理者" &&
            m.status === "有効",
        ).length < 2 &&
        value(form, "status") === "停止"
      )
        return fail("last_admin_required", "最後の企業管理者は停止できません。");
      if (existing.kind === "support" && value(form, "status") === "自己承認")
        return fail("support_self_approval_forbidden", "サポート担当者による自己承認はできません。");
      existing.status = value(form, "status");
      existing.history.push(
        `${now()}：${value(form, "note") || existing.status}`,
      );
    } else {
      if (!value(form, "name").trim())
        return fail("management_name_required", "名前または申請理由を入力してください。");
      workflow.management.push({
        id: newId(),
        kind,
        name: value(form, "name"),
        detail: value(form, "detail"),
        status: value(form, "status") || "下書き",
        history: ["作成"],
      });
      if (kind === "store")
        snapshot.context.stores.push({
          id: workflow.management.at(-1)!.id,
          name: value(form, "name"),
        });
    }
  } else return fail("unsupported_operation", "対象または操作を確認してください。");
  workflow.audit.unshift({
    id: newId(),
    at: now(),
    actor: "サンプル担当者",
    action: intent,
    target: version?.id || item?.id || value(form, "name") || "設定",
  });
  return {
    snapshot,
    result: {
      code: "preview_saved",
      message:
        "プレビューに反映しました。実データの保存・通知・外部登録は行っていません。",
      redirectTo,
    },
  };
}
