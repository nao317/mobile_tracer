-- 制約のテストと同時実行のテストで使う確認用の関数。pg_temp に作るので、接続ごとに読み込む。
SET client_min_messages = warning;

CREATE FUNCTION pg_temp.u(x text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-' || lpad(x, 12, '0'))::uuid
$$;

-- 止まるはずの SQLSTATE を書き、制約で止めるものは制約名も書く。
-- 主な SQLSTATE: 23503 外部キー、23505 一意、23514 CHECK、23502 NOT NULL、P0001 トリガーの RAISE EXCEPTION
-- トリガーの RAISE はどれも P0001 になるので、どのトリガーで止まったかは expected_message のエラー文で確かめる。
-- 比べるのは 000001 のトリガーに書いたエラー文で、PostgreSQL 自身のエラー文は比べない。
-- 止まった処理はロールバックされるので、ここで作った行を後のテストで使わない。
CREATE FUNCTION pg_temp.ng(
  label text,
  statement_sql text,
  expected_state text,
  expected_constraint text DEFAULT NULL,
  expected_message text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  observed_state text;
  observed_constraint text;
  observed_message text;
BEGIN
  IF expected_state = 'P0001' AND expected_message IS NULL THEN
    RAISE EXCEPTION 'NG: % は P0001 なので expected_message も書く', label;
  END IF;

  BEGIN
    EXECUTE statement_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      observed_state = RETURNED_SQLSTATE,
      observed_constraint = CONSTRAINT_NAME,
      observed_message = MESSAGE_TEXT;
  END;

  IF observed_state IS NULL THEN
    RAISE EXCEPTION 'NG: % はエラーになるはずが通った', label;
  END IF;

  IF observed_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'NG: % のエラーが違う。期待=%、実際=%、内容=%',
      label, expected_state, observed_state, observed_message;
  END IF;

  IF expected_constraint IS NOT NULL
     AND observed_constraint IS DISTINCT FROM expected_constraint THEN
    RAISE EXCEPTION 'NG: % の制約が違う。期待=%、実際=%、内容=%',
      label, expected_constraint, observed_constraint, observed_message;
  END IF;

  IF expected_message IS NOT NULL
     AND observed_message IS DISTINCT FROM expected_message THEN
    RAISE EXCEPTION 'NG: % のエラー文が違う。期待=%、実際=%',
      label, expected_message, observed_message;
  END IF;

  RAISE NOTICE 'OK: %', label;
END $$;

-- 失敗したら、後のテストを続けずにその場で止める
CREATE FUNCTION pg_temp.ok(label text, sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'OK: %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'NG: % が失敗した -> [%] %', label, SQLSTATE, SQLERRM;
END $$;

-- 0 件の UPDATE も成功になるので、保存された結果はこれで確かめる
CREATE FUNCTION pg_temp.assert_true(label text, actual boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NG: %', label;
  END IF;
  RAISE NOTICE 'OK: %', label;
END $$;

SET client_min_messages = notice;
