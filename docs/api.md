# フロントエンド向け業務API

車両・案件・記録・下書きの取得と保存に使うAPIの仕様です。写真のアップロード、記録の提出・訂正、確認・署名・共有、チェーンへの登録・照合は今回の対象に含みません。

## 接続先と認証

| 呼び出し元 | 接続先 |
| --- | --- |
| Compose経由のブラウザー | `http://localhost:8080`。同じオリジンからは `/api/...` の相対パス |
| Compose内のReact Router SSRサーバー | `http://backend:8080` |
| `compose.debug.yaml` でAPIへ直接接続 | `http://localhost:8081` |

ポートを環境変数で変更した場合は、変更後の値を使います。ブラウザーからの別オリジン接続に使うCORS設定はありません。Nginx経由で画面とAPIを同じオリジンに揃えます。

現在の業務APIは、開発用の固定Bearerトークンから、サーバーに設定した担当者を特定します。本番の認証プロバイダーとの接続は後続実装です。

| 環境変数 | 設定 |
| --- | --- |
| `APP_ENV` | 既定値は `production`。開発認証を使う場合は `development` |
| `DEV_AUTH_TOKEN` | 32バイト以上で空白を含まないトークン |
| `DEV_AUTH_STAFF_ID` | 操作する開発用担当者のUUID |

`APP_ENV=development` 以外で開発認証の変数を設定すると、APIは起動時に失敗します。両変数が未設定なら業務APIは401を返します。ヘルスチェックにはトークンは不要です。

リクエストには `Authorization: Bearer <DEV_AUTH_TOKEN>` を付けます。顧客ID・操作者IDをリクエストから指定する方式は採用していません。担当者と顧客の有効状態、役割の取消しは、リクエストごとにDBから確認します。開発用トークンをソースや公開用のフロントエンドビルドへ埋め込まないでください。

### このAPIでの権限

| 役割 | 参照範囲 | 更新範囲 |
| --- | --- | --- |
| `tenant_admin` | 自社内すべて | 車両の登録・車種名の更新、案件作成・担当変更・段階変更・中止、記録・下書きの保存 |
| `store_manager` | 担当店舗の案件と、その案件に関連する車両 | 担当店舗の案件作成・担当変更・段階変更・中止、記録・下書きの保存 |
| `staff` | 役割で許可された店舗のうち、自分が担当または作成した案件と関連車両 | 参照できる車両を使った案件作成、自分が担当または作成した案件の段階変更、記録・下書きの保存 |
| `auditor` | 役割で許可された店舗の案件と関連車両。店舗指定がなければ自社全体 | 参照のみ |

複数の役割は許可範囲を合わせて判定します。一般担当者が案件を作成する場合、担当者は自分または未指定に限ります。担当変更と中止は企業管理者・店舗責任者が行います。

今回の車両書き込みは企業管理者に限定しています。店舗権限の利用者は、参照できる案件に関連する車両を参照・選択できます。まだ案件に関連していない車両は企業管理者が扱います。

他社・担当範囲外のデータや、URL上の案件・記録・版の組み合わせが一致しない場合は404を返します。参照できるデータに対して更新権限がない場合は403を返します。

## エンドポイント

業務APIの成功レスポンスは、単件なら `{"data": ...}`、一覧なら `{"data": [...], "pagination": ...}` です。作成は201、その他の成功は200です。

| メソッド | パス | 用途 |
| --- | --- | --- |
| GET | `/api/context` | 操作者・役割・参照可能な店舗・反映済み構成版を取得 |
| GET / POST | `/api/vehicles` | 車両一覧 / 車両登録 |
| GET / PATCH | `/api/vehicles/{vehicleID}` | 車両詳細 / 車種名の更新 |
| GET / POST | `/api/cases` | 案件一覧 / 案件作成 |
| GET / PATCH | `/api/cases/{caseID}` | 案件詳細 / 担当者・業務段階の更新 |
| POST | `/api/cases/{caseID}/cancel` | 案件中止 |
| GET / POST | `/api/cases/{caseID}/records` | 記録一覧 / 記録と最初の下書きの作成 |
| GET | `/api/cases/{caseID}/records/{recordID}` | 記録のメタデータを取得 |
| GET | `/api/cases/{caseID}/records/{recordID}/versions` | 記録版の一覧を取得 |
| GET | `/api/cases/{caseID}/records/{recordID}/versions/{versionID}` | 項目値を含む特定の記録版を取得 |
| PUT | `/api/cases/{caseID}/records/{recordID}/versions/{versionID}/entries` | 下書きの項目値を全置換 |
| GET | `/api/health` | APIの稼働確認。200・`{"status":"ok"}` |
| GET | `/api/ready` | DB・Core・Esploraの準備確認。200・`{"status":"ok"}` または503・`{"status":"unavailable"}` |

パスのIDはUUID形式です。業務APIのDELETEは提供しません。車両・案件・記録・提出版はAPIから物理削除できず、案件には理由を伴う中止を使います。下書きの項目値を除去する場合は、後述の全置換で対象項目を省きます。

## 共通の入力・一覧仕様

- POST・PATCH・PUTの本文は `Content-Type: application/json` のJSONオブジェクトです。上限は1 MiBです。
- 未定義の本文項目、未対応のクエリ、同じクエリの複数指定、空のクエリ値を拒否します。
- IDと作成日時はサーバーで設定します。日時はタイムゾーンを含むRFC 3339形式です。
- 文字数の上限はUnicodeの文字数です。文字列の前後の空白は自動除去しません。空白だけの名前・理由は拒否します。
- PATCHの未指定項目は変更しません。`null` の可否は各項目の定義に従います。

| 共通クエリ | 既定値・制約 |
| --- | --- |
| `page` | 1。1〜1000000の整数 |
| `page_size` | 20。1〜100の整数 |
| `sort` | `-created_at`。先頭の `-` は降順。許可する項目は下表 |

同じ並び順の値はIDの昇順で並べます。ページをまたぐ間に更新があった場合の固定スナップショットは保証しません。最終ページを超えた場合は空配列と総件数を返します。

| 一覧 | 追加クエリ | `sort` に指定できる項目 |
| --- | --- | --- |
| 車両 | `q`：車種名または識別情報の部分一致。大文字・小文字を区別せず、200文字以内。`%`・`_` は通常の文字として検索 | `created_at`、`model_name` |
| 案件 | `q`：車種名の部分一致。`store_id`、`vehicle_id`、`assignee_id`、`case_type`、`status`、`stage`：完全一致 | `created_at`、`stage` |
| 記録 | `record_kind`：完全一致 | `created_at` |
| 記録版 | `status`：`draft` または `submitted` | `created_at`、`version_no` |

案件の `case_type` は `rental`・`dealer`・`repair`、`status` は `in_progress`・`completed`・`cancelled` です。複数の条件はANDで組み合わせます。フィルターを指定しても権限の範囲は広がりません。

```json
{
  "data": [],
  "pagination": {"page": 1, "page_size": 20, "total": 0}
}
```

## 操作ごとの本文とレスポンス

### 利用コンテキスト

`GET /api/context` は次の構造を返します。構成版が未反映なら `configuration` は `null` です。

```json
{
  "data": {
    "principal": {
      "tenant_id": "00000000-0000-0000-0000-000000000001",
      "staff_id": "00000000-0000-0000-0000-000000000101",
      "roles": [{"role": "tenant_admin", "store_id": null}]
    },
    "stores": [{"id": "00000000-0000-0000-0000-000000000011", "name": "開発用店舗A1"}],
    "configuration": {
      "id": "00000000-0000-0000-0000-000000001001",
      "settings": {"schema_version": 1, "businesses": {}}
    }
  }
}
```

上は構造の説明用に店舗と設定を省略しています。実際の開発用データには店舗A2と、下記の設定が含まれます。

### 車両

POSTの本文例です。

```json
{
  "model_name": "開発用車両",
  "identifiers": [{"kind": "plate_number", "value": "開発用ナンバー"}]
}
```

`model_name` は任意・null可。文字列なら空白以外の文字を含み、200文字以内です。`identifiers` は任意で最大10件、各要素は必須の `kind` と `value` を持ちます。`kind` は `chassis_number`・`vin`・`plate_number`、`value` は空白以外の文字を含む100文字以内です。未指定またはnullの配列は空配列として扱います。

識別情報は未確認として登録します。ナンバーの重複など、DBの一意制約に反する場合は409です。識別情報の差し替え・確認や所有者変更は今回のAPIでは提供しません。

PATCHできるのは `model_name` だけです。`{"model_name":null}` で車種名を未設定に戻せます。空のPATCHは400です。

```json
{
  "data": {
    "id": "生成されたUUID",
    "model_name": "開発用車両",
    "created_at": "2026-10-28T00:00:00Z",
    "identifiers": [{"id": "生成されたUUID", "kind": "plate_number", "value": "開発用ナンバー", "valid_from": null, "valid_to": null, "verified_at": null}]
  }
}
```

### 案件

POSTには `store_id`・`vehicle_id`・`case_type`・`configuration_version_id` が必要です。`assignee_id` は任意・null可です。

```json
{
  "store_id": "00000000-0000-0000-0000-000000000011",
  "vehicle_id": "車両登録で取得したUUID",
  "case_type": "rental",
  "configuration_version_id": "00000000-0000-0000-0000-000000001001",
  "assignee_id": null
}
```

店舗・車両・担当者・構成版は同じ顧客に属するものを指定します。構成版は対象業態のモジュールを持つ反映済み版に限ります。担当者を指定する場合は、有効な担当者で、その店舗を担当できる役割が必要です。開始時の `stage` は構成版の最初の段階、`status` は `in_progress` になります。

PATCHでは `assignee_id` と `stage` を指定できます。担当者は `null` で解除できます。`stage` はnull不可・100文字以内で、構成版の `transitions` で現在の段階から許可された移行先、または現在と同じ値を指定します。承認を伴う業務フローは後続APIで実装し、この設定には承認なしで移行できる段階だけを定義します。

```json
{"assignee_id": null, "stage": "inspection"}
```

中止は `POST /api/cases/{caseID}/cancel` に `{"reason":"中止理由"}` を渡します。理由は空白以外の文字を含む2000文字以内です。`status`・`cancelled_by`・`cancelled_at` はサーバーが設定します。完了・中止済み案件の変更、記録追加、下書き更新は409です。完了や構成版移行、店舗変更はこのAPIでは提供しません。

案件の単件・一覧の各要素は以下の形です。

```json
{
  "id": "生成されたUUID",
  "store_id": "00000000-0000-0000-0000-000000000011",
  "vehicle_id": "車両のUUID",
  "case_type": "rental",
  "configuration_version_id": "00000000-0000-0000-0000-000000001001",
  "assignee_id": null,
  "stage": "intake",
  "status": "in_progress",
  "cancel_reason": null,
  "cancelled_by": null,
  "cancelled_at": null,
  "created_by": "00000000-0000-0000-0000-000000000101",
  "created_at": "2026-10-28T00:00:00Z"
}
```

### 記録・最初の下書き

`POST /api/cases/{caseID}/records` は、記録と第1版の下書きを一つのトランザクションで作成します。

```json
{"record_kind":"inspection","entries":{"odometer":12000,"fuel_level":50,"notes":"下書き","inspected":false}}
```

`record_kind` は必須・100文字以内で、案件の構成版に定義された記録種別です。`entries` は任意で、未指定・nullは空の項目として扱います。構成版にない項目は保存できません。項目数は最大100件です。

作成レスポンスは `{"data":{"record":記録のメタデータ,"draft":項目値を含む記録版}}` です。記録のメタデータは `id`・`case_id`・`record_kind`・`created_by`・`created_at` を持ちます。記録詳細・記録一覧も同じメタデータを返します。

このAPIで作る下書きは第1版のみです。提出済み版から訂正版・補足版を作る操作は後続実装です。

### 記録版の参照・下書き更新

記録版の詳細・一覧の各要素は以下の形です。

```json
{
  "id":"記録版のUUID",
  "case_id":"案件のUUID",
  "record_id":"記録のUUID",
  "version_no":1,
  "status":"draft",
  "configuration_version_id":"00000000-0000-0000-0000-000000001001",
  "lock_version":0,
  "based_on_version_id":null,
  "change_kind":null,
  "change_reason":null,
  "submitted_by":null,
  "submitted_at":null,
  "content_hash":null,
  "hash_algorithm":null,
  "vehicle_snapshot":null,
  "created_by":"00000000-0000-0000-0000-000000000101",
  "created_at":"2026-10-28T00:00:00Z",
  "entries":{"odometer":12000}
}
```

`PUT .../versions/{versionID}/entries` は **項目値の全置換** です。本文には必須の `lock_version` と `entries` を指定します。

```json
{"lock_version":0,"entries":{"odometer":12010,"notes":"更新後"}}
```

- `lock_version` は取得時の0以上の整数です。保存成功時に1増えます。
- `entries` はJSONオブジェクトで、null・未指定は400です。`{}` を渡すと下書きの項目値をすべて除去します。
- 本文にない既存項目は除去します。成功後のレスポンスに、更新後の項目値と `lock_version` を含む記録版を返します。
- 古い版番号による保存は409・`version_conflict` です。GETで最新の版を取得し、利用者に差分を確認してもらってから再編集します。
- 提出済みの版は参照だけが可能です。内容と版番号は変更できません。

項目値と版番号と監査履歴は、同じトランザクションで保存します。途中で失敗した場合はすべてロールバックします。新規作成や更新は自動再試行しないでください。特にPOSTの重複防止キーは今回のAPIにはなく、応答を受け取れなかった場合は一覧・詳細で結果を確認します。

## 構成版の最小設定形式

このAPIは `schema_version: 1` の以下の形式を扱います。案件の作成時と項目値の保存時に検証し、未対応・不正な構成版は409にします。既存の構成版をAPIが自動で書き換えることはありません。

```json
{
  "schema_version":1,
  "businesses":{
    "rental":{
      "stages":["intake","inspection"],
      "transitions":{"intake":["inspection"]},
      "record_kinds":{
        "inspection":{
          "fields":{
            "odometer":{"type":"integer","minimum":0,"maximum":1000000000,"required":true},
            "fuel_level":{"type":"number","minimum":0,"maximum":100},
            "notes":{"type":"string","max_length":2000,"nullable":true},
            "inspected":{"type":"boolean"}
          }
        }
      }
    }
  }
}
```

`type` は `string`・`integer`・`number`・`boolean` です。数値はJSONの数値を渡し、文字列からの変換は行いません。`integer` は小数点・指数表記を使わない整数で、JavaScriptが正確に扱える範囲（-9007199254740991〜9007199254740991）に限ります。`number` は有限の倍精度浮動小数点数として検証します。`minimum`・`maximum` は端の値を含みます。文字列は `max_length` と任意の `enum`（許可する文字列の配列）を使えます。値のnullは `nullable: true` の項目だけに許可します。項目名にドットは使いません。

`required` は提出時の必須項目を表す設定です。今回は下書き保存までなので、未入力の必須項目があっても保存できます。入力済みの値の型・範囲は下書きでも検証します。記録版は作成時の構成版を保持します。

## エラー形式

業務APIのエラーは次の構造です。画面の判断には `code` と `fields` を使い、メッセージ文字列との一致で分岐しないでください。

```json
{
  "error": {
    "code":"validation_error",
    "message":"入力内容を確認してください。",
    "fields":{"entries.odometer":["構成版の型・値の制約に合う値を指定してください。"]}
  }
}
```

| ステータス | `code` | 扱い |
| --- | --- | --- |
| 400 | `validation_error` | 入力・JSON・クエリの不正。`fields` に修正対象を含む |
| 401 | `unauthorized` | トークンなし・不一致、または業務APIの認証が未設定 |
| 403 | `forbidden` | 停止済みの顧客・担当者、有効な役割なし、操作権限なし |
| 404 | `not_found` | 対象なし・範囲外・案件や版の組み合わせ不一致 |
| 405 | `method_not_allowed` | 提供していないメソッド |
| 409 | `version_conflict` | 下書きの版番号が古い |
| 409 | `conflict` | 重複・更新不可の状態・許可されていない段階移行・不正な構成版など |
| 413 | `payload_too_large` | 本文が上限を超えている |
| 415 | `unsupported_media_type` | Content-TypeがJSONでない |
| 500 | `internal_error` | 内部エラー。SQLやDB接続情報は返さない |
| 503 | `timeout` | 業務APIの処理が10秒以内に完了しなかった。結果を確認してから再操作する |

項目別の情報がない場合、`fields` は `{}` です。本文の形式・未定義項目・型の不正は `body`、クエリ全体の不正は `query` をキーにします。最初に検出した入力エラーを返すため、複数項目のエラーを一度にすべて返す仕様ではありません。ヘルスチェックの503は、この業務API用エラー形式とは別の `{"status":"unavailable"}` です。

## ローカルで一連の操作を試す

1. 通常の初期化とマイグレーションを済ませます。新規環境はリポジトリルートで `bash scripts/init.sh` を実行します。
2. `.env` に `APP_ENV=development`、32バイト以上の `DEV_AUTH_TOKEN`、`DEV_AUTH_STAFF_ID=00000000-0000-0000-0000-000000000101` を設定します。
3. `docker compose up --build --wait --wait-timeout 180` で起動します。
4. `docker compose run --rm --entrypoint /app/dev-seed backend` で架空の開発用データを投入します。再実行しても既存の開発用データをリセットしません。

開発用データには企業A/B、企業Aの店舗A1/A2、企業管理者、店舗責任者、担当者、監査担当、反映済み構成版、参照範囲を確認する車両と案件が含まれます。通常のマイグレーションやAPI起動では投入しません。既存データと開発用の固定IDが衝突する環境では使わず、専用DBを用意してください。

企業Aの開発用担当者IDの末尾は、企業管理者 `000101`、店舗A1責任者 `000102`、店舗A1担当者 `000103`、監査担当 `000104`、店舗A2責任者 `000105` です。企業B管理者は `000201` です。担当者を切り替える場合は `DEV_AUTH_STAFF_ID` を変更し、backendを再作成します。

次のスクリプトはリポジトリルートから実行します。シェルへ `.env` を読み込み、車両登録→案件作成→記録と下書き作成→下書き更新→再取得までを試します。

```bash
set -a
source .env
set +a
python3 - <<'PY'
import json
import os
import urllib.request

base = 'http://localhost:' + os.getenv('NGINX_PORT', '8080')
def api(method, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=payload, method=method, headers={
        'Authorization': 'Bearer ' + os.environ['DEV_AUTH_TOKEN'],
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req) as res:
        return json.load(res)['data']

context = api('GET', '/api/context')
vehicle = api('POST', '/api/vehicles', {'model_name': 'API操作確認用'})
case = api('POST', '/api/cases', {
    'store_id': '00000000-0000-0000-0000-000000000011',
    'vehicle_id': vehicle['id'],
    'case_type': 'rental',
    'configuration_version_id': context['configuration']['id'],
})
record = api('POST', '/api/cases/' + case['id'] + '/records', {
    'record_kind': 'inspection', 'entries': {'odometer': 100},
})
path = '/api/cases/' + case['id'] + '/records/' + record['record']['id']
path += '/versions/' + record['draft']['id']
updated = api('PUT', path + '/entries', {
    'lock_version': record['draft']['lock_version'], 'entries': {'odometer': 110},
})
assert updated['lock_version'] == 1
assert api('GET', path)['entries']['odometer'] == 110
print('車両・案件・下書きの作成、更新、再取得に成功しました。')
PY
```

実装の正確なJSONフィールドは `backend/internal/business/types.go`、HTTP入力の処理は `backend/internal/server/business.go`、業務条件は `backend/internal/business/service.go` と `rules.go`、DB操作は `repository*.go` にあります。
