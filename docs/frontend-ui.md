# フロントエンド画面とAPI接続の状況

既存UIを共通部品に分け、車両・案件・記録の業務画面と、P0の操作を確認する開発用プレビューを作成した。実APIには車両・案件・記録・下書きの基本操作と、[ユーザー・企業・申請の管理](user-company-management.md)を接続している。写真、提出、回答、共有、検証と、`/preview`内の管理・運用は架空データでUIを確認する段階であり、製品受入が完了したことを表すものではない。

## 起動して画面を確認する

フロントエンドだけでプレビューを確認できる。`frontend/`で実行する。

```bash
APP_ENV=development ENABLE_UI_PREVIEW=1 npm run dev
```

`http://localhost:5173/preview/screens`が画面一覧。上部の「UIプレビュー」を展開すると、表示確認用の役割と状態を切り替えられる。変更はブラウザー内のメモリーに保持し、画面間の移動では引き継ぐ。再読み込みすると架空データの初期状態に戻る。構成変更・削除・取込には閲覧用のサンプルも用意している。写真は端末内のファイルを一時表示するだけで、サーバーへ送信しない。実データは入力しない。

Composeで確認する場合は、ローカル用の設定を追加する。

```bash
docker compose -f compose.yaml -f compose.firebase-emulator.yaml -f compose.ui-preview.yaml up --build -d --wait --wait-timeout 180
```

この場合は`http://localhost:8080/preview/screens`を開く。業務画面の`/app`には、Firebaseのログインと担当者への紐付け、所属選択が必要。認証の準備は[auth.md](auth.md)に従う。

プレビューの有効条件は`ENABLE_UI_PREVIEW === "1" && APP_ENV !== "production"`。ローカル確認では上記のように`APP_ENV=development`を明示する。無効時は404を返す。`compose.public.yaml`では`APP_ENV=production`、`ENABLE_UI_PREVIEW=0`に固定する。実APIが失敗しても、プレビューデータには切り替えない。

## 共通部品と処理の配置

| 配置 | 責務 |
| --- | --- |
| `frontend/app/components/atoms/` | Button、Input、Select、Textarea、Alert、Badge。業務APIを呼ばない基礎部品 |
| `frontend/app/components/molecules/` | Field、TextField、Panel、EmptyState、共通Pagination等の組合せ部品 |
| `frontend/app/components/templates/` | AuthenticatedLayout。共通操作領域・折りたたみサイドバー・モバイルドロワー・mainの配置 |
| `frontend/app/components/ui/` | 既存import用の再export、表示設定、未保存入力の移動確認、SplitText、UIのCSS Module |
| `frontend/app/i18n/` | 型付きの日英辞書、名前付き引数、日時・数値整形、状態・エラーコードの表示 |
| `frontend/app/features/management/` | 実APIに接続するユーザー・企業・申請管理の型、通信、共通フォーム・表示部品 |
| `frontend/app/features/auth/` | ログイン画面、文言、認証・表示状態を扱うフック |
| `frontend/app/features/workspace/model.ts` | APIの型とZodスキーマ、権限表示、構成版に応じた入力検証 |
| `frontend/app/features/workspace/api.server.ts` | Cookie・CSRFの転送、実APIの取得・更新、エラー処理 |
| `frontend/app/features/workspace/command-form.tsx` | 保存中・成功・失敗・結果未確定、未保存の入力を残した移動の確認 |
| `frontend/app/features/workspace/pages/` | 車両・案件・記録・下書きの機能別画面。`core-screens.tsx`は再exportのみ |
| `frontend/app/features/workspace/workflow-*-pages.tsx` | 写真、提出、訂正、回答、比較、共有、検証、出力。`workflow-screens.tsx`は再exportのみ |
| `frontend/app/features/workspace/preview-management/` | 企業設定、提供側運用、画面一覧。`management-screens.tsx`は再exportのみ |
| `frontend/app/features/workspace/screens.ts`、`page-registry.tsx` | URL解決・可用性・ナビゲーションと、型で全画面を確認する描画定義 |
| `frontend/app/features/workspace/preview-data.ts`、`preview-commands.ts` | 架空データとプレビュー内の操作。実APIの代替処理には使わない |
| `frontend/app/routes/` | SSRのloader/action、ルートごとの認証と画面への受け渡し |

Atomic Designの責務に沿って部品・配置・機能画面を分ける。業務フォームと対象情報はfeatures内に置き、CommandForm・CommandSubmit・CommandFeedbackで保存状態を共有する。共通UIはFirebaseや個別の業務APIを呼び出さない。スタイルはCSS Modulesを使い、global CSSはreset・フォント・テーマ変数・アクセシビリティの基礎指定に限定する。Tailwindの依存とViteプラグインは削除した。

React RouterはFramework Modeの既存構成を維持した。業務画面は`/app/*`、架空データの画面は`/preview/*`で、それぞれ同じ画面部品を使用する。具体的な画面の対応は`screens.ts`に定義している。

## 実APIで確認できる操作

- ログイン、所属選択、ログアウト、システム管理者の権限確認。
- 車両の検索・一覧・詳細・登録・車種名の更新。
- 案件の検索・一覧・作成・詳細・許可された段階変更・理由付きの中止。
- 案件の担当を自分または未指定へ変更。任意の担当者を選ぶには担当者一覧APIが必要。
- 記録・最初の下書きの作成、版履歴の閲覧、下書き項目の保存。

権限の最終判断はGo APIが行う。UIのボタン表示やプレビューの役割切替を、認可の検証とは扱わない。

下書きでは提出時の必須不足を許可し、入力済みの型・範囲を検証する。項目値は全置換APIへ送るため、未編集の値を保持し、除去とnullを明示的な操作に分けた。古い`lock_version`での上書きは拒否し、POST・PUT・PATCHの自動再送は行わない。応答が途切れた場合は結果未確定として、一覧・詳細での確認を案内する。

案件が使用する構成版と、現在取得できる構成版が異なる場合は、古い案件を新しい設定で編集しない。現在は構成版をIDで取得するAPIがないため、その案件の項目編集・段階変更を停止して案内する。

車両・案件の一覧と、車両の関連案件、案件内記録、記録の版履歴はAPIのページ情報を保持する。案件作成の車両は検索とページ取得で選ぶ。表示中の版は履歴ページとは別に取得し、履歴に追加しない。履歴のページ変更でも選択した版を維持する。

## 共通レイアウトと設定

全画面の責務・分離先・接続範囲は[UI再構成の対応表](ui-migration.md)に記録する。新設の`/settings`からアカウント・所属・表示設定・自分の申請へ移動する。`/settings/display`はログインと共通の`mt_locale`・`mt_theme`を使う。システム管理へのリンクは、サーバーが検証した`session.system_admin`に基づいて表示する。

管理画面では既存URLのqueryで一覧・詳細・作成・編集を分ける。`/app/*`と`/preview/*`の画面は同じ実装を使い、`/app/actions`は従来どおり保存を受け付ける。

左上の開閉ボタンと右上の言語・テーマ切替を共通の操作領域に置く。サイト名ヘッダー、業務フッター、大きな画面名、飾りの英語見出しは表示しない。画面名は読み上げ用のh1とブラウザータイトルに残す。案件内では対象車両・ナンバー・状態・選択版を短く表示し、内部IDは詳細で参照する。

デスクトップは通常のサイドバー、768px未満は同じグループを持つモーダルドロワーになる。モバイルは背景スクロールを止め、Escape・背景クリック・閉じるボタンに対応する。遷移成功時に閉じ、未保存の移動確認は開いているドロワー内でも操作できる。設定変更だけではフォームを作り直さない。

日英のキー・引数の不足は型チェックとテストで検出する。APIのcodeとfieldを翻訳し、未知エラーには一般的な案内を表示する。日付は選択言語で整形し、タイムゾーンは`Asia/Tokyo`に固定する。テーマには意味別のCSS変数を使う。本文・入力・リンク・主操作の代表色は4.5:1以上、フォーカスはライトで3.28:1、ダークで8.31:1を確認した。ログインの固有スタイルは維持する。

## プレビューで確認する業務ルール

- 三業態の記録編集、提出前確認、回答、比較を同じ画面部品で進める。
- 必須不足、写真不足、送信失敗、撮影不能の責任者承認を分けて表示する。
- 提出版を直接編集せず、訂正・補足は新しい下書きとする。旧版の回答を新版に移さない。
- 受領・状態同意・作業承認と、拒否・保留・未回答を区別する。
- 修理の作業段階へ進む前に、最新の提出範囲への作業承認を確認する。
- 業務完了後も、未解決の異議と登録失敗を残す。
- 共有取消し・期限切れと、記録の保存・本人控えを区別する。
- 公開前の写真確認で非公開表示を指定し、共有先では原本の画像・リンク・撮影情報を表示しない。画像内の指定領域を加工する機能は未接続。
- 構成変更を試行して差分を示し、新しい案件に反映する。既存案件には元の設定版を保持する。

表示状態の切替は読み込み中、データなし、通信失敗、権限不足、対象なし、保存競合、結果未確定に対応する。これらは表示確認用であり、実際のネットワーク障害や権限失効を再現した試験ではない。

CSVは2列のサンプルを全行検査し、結果を20行ずつ表示する。完全なCSV解析・実取込・サーバーでの重複防止、通知の配信、署名の本人確認、帳票のサーバー生成、ハッシュ計算・外部登録・照合は未実装。印刷・JSON取得はプレビュー内のサンプル出力に限定する。

## 次のAPI連携Issue案

以下はリポジトリ内の作業整理であり、GitHub Issueはまだ作成していない。

| Issue案 | 必要な仕様・完了条件 |
| --- | --- |
| 案件が使用する構成版と担当候補の取得 | ID指定の構成取得、選択可能な担当者、店舗ごとの許可操作を取得できる。古い案件を現行設定で編集しない |
| 写真原本・注釈・撮影不能承認の接続 | アップロード状況、容量制約、再送の重複防止、原本と加工画像、承認者・理由を保存・取得できる |
| 提出・訂正・業務段階の接続 | 提出版を固定し、元版・構成版・車両表示を保持する。訂正・補足、提出の重複防止、完了条件を接続する |
| 本人確認・確認依頼・回答・異議・基本通知の接続 | 対象版・確認文面・資格・承認範囲・金額・期限を固定し、旧回答の流用と無回答の同意扱いを防ぐ |
| 比較・共有・本人控え・標準出力の接続 | 公開項目、マスキング、取消し、期限、所有者変更、本人の取得権限をAPIと出力に適用する |
| 外部登録・照合・再試行の接続 | 登録状況を永続化し、再試行前に結果を照会する。独立基準との実照合と監査記録を検証する |
| 顧客管理・提供側運用の接続 | 店舗・複数役割・サポート許可・構成反映・容量集計・監査出力・CSV取込・個別削除を、対象と承認履歴を含めて接続する |

## 検証とレビュー

共通UIへのリファクタリング後に既存の単体テスト、型チェック、ESLint、ビルド、ブラウザーテストを実行してから、新規画面を追加した。

追加後は、下書きの全置換・競合・訂正と回答の分離・構成版の保持・最終管理者の保護などを単体テストで確認する。HTTPのテスト用APIではCookieとCSRFを転送し、車両・案件・記録の作成、下書き更新と再読込をブラウザーから検証する。Go API・DBとの製品結合試験とは区別する。

Playwrightでは全画面を幅360pxで巡回し、横スクロールと実行時エラーを確認する。三業態の編集・提出・回答・比較、訂正、共有取消し、期限切れ、役割切替も確認する。実Firebase・エミュレーターを使う3件と、Compose上の同一オリジンAPIを使う1件は、各環境を起動した場合に実行する。iOS Safari・Android Chromeの実機試験、性能測定、外部登録の実照合は後続とする。

使用したSkillsは`frontend/.agents/skills/`に保存した。

- [vercel-composition-patterns](https://github.com/vercel-labs/agent-skills/blob/main/skills/composition-patterns/SKILL.md)：部品の組み合わせ、明示的なバリエーション、状態管理とUIの分離。
- [web-design-guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md)：ラベル、エラー時のフォーカス、キーボード操作、状態表示、写真の寸法、スマートフォンでの表示。
- [vercel-react-best-practices](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md)：独立した取得の並列化、派生値の計算、コンポーネント内での部品定義の回避。Next.js専用のルールは適用していない。

レビューでは、保存成功後のフォーム再生成によって成功表示が消える問題と、スマートフォンの表で車両名が細切れになる問題を修正した。未接続の回答・登録・照合の状況は「現在は確認できません」とし、未回答・未登録・未実施と断定しない。未接続APIの認可・通知・署名・検証結果を、UIレビューで保証したとは扱わない。

## 画面一覧

以下のパスには`/app/`または`/preview/`を付ける。「実API」は基本操作までの接続を表す。画面内にある写真・提出などの後続操作はプレビューの対象とする。

| 画面 | パス | 接続 |
| --- | --- | --- |
| ホーム | `(ホーム)` | 実API |
| 未対応一覧 | `tasks` | プレビュー |
| 車両 | `vehicles` | 実API |
| 車両登録 | `vehicles/new` | 実API |
| 車両詳細 | `vehicles/:vehicleId` | 実API |
| 車両編集 | `vehicles/:vehicleId?view=edit` | 実API |
| 識別情報・所有者履歴 | `vehicles/:vehicleId/history` | プレビュー |
| 案件 | `cases` | 実API |
| 案件作成 | `cases/new` | 実API |
| 案件詳細 | `cases/:caseId` | 実API |
| 案件内の記録一覧 | `cases/:caseId/records` | 実API |
| 案件の関係者 | `cases/:caseId/participants` | プレビュー |
| 案件管理 | `cases/:caseId/manage` | 実API。完了操作はプレビュー |
| 記録の作成 | `cases/:caseId/records/new` | 実API |
| 記録の内容 | `cases/:caseId/records/:recordId` | 実API |
| 版履歴 | `cases/:caseId/records/:recordId/history` | 実API |
| 下書き編集 | `cases/:caseId/records/:recordId/edit` | 実API |
| 撮影・点検 | `cases/:caseId/records/:recordId/photos` | プレビュー |
| 提出前確認 | `cases/:caseId/records/:recordId/submit` | プレビュー |
| 訂正・補足 | `cases/:caseId/records/:recordId/correct` | プレビュー |
| 記録の比較 | `cases/:caseId/compare` | プレビュー |
| 確認依頼・回答 | `cases/:caseId/answers` | プレビュー |
| 異議・再確認 | `cases/:caseId/disputes` | プレビュー |
| 共有 | `cases/:caseId/sharing` | プレビュー |
| 登録・検証 | `cases/:caseId/verification` | プレビュー |
| 帳票・データ出力 | `cases/:caseId/exports` | プレビュー |
| 共有された記録 | `recipient/:shareId` | プレビュー |
| 本人控え | `receipts/:answerId` | プレビュー |
| 店舗・担当者・権限 | `settings/organization` | プレビュー |
| 設定・構成版 | `settings/configuration` | プレビュー |
| 利用状況 | `settings/usage` | プレビュー |
| 監査履歴 | `settings/audit` | プレビュー |
| サポート許可 | `settings/support` | プレビュー |
| 削除申請 | `settings/deletion` | プレビュー |
| 利用環境・テンプレート | `operations/environments` | プレビュー |
| CSV取込 | `operations/imports` | プレビュー |
| 運用状況 | `operations/status` | プレビュー |
| サポートアクセス | `operations/support` | プレビュー |
| 画面一覧 | `screens` | プレビュー |
