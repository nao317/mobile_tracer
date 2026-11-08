import type { Translator, TranslationKey } from "../../i18n";

const valueKeys = {
  "閲覧": "workflow.value.view",
  "受領": "workflow.value.receipt",
  "状態同意": "workflow.value.condition",
  "作業承認": "workflow.value.work",
  "拒否": "workflow.value.refuse",
  "保留": "workflow.value.hold",
  "同意": "workflow.value.agree",
  "承認": "workflow.value.approve",
  "受付": "workflow.value.received",
  "対応中": "workflow.value.inProgress",
  "再確認待ち": "workflow.value.awaitingReview",
  "解決": "workflow.value.resolved",
  "再開": "workflow.value.reopened",
  "未登録": "workflow.value.unregistered",
  "未実施": "workflow.value.notChecked",
  "登録待ち": "workflow.value.registrationPending",
  "登録済み": "workflow.value.registered",
  "失敗": "workflow.value.failed",
  "検証不能": "workflow.value.unverifiable",
  "確認待ち": "workflow.value.awaitingConfirmation",
  "正面": "workflow.value.front",
  "右前": "workflow.value.frontRight",
  "右後": "workflow.value.rearRight",
  "後面": "workflow.value.rear",
  "左後": "workflow.value.rearLeft",
  "左前": "workflow.value.frontLeft",
  "右側面": "workflow.value.right",
  "左側面": "workflow.value.left",
  "一致": "workflow.match",
  "不一致": "workflow.mismatch",
  "未回答": "workflow.noAnswer",
  "確認済み": "workflow.verified",
  "未確認": "workflow.unverified",
  "状態記録・写真（個人情報を除く）": "workflow.scopePhotos",
  "状態記録のみ（個人情報を除く）": "workflow.scopeRecords",
  "draft": "workflow.draft",
  "submitted": "workflow.submitted"
} as const satisfies Record<string, TranslationKey>;
export function workflowLabel(t: Translator, value: string) {
  const key = valueKeys[value as keyof typeof valueKeys];
  return key ? t(key) : value;
}
