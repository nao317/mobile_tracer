# バックエンドAPI

Go・Echoで動くAPIです。`GET /api/health` はAPI単体の稼働を確認し、HTTP 200と `{"status":"ok"}` を返します。`GET /api/ready` はTapyrus CoreとEsploraへの接続・索引の準備状態を確認します。PostgreSQLへの接続、業務API、Nginx経由のアクセスは別Issueで実装します。

## ローカルで起動する

Go 1.27.3以上を用意し、リポジトリルートから実行します。

```bash
cd backend
go mod download
go run ./cmd/api
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

`docker compose up` で PostgreSQL 17（`db`）も起動し、`db-migrate` が `db/migrations` の未適用分を流して終了します。APIからDBへの接続はまだありません。DBのパスワードは `scripts/init.sh` が `.env` に作ります。

```bash
# マイグレーションの適用状況（version が最新の番号で、dirty が f なら正常）
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select * from schema_migrations"'

# 制約のテスト。別のDBを作って流し、終わったら消す
docker compose run --rm db-test
```

ホストの `127.0.0.1:5432` にも公開します。使用中の場合は `DB_PORT` で変えてください。テーブルの設計は[テーブル設計](../docs/schema/tables.md)を参照してください。

## 環境変数

APIは起動時に環境変数を読み取ります。未設定または空文字の場合は既定値を使い、不正な値の場合はエラーを記録して終了します。`.env` ファイルをAPI自身が読み込む処理はありません。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `PORT` | `8080` | APIの待受ポート。1〜65535の整数。すべてのネットワークインターフェースで待ち受けます。Composeでは8080に固定します。 |
| `SHUTDOWN_TIMEOUT` | `10s` | 終了時に処理中のリクエストを待つ上限。`time.ParseDuration` で解釈できる正の値（例: `5s`、`1m`）。Composeでも指定できます。 |
| `BACKEND_PORT` | `8080` | Compose専用。ホストに公開するポート。 |
| `BACKEND_STOP_GRACE_PERIOD` | `15s` | Compose専用。停止時にコンテナを強制終了するまでの猶予。`SHUTDOWN_TIMEOUT` より長く設定してください。 |
| `TAPYRUS_RPC_URL` | 未設定 | CoreのRPC接続先。Composeでは `http://tapyrusd:12381`。 |
| `TAPYRUS_REST_URL` | 未設定 | EsploraのREST接続先。Composeでは `http://esplora:3000`。 |
| `TAPYRUS_RPC_USER` / `TAPYRUS_RPC_PASSWORD` | 未設定 | CoreのRPC認証情報。両URLを指定する場合に必要。 |
| `TAPYRUS_TIMEOUT` | `5s` | 接続確認全体の上限時間。正の時間を指定。 |

ローカル起動で両接続先を省略すると、API単体で動きます。この場合は `/api/health` が200、`/api/ready` が503を返します。接続先を設定する場合は両URLと認証情報を揃えてください。

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

テストではヘルスチェック・準備状態の応答、ログ、パニックからの復旧、設定値の検証と、Tapyrusの接続失敗・タイムアウト・チェーンの不一致を確認します。CIの `backend` ジョブでも同じ検査とビルドを行います。

## ディレクトリ構成

```text
backend/
├── cmd/api/main.go           # 起動、シグナル処理、graceful shutdown
├── cmd/tapyrus-check/main.go # Core・Esploraへの接続確認
├── internal/config/          # 環境変数の読取・検証
├── internal/server/          # Echo、ミドルウェア、ルーティング
├── internal/tapyrus/         # CoreのRPC・EsploraのRESTクライアント
├── db/migrations/            # DBのマイグレーション（golang-migrate）
├── db/test/                  # マイグレーションの確認（run.sh）
├── Dockerfile
├── go.mod
└── go.sum
```
