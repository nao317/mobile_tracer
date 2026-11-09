# OSS・ライブラリのライセンス表示

`/licenses` はサイドバーの設定グループの直下にある「OSSライセンス」から開けます。設定グループの外側に置き、開閉操作なしで直接移動できます。ログイン画面と設定内にはリンクを置きません。
既存の `Panel`、`Badge`、`Pagination` を使い、名前順に10件ずつ表示します。
ライセンス原文は翻訳・要約せずに収録し、著作権表示やNOTICEも保持します。
一覧の全データはサーバーに置き、ブラウザーには対象ページの10件だけを渡します。

収録対象は以下です。

- `frontend/package-lock.json` のnpm依存。間接依存、開発ツール、他OS向けの任意依存も含む。同じ名前・バージョンは1件にまとめる。
- `backend/go.mod` のGoモジュール。間接依存も含む。
- `scripts/license-sources.json` にある主要な基盤ソフトウェアとGoogle Fontsの使用フォント。

Node.jsのライセンスには同梱する第三者コードの通知も含めます。各コンテナのOSパッケージ全件を列挙したSBOMではありません。GSAPは独自ライセンス名と公式原文へのリンクを表示します。
npm配布物にライセンスファイルがない場合や、他OS向けで未インストールの場合は、ライセンス名と配布元へのリンクを表示します。Firebaseは該当リリースの公式リポジトリの原文を収録します。

## 依存や基盤ソフトウェアを更新したとき

リポジトリルートで実行します。

```bash
npm ci --prefix frontend
python3 scripts/generate-licenses.py
python3 scripts/generate-licenses.py --check
```

生成時はGoの公式モジュール配布元と公式リポジトリに接続します。キャッシュはOSの一時ディレクトリ内の `mobile-tracer-license-cache` に置きます。
基盤ソフトウェアやフォントを追加・更新したときは `scripts/license-sources.json` のバージョン・ライセンス名・原文URLも更新してください。

生成した `frontend/app/features/licenses/catalog.generated.json` はGitに含めます。
通常のアプリビルドや閲覧にはライセンス取得先への接続は不要です。CIは入力ファイルのハッシュと収録依存を照合し、更新漏れを検出します。
