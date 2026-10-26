# バックエンドAPI

Go・Echoで動くAPIの最小構成です。`GET /api/health` はHTTP 200と `{"status":"ok"}` を返します。PostgreSQL・Tapyrus APIへの接続、業務API、Nginx経由のアクセスは別Issueで実装します。

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
docker compose up --build --wait backend
curl -i http://localhost:8080/api/health
docker compose logs -f backend
```

`--wait` は、ヘルスチェックの成功まで待ちます。停止するには次を実行します。

```bash
docker compose down
```

ホスト側の8080番ポートが使用中の場合は、公開ポートを変更できます。

```bash
BACKEND_PORT=9000 docker compose up --build --wait backend
curl -i http://localhost:9000/api/health
```

バックエンドはホストの `127.0.0.1` に公開します。コンテナ内のポートは8080固定です。

## 環境変数

APIは起動時に環境変数を読み取ります。未設定または空文字の場合は既定値を使い、不正な値の場合はエラーを記録して終了します。`.env` ファイルをAPI自身が読み込む処理はありません。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `PORT` | `8080` | APIの待受ポート。1〜65535の整数。すべてのネットワークインターフェースで待ち受けます。Composeでは8080に固定します。 |
| `SHUTDOWN_TIMEOUT` | `10s` | 終了時に処理中のリクエストを待つ上限。`time.ParseDuration` で解釈できる正の値（例: `5s`、`1m`）。Composeでも指定できます。 |
| `BACKEND_PORT` | `8080` | Compose専用。ホストに公開するポート。 |
| `BACKEND_STOP_GRACE_PERIOD` | `15s` | Compose専用。停止時にコンテナを強制終了するまでの猶予。`SHUTDOWN_TIMEOUT` より長く設定してください。 |

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
go build ./cmd/api
```

`gofmt -l .` は、整形が必要なファイルがなければ何も表示しません。整形する場合は `gofmt -w .` を実行します。

テストではヘルスチェックのステータス・JSON・リクエストログ、パニックからの復旧、環境変数の既定値と入力エラーを確認します。CIの `backend` ジョブでも同じ検査とビルドを行います。

## ディレクトリ構成

```text
backend/
├── cmd/api/main.go           # 起動、シグナル処理、graceful shutdown
├── internal/config/          # 環境変数の読取・検証
├── internal/server/          # Echo、ミドルウェア、ルーティング
├── Dockerfile
├── go.mod
└── go.sum
```
