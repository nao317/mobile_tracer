# UI再構成の対応表

基準は`450681f9db0641dafe0dfdaa6a0ab809d92b3f6d`。同じブランチの未変更状態から着手した。下表は移行の確認に使う。実装と試験の結果は作業後に追記する。

業務パスには`/app`、プレビューパスには`/preview`を付ける。既存のURLと`/app/actions`のPOST受け口を維持する。追加の業務画面は同じワイルドカードルートで解決し、管理画面は既存パスのqueryで作業を選ぶ。

| 現在のURL | 主な作業と分離先 | 権限・接続 | 一覧の確認対象 |
| --- | --- | --- | --- |
| `/app` | 利用可能な機能の入口 | セッションと業務所属を区別 | 集計の上限を隠さない |
| `/account` | 個人情報・所属選択 | セッションのみ | 所属 |
| `/settings` | 個人・企業・管理への入口 | セッションのみ | 固定リンク |
| `/settings/display` | 言語・テーマ | セッションのみ | なし |
| `/account/requests` | 履歴、業者変更、企業作成、所属企業、プロファイル変更をqueryで分離 | セッションのみ、実API | 履歴と承認待ち判定を別取得 |
| `/admin` | 管理件数 | system_admin、実API | 正確なAPI件数 |
| `/admin/users` | 一覧、詳細、編集をqueryで分離 | system_admin、実API | ユーザー・所属 |
| `/admin/companies` | 一覧、詳細、編集、所属管理、新規作成をqueryで分離 | system_admin、実API | 企業・所属者・候補 |
| `/admin/requests` | 一覧、詳細、審査をqueryで分離 | system_admin、実API | 申請・審査履歴 |
| `vehicles` | 検索と一覧 | 業務参照、実API | APIページ |
| `vehicles/new` | 車両登録 | tenant_admin、実API | なし |
| `vehicles/:vehicleId` | 基本情報、編集、関連案件 | 参照、編集はtenant_admin、実API | relatedPage |
| `vehicles/:vehicleId/history` | 識別・所有者履歴 | preview | 履歴 |
| `cases` | 案件検索と一覧 | 業務参照、実API | APIページ |
| `cases/new` | 車両検索・選択、案件作成 | 店舗範囲内の更新、実API | 車両検索ページ |
| `cases/:caseId` | 概要、記録、関係者、管理へ分離 | 対象店舗範囲、関係者はpreview | recordsPage |
| `cases/:caseId/records/new` | 記録作成 | 対象案件の更新、実API | なし |
| `cases/:caseId/records/:recordId` | 内容と版履歴を分離 | 対象案件参照、実API | historyPage、versionは独立 |
| `cases/:caseId/records/:recordId/edit` | 下書き編集 | 対象案件更新、構成版一致、実API | なし |
| `cases/:caseId/records/:recordId/photos` | 撮影・注釈・撮影不能 | preview | 固定撮影位置 |
| `cases/:caseId/records/:recordId/submit` | 提出前確認 | preview | なし |
| `cases/:caseId/records/:recordId/correct` | 元版・理由付き訂正 | preview | なし |
| `cases/:caseId/compare` | 比較対象と差分 | preview | 比較対象 |
| `cases/:caseId/answers` | 確認依頼・回答入力・履歴を分離 | preview | 回答履歴 |
| `cases/:caseId/disputes` | 一覧・内容・作成を分離 | preview | 一覧・経緯 |
| `cases/:caseId/sharing` | 共有一覧・作成・公開範囲を分離 | preview | 共有履歴 |
| `cases/:caseId/verification` | 登録・照合・履歴を分離 | preview | 処理履歴 |
| `cases/:caseId/exports` | 対象・形式の選択と出力 | preview | なし |
| `recipient/:shareId` | 許可された内容の閲覧 | preview | 単一共有 |
| `receipts/:answerId` | 本人控え | preview | 単一回答 |
| `tasks` | 未対応一覧 | preview | 一覧 |
| `settings/organization` | 店舗と担当者を分離 | 管理範囲内、preview | 店舗・担当者 |
| `settings/configuration` | 現在設定・試行・履歴を分離 | 管理、preview | 構成変更 |
| `settings/usage` | 利用状況 | preview | 固定集計 |
| `settings/audit` | 監査検索 | preview | 監査履歴 |
| `settings/support` | 許可作成と履歴を分離 | 管理、preview | 許可履歴 |
| `settings/deletion` | 削除申請と履歴を分離 | 管理、preview | 削除履歴 |
| `operations/environments` | 環境とテンプレート | 管理、preview | 環境 |
| `operations/imports` | CSV確認と履歴 | 管理、preview | 取込履歴 |
| `operations/status` | 運用状況 | 管理、preview | 処理履歴 |
| `operations/support` | 許可のあるサポートアクセス | 管理、preview | アクセス履歴 |
| `screens` | 全画面カタログ | preview | カタログ |

サイドバーは画面定義の可用性と権限から生成する。対象案件が必要な機能は、その案件を開いてから選ぶ。企業内の管理権限をsystem_adminの代わりに使わない。設定入口から個人設定・所属企業・許可されたシステム管理へ移動する。

各行について日本語・英語、ライト・ダーク、360px・768px・1440pxを確認する。連続データは20件を基本とする。API fixtureの確認結果は、実Firebase・Go API・DBの結合試験と区別して記録する。
