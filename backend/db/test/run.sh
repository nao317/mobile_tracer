#!/usr/bin/env bash
# 空の DB にマイグレーションを番号順に流し、制約のテストと書き方の決まりの確認をする。
# 接続先は PGHOST、PGPORT、PGUSER などの環境変数で指定する。DB を作れるロールで実行する。
# 作った DB は最後に消す。
set -euo pipefail

cd "$(dirname "$0")/.."
db="mobile_tracer_test_$$"
psql=(psql -X -q -v ON_ERROR_STOP=1)

"${psql[@]}" -d postgres -c "CREATE DATABASE $db"
trap '"${psql[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db"' EXIT

# golang-migrate と同じく、1 ファイルを一つのトランザクションで流す
for f in migrations/*.up.sql; do
  echo "$f"
  "${psql[@]}" -1 -d "$db" -f "$f"
done

out=$(psql -X -q -d "$db" -f test/constraints.sql -f test/rules.sql 2>&1)
ok=$(grep -c 'OK:' <<<"$out" || true)
ng=$(grep -E 'NG:|ERROR:' <<<"$out" || true)

if [[ -n "$ng" ]]; then
  echo "$ng"
  echo "OK $ok 件、NG $(grep -c . <<<"$ng") 件"
  exit 1
fi
echo "OK $ok 件"
