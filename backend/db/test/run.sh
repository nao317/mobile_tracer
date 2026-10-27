#!/usr/bin/env bash
# 空の DB にマイグレーションを番号順に流し、制約のテスト、書き方の決まりの確認、同時実行のテストをする。
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

# テストは最初の NG で止まる。止まったら psql が 0 以外で終わるので、その終了コードでも失敗を判定する
status=0
out=$("${psql[@]}" -d "$db" -f test/constraints.sql -f test/rules.sql 2>&1) || status=$?
# 同時実行のテストは constraints.sql で作った行を使うので、通ったときだけ流す
if [[ $status -eq 0 ]]; then
  out+=$'\n'$(bash test/concurrency.sh "$db" 2>&1) || status=$?
fi
ok=$(grep -c 'OK:' <<<"$out" || true)
ng=$(grep -E 'NG:|ERROR:' <<<"$out" || true)

if [[ $status -ne 0 || -n "$ng" ]]; then
  echo "$out"
  echo "OK $ok 件で止まりました（psql の終了コード $status）"
  exit 1
fi
echo "OK $ok 件"
