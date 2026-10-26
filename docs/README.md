# 要件定義書の編集・PDF生成・共有

編集原本は [design.md](design.md) のみです。PDFは直接編集しません。要件を変更したら版を上げ、文書チェックとPDF生成を実行し、見た目を確認してから改訂版を人間が共有ドライブへアップロードします。

## ファイルの役割

| パス | 内容 |
| --- | --- |
| `docs/design.md` | 機能・非機能要件を中心とする要件定義書の編集原本 |
| [docs/business-logic.md](business-logic.md) | 業務の流れ・判断ルール・現在の実装範囲を簡潔に説明する資料 |
| [docs/tapyrus.md](tapyrus.md) | Tapyrusのローカル環境の初期化・起動・接続確認・データ削除の手順 |
| `docs/design.pdf` | 現行の原本と対応する最新版PDF |
| `docs/pdf/design-v<版>-<YYYYMMDDTHHMMSS>-JST.pdf` | 各改訂時点のPDF。日時は日本時間、過去版は上書きしない |
| `docs/pdf/*.json` | PDFごとの生成情報。原本・PDF・生成入力のSHA-256、版、生成日時、依存版等を記録 |
| `docs/10_22中間発表.pdf` | 参照元の発表資料。編集・上書きしない |
| `scripts/docs/` | ビルド、印刷CSS、固定依存、履歴管理の回帰テスト |
| `docs/quality/traceability.json` | 原本から生成する対応検査結果。要件数、目標・受入への明示対応、ケース数。直接編集しない |
| `docs/quality/*findings*.json`・`*report*.json` | 指定スキルによる読み取り専用の文書品質レビュー結果。製品受入・人の承認とは別 |
| `docs/skill-sources.md` | 使用したスキルの固定コミット・出典・既存文書への適用差分 |
| `docs/01_organized_mobiltracer-review.md` | Marpスキルの内容整理。要件原本から派生した説明用文書 |
| `docs/02_slide-design_mobiltracer-review.md` | 承認された内容整理から作成したスライド設計。枚数・構成・レイアウトの確認用 |
| `docs/03_marp_mobiltracer-review.md` | 承認済み設計から作成した18枚のMarp原稿。発表メモをコメントに保持 |
| `docs/03_marp_mobiltracer-review.pdf` | 説明資料の最新版PDF。要件定義書のA4 PDFとは別 |
| `docs/pdf/slides/` | 説明資料の改訂版PDFと対応する生成情報 |
| `docs/assets/slides/` | スライドで使うSVGの概念図・業務フロー |
| `scripts/slides/` | Marp・ブラウザーの固定依存、テーマ、PDF生成・検証処理 |
| `.github/workflows/docs.yml` | 文書関連の変更時に動くCI。保存済みPDFと原本の対応を検査 |

要件定義書のプロダクト向け帳票出力（FR-C15）と、ここで扱う開発文書のPDF生成は別です。

## 初回に準備するもの

推奨環境はLinux、Python 3.12以上です。CIではPython 3.12を使います。文書用のPython環境をフロントエンドのNode依存から分離しています。

必要なシステム依存はFontconfig、Pango、HarfBuzzとHarfBuzz Subset、日本語フォント **Noto Sans CJK JP** です。Ubuntuでは次を実行します。システムへのインストール権限が必要です。

```bash
sudo apt-get update
sudo apt-get install -y python3-venv fontconfig fonts-noto-cjk libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0
python3 -m venv .venv-docs
.venv-docs/bin/python -m pip install -r scripts/docs/requirements.txt
```

Pythonの直接依存はWeasyPrint 70.0、markdown-it-py 4.0.0、PyMuPDF 1.26.7です。PDF生成、表を含むMarkdownの解釈、PDF検証・画像化を担当します。間接依存も `requirements.txt` に固定しています。`requirements.in` は直接依存の一覧です。フォントをPDFへ埋め込むので、閲覧者によるフォントのインストールは不要です。

見出し、段落、箇条書き、表、コードブロックを使えます。概念図は原本内の `text` コードブロックで記述しています。Mermaidの自動描画と画像の読み込みは現行のビルドでは扱いません。生のHTMLも解釈しません。

インストールの前提は [WeasyPrint公式の導入手順](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)、Markdownの表の扱いは [markdown-it-py公式資料](https://markdown-it-py.readthedocs.io/en/latest/using.html)を参照してください。本ビルドはLinux向けで、排他制御に `flock` のPython APIを使用します。他OSではLinux環境またはWSLを使用してください。

今回の作業環境には `.venv-docs` を準備済みです。システムの対話認証が使えなかったため、配布パッケージから取得したフォントを `.venv-docs/fonts/NotoSansCJK-Regular.ttc`、不足ライブラリを `.venv-docs/lib/docs-native/` に置いています。これらはGit対象外です。通常の再セットアップでは上記のシステム導入手順を使えます。

フォントは、`DOCS_FONT_PATH` で指定したファイル、仮想環境内の上記フォント、Fontconfigで見つかったNoto Sans CJK JPの順に選びます。任意のフォントへの自動置換はせず、必要な日本語がない場合はエラーにします。ローカルの不足ライブラリがあるときは `docs.sh` がそのディレクトリを設定します。

## 編集から手動共有まで

すべてリポジトリルートで実行します。

1. `docs/design.md` の要件を変更します。要件IDは保ち、新規要件には未使用のIDを付けます。資料由来・今回の指定・追加提案・仮定・未決を区別し、業務フローと受入条件の参照も更新します。
2. 原本冒頭の `文書版: 0.1.0` を新しい版へ変更し、第1章の改訂履歴に同じ版・日本時間の日付・変更内容を追記します。版は `major.minor.patch` の三つの数値とし、保存済みの最大版より大きくします。変更の大小にかかわらず、原本を変更したら版を更新します。
3. 次のコマンドで、文書チェックと最新版・改訂版PDFの生成をまとめて実行します。

   ```bash
   bash scripts/docs/docs.sh build
   ```

4. `docs/design.pdf` をPDFビューアーで開くか、全ページを画像化して確認します。日本語の文字化け・欠落、表のはみ出し、表の続きと見出し、改ページ、ページ番号、概念図、未合意・未決事項の記載を確認します。

   ```bash
   bash scripts/docs/docs.sh preview --output /tmp/mobiltracer-pdf-preview
   ```

5. `build` が表示した **`docs/pdf/` 配下の改訂版PDF** を、人間がGoogle Driveの共有ドライブへアップロードします。ファイル名の版と日時を確認し、過去版を上書きせず保存します。保存先・閲覧権限はチームの指定に従って人間が確認します。共有先URLは未提供のため本書には記載しません。

Google Driveの接続・認証・保存先探索・アップロード・共有設定を行うコードはありません。認証情報や共有URLをビルド設定へ埋め込む必要もありません。

## チェックと改訂版の保存規則

```bash
# 原本の構造、版、履歴、要件・目標・未決ID、必須項目、相互参照を検査
bash scripts/docs/docs.sh check

# PDFを生成せず、原本の明示対応と受入ケース数のレポートを更新
bash scripts/docs/docs.sh quality

# 保存済みPDFと原本・生成入力・ハッシュの対応、文字抽出、ページ番号、描画範囲を検査
bash scripts/docs/docs.sh verify

# 履歴を壊さないこと、同版変更の拒否、生成失敗時の保全等を回帰検査
.venv-docs/bin/python -m unittest discover -s scripts/docs -p 'test_*.py' -v
```

`build` は毎回原本をチェックします。初回は一時領域でPDFを生成・検証してから、改訂版PDFとJSONを新規作成し、最新版を置き換え、対応検査レポートも更新します。生成・検証に失敗すると非ゼロで終了し、保存済みの最新版と過去版を維持します。生成途中に原本が変わった場合も保存を中断します。原本チェックは内容の矛盾や受入条件の妥当性を自動判定するものではないため、要件レビューも行います。

対応検査では、FR→AC、FR→GOAL、NFR→ACの各表を検査し、ACからの逆参照と照合します。未掲載、未定義、重複、対応不一致、受入ケースの空欄をエラーにします。対応率100%は記載の対応が存在するという意味で、製品テストの実施・合格率ではありません。`verify` は対応検査レポートが原本と一致することも確認します。品質レビューの指摘は人が検討し、提案値・未決事項・承認状態を更新してください。

| 状況 | 処理 |
| --- | --- |
| 同じ版・同じ原本・同じ生成入力 | 保存済み改訂版を検証して再利用。日時違いの履歴を増やさず、最新版を同じPDFへ戻す |
| 同じ版で原本が変わった | エラー。空白や誤字の変更も含め、版と改訂履歴を更新して再実行する |
| 同じ版でビルド本体・CSS・固定依存が変わった | エラー。出力に影響し得るため、文書版を上げ、改訂理由を記載する |
| 未保存の大きな版 | 日本時間の生成日時を含む新しい改訂版を保存する |
| 保存済みの最大版以下の未保存版 | エラー。意図しない巻き戻しを避ける |
| 最新版だけが欠落・不一致 | `verify` は失敗。原本と生成入力が一致するなら `build` で保存済み改訂版から復元する |
| 過去PDFのハッシュ不一致・PDFとJSONの片方が欠落 | エラー。自動修復や上書きはしない。Gitの正常な版から対応するPDFとJSONを復元して再検査する |

原本SHA-256、文書版、日本時間の生成日時はPDFの先頭ページに入ります。JSONにはPDFハッシュ、ページ数、生成スクリプト・要件検査モジュール・CSS・固定依存のハッシュ、実際のフォントハッシュ、Pythonの版、参照資料のハッシュも記録します。フォントとOSの違いは生成環境の情報として残し、保存済み版の再利用を妨げません。同版のPDFを別環境で作り直して過去版へ差し替えることはしません。

生成中断やディスク障害で改訂版PDF・JSONの片方だけが残った場合も、次回は失敗します。正しい履歴をGitから復元し、最新版を `build` で戻します。初回保存の途中で中断しGitに正常版がない場合は、担当者が未完了ファイルを退避して原因を確認した後に再生成し、未完了ファイルを共有しないでください。意図した過去版を削除してエラーを回避しないでください。

一時HTML・中間PDFは一時ディレクトリに作成し、通常終了時に除去します。排他制御用の `docs/.build.lock`、仮想環境、Pythonキャッシュ、最新版置換用の一時ファイルはGit対象外です。PDFは許可したフォント以外の外部・ローカル資源を読み込まず、認証情報やプロジェクト全体を成果物へ取り込みません。

## 依存を更新する場合

`requirements.in` の直接依存を検討してから、作業用の新しい仮想環境で依存を解決し、間接依存も含めて `requirements.txt` を更新します。`pip check`、回帰テスト、PDFの実生成と全ページの表示確認を実施します。既存仮想環境をそのまま `pip freeze` すると無関係なパッケージが混ざる場合があるため、文書用依存だけを固定してください。

生成入力の変更は現行版との不一致になるため、原本の文書版と改訂履歴も更新します。過去版は旧環境で生成した成果物として残し、最新の生成環境で上書きしません。

## CIとGitでの管理

既存のプロダクトCIは変更せず、文書専用のワークフローを追加しています。`main`・`develop`へのpushと、この二つをマージ先とするPRのうち、文書・ビルド・文書CIを変更した場合だけ動作します。文書チェック、履歴管理の回帰テスト、保存済み最新版・改訂版の検証を行います。原本だけ変更してPDFを更新し忘れると失敗します。

CIは新しい改訂版を保存しません。ローカルで `build` と表示確認を行い、以下を同じ変更としてGitで管理してください。自動コミット・pushは行いません。

- `docs/design.md` と `docs/design.pdf`
- 新しい改訂版PDFと対応するJSON
- `docs/quality/traceability.json` と、その版の品質レビュー結果・検証記録
- 変更した手順・ビルド・依存・CIの各ファイル

`git status --short` と `git check-ignore docs/design.pdf docs/pdf/*.pdf` で対象を確認できます。後者は、どのPDFもignoreされなければ何も出力せず終了コード1になります。ルートの `.gitignore` は生成PDFを除外していません。個人のグローバルignore設定がある場合も確認してください。

PDFの日本語グリフ、主要な要件ID、ページ番号、ページ外への文字のはみ出しは自動検査します。表の読みやすさ、段落の切れ方、図の理解しやすさは人間の表示確認で補います。今回の検証結果は [validation.md](validation.md) に記録しています。

## Marp用の説明資料を進める場合

今回指定された `marp-creator` に従い、内容整理とスライド設計を段階ごとに確認し、生成への承認後に18枚の資料を作成しました。手順と参照先は [skill-sources.md](skill-sources.md) に記載しています。説明用文書の変更で要件を確定させず、仕様変更は先に `design.md` を改訂します。

要件定義書用のPython環境・日本語フォントに加え、Node.js 24系を使います。Marp Core 5.0.2とPlaywright 1.64.1を `scripts/slides/package-lock.json` に固定しています。プロダクト本体のNode依存とは分離しています。初回はリポジトリルートで次を実行します。

```bash
npm ci --prefix scripts/slides
npm --prefix scripts/slides run browser:install
```

ブラウザーは `.cache-docs/browsers/` へダウンロードします。Linuxで不足ライブラリがある場合は、Playwright公式の[ブラウザー導入手順](https://playwright.dev/docs/browsers)に従ってChromiumのOS依存を準備してください。フォントは `DOCS_FONT_PATH`、`.venv-docs/fonts/NotoSansCJK-Regular.ttc`、システムのNoto Sans CJK JPから選びます。

```bash
# 18枚の構成、参照版、要件ID、図のパス等を検査
npm --prefix scripts/slides run check

# 試作PDF・HTML・全ページ画像をキャッシュへ生成（改訂版を保存しない）
npm --prefix scripts/slides run build -- --draft

# 最新版と改訂版PDFを生成。初回は描画検査も実行する
npm --prefix scripts/slides run build

# 保存済みPDFの原稿・生成入力・ハッシュ・文字・ページ番号を検証
npm --prefix scripts/slides run verify
```

試作の出力先は `.cache-docs/slides/draft.pdf`、`preview.html`、`preview/slide-01.png`〜`slide-18.png` です。キャッシュはGitへ含めません。試作段階で全ページを確認してから通常の `build` で保存してください。既存版を再利用する場合は再描画しないため、キャッシュ内のプレビューは試作で作った時点のものです。

説明資料の最新版は `03_marp_mobiltracer-review.pdf`、改訂版は `pdf/slides/mobiltracer-review-v<版>-<日本時間日時>-JST.pdf` です。共有するときは必要な資料の改訂版を人間がアップロードします。同じ説明資料版・同じ内容の再ビルドは保存済みPDFを再利用し、履歴を増やしません。原稿・図・テーマ・生成コード・固定依存を変えたら、原稿の `deck_version` を上げます。参照する要件定義書を更新した場合は `requirements_version` と内容を確認し、説明資料の版も更新してください。

改訂版JSONには原稿、要件原本、各図、テーマ、生成処理、固定依存のハッシュと生成日時を記録します。PDFとJSONの片方が欠けた場合や破損時は失敗させ、過去版を自動修復・上書きしません。正しい組をGitから復元して検証してください。初回保存の中断時は未完了ファイルを担当者が退避し、原因を確認してから再生成します。`docs/.slides.lock` が残った場合は、生成処理が動いていないことを確認してから担当者が取り除きます。

生成時はHTML・図の読み込みと描画範囲、日本語文字、18枚の寸法・タイトル・ページ番号を検査します。外部リソースの取得は止め、許可したローカルSVGを埋め込みます。スライド原稿・PDF・SVG・テーマ・生成情報・固定依存はGitで管理し、ブラウザー、依存本体、検査用の一時出力は除外します。CIはブラウザーを新規導入せず、原稿チェックと保存済み成果物の対応検証を行います。
