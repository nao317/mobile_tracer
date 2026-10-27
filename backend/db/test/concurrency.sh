#!/usr/bin/env bash
# 二つの接続から同時に操作して、後の接続がロックで待たされ、先の接続が確定した後に止まることを確かめる。
# run.sh から DB 名を渡して呼ぶ。constraints.sql で作った行を使うので、その後に流す。
set -euo pipefail
cd "$(dirname "$0")/.."
psql=(psql -X -q -v ON_ERROR_STOP=1 -d "$1")
tmp=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$tmp"' EXIT

# 確認用の関数を読み込んでから流す。結果の行は捨て、OK と NG の行だけを出す
run() { "${psql[@]}" -o /dev/null -f test/helpers.sql "$@"; }

# race 名前 先の接続の文 後の接続の文 止まる理由
# 先の接続は BEGIN して文を流し、後の接続がこの接続を待ち始めるまで COMMIT しない。
# 後の接続は、先の接続が確定した後に、止まる理由で止まることを ng() で確かめる。
# 止まる理由は ng() の SQL より後の引数（SQLSTATE と、制約名かエラー文）をそのまま書く。
race() {
  PGAPPNAME=race_first run -f - >"$tmp/first.log" 2>&1 <<SQL &
BEGIN;
$2
DO \$\$
BEGIN
  FOR i IN 1..200 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (SELECT 1 FROM pg_stat_activity
                WHERE application_name = 'race_second' AND pg_backend_pid() = ANY (pg_blocking_pids(pid))) THEN
      RAISE NOTICE 'OK: %（後の接続が待つ）', '$1';
      RETURN;
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION 'NG: % で後の接続が待たなかった', '$1';
END \$\$;
COMMIT;
SQL
  local first=$! status=0
  # 先の接続が文を流し終えて、待つところまで進むのを待つ
  for _ in {1..100}; do
    [[ $("${psql[@]}" -tAc "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'race_first' AND query LIKE 'DO%'") == 1 ]] && break
    kill -0 "$first" 2>/dev/null || break
    sleep 0.1
  done
  PGAPPNAME=race_second run -c "SELECT pg_temp.ng('$1', \$q\$ $3 \$q\$, $4)" >"$tmp/second.log" 2>&1 || status=1
  wait "$first" || status=1
  cat "$tmp/first.log" "$tmp/second.log"
  return $status
}

run -c "SELECT pg_temp.ok('同時実行のテストに使う行を作る', \$q\$
  INSERT INTO app.records (id, tenant_id, case_id, record_kind, created_by) VALUES
    (pg_temp.u('7c1'), pg_temp.u('a'), pg_temp.u('5a1'), 'pre_rental', pg_temp.u('1a1')),
    (pg_temp.u('7c2'), pg_temp.u('a'), pg_temp.u('5a1'), 'pre_rental', pg_temp.u('1a1'));
  INSERT INTO app.record_versions (id, tenant_id, case_id, record_id, version_no, configuration_version_id, created_by) VALUES
    (pg_temp.u('8c1'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7c1'), 1, pg_temp.u('3a5'), pg_temp.u('1a1')),
    (pg_temp.u('8c2'), pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7c2'), 1, pg_temp.u('3a5'), pg_temp.u('1a1'));
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('c', 64), submit_idempotency_key = pg_temp.u('fc1'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8c2');
  INSERT INTO app.share_grants (id, tenant_id, recipient_tenant_id, purpose, expires_at, created_by)
  VALUES (pg_temp.u('ec1'), pg_temp.u('a'), pg_temp.u('b'), '修理の見積', now() + interval '7 day', pg_temp.u('1a1'));
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ec1'), pg_temp.u('5a1'), pg_temp.u('8a1'));
  INSERT INTO app.tenants (id, name, status) VALUES (pg_temp.u('d'), 'D 自動車', 'active');
  INSERT INTO app.staff_members (id, tenant_id, display_name, email, status)
  VALUES (pg_temp.u('1d1'), pg_temp.u('d'), '高橋', 'takahashi@d.example', 'active');
  INSERT INTO app.configuration_versions (id, tenant_id, version_no, settings, created_by_staff) VALUES
    (pg_temp.u('3d1'), pg_temp.u('d'), 1, '{}', pg_temp.u('1d1')),
    (pg_temp.u('3d2'), pg_temp.u('d'), 2, '{}', pg_temp.u('1d1'));
  INSERT INTO app.vehicles (id, tenant_id, model_name) VALUES
    (pg_temp.u('4a8'), pg_temp.u('a'), 'フィット'), (pg_temp.u('4a9'), pg_temp.u('a'), 'フィット') \$q\$)"

# 提出する側は tables.md に書いた順に、記録版を FOR UPDATE してから submitted にする
race '提出と同時に項目を足す' "
  SELECT 1 FROM app.record_versions WHERE id = pg_temp.u('8c1') FOR UPDATE;
  UPDATE app.record_versions
     SET status = 'submitted', vehicle_snapshot = '{}', hash_algorithm = 'sha256',
         content_hash = repeat('c', 64), submit_idempotency_key = pg_temp.u('fc2'),
         submitted_by = pg_temp.u('1a1'), submitted_at = now()
   WHERE id = pg_temp.u('8c1');" "
  INSERT INTO app.record_entries (tenant_id, case_id, record_version_id, item_key, value)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('8c1'), 'odometer', '12000')" \
  "'P0001', expected_message => '提出済みの記録版の record_entries は変更できません'"

race '発行と同時に共有の範囲を足す' "
  UPDATE app.share_grants SET issued_by = pg_temp.u('1a1'), issued_at = now() WHERE id = pg_temp.u('ec1');" "
  INSERT INTO app.share_grant_targets (tenant_id, share_grant_id, case_id, record_version_id)
  VALUES (pg_temp.u('a'), pg_temp.u('ec1'), pg_temp.u('5a1'), pg_temp.u('8c2'))" \
  "'P0001', expected_message => '発行済みか取り消した共有には範囲を足せません'"

race '同じ顧客の構成版を二つ同時に反映する' "
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1d1'), published_at = now()
   WHERE id = pg_temp.u('3d1');" "
  UPDATE app.configuration_versions
     SET status = 'published', published_by = pg_temp.u('1d1'), published_at = now()
   WHERE id = pg_temp.u('3d2')" \
  "'23505', 'configuration_versions_one_published'"

race '二台の車両を互いに統合する' "
  INSERT INTO app.vehicle_merges (tenant_id, source_vehicle_id, target_vehicle_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('4a8'), pg_temp.u('4a9'), '重複登録', pg_temp.u('1a1'));" "
  INSERT INTO app.vehicle_merges (tenant_id, source_vehicle_id, target_vehicle_id, reason, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('4a9'), pg_temp.u('4a8'), '重複登録', pg_temp.u('1a1'))" \
  "'P0001', expected_message => '統合先の車両はすでに別の車両へ統合されています'"

# 版の番号を変えて、番号の重複ではなく下書きの数で止まることを見る
race '同じ記録に下書きを同時に作る' "
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id,
                                   change_kind, change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7c2'), 2, pg_temp.u('8c2'),
          'correction', '走行距離の訂正', pg_temp.u('3a5'), pg_temp.u('1a1'));" "
  INSERT INTO app.record_versions (tenant_id, case_id, record_id, version_no, based_on_version_id,
                                   change_kind, change_reason, configuration_version_id, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('5a1'), pg_temp.u('7c2'), 3, pg_temp.u('8c2'),
          'correction', '走行距離の訂正', pg_temp.u('3a5'), pg_temp.u('1a1'))" \
  "'23505', 'record_versions_one_draft'"

run -c "
  SELECT pg_temp.assert_true('提出した版に、重なった項目が残っていない',
    (SELECT status FROM app.record_versions WHERE id = pg_temp.u('8c1')) = 'submitted'
    AND NOT EXISTS (SELECT 1 FROM app.record_entries WHERE record_version_id = pg_temp.u('8c1')));
  SELECT pg_temp.assert_true('発行した共有の範囲が、発行したときのまま',
    (SELECT issued_at IS NOT NULL FROM app.share_grants WHERE id = pg_temp.u('ec1'))
    AND (SELECT count(*) FROM app.share_grant_targets WHERE share_grant_id = pg_temp.u('ec1')) = 1);
  SELECT pg_temp.assert_true('本番の構成版が一つだけ',
    (SELECT count(*) FROM app.configuration_versions
      WHERE tenant_id = pg_temp.u('d') AND status = 'published') = 1);
  SELECT pg_temp.assert_true('統合が片方だけ残る',
    (SELECT count(*) FROM app.vehicle_merges
      WHERE source_vehicle_id IN (pg_temp.u('4a8'), pg_temp.u('4a9'))) = 1);
  SELECT pg_temp.assert_true('下書きが一つだけ',
    (SELECT count(*) FROM app.record_versions
      WHERE record_id = pg_temp.u('7c2') AND status = 'draft') = 1)"
