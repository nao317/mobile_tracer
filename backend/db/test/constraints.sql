-- マイグレーションで作った制約とトリガーが意図どおり効くかを確かめる。
-- 期待どおりなら "OK:" の行だけが出る。期待と違えば "NG:" のエラーで止まる。run.sh から流す。
\set ON_ERROR_STOP on
\ir helpers.sql

-- ---------------------------------------------------------------
-- 組織
-- ---------------------------------------------------------------
SELECT pg_temp.ok('顧客を作る', $q$
  INSERT INTO app.tenants (id, name, status) VALUES
    (pg_temp.u('a'), 'A レンタカー', 'active'), (pg_temp.u('b'), 'B 整備', 'active') $q$);
SELECT pg_temp.ok('店舗・担当者・提供側担当者を作る', $q$
  INSERT INTO app.stores (id, tenant_id, name) VALUES
    (pg_temp.u('a1'), pg_temp.u('a'), '本店'), (pg_temp.u('a2'), pg_temp.u('a'), '駅前店'),
    (pg_temp.u('b1'), pg_temp.u('b'), '工場');
  INSERT INTO app.staff_members (id, tenant_id, display_name, email, status) VALUES
    (pg_temp.u('1a1'), pg_temp.u('a'), '田中', 'tanaka@a.example', 'active'),
    (pg_temp.u('1a2'), pg_temp.u('a'), '鈴木', 'suzuki@a.example', 'active'),
    (pg_temp.u('1b1'), pg_temp.u('b'), '佐藤', 'sato@b.example', 'active');
  INSERT INTO app.provider_operators (id, display_name, email, role) VALUES
    (pg_temp.u('0f1'), '運営', 'ops@example.com', 'onboarding') $q$);

SELECT pg_temp.ok('顧客を一時停止して戻す', $q$
  UPDATE app.tenants SET status = 'suspended' WHERE id = pg_temp.u('a');
  UPDATE app.tenants SET status = 'active' WHERE id = pg_temp.u('a') $q$);
SELECT pg_temp.ng('顧客の作成日時を変える', $q$
  UPDATE app.tenants SET created_at = now() - interval '1 day' WHERE id = pg_temp.u('a') $q$,
  'P0001', expected_message => 'app.tenants の created_at は変更できません');
SELECT pg_temp.ng('店舗を別の顧客へ移す', $q$
  UPDATE app.stores SET tenant_id = pg_temp.u('b') WHERE id = pg_temp.u('a1') $q$,
  'P0001', expected_message => 'app.stores の tenant_id は変更できません');
SELECT pg_temp.ng('担当者を別の顧客へ移す', $q$
  UPDATE app.staff_members SET tenant_id = pg_temp.u('b') WHERE id = pg_temp.u('1a2') $q$,
  'P0001', expected_message => 'app.staff_members の tenant_id は変更できません');
SELECT pg_temp.ng('提供側担当者を、止めた人なしで止める', $q$
  UPDATE app.provider_operators SET disabled_at = now() WHERE id = pg_temp.u('0f1') $q$,
  '23514', 'provider_operators_check');

-- 役割
SELECT pg_temp.ok('役割を付ける（最初の管理者は提供側が付ける）', $q$
  INSERT INTO app.staff_role_assignments (id, tenant_id, staff_id, role, created_by_operator)
  VALUES (pg_temp.u('1c1'), pg_temp.u('a'), pg_temp.u('1a1'), 'tenant_admin', pg_temp.u('0f1')) $q$);
SELECT pg_temp.ng('付けた人がいない役割', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role)
  VALUES (pg_temp.u('a'), pg_temp.u('1a2'), 'staff') $q$,
  '23514', 'staff_role_assignments_check');
SELECT pg_temp.ng('店舗のない店長', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role, created_by_staff)
  VALUES (pg_temp.u('a'), pg_temp.u('1a2'), 'store_manager', pg_temp.u('1a1')) $q$,
  '23514', 'staff_role_assignments_check2');
SELECT pg_temp.ng('全店舗の役割を二重に付ける', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role, created_by_staff)
  VALUES (pg_temp.u('a'), pg_temp.u('1a1'), 'tenant_admin', pg_temp.u('1a1')) $q$,
  '23505', 'staff_role_assignments_active_all_stores');
SELECT pg_temp.ok('同じ人を二つの店舗の店長にする', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role, store_id, created_by_staff) VALUES
    (pg_temp.u('a'), pg_temp.u('1a2'), 'store_manager', pg_temp.u('a1'), pg_temp.u('1a1')),
    (pg_temp.u('a'), pg_temp.u('1a2'), 'store_manager', pg_temp.u('a2'), pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('同じ店舗の店長を二重に付ける', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role, store_id, created_by_staff)
  VALUES (pg_temp.u('a'), pg_temp.u('1a2'), 'store_manager', pg_temp.u('a1'), pg_temp.u('1a1')) $q$,
  '23505', 'staff_role_assignments_active_store');
SELECT pg_temp.ng('別の顧客の店舗で役割を付ける', $q$
  INSERT INTO app.staff_role_assignments (tenant_id, staff_id, role, store_id, created_by_staff)
  VALUES (pg_temp.u('a'), pg_temp.u('1a2'), 'store_manager', pg_temp.u('b1'), pg_temp.u('1a1')) $q$,
  '23503', 'staff_role_assignments_tenant_id_store_id_fkey');
SELECT pg_temp.ok('役割を外す', $q$
  UPDATE app.staff_role_assignments SET revoked_by = pg_temp.u('1a1'), revoked_at = now()
   WHERE id = pg_temp.u('1c1') $q$);
SELECT pg_temp.ng('外した役割を戻す', $q$
  UPDATE app.staff_role_assignments SET revoked_by = NULL, revoked_at = NULL WHERE id = pg_temp.u('1c1') $q$,
  'P0001', expected_message => 'app.staff_role_assignments のこの行は変更・削除できません');
SELECT pg_temp.ng('役割の行を消す', $q$
  DELETE FROM app.staff_role_assignments WHERE id = pg_temp.u('1c1') $q$,
  'P0001', expected_message => 'app.staff_role_assignments のこの行は変更・削除できません');

-- サポートの許可
SELECT pg_temp.ok('サポートの許可を出す', $q$
  INSERT INTO app.support_grants (id, tenant_id, operator_id, purpose, valid_from, valid_to, created_by)
  VALUES (pg_temp.u('fa1'), pg_temp.u('a'), pg_temp.u('0f1'), '問い合わせ対応', now(), now() + interval '1 day', pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('終わりが始まりより前の許可', $q$
  INSERT INTO app.support_grants (tenant_id, operator_id, purpose, valid_from, valid_to, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('0f1'), 'x', now(), now() - interval '1 day', pg_temp.u('1a1')) $q$,
  '23514', 'support_grants_check');
SELECT pg_temp.ng('許可の期間を延ばす', $q$
  UPDATE app.support_grants SET valid_to = valid_to + interval '1 day' WHERE id = pg_temp.u('fa1') $q$,
  'P0001', expected_message => 'app.support_grants の valid_to は変更できません');
SELECT pg_temp.ng('許可の行を消す', $q$
  DELETE FROM app.support_grants WHERE id = pg_temp.u('fa1') $q$,
  'P0001', expected_message => 'app.support_grants のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- テンプレートと構成版
-- ---------------------------------------------------------------
SELECT pg_temp.ok('テンプレートを作る', $q$
  INSERT INTO app.business_templates (id, business_type, version_no, definition) VALUES
    (pg_temp.u('0e1'), 'rental', 1, '{}'), (pg_temp.u('0e2'), 'repair', 1, '{}') $q$);
SELECT pg_temp.ng('テンプレートを書き換える', $q$
  UPDATE app.business_templates SET definition = '{"x":1}' WHERE id = pg_temp.u('0e1') $q$,
  'P0001', expected_message => 'app.business_templates のこの行は変更・削除できません');

SELECT pg_temp.ok('構成版を下書きで作り、業態を決めて反映する', $q$
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, settings, created_by_staff)
  VALUES (pg_temp.u('3a1'), pg_temp.u('a'), 1, '{}', pg_temp.u('1a1'));
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('a'), pg_temp.u('3a1'), 'rental', pg_temp.u('0e1'));
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1a1'), published_at = now()
   WHERE id = pg_temp.u('3a1');
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, settings, created_by_operator)
  VALUES (pg_temp.u('3b1'), pg_temp.u('b'), 1, '{}', pg_temp.u('0f1'));
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('b'), pg_temp.u('3b1'), 'repair', pg_temp.u('0e2'));
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1b1'), published_at = now()
   WHERE id = pg_temp.u('3b1') $q$);
SELECT pg_temp.ng('業態とテンプレートが食い違う', $q$
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, settings, created_by_staff)
  VALUES (pg_temp.u('3a9'), pg_temp.u('a'), 9, '{}', pg_temp.u('1a1'));
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('a'), pg_temp.u('3a9'), 'rental', pg_temp.u('0e2')) $q$,
  '23503', 'configuration_modules_template_id_business_type_fkey');
SELECT pg_temp.ng('構成版をいきなり反映済みで作る', $q$
  INSERT INTO app.configuration_versions (tenant_id, version_no, status, settings, created_by_staff, published_by, published_at)
  VALUES (pg_temp.u('a'), 8, 'published', '{}', pg_temp.u('1a1'), pg_temp.u('1a1'), now()) $q$,
  'P0001', expected_message => 'app.configuration_versions は status = draft で作ってください');
SELECT pg_temp.ng('反映済みの構成版の設定を変える', $q$
  UPDATE app.configuration_versions SET settings = '{"x":1}' WHERE id = pg_temp.u('3a1') $q$,
  'P0001', expected_message => '反映済みの構成版は変更・削除できません');
SELECT pg_temp.ng('反映済みの構成版に業態を足す', $q$
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('a'), pg_temp.u('3a1'), 'repair', pg_temp.u('0e2')) $q$,
  'P0001', expected_message => '反映済みの構成版の業態は変更できません');
SELECT pg_temp.ng('構成版の番号を変える', $q$
  UPDATE app.configuration_versions SET version_no = 5 WHERE id = pg_temp.u('3a1') $q$,
  'P0001', expected_message => 'app.configuration_versions の version_no は変更できません');
SELECT pg_temp.ok('2版目を下書きで作る', $q$
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, based_on_id, settings, created_by_staff)
  VALUES (pg_temp.u('3a2'), pg_temp.u('a'), 2, pg_temp.u('3a1'), '{"v":2}', pg_temp.u('1a1'));
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('a'), pg_temp.u('3a2'), 'rental', pg_temp.u('0e1')) $q$);
SELECT pg_temp.ng('本番の版を二つにする', $q$
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1a1'), published_at = now()
   WHERE id = pg_temp.u('3a2') $q$,
  '23505', 'configuration_versions_one_published');
SELECT pg_temp.ng('反映者なしで反映する', $q$
  UPDATE app.configuration_versions SET status = 'trial' WHERE id = pg_temp.u('3a2');
  UPDATE app.configuration_versions SET status = 'published', published_at = now() WHERE id = pg_temp.u('3a2') $q$,
  '23514', 'configuration_versions_check1');

-- 取込
SELECT pg_temp.ok('取込を試行し、行ごとの結果を入れる', $q$
  INSERT INTO app.import_jobs (id, tenant_id, file_name, file_sha256, created_by)
  VALUES (pg_temp.u('5f1'), pg_temp.u('a'), 'cars.csv', repeat('c', 64), pg_temp.u('0f1'));
  INSERT INTO app.import_job_rows (tenant_id, import_job_id, row_no, result, message) VALUES
    (pg_temp.u('a'), pg_temp.u('5f1'), 1, 'ok', NULL),
    (pg_temp.u('a'), pg_temp.u('5f1'), 2, 'duplicate', '車台番号が登録済み') $q$);
SELECT pg_temp.ng('不正行に理由がない', $q$
  INSERT INTO app.import_job_rows (tenant_id, import_job_id, row_no, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5f1'), 3, 'error') $q$,
  '23514', 'import_job_rows_check');
SELECT pg_temp.ng('取込の結果を書き換える', $q$
  UPDATE app.import_job_rows SET result = 'ok', message = NULL WHERE import_job_id = pg_temp.u('5f1') AND row_no = 2 $q$,
  'P0001', expected_message => 'app.import_job_rows のこの行は変更・削除できません');
SELECT pg_temp.ng('取込をいきなり本取込済みで作る', $q$
  INSERT INTO app.import_jobs (tenant_id, file_name, file_sha256, status, created_by, confirmed_by, confirmed_at, committed_at)
  VALUES (pg_temp.u('a'), 'x.csv', repeat('d', 64), 'committed', pg_temp.u('0f1'), pg_temp.u('1a1'), now(), now()) $q$,
  'P0001', expected_message => 'app.import_jobs は status = trial で作ってください');
SELECT pg_temp.ng('顧客の確認なしで本取込する', $q$
  UPDATE app.import_jobs SET status = 'committed', committed_at = now() WHERE id = pg_temp.u('5f1') $q$,
  '23514', 'import_jobs_check1');
SELECT pg_temp.ok('顧客が確かめてから本取込し、車両を作る', $q$
  UPDATE app.import_jobs SET status = 'confirmed', confirmed_by = pg_temp.u('1a1'), confirmed_at = now()
   WHERE id = pg_temp.u('5f1');
  UPDATE app.import_jobs SET status = 'committed', committed_at = now() WHERE id = pg_temp.u('5f1');
  INSERT INTO app.vehicles (id, tenant_id, model_name, import_job_id, source_key)
  VALUES (pg_temp.u('4a3'), pg_temp.u('a'), 'プリウス', pg_temp.u('5f1'), 'row-1') $q$);
SELECT pg_temp.assert_true('本取込の状態と確認者が残っている', EXISTS (
  SELECT 1 FROM app.import_jobs
   WHERE id = pg_temp.u('5f1') AND status = 'committed' AND confirmed_by = pg_temp.u('1a1')));
SELECT pg_temp.ng('本取込した取込を戻す', $q$
  UPDATE app.import_jobs SET status = 'failed' WHERE id = pg_temp.u('5f1') $q$,
  'P0001', expected_message => 'app.import_jobs のこの行は変更・削除できません');
SELECT pg_temp.ng('同じファイルをもう一度本取込する', $q$
  INSERT INTO app.import_jobs (id, tenant_id, file_name, file_sha256, created_by)
  VALUES (pg_temp.u('5f2'), pg_temp.u('a'), 'cars.csv', repeat('c', 64), pg_temp.u('0f1'));
  UPDATE app.import_jobs SET status = 'confirmed', confirmed_by = pg_temp.u('1a1'), confirmed_at = now()
   WHERE id = pg_temp.u('5f2');
  UPDATE app.import_jobs SET status = 'committed', committed_at = now() WHERE id = pg_temp.u('5f2') $q$,
  '23505', 'import_jobs_committed_file');
SELECT pg_temp.ng('取込元の識別子がない取込車両', $q$
  INSERT INTO app.vehicles (tenant_id, import_job_id) VALUES (pg_temp.u('a'), pg_temp.u('5f1')) $q$,
  '23514', 'vehicles_check');
SELECT pg_temp.ng('取込の行を消す', $q$
  DELETE FROM app.import_jobs WHERE id = pg_temp.u('5f1') $q$,
  'P0001', expected_message => 'app.import_jobs のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 関係者と車両
-- ---------------------------------------------------------------
SELECT pg_temp.ok('関係者と車両を作る', $q$
  INSERT INTO app.parties (id, tenant_id, kind, display_name, phone) VALUES
    (pg_temp.u('2a1'), pg_temp.u('a'), 'person', '山田', '090'),
    (pg_temp.u('2a2'), pg_temp.u('a'), 'person', '高橋', '080'),
    (pg_temp.u('2b1'), pg_temp.u('b'), 'person', '伊藤', NULL);
  INSERT INTO app.vehicles (id, tenant_id, model_name) VALUES
    (pg_temp.u('4a1'), pg_temp.u('a'), 'アクア'), (pg_temp.u('4a2'), pg_temp.u('a'), NULL),
    (pg_temp.u('4b1'), pg_temp.u('b'), 'ノート') $q$);
SELECT pg_temp.ng('個人情報を一部だけ残して消去済みにする', $q$
  UPDATE app.parties SET display_name = NULL, erased_at = now() WHERE id = pg_temp.u('2a2') $q$,
  '23514', 'parties_check1');
SELECT pg_temp.ok('個人情報を消す', $q$
  UPDATE app.parties SET display_name = NULL, phone = NULL, erased_at = now() WHERE id = pg_temp.u('2a2') $q$);
SELECT pg_temp.ng('消した個人情報を戻す', $q$
  UPDATE app.parties SET display_name = '高橋', erased_at = NULL WHERE id = pg_temp.u('2a2') $q$,
  'P0001', expected_message => 'app.parties のこの行は変更・削除できません');
SELECT pg_temp.ng('取込の車両を現場登録に変える', $q$
  UPDATE app.vehicles SET import_job_id = NULL, source_key = NULL WHERE id = pg_temp.u('4a3') $q$,
  'P0001', expected_message => 'app.vehicles の source_key, import_job_id は変更できません');

SELECT pg_temp.ok('確認済みのナンバーを付ける', $q$
  INSERT INTO app.vehicle_identifiers (tenant_id, vehicle_id, kind, value, verified_by, verified_at)
  VALUES (pg_temp.u('a'), pg_temp.u('4a1'), 'plate_number', '品川 500 あ 12-34', pg_temp.u('1a1'), now()) $q$);
SELECT pg_temp.ng('同じ確認済みナンバーを別の車に付ける', $q$
  INSERT INTO app.vehicle_identifiers (tenant_id, vehicle_id, kind, value, verified_by, verified_at)
  VALUES (pg_temp.u('a'), pg_temp.u('4a2'), 'plate_number', '品川 500 あ 12-34', pg_temp.u('1a1'), now()) $q$,
  '23505', 'vehicle_identifiers_verified');
SELECT pg_temp.ok('未確認なら同じナンバーでも登録できる', $q$
  INSERT INTO app.vehicle_identifiers (tenant_id, vehicle_id, kind, value)
  VALUES (pg_temp.u('a'), pg_temp.u('4a2'), 'plate_number', '品川 500 あ 12-34') $q$);
SELECT pg_temp.ng('1台に今のナンバーを二つ付ける', $q$
  INSERT INTO app.vehicle_identifiers (tenant_id, vehicle_id, kind, value)
  VALUES (pg_temp.u('a'), pg_temp.u('4a1'), 'plate_number', '品川 500 い 56-78') $q$,
  '23505', 'vehicle_identifiers_current_plate');
SELECT pg_temp.ng('識別子の値を書き換える', $q$
  UPDATE app.vehicle_identifiers SET value = 'x' WHERE vehicle_id = pg_temp.u('4a1') $q$,
  'P0001', expected_message => 'app.vehicle_identifiers の value は変更できません');
SELECT pg_temp.ng('別の顧客の車両に識別子を付ける', $q$
  INSERT INTO app.vehicle_identifiers (tenant_id, vehicle_id, kind, value)
  VALUES (pg_temp.u('a'), pg_temp.u('4b1'), 'vin', 'X') $q$,
  '23503', 'vehicle_identifiers_tenant_id_vehicle_id_fkey');

SELECT pg_temp.ok('所有者を登録する', $q$
  INSERT INTO app.vehicle_ownerships (tenant_id, vehicle_id, owner_party_id, valid_from)
  VALUES (pg_temp.u('a'), pg_temp.u('4a1'), pg_temp.u('2a1'), current_date) $q$);
SELECT pg_temp.ng('今の所有者を二人にする', $q$
  INSERT INTO app.vehicle_ownerships (tenant_id, vehicle_id, owner_party_id, valid_from)
  VALUES (pg_temp.u('a'), pg_temp.u('4a1'), pg_temp.u('2a2'), current_date) $q$,
  '23505', 'vehicle_ownerships_current');
SELECT pg_temp.ng('別の顧客の関係者を所有者にする', $q$
  INSERT INTO app.vehicle_ownerships (tenant_id, vehicle_id, owner_party_id, valid_from)
  VALUES (pg_temp.u('a'), pg_temp.u('4a2'), pg_temp.u('2b1'), current_date) $q$,
  '23503', 'vehicle_ownerships_tenant_id_owner_party_id_fkey');

SELECT pg_temp.ok('重複した車両を統合する', $q$
  INSERT INTO app.vehicle_merges (tenant_id, source_vehicle_id, target_vehicle_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('4a2'), pg_temp.u('4a1'), '同じ車台番号', pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('統合済みの車両へ統合する（輪になる）', $q$
  INSERT INTO app.vehicle_merges (tenant_id, source_vehicle_id, target_vehicle_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('4a1'), pg_temp.u('4a2'), 'x', pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '統合先の車両はすでに別の車両へ統合されています');
SELECT pg_temp.ng('自分自身へ統合する', $q$
  INSERT INTO app.vehicle_merges (tenant_id, source_vehicle_id, target_vehicle_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('4a3'), pg_temp.u('4a3'), 'x', pg_temp.u('1a1')) $q$,
  '23514', 'vehicle_merges_check');
SELECT pg_temp.ng('統合を取り消す', $q$
  DELETE FROM app.vehicle_merges WHERE source_vehicle_id = pg_temp.u('4a2') $q$,
  'P0001', expected_message => 'app.vehicle_merges のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 案件
-- ---------------------------------------------------------------
SELECT pg_temp.ok('案件と関係者を作る', $q$
  INSERT INTO app.cases (id, tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by) VALUES
    (pg_temp.u('5a1'), pg_temp.u('a'), pg_temp.u('a1'), pg_temp.u('4a1'), 'rental', pg_temp.u('3a1'), 'reception', pg_temp.u('1a1')),
    (pg_temp.u('5a2'), pg_temp.u('a'), pg_temp.u('a1'), pg_temp.u('4a3'), 'rental', pg_temp.u('3a1'), 'reception', pg_temp.u('1a1'));
  INSERT INTO app.cases (id, tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by) VALUES
    (pg_temp.u('5b1'), pg_temp.u('b'), pg_temp.u('b1'), pg_temp.u('4b1'), 'repair', pg_temp.u('3b1'), 'reception', pg_temp.u('1b1'));
  INSERT INTO app.case_participants (id, tenant_id, case_id, party_id, qualification, created_by) VALUES
    (pg_temp.u('6a1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('2a1'), 'renter', pg_temp.u('1a1')),
    (pg_temp.u('6a2'), pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('2a1'), 'owner', pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('別の顧客の店舗で案件を作る', $q$
  INSERT INTO app.cases (tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('b1'), pg_temp.u('4a1'), 'rental', pg_temp.u('3a1'), 's', pg_temp.u('1a1')) $q$,
  '23503', 'cases_tenant_id_store_id_fkey');
SELECT pg_temp.ng('別の顧客の担当者が案件を作る', $q$
  INSERT INTO app.cases (tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('a1'), pg_temp.u('4a1'), 'rental', pg_temp.u('3a1'), 's', pg_temp.u('1b1')) $q$,
  '23503', 'cases_tenant_id_created_by_fkey');
SELECT pg_temp.ng('構成版で使わない業態の案件を作る', $q$
  INSERT INTO app.cases (tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('a1'), pg_temp.u('4a1'), 'repair', pg_temp.u('3a1'), 's', pg_temp.u('1a1')) $q$,
  '23503', 'cases_tenant_id_configuration_version_id_case_type_fkey');
SELECT pg_temp.ng('下書きの構成版で案件を作る', $q$
  INSERT INTO app.cases (tenant_id, store_id, vehicle_id, case_type, configuration_version_id, stage, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('a1'), pg_temp.u('4a1'), 'rental', pg_temp.u('3a2'), 's', pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '案件には本番反映した構成版だけを指定できます');
SELECT pg_temp.ng('完了した人なしで案件を完了する', $q$
  UPDATE app.cases SET status = 'completed', completed_at = now() WHERE id = pg_temp.u('5b1') $q$,
  '23514', 'cases_check');
SELECT pg_temp.ng('理由なしで案件を中止する', $q$
  UPDATE app.cases SET status = 'cancelled', cancelled_by = pg_temp.u('1b1'), cancelled_at = now()
   WHERE id = pg_temp.u('5b1') $q$,
  '23514', 'cases_check1');
SELECT pg_temp.ng('案件の車両を差し替える', $q$
  UPDATE app.cases SET vehicle_id = pg_temp.u('4a3') WHERE id = pg_temp.u('5a1') $q$,
  'P0001', expected_message => 'app.cases の vehicle_id は変更できません');
SELECT pg_temp.ok('案件を完了する', $q$
  UPDATE app.cases SET status = 'completed', completed_by = pg_temp.u('1b1'), completed_at = now()
   WHERE id = pg_temp.u('5b1') $q$);
SELECT pg_temp.ng('完了した案件を動かす', $q$
  UPDATE app.cases SET stage = 'x' WHERE id = pg_temp.u('5b1') $q$,
  'P0001', expected_message => 'app.cases のこの行は変更・削除できません');
SELECT pg_temp.ng('同じ人を同じ資格で二重に登録する', $q$
  INSERT INTO app.case_participants (tenant_id, case_id, party_id, qualification, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('2a1'), 'renter', pg_temp.u('1a1')) $q$,
  '23505', 'case_participants_active');
SELECT pg_temp.ok('サポートで見てよい案件を決める', $q$
  INSERT INTO app.support_grant_cases (tenant_id, support_grant_id, case_id)
  VALUES (pg_temp.u('a'), pg_temp.u('fa1'), pg_temp.u('5a1')) $q$);
SELECT pg_temp.ng('別の顧客の案件をサポートの範囲に入れる', $q$
  INSERT INTO app.support_grant_cases (tenant_id, support_grant_id, case_id)
  VALUES (pg_temp.u('a'), pg_temp.u('fa1'), pg_temp.u('5b1')) $q$,
  '23503', 'support_grant_cases_tenant_id_case_id_fkey');

-- ---------------------------------------------------------------
-- 記録と記録版
-- ---------------------------------------------------------------
SELECT pg_temp.ok('記録と下書きを作る', $q$
  INSERT INTO app.records (id, tenant_id, case_id, record_kind, created_by) VALUES
    (pg_temp.u('7a1'), pg_temp.u('a'), pg_temp.u('5a1'), 'pre_rental', pg_temp.u('1a1')),
    (pg_temp.u('7a2'), pg_temp.u('a'), pg_temp.u('5a2'), 'pre_rental', pg_temp.u('1a1')),
    (pg_temp.u('7a3'), pg_temp.u('a'), pg_temp.u('5a1'), 'post_rental', pg_temp.u('1a1'));
  INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, configuration_version_id, created_by) VALUES
    (pg_temp.u('8a1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 1, pg_temp.u('3a1'), pg_temp.u('1a1')),
    (pg_temp.u('8a3'), pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('7a2'), 1, pg_temp.u('3a1'), pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('記録の種類を変える', $q$
  UPDATE app.records SET record_kind = 'x' WHERE id = pg_temp.u('7a1') $q$,
  'P0001', expected_message => 'app.records のこの行は変更・削除できません');
SELECT pg_temp.ng('記録版の案件を記録と食い違わせる', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('7a3'), 1, pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  '23503', 'record_versions_tenant_id_case_id_record_id_fkey');
SELECT pg_temp.ng('いきなり提出済みで作る', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, status, configuration_version_id,
                                   vehicle_snapshot, hash_algorithm, content_hash, submit_idempotency_key,
                                   submitted_by, submitted_at, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a3'), 1, 'submitted', pg_temp.u('3a1'), '{}', 'sha256',
          'h', gen_random_uuid(), pg_temp.u('1a1'), now(), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '記録版は下書きで作ってから提出してください');
SELECT pg_temp.ng('案件と違う構成版で記録版を作る', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a3'), 1, pg_temp.u('3a2'), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '記録版の構成版は案件の構成版と同じにしてください');

SELECT pg_temp.ok('原本の写真を受け取る', $q$
  INSERT INTO app.media_originals (id, tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                   created_by_staff, idempotency_key) VALUES
    (pg_temp.u('9a1'), pg_temp.u('a'), pg_temp.u('5a1'), 'image/jpeg', 100, repeat('a', 64), 'k1', pg_temp.u('1a1'), pg_temp.u('ff1')),
    (pg_temp.u('9a2'), pg_temp.u('a'), pg_temp.u('5a1'), 'image/jpeg', 100, repeat('d', 64), 'k2', pg_temp.u('1a1'), pg_temp.u('ff2')),
    (pg_temp.u('9a3'), pg_temp.u('a'), pg_temp.u('5a2'), 'image/jpeg', 100, repeat('e', 64), 'k3', pg_temp.u('1a1'), pg_temp.u('ff3')) $q$);
SELECT pg_temp.ok('関係者が撮った写真を受け取る', $q$
  INSERT INTO app.media_originals (id, tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                   created_by_participant, idempotency_key)
  VALUES (pg_temp.u('9a4'), pg_temp.u('a'), pg_temp.u('5a1'), 'image/png', 100, repeat('f', 64), 'k4', pg_temp.u('6a1'), pg_temp.u('ff4')) $q$);
SELECT pg_temp.ng('別の案件の関係者が撮った写真にする', $q$
  INSERT INTO app.media_originals (tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                   created_by_participant, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), 'image/png', 100, repeat('f', 64), 'k5', pg_temp.u('6a2'), gen_random_uuid()) $q$,
  '23503', 'media_originals_tenant_id_case_id_created_by_participant_fkey');
SELECT pg_temp.ng('撮った人がいない写真', $q$
  INSERT INTO app.media_originals (tenant_id, case_id, mime_type, byte_size, sha256, storage_key, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), 'image/png', 100, repeat('f', 64), 'k6', gen_random_uuid()) $q$,
  '23514', 'media_originals_check');
SELECT pg_temp.ng('再送で同じ写真を二重に登録する', $q$
  INSERT INTO app.media_originals (tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                   created_by_staff, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), 'image/jpeg', 100, repeat('a', 64), 'k7', pg_temp.u('1a1'), pg_temp.u('ff1')) $q$,
  '23505', 'media_originals_tenant_id_idempotency_key_key');
SELECT pg_temp.ng('動画を受け取る（MVP は画像だけ）', $q$
  INSERT INTO app.media_originals (tenant_id, case_id, mime_type, byte_size, sha256, storage_key,
                                   created_by_staff, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), 'video/mp4', 100, repeat('a', 64), 'k8', pg_temp.u('1a1'), gen_random_uuid()) $q$,
  '23514', 'media_originals_mime_type_check');
SELECT pg_temp.ng('原本のハッシュを書き換える', $q$
  UPDATE app.media_originals SET sha256 = repeat('0', 64) WHERE id = pg_temp.u('9a1') $q$,
  'P0001', expected_message => 'app.media_originals の sha256 は変更できません');
SELECT pg_temp.ng('原本の行を消す', $q$
  DELETE FROM app.media_originals WHERE id = pg_temp.u('9a4') $q$,
  'P0001', expected_message => 'app.media_originals のこの行は変更・削除できません');
SELECT pg_temp.ok('原本のファイルを消した印を付ける', $q$
  UPDATE app.media_originals SET deleted_at = now() WHERE id = pg_temp.u('9a4') $q$);
SELECT pg_temp.ng('消した印を外す', $q$
  UPDATE app.media_originals SET deleted_at = NULL WHERE id = pg_temp.u('9a4') $q$,
  'P0001', expected_message => 'app.media_originals のこの行は変更・削除できません');

SELECT pg_temp.ok('下書きに項目と写真と傷と撮影不能を入れる', $q$
  INSERT INTO app.record_entries (tenant_id, case_id, record_version_id, item_key, value) VALUES
    (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'fuel', '"full"'),
    (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'mileage', '12345');
  INSERT INTO app.record_version_media (tenant_id, case_id, record_version_id, media_id, spot_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a1'), 'front');
  INSERT INTO app.damage_marks (tenant_id, case_id, record_version_id, media_id, x, y, description, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a1'), 0.5, 0.5, '前の擦り傷', pg_temp.u('1a1'));
  INSERT INTO app.capture_exceptions (tenant_id, case_id, record_version_id, spot_key, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'roof', '雨で撮れない', pg_temp.u('1a1'));
  UPDATE app.record_entries SET value = '"half"' WHERE record_version_id = pg_temp.u('8a1') AND item_key = 'fuel';
  UPDATE app.capture_exceptions SET approved_by = pg_temp.u('1a2'), approved_at = now()
   WHERE record_version_id = pg_temp.u('8a1') $q$);
SELECT pg_temp.ng('別の案件の写真を記録版に入れる', $q$
  INSERT INTO app.record_version_media (tenant_id, case_id, record_version_id, media_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a3')) $q$,
  '23503', 'record_version_media_tenant_id_case_id_media_id_fkey');
SELECT pg_temp.ng('版に含めていない写真に傷を付ける', $q$
  INSERT INTO app.damage_marks (tenant_id, case_id, record_version_id, media_id, x, y, description, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a2'), 0.1, 0.1, 'x', pg_temp.u('1a1')) $q$,
  '23503', 'damage_marks_tenant_id_case_id_record_version_id_media_id_fkey');
SELECT pg_temp.ng('写真の位置が半分だけの傷', $q$
  INSERT INTO app.damage_marks (tenant_id, case_id, record_version_id, media_id, x, description, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a1'), 0.1, 'x', pg_temp.u('1a1')) $q$,
  '23514', 'damage_marks_check');
SELECT pg_temp.ng('項目の行を別の記録版へ移す', $q$
  UPDATE app.record_entries SET record_version_id = pg_temp.u('8a3'), case_id = pg_temp.u('5a2')
   WHERE record_version_id = pg_temp.u('8a1') AND item_key = 'mileage' $q$,
  'P0001', expected_message => 'app.record_entries の case_id, record_version_id は変更できません');
SELECT pg_temp.ng('提出に必要な値を一部だけ入れて提出する', $q$
  UPDATE app.record_versions SET status = 'submitted', submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a1') $q$,
  '23514', 'record_versions_check2');
SELECT pg_temp.ok('提出する', $q$
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{"plate":"品川 500 あ 12-34"}', hash_algorithm = 'sha256',
         content_hash = repeat('b', 64), submit_idempotency_key = pg_temp.u('fe1'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a1') $q$);
SELECT pg_temp.assert_true('提出した版の状態とハッシュが残っている', EXISTS (
  SELECT 1 FROM app.record_versions
   WHERE id = pg_temp.u('8a1') AND status = 'submitted' AND content_hash = repeat('b', 64)
     AND submitted_by = pg_temp.u('1a1')));
SELECT pg_temp.ng('提出済みの版を書き換える', $q$
  UPDATE app.record_versions SET content_hash = repeat('0', 64) WHERE id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版は変更・削除できません');
SELECT pg_temp.ng('提出済みの版を消す', $q$
  DELETE FROM app.record_versions WHERE id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版は変更・削除できません');
SELECT pg_temp.ng('提出済みの版の項目を変える', $q$
  UPDATE app.record_entries SET value = '"empty"' WHERE record_version_id = pg_temp.u('8a1') AND item_key = 'fuel' $q$,
  'P0001', expected_message => '提出済みの記録版の record_entries は変更できません');
SELECT pg_temp.ng('提出済みの版に項目を足す', $q$
  INSERT INTO app.record_entries (tenant_id, case_id, record_version_id, item_key, value)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'note', '"x"') $q$,
  'P0001', expected_message => '提出済みの記録版の record_entries は変更できません');
SELECT pg_temp.ng('提出済みの版から写真を外す', $q$
  DELETE FROM app.record_version_media WHERE record_version_id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版の record_version_media は変更できません');
SELECT pg_temp.ng('提出済みの版の傷を消す', $q$
  DELETE FROM app.damage_marks WHERE record_version_id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版の damage_marks は変更できません');
SELECT pg_temp.ng('提出済みの版の撮影不能の理由を変える', $q$
  UPDATE app.capture_exceptions SET reason = 'x' WHERE record_version_id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版の capture_exceptions は変更できません');

SELECT pg_temp.ng('2版目なのに元の版がない', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 2, pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  '23514', 'record_versions_check');
SELECT pg_temp.ng('訂正の理由がない', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 2, pg_temp.u('8a1'), 'correction',
          pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  '23514', 'record_versions_check1');
SELECT pg_temp.ng('別の記録の版を元にする', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a3'), 2, pg_temp.u('8a1'), 'correction', 'x',
          pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  '23503', 'record_versions_record_id_based_on_version_id_fkey');
SELECT pg_temp.ng('下書きの版を元にする', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('7a2'), 2, pg_temp.u('8a3'), 'correction', 'x',
          pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => 'record_versions.based_on_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ok('訂正の版を作って提出する', $q$
  INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('8a2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 2, pg_temp.u('8a1'), 'correction',
          '燃料の記入ミス', pg_temp.u('3a1'), pg_temp.u('1a1'));
  INSERT INTO app.record_entries (tenant_id, case_id, record_version_id, item_key, value)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'fuel', '"full"'),
         (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'mileage', '12345');
  INSERT INTO app.record_version_media (tenant_id, case_id, record_version_id, media_id, spot_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('9a1'), 'front');
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('9', 64), submit_idempotency_key = pg_temp.u('fe2'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a2');
  INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('8a4'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 3, pg_temp.u('8a2'), 'supplement',
          '補足', pg_temp.u('3a1'), pg_temp.u('1a1')) $q$);
SELECT pg_temp.assert_true('訂正しても元の提出版が残っている', EXISTS (
  SELECT 1 FROM app.record_versions
   WHERE id = pg_temp.u('8a1') AND status = 'submitted' AND content_hash = repeat('b', 64)));
SELECT pg_temp.ng('下書きを二つ作る', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 4, pg_temp.u('8a2'), 'correction', 'x',
          pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  '23505', 'record_versions_one_draft');
SELECT pg_temp.ng('提出の再送キーを二度使う', $q$
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('9', 64), submit_idempotency_key = pg_temp.u('fe2'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a4') $q$,
  '23505', 'record_versions_tenant_id_submit_idempotency_key_key');
SELECT pg_temp.ok('下書きは捨てられる', $q$
  DELETE FROM app.record_versions WHERE id = pg_temp.u('8a4');
  INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, based_on_version_id, change_kind,
                                   change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('8a4'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a1'), 3, pg_temp.u('8a2'), 'supplement',
          '補足', pg_temp.u('3a1'), pg_temp.u('1a1')) $q$);

-- 比較
SELECT pg_temp.ok('別の案件の版も提出する', $q$
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('8', 64), submit_idempotency_key = pg_temp.u('fe3'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a3') $q$);
SELECT pg_temp.ok('二つの提出版を比べて判定し、判定を直す', $q$
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a2'), 'front', 1, 'changed', '傷が増えた', pg_temp.u('1a1'));
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a2'), 'front', 2, 'no_change', '光の反射だった', pg_temp.u('1a2')) $q$);
SELECT pg_temp.assert_true('いちばん大きい revision_no の行が今の判定になる', (
  SELECT judgement = 'no_change' FROM app.record_comparisons
   WHERE base_version_id = pg_temp.u('8a1') AND target_version_id = pg_temp.u('8a2') AND spot_key = 'front'
   ORDER BY revision_no DESC LIMIT 1));
SELECT pg_temp.ng('同じ revision_no の判定を二つ作る', $q$
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a2'), 'front', 2, 'changed', 'x', pg_temp.u('1a1')) $q$,
  '23505', 'record_comparisons_revision');
SELECT pg_temp.ng('revision_no を 0 にする', $q$
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a2'), 'rear', 0, 'changed', 'x', pg_temp.u('1a1')) $q$,
  '23514', 'record_comparisons_revision_no_check');
SELECT pg_temp.ng('下書きと比べる', $q$
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a4'), 'front', 1, 'changed', 'x', pg_temp.u('1a1')) $q$,
  'P0001', expected_message => 'record_comparisons.target_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ng('別の案件の版と比べる', $q$
  INSERT INTO app.record_comparisons (tenant_id, case_id, base_version_id, target_version_id, spot_key,
                                      revision_no, judgement, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('8a3'), 'front', 1, 'changed', 'x', pg_temp.u('1a1')) $q$,
  '23503', 'record_comparisons_tenant_id_case_id_target_version_id_fkey');
SELECT pg_temp.ng('判定を上書きする', $q$
  UPDATE app.record_comparisons SET judgement = 'changed' WHERE base_version_id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => 'app.record_comparisons のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 異議
-- ---------------------------------------------------------------
SELECT pg_temp.ok('関係者が異議を出し、項目と写真を添える', $q$
  INSERT INTO app.objections (id, tenant_id, case_id, record_version_id, body, created_by_participant)
  VALUES (pg_temp.u('ba1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), '燃料は満タンだった', pg_temp.u('6a1'));
  INSERT INTO app.objection_items (tenant_id, case_id, objection_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ba1'), pg_temp.u('8a1'), 'fuel');
  INSERT INTO app.objection_evidence (tenant_id, case_id, objection_id, media_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ba1'), pg_temp.u('9a2')) $q$);
SELECT pg_temp.ng('出した人が二人いる異議', $q$
  INSERT INTO app.objections (tenant_id, case_id, record_version_id, body, created_by_staff, created_by_participant)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'x', pg_temp.u('1a1'), pg_temp.u('6a1')) $q$,
  '23514', 'objections_check');
SELECT pg_temp.ng('社内の差し戻しに受付の判断を付ける', $q$
  INSERT INTO app.objections (tenant_id, case_id, record_version_id, body, created_by_staff, acceptance)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'x', pg_temp.u('1a1'), 'accepted') $q$,
  '23514', 'objections_check1');
SELECT pg_temp.ng('期限後の受付に理由がない', $q$
  UPDATE app.objections SET acceptance = 'late_accepted' WHERE id = pg_temp.u('ba1') $q$,
  '23514', 'objections_check2');
SELECT pg_temp.ng('下書きに異議を出す', $q$
  INSERT INTO app.objections (tenant_id, case_id, record_version_id, body, created_by_staff)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a4'), 'x', pg_temp.u('1a1')) $q$,
  'P0001', expected_message => 'objections.record_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ng('異議を出した版にない項目を対象にする', $q$
  INSERT INTO app.objection_items (tenant_id, case_id, objection_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ba1'), pg_temp.u('8a1'), 'no_such_item') $q$,
  '23503', 'objection_items_tenant_id_case_id_record_version_id_item_k_fkey');
SELECT pg_temp.ng('異議と違う版の項目を対象にする', $q$
  INSERT INTO app.objection_items (tenant_id, case_id, objection_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ba1'), pg_temp.u('8a2'), 'mileage') $q$,
  '23503', 'objection_items_objection_id_record_version_id_fkey');
SELECT pg_temp.ng('別の案件の写真を添える', $q$
  INSERT INTO app.objection_evidence (tenant_id, case_id, objection_id, media_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ba1'), pg_temp.u('9a3')) $q$,
  '23503', 'objection_evidence_tenant_id_case_id_media_id_fkey');
SELECT pg_temp.ng('異議の本文を書き換える', $q$
  UPDATE app.objections SET body = 'x' WHERE id = pg_temp.u('ba1') $q$,
  'P0001', expected_message => 'app.objections の body は変更できません');
SELECT pg_temp.ng('下書きの版で解決にする', $q$
  UPDATE app.objections SET status = 'resolved', resolution = '訂正', resolved_version_id = pg_temp.u('8a4'),
                            resolved_by = pg_temp.u('1a1'), resolved_at = now()
   WHERE id = pg_temp.u('ba1') $q$,
  'P0001', expected_message => 'objections.resolved_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ok('受け付けて、訂正版で解決する', $q$
  UPDATE app.objections SET acceptance = 'accepted', assignee_id = pg_temp.u('1a2'), status = 'in_progress'
   WHERE id = pg_temp.u('ba1');
  UPDATE app.objections SET status = 'resolved', resolution = '訂正した', resolved_version_id = pg_temp.u('8a2'),
                            resolved_by = pg_temp.u('1a2'), resolved_at = now()
   WHERE id = pg_temp.u('ba1') $q$);
SELECT pg_temp.ng('解決した異議を開け直す', $q$
  UPDATE app.objections SET status = 'in_progress', resolution = NULL, resolved_version_id = NULL,
                            resolved_by = NULL, resolved_at = NULL
   WHERE id = pg_temp.u('ba1') $q$,
  'P0001', expected_message => 'app.objections のこの行は変更・削除できません');
SELECT pg_temp.ng('異議を消す', $q$
  DELETE FROM app.objections WHERE id = pg_temp.u('ba1') $q$,
  'P0001', expected_message => 'app.objections のこの行は変更・削除できません');
SELECT pg_temp.ng('異議の対象項目を外す', $q$
  DELETE FROM app.objection_items WHERE objection_id = pg_temp.u('ba1') $q$,
  'P0001', expected_message => 'app.objection_items のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 確認
-- ---------------------------------------------------------------
SELECT pg_temp.ok('受領の確認を依頼する', $q$
  INSERT INTO app.confirmation_requests (id, tenant_id, case_id, record_version_id, participant_id,
                                         confirmation_type, statement_key, statement_version, statement_text,
                                         objection_id, created_by) VALUES
    (pg_temp.u('ca1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('6a1'), 'receipt', 'receipt', 1,
     '品川 500 あ 12-34 の車両を受け取りました', NULL, pg_temp.u('1a1')),
    (pg_temp.u('ca2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('6a1'), 'condition_agreement', 'cond', 1,
     '預かり時の状態に同意します', pg_temp.u('ba1'), pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('別の案件の関係者に依頼する', $q$
  INSERT INTO app.confirmation_requests (tenant_id, case_id, record_version_id, participant_id,
                                         confirmation_type, statement_key, statement_version, statement_text, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('6a2'), 'view', 'v', 1, '閲覧', pg_temp.u('1a1')) $q$,
  '23503', 'confirmation_requests_tenant_id_case_id_participant_id_fkey');
SELECT pg_temp.ng('下書きの確認を依頼する', $q$
  INSERT INTO app.confirmation_requests (tenant_id, case_id, record_version_id, participant_id,
                                         confirmation_type, statement_key, statement_version, statement_text, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a4'), pg_temp.u('6a1'), 'view', 'v', 1, '閲覧', pg_temp.u('1a1')) $q$,
  'P0001', expected_message => 'confirmation_requests.record_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ng('見せた文面が空の依頼', $q$
  INSERT INTO app.confirmation_requests (tenant_id, case_id, record_version_id, participant_id,
                                         confirmation_type, statement_key, statement_version, statement_text, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('6a1'), 'view', 'v', 1, '  ', pg_temp.u('1a1')) $q$,
  '23514', 'confirmation_requests_statement_text_not_blank');
SELECT pg_temp.ng('文面の版が 0 の依頼', $q$
  INSERT INTO app.confirmation_requests (tenant_id, case_id, record_version_id, participant_id,
                                         confirmation_type, statement_key, statement_version, statement_text, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('6a1'), 'view', 'v', 0, '閲覧', pg_temp.u('1a1')) $q$,
  '23514', 'confirmation_requests_statement_version_positive');
SELECT pg_temp.ng('依頼の文面の版を変える', $q$
  UPDATE app.confirmation_requests SET statement_version = 2 WHERE id = pg_temp.u('ca1') $q$,
  'P0001', expected_message => 'app.confirmation_requests の statement_version は変更できません');
SELECT pg_temp.ng('見せた文面を書き換える', $q$
  UPDATE app.confirmation_requests SET statement_text = '別の文面' WHERE id = pg_temp.u('ca1') $q$,
  'P0001', expected_message => 'app.confirmation_requests の statement_text は変更できません');

SELECT pg_temp.ok('回答し、答え直す', $q$
  INSERT INTO app.confirmation_responses (id, tenant_id, case_id, request_id, confirmation_type, answer,
                                          identity_method, idempotency_key) VALUES
    (pg_temp.u('da1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'receipt', 'refused', 'sms_otp', pg_temp.u('fd1'));
  INSERT INTO app.confirmation_responses (id, tenant_id, case_id, request_id, confirmation_type, answer,
                                          proxy_by, proxy_basis, identity_method, idempotency_key) VALUES
    (pg_temp.u('da2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'receipt', 'received',
     pg_temp.u('1a1'), '店頭で本人が口頭で受領', 'in_person', pg_temp.u('fd2'));
  INSERT INTO app.confirmation_responses (id, tenant_id, case_id, request_id, confirmation_type, answer,
                                          identity_method, idempotency_key) VALUES
    (pg_temp.u('da3'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca2'), 'condition_agreement', 'agreed', 'sms_otp', pg_temp.u('fd3')) $q$);
SELECT pg_temp.ng('依頼の種類に合わない答え', $q$
  INSERT INTO app.confirmation_responses (tenant_id, case_id, request_id, confirmation_type, answer,
                                          identity_method, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'receipt', 'agreed', 'sms_otp', gen_random_uuid()) $q$,
  '23514', 'confirmation_responses_check1');
SELECT pg_temp.ng('依頼と違う種類を写す', $q$
  INSERT INTO app.confirmation_responses (tenant_id, case_id, request_id, confirmation_type, answer,
                                          identity_method, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'view', 'viewed', 'sms_otp', gen_random_uuid()) $q$,
  '23503', 'confirmation_responses_tenant_id_case_id_request_id_confir_fkey');
SELECT pg_temp.ng('代理入力の根拠がない', $q$
  INSERT INTO app.confirmation_responses (tenant_id, case_id, request_id, confirmation_type, answer,
                                          proxy_by, identity_method, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'receipt', 'received', pg_temp.u('1a1'), 'x', gen_random_uuid()) $q$,
  '23514', 'confirmation_responses_check');
SELECT pg_temp.ng('再送で二重に回答する', $q$
  INSERT INTO app.confirmation_responses (tenant_id, case_id, request_id, confirmation_type, answer,
                                          identity_method, idempotency_key)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'receipt', 'received', 'sms_otp', pg_temp.u('fd1')) $q$,
  '23505', 'confirmation_responses_tenant_id_idempotency_key_key');
SELECT pg_temp.ng('回答を書き換える', $q$
  UPDATE app.confirmation_responses SET answer = 'received' WHERE id = pg_temp.u('da1') $q$,
  'P0001', expected_message => 'app.confirmation_responses のこの行は変更・削除できません');

SELECT pg_temp.ok('通知を送る', $q$
  INSERT INTO app.request_notifications (id, tenant_id, case_id, request_id, channel)
  VALUES (pg_temp.u('dc1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'sms');
  UPDATE app.request_notifications SET status = 'sent', sent_at = now() WHERE id = pg_temp.u('dc1') $q$);
SELECT pg_temp.ng('送った通知を失敗に変える', $q$
  UPDATE app.request_notifications SET status = 'failed', sent_at = NULL, error = 'x' WHERE id = pg_temp.u('dc1') $q$,
  'P0001', expected_message => 'app.request_notifications のこの行は変更・削除できません');
SELECT pg_temp.ng('理由なしの失敗', $q$
  INSERT INTO app.request_notifications (tenant_id, case_id, request_id, channel, status)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), 'sms', 'failed') $q$,
  '23514', 'request_notifications_check1');

SELECT pg_temp.ok('本人控えを作る（回答あり・なし）', $q$
  INSERT INTO app.personal_copies (id, tenant_id, case_id, request_id, response_id, storage_key, sha256) VALUES
    (pg_temp.u('db1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), pg_temp.u('da2'), 'pc1', repeat('1', 64)),
    (pg_temp.u('db2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca2'), NULL, 'pc2', repeat('2', 64)) $q$);
SELECT pg_temp.ng('別の依頼の回答を控えに付ける', $q$
  INSERT INTO app.personal_copies (tenant_id, case_id, request_id, response_id, storage_key, sha256)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('ca1'), pg_temp.u('da3'), 'pc3', repeat('3', 64)) $q$,
  '23503', 'personal_copies_tenant_id_case_id_request_id_response_id_fkey');
SELECT pg_temp.ng('控えの行を消す', $q$
  DELETE FROM app.personal_copies WHERE id = pg_temp.u('db1') $q$,
  'P0001', expected_message => 'app.personal_copies のこの行は変更・削除できません');

SELECT pg_temp.ok('依頼を取り下げる', $q$
  UPDATE app.confirmation_requests SET withdrawn_by = pg_temp.u('1a1'), withdrawn_at = now() WHERE id = pg_temp.u('ca2') $q$);
SELECT pg_temp.ng('取り下げを戻す', $q$
  UPDATE app.confirmation_requests SET withdrawn_by = NULL, withdrawn_at = NULL WHERE id = pg_temp.u('ca2') $q$,
  'P0001', expected_message => 'app.confirmation_requests のこの行は変更・削除できません');
SELECT pg_temp.ng('依頼を消す', $q$
  DELETE FROM app.confirmation_requests WHERE id = pg_temp.u('ca1') $q$,
  'P0001', expected_message => 'app.confirmation_requests のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 共有
-- ---------------------------------------------------------------
SELECT pg_temp.ok('写真にマスクを掛ける', $q$
  INSERT INTO app.media_annotations (id, tenant_id, case_id, media_id, kind, payload, created_by) VALUES
    (pg_temp.u('aa1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('9a1'), 'mask', '{}', pg_temp.u('1a1')),
    (pg_temp.u('aa2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('9a2'), 'mask', '{}', pg_temp.u('1a1')),
    (pg_temp.u('aa3'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('9a2'), 'annotation', '{}', pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('注釈を消した人なしで消す', $q$
  UPDATE app.media_annotations SET deleted_at = now() WHERE id = pg_temp.u('aa3') $q$,
  '23514', 'media_annotations_check1');
SELECT pg_temp.ok('注釈を消す', $q$
  UPDATE app.media_annotations SET deleted_by = pg_temp.u('1a1'), deleted_at = now() WHERE id = pg_temp.u('aa3') $q$);
SELECT pg_temp.ng('注釈の行を消す', $q$
  DELETE FROM app.media_annotations WHERE id = pg_temp.u('aa3') $q$,
  'P0001', expected_message => 'app.media_annotations のこの行は変更・削除できません');

SELECT pg_temp.ok('社外の人へ共有する', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_party_id, purpose, expires_at, access_token_hash, created_by)
  VALUES (pg_temp.u('ea1'), pg_temp.u('a'), pg_temp.u('2a1'), '保険の手続き', now() + interval '7 day', 'h1', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a1'));
  INSERT INTO app.share_grant_items (tenant_id, share_grant_id, case_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'fuel');
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id, mask_annotation_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a1'), pg_temp.u('aa1')) $q$);
SELECT pg_temp.ng('相手が二人いる共有', $q$
  INSERT INTO app.share_grants (tenant_id, recipient_party_id, recipient_tenant_id, purpose, expires_at, access_token_hash, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('2a1'), pg_temp.u('b'), 'x', now(), 'h2', pg_temp.u('1a1')) $q$,
  '23514', 'share_grants_check');
SELECT pg_temp.ng('自分の顧客へ共有する', $q$
  INSERT INTO app.share_grants (tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('a'), 'x', now(), pg_temp.u('1a1')) $q$,
  '23514', 'share_grants_check1');
SELECT pg_temp.ng('社外の人への共有にリンクがない', $q$
  INSERT INTO app.share_grants (tenant_id, recipient_party_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('2a1'), 'x', now(), pg_temp.u('1a1')) $q$,
  '23514', 'share_grants_check2');
SELECT pg_temp.ng('社外の人への共有を「受け入れ」にする', $q$
  UPDATE app.share_grants SET accepted_by = pg_temp.u('1a1'), accepted_at = now() WHERE id = pg_temp.u('ea1') $q$,
  '23514', 'share_grants_check4');
SELECT pg_temp.ng('下書きの版を共有する', $q$
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a4')) $q$,
  'P0001', expected_message => 'share_grant_targets.record_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ng('共有していない版の項目を見せる', $q$
  INSERT INTO app.share_grant_items (tenant_id, share_grant_id, case_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'fuel') $q$,
  '23503', 'share_grant_items_share_grant_id_record_version_id_fkey');
SELECT pg_temp.ng('版にない項目を見せる', $q$
  INSERT INTO app.share_grant_items (tenant_id, share_grant_id, case_id, record_version_id, item_key)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'no_such_item') $q$,
  '23503', 'share_grant_items_tenant_id_case_id_record_version_id_item_fkey');
SELECT pg_temp.ng('版に含めていない写真を共有する', $q$
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a2')) $q$,
  '23503', 'share_grant_media_tenant_id_case_id_record_version_id_medi_fkey');
SELECT pg_temp.ok('訂正版も共有範囲に入れる', $q$
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a2')) $q$);
SELECT pg_temp.ng('別の写真のマスクを掛ける', $q$
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id, mask_annotation_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('9a1'), pg_temp.u('aa2')) $q$,
  '23503', 'share_grant_media_mask_annotation_id_media_id_fkey');
SELECT pg_temp.ng('マスクでない注釈をマスクにする', $q$
  INSERT INTO app.media_annotations (id, tenant_id, case_id, media_id, kind, payload, created_by)
  VALUES (pg_temp.u('aa4'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('9a1'), 'annotation', '{}', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id, mask_annotation_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('9a1'), pg_temp.u('aa4')) $q$,
  'P0001', expected_message => 'マスクには消していない mask の注釈だけを指定できます');
SELECT pg_temp.ng('消したマスクを掛ける', $q$
  INSERT INTO app.media_annotations (id, tenant_id, case_id, media_id, kind, payload, created_by, deleted_by, deleted_at)
  VALUES (pg_temp.u('aa5'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('9a1'), 'mask', '{}', pg_temp.u('1a1'),
          pg_temp.u('1a1'), now());
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id, mask_annotation_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea1'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('9a1'), pg_temp.u('aa5')) $q$,
  'P0001', expected_message => 'マスクには消していない mask の注釈だけを指定できます');
SELECT pg_temp.ng('共有した写真のマスクを差し替える', $q$
  UPDATE app.share_grant_media SET mask_annotation_id = NULL WHERE share_grant_id = pg_temp.u('ea1') $q$,
  'P0001', expected_message => 'app.share_grant_media のこの行は変更・削除できません');
SELECT pg_temp.ng('共有の期限を延ばす', $q$
  UPDATE app.share_grants SET expires_at = expires_at + interval '1 day' WHERE id = pg_temp.u('ea1') $q$,
  'P0001', expected_message => 'app.share_grants の expires_at は変更できません');
SELECT pg_temp.ng('理由なしで共有を取り消す', $q$
  UPDATE app.share_grants SET revoked_by = pg_temp.u('1a1'), revoked_at = now() WHERE id = pg_temp.u('ea1') $q$,
  '23514', 'share_grants_check7');
SELECT pg_temp.ok('共有を取り消す', $q$
  UPDATE app.share_grants SET revoked_by = pg_temp.u('1a1'), revoked_at = now(), revoke_reason = '目的終了'
   WHERE id = pg_temp.u('ea1') $q$);
SELECT pg_temp.ng('取り消した共有を戻す', $q$
  UPDATE app.share_grants SET revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL WHERE id = pg_temp.u('ea1') $q$,
  'P0001', expected_message => 'app.share_grants のこの行は変更・削除できません');
SELECT pg_temp.ng('共有を消す', $q$
  DELETE FROM app.share_grants WHERE id = pg_temp.u('ea1') $q$,
  'P0001', expected_message => 'app.share_grants のこの行は変更・削除できません');
SELECT pg_temp.ng('共有の範囲を消す', $q$
  DELETE FROM app.share_grant_targets WHERE share_grant_id = pg_temp.u('ea1') $q$,
  'P0001', expected_message => 'app.share_grant_targets のこの行は変更・削除できません');

SELECT pg_temp.ok('別の事業者へ共有する範囲を決める', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ea2'), pg_temp.u('a'), pg_temp.u('b'), '修理の見積', now() + interval '7 day', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea2'), pg_temp.u('5a1'), pg_temp.u('8a1')) $q$);
SELECT pg_temp.ng('発行前に受け入れる', $q$
  UPDATE app.share_grants SET accepted_by = pg_temp.u('1b1'), accepted_at = now() WHERE id = pg_temp.u('ea2') $q$,
  '23514', 'share_grants_check5');
SELECT pg_temp.ng('共有する版がないまま発行する', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ea4'), pg_temp.u('a'), pg_temp.u('b'), 'x', now() + interval '7 day', pg_temp.u('1a1'));
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() WHERE id = pg_temp.u('ea4') $q$,
  'P0001', expected_message => '共有する記録版がない共有は発行できません');
SELECT pg_temp.ng('いきなり発行済みで作る', $q$
  INSERT INTO app.share_grants (tenant_id, recipient_tenant_id, purpose, expires_at, issued_by, issued_at, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('b'), 'x', now() + interval '7 day', pg_temp.u('1a1'), now(), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '共有は発行前の状態で作ってから発行してください');
SELECT pg_temp.ng('いきなり取り消し済みで作る', $q$
  INSERT INTO app.share_grants (tenant_id, recipient_tenant_id, purpose, expires_at, revoked_by, revoked_at,
                                revoke_reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('b'), 'x', now() + interval '7 day', pg_temp.u('1a1'), now(), 'x',
          pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '共有は発行前の状態で作ってから発行してください');
SELECT pg_temp.ng('期限より後の日時で発行する', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ea5'), pg_temp.u('a'), pg_temp.u('b'), 'x', now() + interval '1 day', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea5'), pg_temp.u('5a1'), pg_temp.u('8a1'));
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() + interval '2 day'
   WHERE id = pg_temp.u('ea5') $q$,
  '23514', 'share_grants_expiry_after_issue');
SELECT pg_temp.ng('期限が切れた共有を、日時をさかのぼって発行する', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ea6'), pg_temp.u('a'), pg_temp.u('b'), 'x', now() - interval '1 day', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea6'), pg_temp.u('5a1'), pg_temp.u('8a1'));
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() - interval '2 day'
   WHERE id = pg_temp.u('ea6') $q$,
  'P0001', expected_message => '期限が切れた共有は発行できません');
SELECT pg_temp.ok('共有を発行し、相手が受け入れる', $q$
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() WHERE id = pg_temp.u('ea2');
  UPDATE app.share_grants SET accepted_by = pg_temp.u('1b1'), accepted_at = now() WHERE id = pg_temp.u('ea2') $q$);
SELECT pg_temp.ng('発行した共有に版を足す', $q$
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea2'), pg_temp.u('5a1'), pg_temp.u('8a2')) $q$,
  'P0001', expected_message => '発行済みか取り消した共有には範囲を足せません');
SELECT pg_temp.ng('発行した共有に写真を足す', $q$
  INSERT INTO app.share_grant_media (tenant_id, share_grant_id, case_id, record_version_id, media_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea2'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('9a1')) $q$,
  'P0001', expected_message => '発行済みか取り消した共有には範囲を足せません');
SELECT pg_temp.ng('発行をやり直す', $q$
  UPDATE app.share_grants SET issued_at = now() + interval '1 day' WHERE id = pg_temp.u('ea2') $q$,
  'P0001', expected_message => '共有の発行と受け入れはやり直せません');
SELECT pg_temp.ng('受け入れをやり直す', $q$
  UPDATE app.share_grants SET accepted_at = now() + interval '1 day' WHERE id = pg_temp.u('ea2') $q$,
  'P0001', expected_message => '共有の発行と受け入れはやり直せません');
SELECT pg_temp.ng('共有した側の担当者が受け入れる', $q$
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ea3'), pg_temp.u('a'), pg_temp.u('b'), 'x', now() + interval '7 day', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ea3'), pg_temp.u('5a1'), pg_temp.u('8a1'));
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() WHERE id = pg_temp.u('ea3');
  UPDATE app.share_grants SET accepted_by = pg_temp.u('1a2'), accepted_at = now() WHERE id = pg_temp.u('ea3') $q$,
  '23503', 'share_grants_recipient_tenant_id_accepted_by_fkey');

-- ---------------------------------------------------------------
-- 保存期間と削除
-- ---------------------------------------------------------------
SELECT pg_temp.ok('保存期間を決めて直す', $q$
  INSERT INTO app.retention_policies (tenant_id, target_kind) VALUES (pg_temp.u('a'), 'media');
  UPDATE app.retention_policies SET retain_days = 365, basis = '契約' WHERE tenant_id = pg_temp.u('a') $q$);
SELECT pg_temp.ng('保存期間の対象を変える', $q$
  UPDATE app.retention_policies SET target_kind = 'record' WHERE tenant_id = pg_temp.u('a') $q$,
  'P0001', expected_message => 'app.retention_policies の target_kind は変更できません');

SELECT pg_temp.ng('案件と関係者の両方を消す申請', $q$
  INSERT INTO app.deletion_requests (tenant_id, case_id, party_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('2a1'), 'x', pg_temp.u('1a1')) $q$,
  '23514', 'deletion_requests_check');
SELECT pg_temp.ok('削除を申請し、保留して、承認して実行する', $q$
  INSERT INTO app.deletion_requests (id, tenant_id, case_id, reason, created_by)
  VALUES (pg_temp.u('dd1'), pg_temp.u('a'), pg_temp.u('5a2'), '保存期間の満了', pg_temp.u('1a1'));
  UPDATE app.deletion_requests SET status = 'on_hold', hold_reason = '異議の対応中' WHERE id = pg_temp.u('dd1');
  UPDATE app.deletion_requests SET status = 'approved', hold_reason = NULL, decided_by = pg_temp.u('1a2'),
                                   decided_at = now() WHERE id = pg_temp.u('dd1');
  UPDATE app.deletion_requests SET status = 'executed', executed_at = now() WHERE id = pg_temp.u('dd1') $q$);
SELECT pg_temp.ng('理由なしで保留する', $q$
  INSERT INTO app.deletion_requests (tenant_id, party_id, reason, status, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('2a1'), 'x', 'on_hold', pg_temp.u('1a1')) $q$,
  '23514', 'deletion_requests_check1');
SELECT pg_temp.ng('判断なしで承認する', $q$
  INSERT INTO app.deletion_requests (tenant_id, party_id, reason, status, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('2a1'), 'x', 'approved', pg_temp.u('1a1')) $q$,
  '23514', 'deletion_requests_check3');
SELECT pg_temp.ng('実行した削除を戻す', $q$
  UPDATE app.deletion_requests SET status = 'failed', executed_at = NULL WHERE id = pg_temp.u('dd1') $q$,
  'P0001', expected_message => 'app.deletion_requests のこの行は変更・削除できません');
SELECT pg_temp.ng('申請を消す', $q$
  DELETE FROM app.deletion_requests WHERE id = pg_temp.u('dd1') $q$,
  'P0001', expected_message => 'app.deletion_requests のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 検証基準と照合
-- ---------------------------------------------------------------
SELECT pg_temp.ok('検証基準を作る', $q$
  INSERT INTO integrity.anchors (id, tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('0c1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'chain', '1', decode('00', 'hex'), repeat('7', 64)) $q$);
SELECT pg_temp.ng('下書きの検証基準を作る', $q$
  INSERT INTO integrity.anchors (tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a4'), 'chain', '1', decode('00', 'hex'), 'x') $q$,
  'P0001', expected_message => 'anchors.record_version_id には提出済みの記録版だけを指定できます');
SELECT pg_temp.ng('同じ版・同じ方式の基準を二つ作る', $q$
  INSERT INTO integrity.anchors (tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), 'chain', '2', decode('00', 'hex'), 'x') $q$,
  '23505', 'anchors_record_version_id_method_key');
SELECT pg_temp.ng('検証基準をいきなり登録済みで作る', $q$
  INSERT INTO integrity.anchors (tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash,
                                 status, external_ref, registered_at)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'chain', '1', decode('00', 'hex'), repeat('7', 64),
          'registered', '0x9', now()) $q$,
  'P0001', expected_message => 'integrity.anchors は status = unregistered で作ってください');
SELECT pg_temp.ng('登録した内容を書き換える', $q$
  UPDATE integrity.anchors SET manifest = decode('01', 'hex') WHERE id = pg_temp.u('0c1') $q$,
  'P0001', expected_message => 'integrity.anchors の manifest は変更できません');

SELECT pg_temp.ok('送る前に署名済みのトランザクションを保存する', $q$
  INSERT INTO integrity.anchor_transactions (id, tenant_id, case_id, anchor_id, raw_tx, txid)
  VALUES (pg_temp.u('0b1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), decode('01', 'hex'), repeat('1', 64)) $q$);
SELECT pg_temp.ng('同じ txid のトランザクションを二つ保存する', $q$
  INSERT INTO integrity.anchor_transactions (tenant_id, case_id, anchor_id, raw_tx, txid)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), decode('02', 'hex'), repeat('1', 64)) $q$,
  '23505', 'anchor_transactions_txid_key');
SELECT pg_temp.ng('txid が 64 桁の16進数でない', $q$
  INSERT INTO integrity.anchor_transactions (tenant_id, case_id, anchor_id, raw_tx, txid)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), decode('02', 'hex'), '0x2') $q$,
  '23514', 'anchor_transactions_txid_format');
SELECT pg_temp.ng('保存したトランザクションを書き換える', $q$
  UPDATE integrity.anchor_transactions SET raw_tx = decode('02', 'hex') WHERE id = pg_temp.u('0b1') $q$,
  'P0001', expected_message => 'integrity.anchor_transactions のこの行は変更・削除できません');
SELECT pg_temp.ng('保存したトランザクションを消す', $q$
  DELETE FROM integrity.anchor_transactions WHERE id = pg_temp.u('0b1') $q$,
  'P0001', expected_message => 'integrity.anchor_transactions のこの行は変更・削除できません');

SELECT pg_temp.ok('登録を試して失敗し、同じトランザクションをもう一度送って結果を入れる', $q$
  INSERT INTO integrity.anchor_attempts (id, tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('0d2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 1, 'submit', pg_temp.u('0b1'));
  UPDATE integrity.anchor_attempts SET outcome = 'failed', response = '{"error":"timeout"}', finished_at = now()
   WHERE id = pg_temp.u('0d2');
  INSERT INTO integrity.anchor_attempts (id, tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('0d1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 2, 'submit', pg_temp.u('0b1'));
  UPDATE integrity.anchor_attempts SET outcome = 'succeeded', response = '{"tx":"0x1"}', finished_at = now()
   WHERE id = pg_temp.u('0d1') $q$);
SELECT pg_temp.ng('同じ試行の番号を二度使う', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 2, 'lookup', pg_temp.u('0b1')) $q$,
  '23505', 'anchor_attempts_anchor_id_attempt_no_key');
SELECT pg_temp.ng('試行の番号が 0', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 0, 'lookup', pg_temp.u('0b1')) $q$,
  '23514', 'anchor_attempts_attempt_no_positive');
SELECT pg_temp.ng('結果だけ入れて終わった日時がない', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id, outcome)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 3, 'lookup', pg_temp.u('0b1'), 'failed') $q$,
  '23514', 'anchor_attempts_check');
SELECT pg_temp.ng('終わった試行を書き換える', $q$
  UPDATE integrity.anchor_attempts SET outcome = 'failed' WHERE id = pg_temp.u('0d1') $q$,
  'P0001', expected_message => 'integrity.anchor_attempts のこの行は変更・削除できません');
SELECT pg_temp.ng('案件と食い違う試行', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('0c1'), 3, 'lookup', pg_temp.u('0b1')) $q$,
  '23503', 'anchor_attempts_tenant_id_case_id_anchor_id_fkey');
SELECT pg_temp.ng('トランザクションを指さずに送る', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 3, 'submit') $q$,
  '23502');
SELECT pg_temp.ng('トランザクションを指さずに照会する', $q$
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 3, 'lookup') $q$,
  '23502');
SELECT pg_temp.ng('別の検証基準のトランザクションを送る', $q$
  INSERT INTO integrity.anchors (id, tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('0c2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'chain', '1', decode('00', 'hex'), repeat('7', 64));
  INSERT INTO integrity.anchor_transactions (id, tenant_id, case_id, anchor_id, raw_tx, txid)
  VALUES (pg_temp.u('0b2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c2'), decode('02', 'hex'), repeat('2', 64));
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c1'), 3, 'submit', pg_temp.u('0b2')) $q$,
  '23503', 'anchor_attempts_tenant_id_case_id_anchor_id_transaction_id_fkey');
SELECT pg_temp.ng('失敗した試行しかない基準を登録済みにする', $q$
  INSERT INTO integrity.anchors (id, tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('0c2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'chain', '1', decode('00', 'hex'), repeat('7', 64));
  INSERT INTO integrity.anchor_transactions (id, tenant_id, case_id, anchor_id, raw_tx, txid)
  VALUES (pg_temp.u('0b2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c2'), decode('02', 'hex'), repeat('2', 64));
  INSERT INTO integrity.anchor_attempts (tenant_id, case_id, anchor_id, attempt_no, kind, transaction_id, outcome, finished_at)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('0c2'), 1, 'submit', pg_temp.u('0b2'), 'failed', now());
  UPDATE integrity.anchors SET status = 'registered', external_ref = repeat('2', 64), registered_at = now()
   WHERE id = pg_temp.u('0c2') $q$,
  'P0001', expected_message => 'external_ref が成功した試行の txid と一致しない検証基準は registered にできません');
SELECT pg_temp.ng('登録先の参照なしで登録済みにする', $q$
  UPDATE integrity.anchors SET status = 'registered', registered_at = now() WHERE id = pg_temp.u('0c1') $q$,
  'P0001', expected_message => 'external_ref が成功した試行の txid と一致しない検証基準は registered にできません');
SELECT pg_temp.ng('成功した試行と違う txid で登録済みにする', $q$
  UPDATE integrity.anchors SET status = 'registered', external_ref = repeat('9', 64), registered_at = now()
   WHERE id = pg_temp.u('0c1') $q$,
  'P0001', expected_message => 'external_ref が成功した試行の txid と一致しない検証基準は registered にできません');
SELECT pg_temp.ng('登録した日時なしで登録済みにする', $q$
  UPDATE integrity.anchors SET status = 'registered', external_ref = repeat('1', 64) WHERE id = pg_temp.u('0c1') $q$,
  '23514', 'anchors_check');
SELECT pg_temp.ok('登録済みにする', $q$
  UPDATE integrity.anchors SET status = 'registered', external_ref = repeat('1', 64), registered_at = now()
   WHERE id = pg_temp.u('0c1') $q$);
SELECT pg_temp.ng('登録済みの基準を戻す', $q$
  UPDATE integrity.anchors SET status = 'failed', registered_at = NULL WHERE id = pg_temp.u('0c1') $q$,
  'P0001', expected_message => 'integrity.anchors のこの行は変更・削除できません');
SELECT pg_temp.ng('基準を消す', $q$
  DELETE FROM integrity.anchors WHERE id = pg_temp.u('0c1') $q$,
  'P0001', expected_message => 'integrity.anchors のこの行は変更・削除できません');

SELECT pg_temp.ok('照合する（一致・基準なし）', $q$
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, anchor_id, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('0c1'), 'match');
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, result, reason)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'unverifiable', '基準がない') $q$);
SELECT pg_temp.ng('基準なしで一致にする', $q$
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'match') $q$,
  'P0001', expected_message => '登録済みの検証基準がない照合は unverifiable にしてください');
SELECT pg_temp.ng('不一致に理由がない', $q$
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, anchor_id, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a1'), pg_temp.u('0c1'), 'mismatch') $q$,
  '23514', 'verification_runs_check1');
SELECT pg_temp.ng('別の版の基準で照合する', $q$
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, anchor_id, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('0c1'), 'match') $q$,
  '23503', 'verification_runs_tenant_id_record_version_id_anchor_id_fkey');
SELECT pg_temp.ng('未登録の基準で一致にする', $q$
  INSERT INTO integrity.anchors (id, tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('0c2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'chain', '1', decode('00', 'hex'), repeat('7', 64));
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, anchor_id, result)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('0c2'), 'match') $q$,
  'P0001', expected_message => '登録済みの検証基準がない照合は unverifiable にしてください');
SELECT pg_temp.ok('未登録の基準では照合不能にする', $q$
  INSERT INTO integrity.anchors (id, tenant_id, case_id, record_version_id, method, method_version, manifest, manifest_hash)
  VALUES (pg_temp.u('0c2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), 'chain', '1', decode('00', 'hex'), repeat('7', 64));
  INSERT INTO integrity.verification_runs (tenant_id, case_id, record_version_id, anchor_id, result, reason)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8a2'), pg_temp.u('0c2'), 'unverifiable', '未登録') $q$);
SELECT pg_temp.ng('照合の結果を書き換える', $q$
  UPDATE integrity.verification_runs SET result = 'mismatch', reason = 'x' WHERE record_version_id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => 'integrity.verification_runs のこの行は変更・削除できません');

-- ---------------------------------------------------------------
-- 監査履歴
-- ---------------------------------------------------------------
SELECT pg_temp.ok('監査履歴を書く', $q$
  INSERT INTO audit.events (tenant_id, actor_type, actor_id, action, target_type, target_id, result, entry_hash)
  VALUES (pg_temp.u('a'), 'staff', pg_temp.u('1a1'), 'submit', 'record_version', pg_temp.u('8a1'), 'succeeded', 'e1');
  INSERT INTO audit.events (tenant_id, actor_type, action, target_type, result, entry_hash)
  VALUES (pg_temp.u('a'), 'system', 'anchor', 'anchor', 'succeeded', 'e2') $q$);
SELECT pg_temp.ng('システムの操作にだれかを入れる', $q$
  INSERT INTO audit.events (actor_type, actor_id, action, target_type, result, entry_hash)
  VALUES ('system', pg_temp.u('1a1'), 'x', 'x', 'succeeded', 'e3') $q$,
  '23514', 'events_check');
SELECT pg_temp.ng('監査履歴を書き換える', $q$
  UPDATE audit.events SET result = 'failed' $q$,
  'P0001', expected_message => 'audit.events のこの行は変更・削除できません');
SELECT pg_temp.ng('監査履歴を消す', $q$
  DELETE FROM audit.events $q$,
  'P0001', expected_message => 'audit.events のこの行は変更・削除できません');
SELECT pg_temp.ng('監査履歴を TRUNCATE する', $q$
  TRUNCATE audit.events $q$,
  'P0001', expected_message => 'audit.events は TRUNCATE できません');
SELECT pg_temp.ng('照合の結果を TRUNCATE する', $q$
  TRUNCATE integrity.verification_runs $q$,
  'P0001', expected_message => 'integrity.verification_runs は TRUNCATE できません');
SELECT pg_temp.ng('記録版をまとめて TRUNCATE する', $q$
  TRUNCATE app.record_versions CASCADE $q$,
  'P0001', expected_message => 'app.record_versions は TRUNCATE できません');

-- ---------------------------------------------------------------
-- 構成版の切り替えと案件の移行
-- ---------------------------------------------------------------
SELECT pg_temp.ok('新しい構成版を反映する', $q$
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, based_on_id, settings, created_by_staff)
  VALUES (pg_temp.u('3a5'), pg_temp.u('a'), 5, pg_temp.u('3a1'), '{"v":5}', pg_temp.u('1a1'));
  INSERT INTO app.configuration_modules (tenant_id, configuration_version_id, business_type, template_id)
  VALUES (pg_temp.u('a'), pg_temp.u('3a5'), 'rental', pg_temp.u('0e1'));
  UPDATE app.configuration_versions SET status = 'superseded' WHERE id = pg_temp.u('3a1');
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1a1'), published_at = now()
   WHERE id = pg_temp.u('3a5') $q$);
SELECT pg_temp.ok('移行しない案件は旧版のまま進む', $q$
  UPDATE app.cases SET stage = 'lending' WHERE id = pg_temp.u('5a2') $q$);
SELECT pg_temp.ng('移行しない案件で新しい構成版の記録版を作る', $q$
  INSERT INTO app.records (id, tenant_id, case_id, record_kind, created_by)
  VALUES (pg_temp.u('7a8'), pg_temp.u('a'), pg_temp.u('5a2'), 'x', pg_temp.u('1a1'));
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a2'), pg_temp.u('7a8'), 1, pg_temp.u('3a5'), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '記録版の構成版は案件の構成版と同じにしてください');
SELECT pg_temp.ok('案件を新しい構成版へ移す', $q$
  UPDATE app.cases SET configuration_version_id = pg_temp.u('3a5') WHERE id = pg_temp.u('5a1') $q$);
SELECT pg_temp.ng('案件を置き換わった構成版へ戻す', $q$
  UPDATE app.cases SET configuration_version_id = pg_temp.u('3a1') WHERE id = pg_temp.u('5a1') $q$,
  'P0001', expected_message => '案件には本番反映した構成版だけを指定できます');
SELECT pg_temp.ng('移した案件で旧版の記録版を作る', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a3'), 1, pg_temp.u('3a1'), pg_temp.u('1a1')) $q$,
  'P0001', expected_message => '記録版の構成版は案件の構成版と同じにしてください');
SELECT pg_temp.ok('移した案件で新しい構成版の記録版を作る', $q$
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7a3'), 1, pg_temp.u('3a5'), pg_temp.u('1a1')) $q$);
SELECT pg_temp.ng('移した案件の下書きを旧版のまま提出する', $q$
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('8', 64), submit_idempotency_key = pg_temp.u('fe9'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a4') $q$,
  'P0001', expected_message => '記録版の構成版は案件の構成版と同じにしてください');
SELECT pg_temp.ok('移した案件の下書きを新しい構成版へ移してから提出する', $q$
  UPDATE app.record_versions SET configuration_version_id = pg_temp.u('3a5') WHERE id = pg_temp.u('8a4');
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('8', 64), submit_idempotency_key = pg_temp.u('fe9'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8a4') $q$);
SELECT pg_temp.ng('提出済みの版を新しい構成版へ移す', $q$
  UPDATE app.record_versions SET configuration_version_id = pg_temp.u('3a5') WHERE id = pg_temp.u('8a1') $q$,
  'P0001', expected_message => '提出済みの記録版は変更・削除できません');
