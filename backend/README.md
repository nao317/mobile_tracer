# バックエンドAPI

Go・Echoで動くAPIです。`GET /api/health` はAPI単体の稼働を確認し、HTTP 200と `{"status":"ok"}` を返します。`GET /api/ready` はPostgreSQLへの接続と、Tapyrus Core・Esploraの接続・索引の準備状態を確認します。業務APIとNginx経由のアクセスは別Issueで実装します。

## ローカルで起動する

Go 1.27.3以上を用意し、リポジトリルートから実行します。初回は `bash scripts/init.sh` で `.env` を準備してください。先にDBを起動し、接続情報を環境変数へ読み込みます。

```bash
docker compose up -d --wait db
docker compose run --rm db-migrate
# scripts/init.sh が生成したローカル開発用 .env を読み込む
set -a
source .env
set +a
cd backend
go mod download
DB_HOST=127.0.0.1 go run ./cmd/api
```

別のターミナルで応答を確認します。

```bash
curl -i http://localhost:8080/api/health
```

`go run` は `Ctrl+C` で停止します。ビルドしたバイナリを直接実行する場合は、`Ctrl+C` または `SIGTERM` で停止できます。

```bash
go build -o bin/api ./cmd/api
./bin/api
```

## Docker Composeで起動する

Docker EngineとDocker Compose v2を用意し、リポジトリルートから実行します。イメージはビルド用と実行用を分け、APIを非rootユーザーで実行します。

```bash
bash scripts/init.sh
docker compose up --build --wait --wait-timeout 180
curl -i http://localhost:8080/api/health
curl -i http://localhost:8080/api/ready
docker compose logs -f backend
```

`--wait` は、ヘルスチェックの成功まで待ちます。停止するには次を実行します。

```bash
docker compose down
```

Tapyrusの構成・初期化・検証用トランザクション・データ削除の手順は[ローカル開発環境の説明](../docs/tapyrus.md)を参照してください。

ホスト側の8080番ポートが使用中の場合は、公開ポートを変更できます。

```bash
BACKEND_PORT=9000 docker compose up --build --wait backend
curl -i http://localhost:9000/api/health
```

バックエンドはホストの `127.0.0.1` に公開します。コンテナ内のポートは8080固定です。

## DB

`docker compose up` で PostgreSQL 17（`db`）も起動し、`db-migrate` が `db/migrations` の未適用分を流して終了します。APIはマイグレーション完了後に起動し、GORMとPostgreSQLドライバーで接続します。DBのパスワードは `scripts/init.sh` が `.env` に作ります。テーブルの作成・変更は既存のSQLマイグレーションで管理し、GORMのAutoMigrateは使いません。

APIはHTTPの受付を始める前にDB接続を確認します。設定不備や接続失敗があればエラーで終了します。起動後にDBへ接続できなくなると、`/api/ready` は `503` と `{"status":"unavailable"}` を返します。DBが復旧すれば、APIを再起動せずに再接続します。`/api/health` はDB・Tapyrusの状態によらず200を返します。

接続プールはAPIプロセスごとに持ち、HTTPリクエストの終了を待ってから閉じます。起動時と準備状態の接続確認は `DB_TIMEOUT` で打ち切ります。リクエストがキャンセルされた場合も待機を止めます。

```bash
# マイグレーションの適用状況（version が最新の番号で、dirty が f なら正常）
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select * from schema_migrations"'

# 制約のテスト。別のDBを作って流し、終わったら消す
docker compose run --rm db-test
```

ホストの `127.0.0.1:5432` にも公開します。使用中の場合は `DB_PORT` で変えてください。テーブルの設計は[テーブル設計](../docs/schema/tables.md)を参照してください。

## 環境変数

APIは起動時に環境変数を読み取ります。必須項目が空の場合や不正な値の場合は、エラーを記録して終了します。任意項目が未設定または空文字の場合は既定値を使います。`.env` ファイルをAPI自身が読み込む処理はありません。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `PORT` | `8080` | APIの待受ポート。1〜65535の整数。すべてのネットワークインターフェースで待ち受けます。Composeでは8080に固定します。 |
| `SHUTDOWN_TIMEOUT` | `10s` | 終了時に処理中のリクエストを待つ上限。`time.ParseDuration` で解釈できる正の値（例: `5s`、`1m`）。Composeでも指定できます。 |
| `BACKEND_PORT` | `8080` | Compose専用。ホストに公開するポート。 |
| `BACKEND_STOP_GRACE_PERIOD` | `15s` | Compose専用。停止時にコンテナを強制終了するまでの猶予。`SHUTDOWN_TIMEOUT` より長く設定してください。 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | 必須 | DB名・ユーザー・パスワード。ComposeではDB名に `mobile_tracer`、ユーザーに `mobiletracer` を補います。 |
| `DB_HOST` | `localhost` | DB接続先。ComposeのAPI内では `db` に固定します。 |
| `DB_PORT` | `5432` | DB接続先のポート。Composeではホスト公開用にも使い、API内の接続先は5432に固定します。 |
| `DB_SSLMODE` | `disable` | PostgreSQLのSSLモード。ローカル開発の既定値です。Compose内では `disable` に固定します。TLS接続では `verify-full` など環境に合う値を指定してください。 |
| `DB_TIMEOUT` | `3s` | 起動時・準備状態のDB接続確認の上限。正の時間を指定します。 |
| `DB_MAX_OPEN_CONNS` | `10` | APIプロセスごとの最大接続数。1以上の整数。 |
| `DB_MAX_IDLE_CONNS` | `2` | 待機接続数の上限。0以上かつ最大接続数以下の整数。 |
| `DB_CONN_MAX_LIFETIME` | `30m` | 接続を再利用する期間の上限。正の時間を指定します。 |
| `TAPYRUS_RPC_URL` | 未設定 | CoreのRPC接続先。Composeでは `http://tapyrusd:12381`。 |
| `TAPYRUS_REST_URL` | 未設定 | EsploraのREST接続先。Composeでは `http://esplora:3000`。 |
| `TAPYRUS_RPC_USER` / `TAPYRUS_RPC_PASSWORD` | 未設定 | CoreのRPC認証情報。両URLを指定する場合に必要。 |
| `TAPYRUS_TIMEOUT` | `5s` | 接続確認全体の上限時間。正の時間を指定。 |

Tapyrusの両接続先を省略しても、DBの設定と接続は必要です。この場合は `/api/health` が200、`/api/ready` が503を返します。Tapyrusも利用する場合は両URLと認証情報を揃えてください。

準備状態はDB、Tapyrusの順に確認するため、全体の待機時間は最大で `DB_TIMEOUT + TAPYRUS_TIMEOUT` です。ComposeのAPIヘルスチェックは10秒で打ち切ります。確認時間を増やす場合は、この値も余裕を持って調整してください。

ローカルでの指定例です。

```bash
PORT=9000 SHUTDOWN_TIMEOUT=5s go run ./cmd/api
```

Composeで終了待機時間を変更する場合は、両方の値を指定します。

```bash
SHUTDOWN_TIMEOUT=20s BACKEND_STOP_GRACE_PERIOD=25s docker compose up --build --wait backend
```

リクエストログと起動・終了ログはJSON形式で標準出力に記録します。パニックが発生した場合はログに記録し、HTTP 500を返します。`SIGINT`・`SIGTERM` を受信すると新しい接続の受付を止め、処理中のリクエストが完了するまで待ちます。上限を過ぎた場合は接続を閉じ、エラーで終了します。

## テストと検査

`backend` ディレクトリで実行します。`-race` にはCGOとCコンパイラー（LinuxではGCCなど）が必要です。

```bash
gofmt -l .
go vet ./...
go test -race -count=1 ./...
go build ./cmd/api ./cmd/tapyrus-check
```

`gofmt -l .` は、整形が必要なファイルがなければ何も表示しません。整形する場合は `gofmt -w .` を実行します。

テストではヘルスチェック・準備状態の応答、ログ、パニックからの復旧、設定値の検証、DBの接続タイムアウト、Tapyrusの接続失敗・タイムアウト・チェーンの不一致を確認します。CIの `backend` ジョブではPostgreSQLも起動し、GORMでのクエリ、認証失敗、接続プール待機のキャンセル、接続終了後の準備状態を検査します。

接続情報を環境変数に読み込んだ状態で、実DBを使うテストをローカルでも実行できます。

```bash
TEST_DATABASE=1 go test -race -count=1 ./...
```

全サービスの起動後、リポジトリルートで次を実行すると、不正な認証情報による起動失敗と、DB停止時の503・復旧後の200を確認できます。DBを一時停止するため、ローカルの検証環境で実行してください。CIの結合テストでも実行します。

```bash
python3 scripts/db-smoke.py
```

## ディレクトリ構成

```text
backend/
├── cmd/api/main.go           # 起動、シグナル処理、graceful shutdown
├── cmd/tapyrus-check/main.go # Core・Esploraへの接続確認
├── internal/config/          # 環境変数の読取・検証
├── internal/database/        # GORM・接続プール・接続確認
├── internal/server/          # Echo、ミドルウェア、ルーティング
├── internal/tapyrus/         # CoreのRPC・EsploraのRESTクライアント
├── db/migrations/            # DBのマイグレーション（golang-migrate）
├── db/test/                  # マイグレーションの確認（run.sh）
├── Dockerfile
├── go.mod
└── go.sum
```
