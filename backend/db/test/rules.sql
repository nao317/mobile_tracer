-- 表を足したときに、書き方の決まり（docs/schema/tables.md）から外れていないかを確かめる。
-- 外れた表や列があると "NG:" の行が出る。run.sh から流す。

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
SELECT '更新を制限するトリガーがない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('app', 'integrity', 'audit')
   AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND (t.tgtype & 16) <> 0)
UNION ALL
SELECT 'TRUNCATE を止めるトリガーがない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('app', 'integrity', 'audit')
   AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid AND (t.tgtype & 32) <> 0)
UNION ALL
SELECT 'id があるのに created_at がない表', n.nspname || '.' || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('app', 'integrity', 'audit')
   AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id')
   AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'created_at');

DO $$
DECLARE
  v record;
  found boolean := false;
BEGIN
  FOR v IN SELECT * FROM pg_temp.violations ORDER BY 1, 2 LOOP
    RAISE WARNING 'NG: % -> %', v.rule, v.target;
    found := true;
  END LOOP;
  IF NOT found THEN
    RAISE NOTICE 'OK: 書き方の決まりから外れた表や列はない';
  END IF;
END $$;
