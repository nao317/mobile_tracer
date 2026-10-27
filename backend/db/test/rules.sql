-- 表を足したときに、書き方の決まり（docs/schema/tables.md）から外れていないかを確かめる。
-- 外れた表や列があると "NG:" の行を出し、最後にエラーで止まる。run.sh から流す。
\set ON_ERROR_STOP on

CREATE TEMP VIEW violations AS
-- 外部キーのない _id・_by の列。audit.events は消えた行も指せるよう外部キーを張らない
SELECT '外部キーのない列' AS rule, c.table_schema || '.' || c.table_name || '.' || c.column_name AS target
  FROM information_schema.columns c
 WHERE c.table_schema IN ('app', 'integrity')
   AND (c.column_name ~ '_id$' OR c.column_name ~ '_by(_staff|_participant|_operator)?$')
   AND NOT EXISTS (
     SELECT 1 FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
      WHERE k.contype = 'f'
        AND k.conrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
        AND a.attname = c.column_name)
UNION ALL
SELECT '配列の列', table_schema || '.' || table_name || '.' || column_name
  FROM information_schema.columns
 WHERE table_schema IN ('app', 'integrity', 'audit') AND data_type = 'ARRAY'
UNION ALL
-- 案件の下の表を指すのに、case_id を持たない表
SELECT DISTINCT 'case_id のない表', k.conrelid::regclass::text
  FROM pg_constraint k
 WHERE k.contype = 'f'
   AND k.confrelid <> 'app.cases'::regclass
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = k.confrelid AND a.attname = 'case_id' AND NOT a.attisdropped)
   AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = k.conrelid AND a.attname = 'case_id' AND NOT a.attisdropped)
UNION ALL
-- 有効で、どの列の更新でも条件なしで動く BEFORE ROW の UPDATE トリガーがあるか。
-- 中身が正しく更新を止めるかは constraints.sql で確かめる
SELECT '更新を制限するトリガーがない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('app', 'integrity', 'audit')
   AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                      AND t.tgenabled IN ('O', 'A')
                      AND (t.tgtype & 16) <> 0  -- UPDATE
                      AND (t.tgtype & 2) <> 0   -- BEFORE
                      AND (t.tgtype & 1) <> 0   -- FOR EACH ROW
                      AND t.tgattr = ''::int2vector
                      AND t.tgqual IS NULL)
UNION ALL
SELECT 'TRUNCATE を止めるトリガーがない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('app', 'integrity', 'audit')
   AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                      AND t.tgenabled IN ('O', 'A')
                      AND (t.tgtype & 32) <> 0  -- TRUNCATE
                      AND (t.tgtype & 2) <> 0   -- BEFORE
                      AND (t.tgtype & 1) = 0    -- FOR EACH STATEMENT
                      AND t.tgfoid = 'app.reject_change()'::regprocedure)
UNION ALL
SELECT 'id があるのに created_at がない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('app', 'integrity', 'audit')
   AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id')
   AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'created_at');

DO $$
DECLARE
  v record;
  n integer := 0;
BEGIN
  FOR v IN SELECT * FROM pg_temp.violations ORDER BY 1, 2 LOOP
    RAISE WARNING 'NG: % -> %', v.rule, v.target;
    n := n + 1;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'NG: 書き方の決まりに反する箇所が % 件あります', n;
  END IF;
  RAISE NOTICE 'OK: 書き方の決まりから外れた表や列はない';
END $$;
