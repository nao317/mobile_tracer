-- 期間の経過だけを理由に自動削除しない方針へ変更する。
-- 既存の保存日数設定は監査履歴へ退避し、設定テーブルを廃止する。
-- 記録・原本の参照情報・検証基準・個別の削除申請は変更しない。
-- 000001 と同じく、ファイル全体を一つのトランザクションで適用する。

LOCK TABLE app.retention_policies IN ACCESS EXCLUSIVE MODE;

WITH archived_events AS (
  SELECT tenant_id,
         CURRENT_TIMESTAMP AS created_at,
         'system'::text AS actor_type,
         'retire_retention_policy'::text AS action,
         'retention_policy'::text AS target_type,
         'succeeded'::text AS result,
         jsonb_build_object('migration', '000002_remove_retention_policies',
                            'policy', to_jsonb(p)) AS details
    FROM app.retention_policies p
)
INSERT INTO audit.events (tenant_id, created_at, actor_type, action, target_type, result, details, entry_hash)
SELECT tenant_id, created_at, actor_type, action, target_type, result, details,
       -- この移行で追加する監査行は、上記のイベントを JSONB テキストにして SHA-256 を計算する。
       encode(sha256(convert_to(to_jsonb(e)::text, 'UTF8')), 'hex')
  FROM archived_events e;

-- 付随する更新制限・TRUNCATE 禁止トリガーもテーブルとともに削除される。
DROP TABLE app.retention_policies;
