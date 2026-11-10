# ローカル負荷試験の手順

## 1. コードと実行環境の準備

変更が `develop` に取り込まれた後、Ubuntu または WSL2 の作業コピーで実行します。

```bash
git switch develop
git pull --ff-only origin develop
docker version
docker compose version
python3 --version
openssl version
free -h
df -h .
docker system df
```

Docker Engine と Compose v2、ホストの Python 3.10 以上と OpenSSL を使います。実行ユーザーからローカル Docker ソケットに接続できる状態にしてください。Go、Node.js、k6、psql はコンテナで実行します。初回のイメージ取得・ビルドにはパッケージ配布元への接続が必要です。

## 2. 初期化と起動

```bash
./scripts/load.sh init
./scripts/load.sh check
./scripts/load.sh up
```

`init` は試験用 DB パスワード、試験ユーザー用パスワード、CA、mTLS のサーバー・クライアント証明書、Bearer トークンを生成します。生成済みのファイルは再利用します。変更するのは `.env.load` の設定値です。値を画面共有やログに出さないでください。

| 設定 | 初期値 | 用途 |
| --- | ---: | --- |
| `LOAD_HTTP_PORT` | 18080 | ログイン画面と API のホスト側ポート |
| `LOAD_AUTH_PORT` | 19099 | Firebase Auth エミュレーターのホスト側ポート |
| `LOAD_API_REPLICAS` | 1 | API の起動台数。1〜8 台 |
| `LOAD_API_CPUS` | 1.0 | API 1 台あたりの CPU 上限 |
| `LOAD_API_MEMORY_MIB` | 512 | API 1 台あたりのメモリ上限 |
| `LOAD_DB_CONNECTIONS` | 10 | API 1 台あたりの DB 接続上限。全 API の合計は 90 以下 |
| `LOAD_MOCK_MODE` | normal | 模擬 Timestamp V2 の動作 |
| `LOAD_MOCK_DELAY_MS` | 0 | 模擬 POST の応答遅延 |
| `LOAD_CONFIRM_SECONDS` | 5 | 模擬サービスで承認済みになるまでの秒数 |

ポートが使用中なら別の値を指定し、`check` と `up` をやり直します。起動後のログイン画面は `http://localhost:18080/login` です。認証エミュレーターへのブラウザー通信は同じ専用 Nginx の別ポートを経由します。証明書の期限切れや権限エラーが出たら、専用環境を停止してから `load/credentials` を退避し、同じ一般ユーザーで `init` を実行します。証明書は 365 日で失効します。

Compose プロジェクトは `mobile-tracer-load` です。Go API・DB・Firebase・k6・模擬サービスは外部ルートのない専用ネットワークに参加します。Nginx の入口だけを別ネットワークに置き、ホストでは 2 ポートとも `127.0.0.1` に限定します。Nginx の転送先は構成内のサービス名に固定しています。Firebase は `demo-mobile-tracer-load`、Timestamp V2 は `mock-tapyrus` に固定しています。専用 DB、Firebase ボリューム、証明書と結果はこのプロジェクトに閉じています。

## 3. データ量の見積もりと投入

```bash
./scripts/load.sh estimate small
./scripts/load.sh estimate medium
./scripts/load.sh estimate large
./scripts/load.sh seed small
./scripts/load.sh verify
```

初期例は small が 100 顧客・300 案件、medium が 1,000 顧客・3,000 案件、large が 10,000 顧客・30,000 案件です。medium と large の投入は空き容量と所要時間を確認してから実施します。

```bash
./scripts/load.sh reset
./scripts/load.sh up
./scripts/load.sh seed medium
./scripts/load.sh verify
```

large は `seed large` を指定します。生成条件は `load/config/` の JSON で変更できます。案件開始状態と業態の割合は、それぞれ合計を 100 にします。割合は固定 seed の抽選で割り当てるため、小規模では設定値からずれることがあります。案件開始の待機期限は基準日時から 365 日、期限超過データは基準日時から 1 時間で生成します。投入時点から 1 時間以上 365 日未満前の基準日時を指定してください。写真は JPEG・PNG・WebP で、1 枚の最大は 10 MiB です。WebP のバイト数は偶数にします。写真の件数は対象記録の割合、版数、各版の写真数で調整できます。写真なしの記録は下書きとして残ります。

`estimate` はテーブル別の予定件数、Firebase ユーザー数、写真の実バイト数、DB・インデックス・WAL と作業領域の概算を出します。写真は同じ seed の有効な画像を位置ごとに保存します。画像以外の容量は行あたりの仮定を使った概算です。Docker の既存キャッシュ、DB のページ空きや WAL の再利用により実使用量は変動します。

`seed` は同じ設定なら重複投入を抑止し、Firebase の対応アカウントを確認します。異なる条件は DB に記録した設定ハッシュと照合して拒否します。 `verify` は更新試験の前に実行します。件数、ケースの承認条件、写真・登録マニフェストのハッシュ、初期案件状態の指紋が出ます。別の実行との照合には同じ生成コード、JSON、seed と基準日時を使います。

## 4. 認証と試運転

```bash
./scripts/load.sh smoke
./scripts/load.sh run login --duration 5 --vus 2 --rate 2
./scripts/load.sh run read --warmup 5 --duration 10 --vus 2 --rate 2
```

試験ユーザーは `seed` で Firebase とアプリ DB の両方に作成します。k6 は試験前にユーザーごとの ID トークン、チャレンジ、セッション Cookie、CSRF を取得します。認証情報はメモリー内で扱います。事前認証は `phase:prepare`、負荷対象は `phase:business` として区別されます。 `run login` は認証そのものを測ります。手動確認では `.env.load` の試験用パスワードと `small-customer-0@load.example` を使用できます。

k6 の業務 HTTP は `k6 → 専用 Nginx → Go API → PostgreSQL` を通ります。画面表示の SSR は `Nginx → React Router / Express → Nginx 内部ポート → Go API` を使います。試運転は SSR のログイン画面が返ることを確認し、性能値は業務 API を対象とします。

## 5. 更新、競合、写真、混合負荷

```bash
./scripts/load.sh run conflict --duration 5 --vus 1
./scripts/load.sh run write --duration 5 --vus 2 --rate 1
./scripts/load.sh run images --duration 5 --vus 2 --rate 1 --image-bytes 65536
./scripts/load.sh run mixed --duration 10 --vus 3 --rate 2 --read-percent 70
```

`--rate` は毎秒のシナリオ開始数です。1 回のシナリオで複数の HTTP リクエストを送ります。 `--rate 0` は同時ユーザー数を固定します。 `conflict` は同一案件へ同時リクエストを送る 1 回の試験です。同一再送キーは同じ結果、別のキーで競合した更新は 200 と 409 が 1 件ずつになることを確認します。権限外アクセスや開始承認前の処理も検査します。

更新試験は未処理の専用案件を消費します。必要な枠を `reserved` で設定してください。比較では同じ設定から `reset → up → seed → verify` で作り直します。ウォームアップは参照シナリオとして別結果に保存します。写真サイズ別のアップロードは `--image-bytes` で指定します。DB に事前保存する写真のサイズと割合は生成設定で指定します。

## 6. 模擬 Tapyrus の登録と応答喪失

履歴のあるデータセットでは既存のキューが先に処理されます。単独の登録を追う場合は、結果を残す `reset` で DB と模擬サービスを空にして、承認済みの履歴がない `probe` を使います。

```bash
./scripts/load.sh reset
# .env.load の LOAD_MOCK_MODE を lost に設定してから起動
./scripts/load.sh up
./scripts/load.sh seed probe
./scripts/load.sh run registration --once
./scripts/load.sh registration
```

`normal` は通常、`reject` は 422、`server-error` は 503、`lost` は保存直後の応答喪失、`lost-hidden` は応答喪失後も照会に出ない状態、`mismatch` は登録応答のハッシュ不整合です。各条件を初期状態から比べるときは `reset` してモードを変更します。

ワーカーは 10 秒間隔で起動し、同じ対象の処理は 30 秒以上の間隔を空けます。 `registration` は最大 120 秒間、最新の試験対象を追跡します。 `lost` では監査履歴の `unknown` とその後の確認済み状態、模擬サーバーでの重複 POST ゼロを検査します。 `lost-hidden` では結果不明を保持します。負荷試験用の模擬サーバーは同じ内容を再 POST すると別の登録を作るため、二重送信を件数で検出できます。

## 7. 1 台と 2 台を比べる

```bash
./scripts/load.sh compare --duration 10 --warmup 5 --vus 2 --rate 2
./scripts/load.sh failover
./scripts/load.sh report
```

`compare` は同じデータを参照し、API だけを 1 台から 2 台へ変更します。両方の upstream に業務リクエストが到達したことを Nginx ログで確認します。既定値では API の総 CPU とメモリ上限も 2 倍になります。同じ総資源で比べるときは 1 台の結果を取った後、2 台にして 1 台あたりの `LOAD_API_CPUS` と `LOAD_API_MEMORY_MIB` を半分に設定し、同じ条件で `run read` を実行します。登録キューが処理中の場合は開始時と終了時の件数を比較し、バックグラウンド負荷の違いを記録します。完全に揃える試験では、同じ初期状態から個別に実行してください。

`failover` は 2 台構成で片方を停止し、残った 1 台だけで参照試験が通ることを確認した後、2 台に戻します。

## 8. 結果とテスト

`load/results/<実行ID>/` の `report.json` に SHA、データ条件、実行設定、upstream 別の業務リクエスト件数、Docker・DB・模擬サービスの観測値を保存します。 `k6.json` には操作別の遅延、業務エラー、HTTP ステータス、タイムアウト、期待した競合などが入ります。 `report` は比較用 CSV を標準出力に出します。ドロップした反復と k6 コンテナ自身の CPU・メモリを確認してから、サーバーの処理能力を評価します。DB 接続待ちは PostgreSQL 側の観測です。アプリ内プールの待ち時間は計測していません。k6 の閾値は試運転の成否を検知する暫定値です。

```bash
./scripts/load.sh stats
./scripts/load.sh tests
```

## 9. 停止とデータ削除

```bash
./scripts/load.sh down
```

`down` は専用サービスを停止し、データと結果を保存します。 `reset` は専用ボリュームと生成データを消し、結果を保存します。 `clean` は結果も消します。どちらも削除対象を表示し、プロジェクト名の入力を求めます。

```bash
./scripts/load.sh reset
# 結果も不要なときだけ実行
./scripts/load.sh clean
```
