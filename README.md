# mobile tracer

## プロジェクトの概要

現在は、React Router・React・TypeScriptを使ったフロントエンドの開発環境と、GitHub ActionsによるCIを整備しています。フロントエンドのコードは `frontend/` にあります。

CIには、今後の実装に向けてGo製APIの検証と、Tapyrusを含む結合テストの実行手順も用意しています。Goの検証ジョブと結合テストのジョブは、それぞれに必要なファイルが揃うと実行されます。CIから読み取れる構成は次のとおりです。

| 構成要素 | 役割・現在の状態 |
| --- | --- |
| フロントエンド | React Router・React・TypeScriptを使用。型チェックと本番ビルドをCIで検証します。 |
| バックエンド | Go製APIを導入する予定です。`backend/go.mod` と `backend/cmd/api/main.go` は未導入です。 |
| E2Eテスト | 未導入です。`frontend/package.json` に `e2e` スクリプトを追加するとCIの対象になります。テストツールに応じた準備も必要です。 |
| 結合テスト | Docker Composeでサービスを起動し、接続とTapyrusのトランザクションを確認する予定です。必要なCompose定義やスクリプトは未導入です。 |

業務上の用途や機能の詳細は、現在の実装とCIだけでは確定できません。今後、仕様や機能の追加に合わせて、この概要も更新します。

## Issueと変更の管理

以下は、これまでのコミット履歴とブランチ名に基づく開発手順です。Issueのタイトル・本文の書式やラベルの付け方は、履歴から統一ルールを確認できていません。

### Issueとブランチ・コミットの対応

作業内容をIssue番号で関連付けます。ブランチ名には番号を含め、コミットメッセージには `#<Issue番号>` を記載します。

| Issue | 作業内容 | 対応するブランチ |
| --- | --- | --- |
| #1 | READMEの作成・整備 | `docs/1-readme` |
| #2 | React Routerの環境構築 | `chore/2-reactrouter-env` |
| #5 | CIの整備 | `chore/5-ci` |

Issue番号とPR番号は別の番号です。たとえば、Issue #2に対応する変更はPR #3、Issue #5に対応する変更はPR #6で取り込まれています。

コミットメッセージでは、次の形式が使われています。

```text
<変更の種類>: <変更内容> #<Issue番号> @<担当者>
```

例：`chore: ReactRouterの環境構築 #2 @nao317`

`#<Issue番号>` はIssueへの参照です。参照を書くだけで、マージ時にIssueを閉じる運用になっているとは限りません。

### ブランチの命名

作業ブランチは、次の形式で命名します。

```text
<変更の種類>/<Issue番号>-<作業内容>
```

これまでに使われている変更の種類は、環境構築やCI整備の `chore` と、ドキュメント整備の `docs` です。作業内容は `reactrouter-env` のように、短い英語をハイフンでつないで表します。

### Gitフロー

`main` と `develop` を使い、作業ブランチの変更をPRで段階的に取り込みます。

| ブランチ | 役割 |
| --- | --- |
| `main` | `develop`でまとめた変更を取り込むブランチです。 |
| `develop` | 個々の作業ブランチを取り込み、変更をまとめる開発用ブランチです。 |
| `chore/...`・`docs/...` | Issueに対応する作業を進めるブランチです。 |

基本の流れは次のとおりです。

1. 対象のIssueを確認し、最新の`develop`から作業ブランチを作成します。
2. 変更をコミットしてpushし、`develop`をマージ先とするPRを作成します。
3. CIの結果と変更内容を確認し、PRを`develop`へマージします。
4. 変更をまとめるタイミングで、`develop`から`main`へのPRを作成してマージします。

履歴では、作業ブランチを取り込んだPR #3・#6と、`develop`を`main`へ取り込んだPR #4・#7を確認できます。いずれもマージコミットが残っています。`release`・`hotfix`ブランチや、本番環境への自動デプロイの運用は、現在の履歴とCIでは確認できません。

## CIの構成

設定は[`.github/workflows/ci.yml`](.github/workflows/ci.yml)で管理しています。`main`・`develop`へのpushと、この2つをマージ先とするPRで起動します。

| ジョブ | 実行内容 | 実行条件 |
| --- | --- | --- |
| `quality` | `npm ci`、型チェック、本番ビルド | 毎回実行 |
| `detect` | E2E・Go API・結合テストに必要な実装の有無を確認 | 毎回実行 |
| `e2e` | `npm run e2e` | `e2e`スクリプトがある場合 |
| `backend` | Goの整形確認、静的解析、データ競合を検出するテスト、APIのビルド | GoモジュールとAPIのエントリーポイントがある場合 |
| `integration` | Composeでの起動、サービス間接続とTapyrusトランザクションの確認 | 必要なファイルが揃い、先行する検証が成功した場合 |

`quality`と`detect`は並列で動きます。`e2e`と`backend`は`detect`の判定後に実行されます。

`integration`は先行ジョブの結果を待ちます。E2Eが未導入のためスキップされた場合も、ほかの実行条件を満たせば`integration`を実行します。実行した検証が失敗した場合や、ワークフローがキャンセルされた場合は、`integration`を実行しません。

Node.jsを使うジョブでは、24.22.1以上・25未満の範囲で最新のバージョンを取得します。依存パッケージは`frontend/package-lock.json`に従ってインストールします。

結合テストを有効にするには、Go APIに加え、次のファイルが必要です。

```text
compose.yaml
frontend/Dockerfile
backend/Dockerfile
scripts/init.sh
scripts/smoke.py
scripts/tapyrus-smoke.py
```

結合テストが失敗した場合はComposeのログを出力します。終了時には、成功・失敗にかかわらずサービスを停止し、ボリュームを削除する処理を実行します。
