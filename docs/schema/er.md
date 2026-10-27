# ER 図（たたき台）

[tables.md](tables.md) のテーブル案を、四つの範囲に分けて描いています。列は主キー、外部キー、状態など関係を読むのに必要なものだけを載せています。全列は [000001_init.up.sql](../../backend/db/migrations/000001_init.up.sql) を見てください。

- ほぼすべてのテーブルが `tenant_id` を持ち、複合外部キーで同じ顧客の行だけを指します。図では `tenant_id` と `tenants` への線を省いています。
- 案件の下の表は `case_id` も持ち、同じ案件の行だけを指します。図では `case_id` を省いています。
- 作った人や取り消した人など、担当者（`staff_members`）や運営側の担当者（`provider_operators`）を指す `_by` の列と線は省いています。
- `integrity` と `audit` のテーブルは、図ではスキーマ名を付けずに書いています。
- 記号は Mermaid の erDiagram の書き方です。`||--o{` は「1 対 0 以上」、`|o--o{` は「0 か 1 対 0 以上」です。

## 組織・構成版・車両・案件

```mermaid
erDiagram
  tenants ||--o{ stores : "店舗"
  tenants ||--o{ staff_members : "担当者"
  staff_members ||--o{ staff_role_assignments : "役割"
  stores |o--o{ staff_role_assignments : "対象店舗"
  provider_operators ||--o{ support_grants : "許可を受ける"
  support_grants ||--o{ support_grant_cases : "開ける案件"
  cases ||--o{ support_grant_cases : ""
  tenants ||--o{ configuration_versions : "構成版"
  configuration_versions |o--o{ configuration_versions : "元の版"
  configuration_versions ||--o{ configuration_modules : "使う業態"
  business_templates ||--o{ configuration_modules : "元のテンプレート"
  provider_operators ||--o{ import_jobs : "試行する"
  import_jobs ||--o{ import_job_rows : "行ごとの結果"
  import_jobs |o--o{ vehicles : "取り込んだ車両"
  vehicles ||--o{ vehicle_identifiers : "車台番号・ナンバー"
  vehicles ||--o{ vehicle_ownerships : "所有者"
  parties ||--o{ vehicle_ownerships : ""
  vehicles ||--o| vehicle_merges : "統合元"
  vehicles ||--o{ vehicle_merges : "統合先"
  stores ||--o{ cases : "案件"
  vehicles ||--o{ cases : "対象の車両"
  configuration_modules ||--o{ cases : "構成版と業態"
  cases ||--o{ case_participants : "関係者"
  parties ||--o{ case_participants : "資格"

  tenants {
    uuid id PK
    text status "provisioning / active / suspended / closed"
  }
  stores {
    uuid id PK
  }
  staff_members {
    uuid id PK
    text email "顧客の中で一意"
    text status "invited / active / suspended"
  }
  staff_role_assignments {
    uuid id PK
    uuid staff_id FK
    text role "tenant_admin / store_manager / staff / auditor"
    uuid store_id FK "NULL は全店舗"
    timestamptz revoked_at
  }
  provider_operators {
    uuid id PK
    text role "admin / onboarding / support"
  }
  support_grants {
    uuid id PK
    uuid operator_id FK
    timestamptz valid_from
    timestamptz valid_to
    timestamptz revoked_at
  }
  support_grant_cases {
    uuid support_grant_id PK
    uuid case_id PK
  }
  business_templates {
    uuid id PK
    text business_type "rental / dealer / repair"
    integer version_no
  }
  configuration_versions {
    uuid id PK
    integer version_no
    text status "draft / trial / published / superseded"
    uuid based_on_id FK
    jsonb settings
  }
  configuration_modules {
    uuid configuration_version_id PK
    text business_type PK
    uuid template_id FK
  }
  import_jobs {
    uuid id PK
    text file_sha256
    text status "trial / confirmed / committed / failed"
  }
  import_job_rows {
    uuid import_job_id PK
    integer row_no PK
    text result "ok / duplicate / error"
  }
  parties {
    uuid id PK
    text kind "person / organization"
    text display_name "個人情報はここだけに持つ"
    timestamptz erased_at
  }
  vehicles {
    uuid id PK
    uuid import_job_id FK
    text source_key
  }
  vehicle_identifiers {
    uuid id PK
    uuid vehicle_id FK
    text kind "chassis_number / vin / plate_number"
    text value
    date valid_to
    timestamptz verified_at
  }
  vehicle_ownerships {
    uuid id PK
    uuid vehicle_id FK
    uuid owner_party_id FK
    date valid_from
    date valid_to
  }
  vehicle_merges {
    uuid source_vehicle_id PK
    uuid target_vehicle_id FK
    text reason
  }
  cases {
    uuid id PK
    uuid store_id FK
    uuid vehicle_id FK
    text case_type FK
    uuid configuration_version_id FK "本番反映した版だけ"
    text stage
    text status "in_progress / completed / cancelled"
  }
  case_participants {
    uuid id PK
    uuid party_id FK
    text qualification
    timestamptz valid_from
    timestamptz valid_to
  }
```

## 記録と写真

```mermaid
erDiagram
  cases ||--o{ records : "記録"
  records ||--o{ record_versions : "版"
  record_versions |o--o{ record_versions : "元の版"
  configuration_versions ||--o{ record_versions : "入力に使った構成版"
  record_versions ||--o{ record_entries : "項目の値"
  cases ||--o{ media_originals : "原本"
  case_participants |o--o{ media_originals : "撮った関係者"
  media_originals ||--o{ media_annotations : "注釈・マスク"
  record_versions ||--o{ record_version_media : "含める写真"
  media_originals ||--o{ record_version_media : ""
  record_versions ||--o{ damage_marks : "傷"
  record_version_media |o--o{ damage_marks : "傷を付けた写真"
  record_versions ||--o{ capture_exceptions : "撮影できなかった箇所"
  record_versions ||--o{ record_comparisons : "比べる元"
  record_versions ||--o{ record_comparisons : "比べる先"

  cases {
    uuid id PK
  }
  configuration_versions {
    uuid id PK
  }
  case_participants {
    uuid id PK
  }
  records {
    uuid id PK
    text record_kind
  }
  record_versions {
    uuid id PK
    uuid record_id FK
    integer version_no
    text status "draft / submitted"
    uuid based_on_version_id FK
    text change_kind "correction / supplement"
    uuid configuration_version_id FK
    jsonb vehicle_snapshot "提出時の車両表示"
    text content_hash
    uuid submit_idempotency_key
  }
  record_entries {
    uuid record_version_id PK
    text item_key PK
    jsonb value
  }
  media_originals {
    uuid id PK
    text sha256
    uuid created_by_staff FK
    uuid created_by_participant FK
    timestamptz device_captured_at
    uuid idempotency_key
    timestamptz deleted_at
  }
  media_annotations {
    uuid id PK
    uuid media_id FK
    text kind "annotation / mask / crop / resize"
    jsonb payload
  }
  record_version_media {
    uuid record_version_id PK
    uuid media_id PK
    text spot_key
  }
  damage_marks {
    uuid id PK
    uuid record_version_id FK
    uuid media_id FK
    numeric x
    numeric y
  }
  capture_exceptions {
    uuid record_version_id PK
    text spot_key PK
    text reason
    timestamptz approved_at
  }
  record_comparisons {
    uuid id PK
    uuid base_version_id FK
    uuid target_version_id FK
    text spot_key
    integer revision_no "大きいほど新しい判定"
    text judgement "no_change / changed / not_comparable"
  }
```

## 異議・確認・共有

```mermaid
erDiagram
  record_versions ||--o{ objections : "異議・差し戻し"
  record_versions |o--o{ objections : "訂正して出し直した版"
  case_participants |o--o{ objections : "出した関係者"
  objections ||--o{ objection_items : "対象の項目"
  record_entries ||--o{ objection_items : ""
  objections ||--o{ objection_evidence : "添えた写真"
  media_originals ||--o{ objection_evidence : ""
  record_versions ||--o{ confirmation_requests : "確認の依頼"
  case_participants ||--o{ confirmation_requests : "依頼の相手"
  objections |o--o{ confirmation_requests : "再確認のもとの異議"
  confirmation_requests ||--o{ confirmation_responses : "回答"
  confirmation_requests ||--o{ request_notifications : "通知"
  confirmation_requests ||--o{ personal_copies : "本人控え"
  confirmation_responses |o--o{ personal_copies : ""
  parties |o--o{ share_grants : "社外の相手"
  tenants |o--o{ share_grants : "事業者の相手"
  share_grants ||--o{ share_grant_targets : "共有する版"
  record_versions ||--o{ share_grant_targets : ""
  share_grant_targets ||--o{ share_grant_items : "見せる項目"
  record_entries ||--o{ share_grant_items : ""
  share_grant_targets ||--o{ share_grant_media : "見せる写真"
  record_version_media ||--o{ share_grant_media : ""
  media_annotations |o--o{ share_grant_media : "掛けるマスク"

  record_versions {
    uuid id PK
  }
  record_entries {
    uuid record_version_id PK
    text item_key PK
  }
  record_version_media {
    uuid record_version_id PK
    uuid media_id PK
  }
  media_originals {
    uuid id PK
  }
  media_annotations {
    uuid id PK
  }
  case_participants {
    uuid id PK
  }
  parties {
    uuid id PK
  }
  tenants {
    uuid id PK
  }
  objections {
    uuid id PK
    uuid record_version_id FK "提出版だけ"
    uuid created_by_staff FK
    uuid created_by_participant FK
    text acceptance "accepted / late_accepted / not_accepted"
    text status "received / in_progress / resolved"
    uuid resolved_version_id FK
  }
  objection_items {
    uuid objection_id PK
    text item_key PK
    uuid record_version_id FK
  }
  objection_evidence {
    uuid objection_id PK
    uuid media_id PK
  }
  confirmation_requests {
    uuid id PK
    uuid record_version_id FK "提出版だけ"
    uuid participant_id FK
    text confirmation_type "view / receipt / condition_agreement / work_approval"
    text statement_key
    integer statement_version
    text statement_text "見せた文面そのもの"
    timestamptz due_at
    uuid objection_id FK
    timestamptz withdrawn_at
  }
  confirmation_responses {
    uuid id PK
    uuid request_id FK
    text confirmation_type FK "依頼の種類の写し"
    text answer
    uuid proxy_by FK
    uuid idempotency_key
  }
  request_notifications {
    uuid id PK
    uuid request_id FK
    text channel "email / sms"
    text status "queued / sent / failed"
  }
  personal_copies {
    uuid id PK
    uuid request_id FK
    uuid response_id FK
    text sha256
    timestamptz deleted_at
  }
  share_grants {
    uuid id PK
    uuid recipient_party_id FK
    uuid recipient_tenant_id FK
    timestamptz expires_at
    text access_token_hash
    timestamptz issued_at "範囲を決めてから発行"
    timestamptz accepted_at
    timestamptz revoked_at
  }
  share_grant_targets {
    uuid share_grant_id PK
    uuid record_version_id PK
  }
  share_grant_items {
    uuid share_grant_id PK
    uuid record_version_id PK
    text item_key PK
  }
  share_grant_media {
    uuid share_grant_id PK
    uuid record_version_id PK
    uuid media_id PK
    uuid mask_annotation_id FK
  }
```

## 検証・削除・監査

```mermaid
erDiagram
  record_versions ||--o{ anchors : "検証基準"
  anchors ||--o{ anchor_transactions : "署名済みのトランザクション"
  anchors ||--o{ anchor_attempts : "登録と照会の試行"
  anchor_transactions ||--o{ anchor_attempts : "送ったか照会したトランザクション"
  record_versions ||--o{ verification_runs : "照合"
  anchors |o--o{ verification_runs : "使った基準"
  tenants ||--o{ retention_policies : "保存期間"
  cases |o--o{ deletion_requests : "案件の削除"
  parties |o--o{ deletion_requests : "個人情報の削除"

  record_versions {
    uuid id PK
  }
  tenants {
    uuid id PK
  }
  cases {
    uuid id PK
  }
  parties {
    uuid id PK
  }
  anchors {
    uuid id PK
    uuid record_version_id FK "提出版だけ"
    text method
    text method_version
    bytea manifest
    text manifest_hash
    text status "unregistered / queued / sending / unknown / registered / failed"
    text external_ref
  }
  anchor_transactions {
    uuid id PK
    uuid anchor_id FK
    bytea raw_tx
    text txid UK
  }
  anchor_attempts {
    uuid id PK
    uuid anchor_id FK
    uuid transaction_id FK
    integer attempt_no
    text kind "submit / lookup"
    text outcome "succeeded / failed / timeout / not_found"
  }
  verification_runs {
    uuid id PK
    uuid record_version_id FK
    uuid anchor_id FK
    text result "match / mismatch / unverifiable"
  }
  retention_policies {
    uuid tenant_id PK
    text target_kind PK "media / record / personal_copy / share / audit"
    integer retain_days "未定のあいだは NULL"
  }
  deletion_requests {
    uuid id PK
    uuid case_id FK
    uuid party_id FK
    text status "requested / on_hold / approved / rejected / executed / failed"
  }
  events {
    bigint id PK
    uuid tenant_id
    text actor_type "staff / participant / operator / system"
    uuid actor_id
    text action
    text target_type
    uuid target_id
    text result "succeeded / denied / failed"
    text entry_hash
  }
```

`audit.events`（図では `events`）は、業務の行が消えても履歴を残すため外部キーを張らず、ほかの表とつないでいません。
