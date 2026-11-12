# 案件開始・提案・顧客報告とTapyrus API

## 三つの流れ

1. 業者が車両、取引種別、担当店舗、担当者、顧客の登録メールアドレス、取引条件、回答期限を指定する。案件は `awaiting_customer`（開始承認待ち）として保存する。顧客が対象版の条件を承認して初めて `in_progress` に移る。拒否・保留・期限超過では進行できない。
2. 業者が作業提案または進捗報告を作る。作業提案は金額・範囲・任意の段階変更を固定し、顧客承認後にだけ着手できる。結果報告後、顧客が完了を確認する。進捗報告は顧客の承認で確認済みになる。作業承認と報告の確認を混同しない。
3. 顧客がインシデント報告・依頼を作る。担当範囲の業者が受理・拒否・保留・差戻しを回答する。受理後は業者が着手・対応結果を報告し、顧客が完了を確認する。追加費用のある作業は関連する作業提案として作成し、顧客承認を得る。

提示内容と回答・対応履歴は追記専用。変更は新しい版で再提示する。旧版への承認は新版へ引き継がない。旧版への回答、自己承認、他社・他顧客からの操作、期限超過の承認をAPIでも拒否する。案件とイベントを一定の順序でロックし、同時操作を直列化する。再送キーが一致する同一操作は元の結果を返す。

画面は `/casework`（一覧）、`/casework/new`（開始条件の提示）、`/casework/inbox`（顧客の受信履歴）。案件ごとは `/casework/{caseID}/start`、`work`、`report`、`incident`、`request`、`timeline`、`verification` に分ける。既存のレイアウト、パネル、フォーム入力、バッジ、ページ送りを再利用する。写真・点検記録は既存の `/transactions` と業務画面から扱う。

## API

Firebaseセッション、同一オリジン、更新時のCSRF検証を使用する。顧客の権限は、対象案件の最新の開始条件に指定された本人に限定する。業者は既存の自社・店舗・担当範囲で制限する。システム管理者にも顧客の代理承認は許可しない。

| メソッド | パス | 処理 |
| --- | --- | --- |
| GET | `/api/casework` | 参照可能な案件の検索・ページ送り |
| GET | `/api/casework/starts` | 自分宛の開始条件と回答の受信履歴 |
| POST | `/api/casework/starts` | 開始条件の提示。再提示時は `case_id` を指定 |
| POST | `/api/casework/starts/{requestID}/respond` | 顧客本人の approved / rejected / held |
| GET | `/api/casework/{caseID}` | 開始条件・現在状態・イベント・API登録状態 |
| POST | `/api/casework/{caseID}/events` | 作業・進捗報告、または顧客のインシデント・依頼 |
| POST | `/api/casework/{caseID}/events/{eventID}/actions` | 承認・拒否・保留・差戻し・着手・結果報告・完了確認 |
| POST | `/api/casework/{caseID}/verify/{registrationID}` | 保存内容とTimestamp APIの登録内容を照合 |

開始条件は `store_id`、`vehicle_id`、`case_type`、`configuration_version_id`、任意の `assignee_id`、`email`、`terms`、`deadline`、UUIDの `request_key` を指定する。再提示時は既存の `case_id` と、新しい再送キーを使う。

イベントは `kind`（業者：work / progress_report、顧客：incident / request）、`title`、`description`、`deadline`、UUIDの `request_key` を指定する。作業は任意で `amount_minor`（日本円の整数）と `target_stage` を持つ。関連付けは `parent_event_id`、再提示は `supersedes_id` を使う。承認済み・着手済みの作業を置き換えず、追加の提案を作る。

回答・対応は `action`、`detail`、UUIDの `request_key`。pending に対して相手が approved / rejected / held / returned を回答する。returned には理由が必要。作業・依頼の approved に対して業者が executed、in_progress に対して業者が reported（結果必須）、awaiting_completion に対して顧客が completed を行う。

既存の `PATCH /api/cases/{id}` からの段階変更では承認フローを迂回できない。作業実行時に、顧客の承認、現在の状態、設定で許可された移行先を確認する。DBも同じトランザクション内の承認済みイベントの実行を要求する。

## Tapyrus APIへの登録

登録先はChaintopeの [Timestamp V2 API](https://doc.api.tapyrus.chaintope.com/)。アプリ側で固定形式のJSONをSHA-256にし、`POST /api/v2/timestamps` へ `type: simple`、`digest: none`、`prefix: 6d747261636572`、`content: <64桁のハッシュ>` を送る。画像原本や個人情報の本文は送らない。

登録するのは、案件開始の承認、イベントへの相手の承認、対応完了への顧客の確認、および写真・点検記録に必要な顧客承認が揃った版。対象ID、固定した内容、回答者、回答内容、回答日時を含むマニフェストをDBに保持する。登録と業務の状態は別に表示し、チェーン確認待ちを業務承認待ちと混同しない。

`integrity.api_registrations` に登録要求を永続化し、30秒の処理間隔制約と行ロックで複数プロセスの重複処理を防ぐ。送信前（queued）の要求は間隔を待たずに送る。APIの応答が `init`（受付済み・ブロック未確定）の場合はunconfirmedとして保存し、確定まで照会する。ワーカーは10秒ごとに確認する。送信前にsubmittingを確定し、APIのID・txid・content_hash・prefix・timestamp_type・確認状態を検証して保存する。confirmedになるまで登録済みにしない。

通信断、5xx、不正な応答、送信後のプロセス停止はunknownとして扱う。IDがある場合は個別照会、IDが不明なら一覧から同じハッシュ・prefix・typeを探す。結果が見つからなくてもPOSTを自動で繰り返さない。公式仕様に冪等キーや一覧の完全性の保証がないため、判断できない要求は照会中のまま残す。明確な4xx拒否だけを再試行可能なfailedとする。接続先を変えたときに、前の登録要求を新しい環境へ自動再登録しない。

## 接続設定

認証情報は現在未準備。実サービスへの登録テストは未実施で、mTLS付き模擬APIとDBで検証する。未設定時も業務内容・承認・登録待ちはDBに保存する。RPC直接登録へ自動で切り替えない。

| 環境変数 | 内容 |
| --- | --- |
| `TAPYRUS_API_URL` | ダッシュボードで確認したHTTPSのオリジン。パスを含めない |
| `TAPYRUS_API_SECRETS_DIR` | ホストの専用秘密情報ディレクトリ。Composeで `/run/tapyrus-api` に読み取り専用マウント |
| `TAPYRUS_API_TOKEN_FILE` | コンテナ内のアクセストークンファイルのパス |
| `TAPYRUS_API_CERT_FILE` | PEM形式のクライアント証明書のパス |
| `TAPYRUS_API_KEY_FILE` | PEM形式のクライアント秘密鍵のパス |
| `TAPYRUS_API_CA_FILE` | 任意の追加CA。TLS検証は無効化しない |
| `TAPYRUS_API_TIMEOUT` | 1回の通信の上限。既定10秒、最大1分 |

例は `.env.example`、公開環境は `.env.public.example` を参照。証明書・鍵・トークンはGitに含めず、コンテナの実行ユーザーだけが読める権限で用意する。PKCS#12で発行された証明書は運用環境でPEMの証明書と秘密鍵に変換する。秘密鍵・トークンは画面やログに出さない。

アプリの起動にCore・Esploraは不要。既存のローカルチェーンの検証を行う場合だけ、`docker compose --profile local-chain ...` を指定する。`/api/ready` はDBと、設定済みならTapyrus APIへの接続を確認する。API未設定でDBが正常なら200だが、画面にはAPI未設定と表示する。

## 移行

000007で既存の進行中案件も開始承認待ちに移す。担当業者は案件一覧から顧客と条件を指定し、承認を得て再開する。完了・中止済みの案件や過去の記録は保持する。写真・点検記録の未送信登録要求はAPI用キューへ引き継ぐ。すでにCoreで署名・送信した記録は登録方式を変えず保持し、APIへ重複登録しない。旧方式の検証は別の接続が必要となり、取得できなければ検証不能と表示する。
