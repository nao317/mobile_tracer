-- 初期版から移行しても、業務データと過去の設定が失われないことを確認する。
\set ON_ERROR_STOP on
\ir ../migrations/000001_init.up.sql
\ir helpers.sql
\ir ../seeds/development.sql

INSERT INTO app.records (id, tenant_id, case_id, record_kind, created_by)
VALUES (pg_temp.u('7001'), pg_temp.u('1'), pg_temp.u('5001'), 'inspection', pg_temp.u('101'));
INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
VALUES (pg_temp.u('8001'), pg_temp.u('1'), pg_temp.u('5001'), pg_temp.u('7001'), 1, pg_temp.u('1001'), pg_temp.u('101'));
INSERT INTO app.record_entries (tenant_id, case_id, record_version_id, item_key, value)
VALUES (pg_temp.u('1'), pg_temp.u('5001'), pg_temp.u('8001'), 'odometer', '12345');
INSERT INTO app.media_originals (id, tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                 created_by_staff, idempotency_key, created_at)
VALUES (pg_temp.u('9001'), pg_temp.u('1'), pg_temp.u('5001'), 'image/jpeg', 1234, repeat('a', 64),
        'upgrade-test/original.jpg', pg_temp.u('101'), pg_temp.u('f001'), '2000-01-01');
UPDATE app.record_versions
   SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256', content_hash = repeat('b', 64),
       submit_idempotency_key = pg_temp.u('f002'), submitted_by = pg_temp.u('101'), submitted_at = '2000-01-01'
 WHERE id = pg_temp.u('8001');
INSERT INTO integrity.anchors (tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
VALUES (pg_temp.u('1'), pg_temp.u('5001'), pg_temp.u('8001'), 'tapyrus', '1', decode('00', 'hex'), repeat('c', 64));
INSERT INTO app.deletion_requests (tenant_id, case_id, reason, created_by)
VALUES (pg_temp.u('1'), pg_temp.u('5001'), '誤登録の調査中', pg_temp.u('101'));
INSERT INTO audit.events (tenant_id, actor_type, action, target_type, result, entry_hash)
VALUES (pg_temp.u('1'), 'system', 'upgrade_fixture', 'record_version', 'succeeded', repeat('d', 64));
INSERT INTO app.retention_policies (tenant_id, target_kind, retain_days, basis) VALUES
  (pg_temp.u('1'), 'media', 30, '旧契約の設定'),
  (pg_temp.u('2'), 'record', NULL, NULL);

CREATE TEMP TABLE old_policies AS SELECT tenant_id, to_jsonb(p) AS policy FROM app.retention_policies p;
CREATE TEMP TABLE old_audit AS SELECT * FROM audit.events;
CREATE TEMP TABLE old_business (schema_name text, table_name text, rows jsonb);
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT table_schema, table_name FROM information_schema.tables
            WHERE table_schema IN ('app', 'integrity') AND table_type = 'BASE TABLE'
              AND table_name <> 'retention_policies'
  LOOP
    EXECUTE format('INSERT INTO old_business SELECT %L, %L, coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), ''[]''::jsonb) FROM %I.%I r',
                   t.table_schema, t.table_name, t.table_schema, t.table_name);
  END LOOP;
END $$;

\ir ../migrations/000002_remove_retention_policies.up.sql

SELECT pg_temp.assert_true('既存 DB から保存日数の設定テーブルが廃止される',
  to_regclass('app.retention_policies') IS NULL);
SELECT pg_temp.assert_true('NULL を含む旧設定を顧客ごとに監査履歴へ退避する',
  (SELECT count(*) FROM audit.events WHERE action = 'retire_retention_policy') = (SELECT count(*) FROM old_policies)
  AND NOT EXISTS (
    SELECT 1 FROM old_policies p WHERE NOT EXISTS (
      SELECT 1 FROM audit.events e WHERE e.tenant_id = p.tenant_id AND e.actor_type = 'system'
        AND e.action = 'retire_retention_policy' AND e.target_type = 'retention_policy' AND e.result = 'succeeded'
        AND e.details = jsonb_build_object('migration', '000002_remove_retention_policies', 'policy', p.policy)
        AND e.entry_hash ~ '^[0-9a-f]{64}$')));
SELECT pg_temp.assert_true('既存の監査履歴は書き換えられない', NOT EXISTS (
  SELECT * FROM old_audit EXCEPT SELECT * FROM audit.events));
DO $$
DECLARE
  t record;
  actual jsonb;
BEGIN
  FOR t IN SELECT * FROM old_business LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), ''[]''::jsonb) FROM %I.%I r',
                   t.schema_name, t.table_name) INTO actual;
    PERFORM pg_temp.assert_true(format('移行前後で %I.%I の内容が同じ', t.schema_name, t.table_name), actual = t.rows);
  END LOOP;
END $$;
SELECT pg_temp.ng('移行後も提出済みの記録版を削除できない', $q$
  DELETE FROM app.record_versions WHERE id = pg_temp.u('8001') $q$,
  'P0001', expected_message => '提出済みの記録版は変更・削除できません');
SELECT pg_temp.ng('移行後も原本の DB 行を削除できない', $q$
  DELETE FROM app.media_originals WHERE id = pg_temp.u('9001') $q$,
  'P0001', expected_message => 'app.media_originals のこの行は変更・削除できません');
