# Tapyrusのローカル開発環境

Go APIからTapyrus CoreのRPCとEsploraのREST APIに接続するための環境です。Docker Engine、Docker Compose v2、Bash、Python 3を使用します。Goをホストにインストールする必要はありません。

最初に「初期化と起動」を実行してください。「接続確認とテスト」以降は、検証や再起動が必要なときに参照できます。

## 初期化と起動

リポジトリルートで実行します。

```bash
bash scripts/init.sh
docker compose up --build --wait --wait-timeout 180
python3 scripts/smoke.py
```

初回のイメージ取得・ビルドにはネットワーク接続が必要です。チェーン自体は単一ノードの `dev` モードで動き、公開テストネット、Faucet、外部Signerには接続しません。承認が必要なときは、開発用の鍵でブロックを生成します。

`scripts/init.sh` は `.env` がなければ `.env.example` から作成し、空のRPCパスワードをランダムな値で補います。続いてCoreを起動し、開発用の署名鍵・ジェネシスブロック・ウォレットを準備して101ブロックを生成します。初期化済みの環境では、同じ鍵とチェーンを使い、ブロックを追加しません。

鍵とジェネシスはボリュームに保存します。初期化スクリプトは、既存ボリュームとネットワークID・ウォレット名が異なる場合に停止します。別の環境を用意するには、別のComposeプロジェクト名を使ってください。

```bash
export COMPOSE_PROJECT_NAME=mobile-tracer-dev2
export BACKEND_PORT=8081
bash scripts/init.sh
docker compose up --build --wait --wait-timeout 180
```

## サービスと接続先

| サービス | 役割 | Compose内の接続先 |
| --- | --- | --- |
| `tapyrus-init` | 鍵・ジェネシス・RPC設定の初期化。完了後に終了 | 接続先なし |
| `tapyrusd` | Tapyrus Core `v0.7.2`。チェーンとウォレットを管理 | `http://tapyrusd:12381`（RPC） |
| `tapyrus-bootstrap` | ウォレットの作成・読込と検証用コインの準備。完了後に終了 | CoreのRPCを利用 |
| `esplora` | Esplora `v0.5.8`。ブロック・トランザクションを索引化 | `http://esplora:3000`（REST） |
| `backend` | Go APIと接続確認コマンド | `http://backend:8080` |

CoreとEsploraはタグとイメージのダイジェストを固定しています。Esploraには、Goの接続確認コマンドを追加したイメージを使います。RPC経由で索引を作るため、Esploraにウォレットや署名鍵の保存先はマウントしません。

ホストに公開するのはGo APIの `127.0.0.1:8080` のみです。CoreとEsploraへの確認コマンドはCompose内で実行します。

Esploraのヘルスチェックは、CoreとREST APIのジェネシス・最新ブロックの一致まで確認します。その成功後にGo APIを起動します。通常の起動順は、初期化 → Core → ウォレット・コイン準備 → Esplora → Go APIです。

## 接続確認とテスト

```bash
# API単体の稼働確認。Tapyrusが停止していても200を返します。
curl -i http://localhost:8080/api/health

# CoreとEsploraが同じチェーンの最新ブロックを参照できると200を返します。
curl -i http://localhost:8080/api/ready

# Goコンテナから両方のAPIへ接続し、チェーン情報をJSONで表示します。
docker compose exec -T backend /app/tapyrus-check

# ヘルスチェックと、Goコンテナからの接続を確認します。
python3 scripts/smoke.py

# 検証用送金・ブロック生成・txid照会と再起動後のデータ保持を確認します。
python3 scripts/tapyrus-smoke.py
```

`tapyrus-smoke.py` は、同じ開発用ウォレット内の新しいアドレスへ1 TPCを送信し、1ブロックを生成します。CoreとEsploraで承認結果を照合した後、両サービスを再起動し、チェーン・索引・ウォレット残高・トランザクションの保持を確認します。実行するたびに検証用の送金とブロックが追加されます。

任意のタイミングで1ブロック生成するには、次を実行します。署名鍵はコンテナ内で読み取り、表示しません。

```bash
docker compose exec -T tapyrusd sh /opt/tapyrus/mine.sh 1
```

接続失敗、認証エラー、タイムアウト、別チェーンへの接続、索引の遅れはGoの単体テストでも検査します。実行方法は[バックエンドのREADME](../backend/README.md#テストと検査)を参照してください。

## 環境変数と認証情報

Composeはルートの `.env` を読み取ります。`.env` はGitの管理対象外で、初期化スクリプトは権限を `600` にします。サンプルの `.env.example` に秘密情報を記載しないでください。

| 変数 | 既定値・初期値 | 用途 |
| --- | --- | --- |
| `TAPYRUS_NETWORK_ID` | `1905960821` | ローカル開発用ネットワークのID |
| `TAPYRUS_RPC_USER` | `mobiletracer` | CoreのRPCユーザー名 |
| `TAPYRUS_RPC_PASSWORD` | 初期化時に生成 | CoreのRPCパスワード |
| `TAPYRUS_WALLET` | `mobile-tracer` | 開発用ウォレット名 |
| `TAPYRUS_TIMEOUT` | `5s` | Goの接続確認全体の上限時間 |
| `BACKEND_PORT` | `8080` | ホスト側に公開するGo APIのポート |
| `COMPOSE_PROJECT_NAME` | Composeの既定値 | 別環境のコンテナ・ボリュームを分けるプロジェクト名 |

RPCユーザー名・パスワード・ウォレット名には英数字、`_`、`-` を使用します。ネットワークID・ウォレット名は、初期化後に同じボリュームで変更できません。

GoへはComposeから `TAPYRUS_RPC_URL`、`TAPYRUS_REST_URL` とRPC認証情報を渡します。URLはそれぞれ `http://tapyrusd:12381`、`http://esplora:3000` です。RPCパスワードや署名鍵はイメージに含めません。Esploraの認証はファイル経由とし、起動時の設定ログにパスワードが出ないようにしています。

`TAPYRUS_TIMEOUT` を延ばす場合は、Composeのヘルスチェックの `timeout` もそれより長く調整してください。既定では7秒です。

## 停止・再起動・データ削除

データを残して停止するには、次を実行します。

```bash
docker compose down
```

再度 `bash scripts/init.sh` と起動コマンドを実行すると、同じ鍵・チェーン・ウォレット・索引を使用します。

保存先は次の名前付きボリュームです。実際の名前にはComposeのプロジェクト名が付きます。

| ボリューム | 保存するもの |
| --- | --- |
| `tapyrus-data` | 開発用署名鍵、ジェネシス、Coreの設定、チェーン、ウォレット |
| `tapyrus-auth` | Esploraが読み取るRPC認証ファイル |
| `esplora-data` | Esploraの索引 |

開発データをすべて削除してやり直す場合のみ、次を実行します。署名鍵とウォレットも削除され、元のチェーンを使えなくなります。

```bash
docker compose down --volumes
bash scripts/init.sh
docker compose up --build --wait --wait-timeout 180
```

## 起動や接続に失敗したとき

| 状況 | 確認・対応 |
| --- | --- |
| RPCパスワードが未設定と表示される | 最初に `bash scripts/init.sh` を実行する |
| ネットワークID・ウォレット名の不一致で止まる | 元の設定に戻すか、別のComposeプロジェクトを使用する |
| `/api/ready` が503になる | `docker compose ps -a` と `docker compose logs --tail=100 tapyrusd esplora backend` で停止・索引の遅れ・接続エラーを調べる |
| 索引が最新ブロックに追いつかない | Esploraのログを確認する。ブロック生成直後は索引の更新を待つ |
| ホスト側のポートが使用中 | `.env` の `BACKEND_PORT` を変更して起動し直す |

## 実装の対象範囲

この環境はCoreのRPCとEsploraのREST APIへの接続・検証を対象とします。写真・記録のハッシュ登録を行う業務API、PostgreSQLへの登録状態の保存・再試行管理、Explorer画面、Nginx、本番ネットワークと本番用の鍵管理は別Issueで対応します。

構成は[tapyrus-explorerのCompose](https://github.com/chaintope/tapyrus-explorer/blob/master/docker-compose.yml)、開発モードとブロック生成は[Tapyrus Coreの手順](https://github.com/chaintope/tapyrus-core/blob/master/doc/tapyrus/getting_started.md#how-to-start-tapyrus-in-dev-mode)、照会は[EsploraのAPI仕様](https://github.com/chaintope/esplora-tapyrus/blob/main/doc/API.md)を参考にしています。
