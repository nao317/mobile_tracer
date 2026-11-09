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

-- 既存Google認証の履歴を残してFirebaseへ移行する。
\ir ../migrations/000003_google_auth.up.sql
INSERT INTO auth.users(id,issuer,subject) VALUES(pg_temp.u('ab01'),'https://accounts.google.com','old-google-sub');
INSERT INTO auth.staff_links(user_id,tenant_id,staff_id) VALUES(pg_temp.u('ab01'),pg_temp.u('1'),pg_temp.u('101'));
INSERT INTO auth.sessions(id,user_id,csrf_hash,expires_at) VALUES(pg_temp.u('ab02'),pg_temp.u('ab01'),repeat('a',64),now()+interval '1 day');
INSERT INTO auth.refresh_tokens(token_hash,session_id,expires_at) VALUES(repeat('b',64),pg_temp.u('ab02'),now()+interval '1 day');
CREATE TEMP TABLE old_auth_links AS SELECT * FROM auth.staff_links;
CREATE TEMP TABLE old_auth_users AS SELECT * FROM auth.users;
CREATE TEMP TABLE old_auth_refresh AS SELECT * FROM auth.refresh_tokens;
\ir ../migrations/000004_firebase_auth.up.sql
SELECT pg_temp.assert_true('旧認証の本人・紐付け・更新履歴を保持する',
 NOT EXISTS(SELECT * FROM old_auth_users EXCEPT SELECT * FROM auth.users)
 AND NOT EXISTS(SELECT * FROM old_auth_links EXCEPT SELECT * FROM auth.staff_links)
 AND NOT EXISTS(SELECT * FROM old_auth_refresh EXCEPT SELECT * FROM auth.refresh_tokens));
SELECT pg_temp.assert_true('旧JWTのセッションは失効し履歴は残る',
 EXISTS(SELECT 1 FROM auth.sessions WHERE id=pg_temp.u('ab02') AND revoked_at IS NOT NULL AND token_hash IS NULL));
SELECT pg_temp.assert_true('Firebase移行でも監査履歴を保持する',NOT EXISTS(SELECT * FROM old_audit EXCEPT SELECT * FROM audit.events));
DO $$
DECLARE t record; actual jsonb;
BEGIN
 FOR t IN SELECT * FROM old_business LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), ''[]''::jsonb) FROM %I.%I r',t.schema_name,t.table_name) INTO actual;
  PERFORM pg_temp.assert_true(format('Firebase移行前後で %I.%I の内容が同じ',t.schema_name,t.table_name),actual=t.rows);
 END LOOP;
END $$;

-- 既存の明示的な所属を業者ユーザーとして引き継ぎ、未所属の利用者は一般とする。
INSERT INTO auth.users(id,issuer,subject) VALUES(pg_temp.u('ab03'),'https://securetoken.google.com/demo-mobile-tracer','new-general');
\ir ../migrations/000005_user_company_requests.up.sql
SELECT pg_temp.assert_true('所属済みユーザーの業者区分を引き継ぐ',
 EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.u('ab01') AND account_type='business'));
SELECT pg_temp.assert_true('未所属ユーザーは一般のまま',
 EXISTS(SELECT 1 FROM auth.users WHERE id=pg_temp.u('ab03') AND account_type='general'));
SELECT pg_temp.assert_true('管理機能の移行でも所属と監査履歴を保持する',
 NOT EXISTS(SELECT * FROM old_auth_links EXCEPT SELECT * FROM auth.staff_links)
 AND NOT EXISTS(SELECT * FROM old_audit EXCEPT SELECT * FROM audit.events));

-- 追加の保護を適用しても、顧客承認済み・API登録済みの履歴を保持する。
\ir ../migrations/000006_customer_workflow.up.sql
INSERT INTO app.workflow_presentations(version_id,content,content_hash,actor_id,created_at)
VALUES(pg_temp.u('8001'),decode('00','hex'),repeat('e',64),pg_temp.u('ab01'),'2001-01-01');
INSERT INTO app.workflow_requests(id,version_id,user_id,qualification,kind,statement,deadline)
VALUES(pg_temp.u('ac01'),pg_temp.u('8001'),pg_temp.u('ab03'),'owner','state_agreement','車両状態を確認しました',now()+interval '1 day');
INSERT INTO app.workflow_responses(request_id,actor_id,decision)
VALUES(pg_temp.u('ac01'),pg_temp.u('ab03'),'approved');
INSERT INTO app.workflow_anchors(version_id,manifest,manifest_hash)
VALUES(pg_temp.u('8001'),decode('01','hex'),repeat('f',64));
\ir ../migrations/000007_case_lifecycle.up.sql
UPDATE integrity.api_registrations
 SET status='confirmed',timestamp_id=42,txid=repeat('a',64),confirmed_at='2002-01-01',updated_at='2002-01-01'
 WHERE subject_type='record' AND subject_id=pg_temp.u('8001');
CREATE TEMP TABLE old_workflow_requests AS SELECT * FROM app.workflow_requests;
CREATE TEMP TABLE old_api_registrations AS SELECT * FROM integrity.api_registrations;
\ir ../migrations/000008_workflow_history_guards.up.sql
SELECT pg_temp.assert_true('確認依頼の内容を保持し提示版の作成日時を補う',
 EXISTS(SELECT 1 FROM app.workflow_requests q JOIN old_workflow_requests o ON o.id=q.id
  WHERE q.id=pg_temp.u('ac01') AND to_jsonb(q)-'created_at'=to_jsonb(o) AND q.created_at='2001-01-01'));
SELECT pg_temp.assert_true('確定済みAPI登録の内容を保持し旧更新日時を補う',
 EXISTS(SELECT 1 FROM integrity.api_registrations r JOIN old_api_registrations o ON o.id=r.id
  WHERE r.subject_type='record' AND r.subject_id=pg_temp.u('8001')
   AND to_jsonb(r)-'created_at'=to_jsonb(o) AND r.created_at=o.updated_at));
SELECT pg_temp.ng('移行後も確認依頼の作成日時を変更できない', $q$
 UPDATE app.workflow_requests SET created_at=now() WHERE id=pg_temp.u('ac01') $q$,
 'P0001',expected_message=>'app.workflow_requests のこの行は変更・削除できません');
-- queuedの行でも作成日時を保護する（confirmedの変更禁止だけには依存しない）。
INSERT INTO app.case_events(id,case_id,actor_id,origin,kind,title,description,deadline,request_key)
VALUES(pg_temp.u('ac02'),pg_temp.u('5001'),pg_temp.u('ab01'),'business','progress_report',
 '経過報告','移行後の報告',now()+interval '1 day',pg_temp.u('ac03'));
INSERT INTO integrity.api_registrations(subject_type,subject_id,manifest,manifest_hash)
VALUES('event_approval',pg_temp.u('ac02'),decode('02','hex'),repeat('b',64));
SELECT pg_temp.ng('未送信API登録の作成日時を変更できない', $q$
 UPDATE integrity.api_registrations SET created_at=now()-interval '1 day'
  WHERE subject_type='event_approval' AND subject_id=pg_temp.u('ac02') $q$,
 'P0001',expected_message=>'integrity.api_registrations の created_at は変更できません');
SELECT pg_temp.ok('未送信API登録の送信状態は更新できる', $q$
 UPDATE integrity.api_registrations SET status='submitting',attempts=attempts+1,updated_at=now()
  WHERE subject_type='event_approval' AND subject_id=pg_temp.u('ac02') $q$);
DO $$
DECLARE t record;
BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND ((n.nspname='app' AND (c.relname LIKE 'workflow_%' OR c.relname IN
   ('case_start_requests','case_start_responses','case_events','case_event_actions','case_stage_executions')))
   OR (n.nspname='integrity' AND c.relname='api_registrations'))
 LOOP
  PERFORM pg_temp.ng(format('移行後の %I.%I は一括削除できない',t.nspname,t.relname),
   format('TRUNCATE %I.%I CASCADE',t.nspname,t.relname),
   'P0001',expected_message=>format('%s.%s は TRUNCATE できません',t.nspname,t.relname));
 END LOOP;
END $$;
