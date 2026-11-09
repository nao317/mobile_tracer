# 取引・顧客承認・チェーン登録

`/transactions` は担当範囲内の業者、または提示先の顧客が利用する取引一覧です。アカウント画面と業務の記録詳細から移動できます。新しい画面は `frontend/app/features/transactions/` に機能単位で分け、既存のパネル・入力・ページ送り部品と共通フォームを利用します。

## 登録の条件

業者は画像を保存してから記録版を顧客に提示します。提示操作は業者側の確定操作として監査記録に残ります。提示時に記録項目、案件・車両情報、画像のSHA-256・撮影者・日時・任意の位置情報を固定します。顧客は自分宛の確認文面と対象版にだけ回答できます。業者とシステム管理者は顧客の回答を代行できません。

すべての提示先の回答が期限内の承認となり、状態同意または作業承認が含まれる場合だけ登録キューに入ります。閲覧・受領だけ、未回答・拒否・保留・期限超過では登録しません。回答は追記専用です。回答後に内容や回答を変更する場合は、理由付きの訂正版を作り、顧客へ再提示します。旧版の承認は引き継ぎません。

## API

すべてFirebaseセッション認証を要求し、更新操作には同一オリジンとCSRFトークンが必要です。成功時は `data`、一覧は `pagination` を返します。エラー形式は既存業務APIと共通です。

| メソッド | `/api/transactions` 配下のパス | 内容 |
| --- | --- | --- |
| GET | `/` | 車種名 `q`、`vehicle_id`、`page`、`page_size` による検索 |
| GET | `/{versionID}` | 対象版、画像メタデータ、自分宛または担当範囲の確認依頼、登録状態 |
| POST | `/{versionID}/media` | multipartの `photo`、`position`、UUIDの `request_key`。任意で `device_captured_at`（RFC3339）、`latitude`、`longitude` |
| GET | `/{versionID}/media/{mediaID}` | 権限確認後の画像原本 |
| POST | `/{versionID}/present` | `lock_version`、UUIDの `request_key`、`recipients` 配列を指定して版を固定・提示 |
| POST | `/{versionID}/respond` | 自分宛の `request_id` と `decision`（approved / rejected / held） |
| POST | `/{versionID}/correct` | `reason` を指定し、元版の項目をコピーした訂正下書きを作成。写真は再保存する |
| POST | `/{versionID}/retry` | 条件を満たす版を登録キューへ追加。登録済み・送信済み内容を作り直さない |
| POST | `/{versionID}/verify` | match / mismatch / unverifiable を返す |
| GET / POST | `/{versionID}/ownerships` | 許可範囲の所有者履歴 / 本人の状態同意がある所有者変更を管理者が記録 |
| POST | `/{versionID}/share` | `email`、`expires_at` を指定して登録済み記録の限定公開コピーを共有 |
| GET | `/shares` | 自分が送受信した共有（最新100件） |
| POST | `/shares/{shareID}/accept` | 受信者本人が受け入れる |
| POST | `/shares/{shareID}/revoke` | 送信者が取り消す |

提示先は `email`、`qualification`（owner / renter / purchaser / repair_requester / approver）、`kind`（view / receipt / state_agreement / work_authorization）、`statement`、`deadline`（RFC3339）を指定します。最大20件です。確認文面に作業範囲・金額を含めます。有効な一般ユーザーの登録メールアドレスを使用します。

## 保存・登録・復旧

原本画像はPostgreSQLのbyteaとして保存し、DBの永続ボリュームとバックアップで保持します。JPEG・PNG・WebP、1画像10MiBまでです。画像は同じ撮影箇所に重複登録できません。同じ再送キー・版・撮影箇所・画像の再送は元のIDを返します。提出後の画像・記録・確認依頼・回答はDBトリガーでも変更を拒否します。

登録・照会はChaintopeのTapyrus API Timestamp V2を使用します。アプリ側で計算したSHA-256を、証明書とアクセストークンで認証したAPIへ送信します。登録要求、APIのTimestamp ID、txid、確認状態をDBに保存し、confirmedを確認してから登録済みにします。

送信結果不明時はAPIを照会し、POSTを自動で繰り返しません。詳細、接続設定、移行と検証方法は[案件フロー・Tapyrus API](casework.md)を参照してください。実サービスの認証情報は現在未準備のため、実接続確認は未実施です。

照合は、原本バイト列、現在の記録項目、固定した提示内容、承認情報とマニフェスト、API上の登録ハッシュを確認します。原本欠損・未登録・API取得失敗は検証不能です。登録や一致は内容の真実性・責任を保証しません。

## 履歴の公開範囲

通常の顧客閲覧は提示された版だけです。所有者に追加しただけでは、他の版や過去の取引への閲覧権限を付けません。車両履歴も参照可能な版に限定します。

外部共有では原本への権限を付けず、車種、版番号、記録日時、走行距離・燃料・見積金額の数値、登録ハッシュ・txidだけをコピーします。写真・自由記述・氏名・所有者情報・企業情報は含めません。受信者が受け入れた後、期限内かつ取消し前にだけ閲覧できます。取得済みのコピーを相手の手元から削除する機能ではありません。
