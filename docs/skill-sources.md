# 使用したスキルと今回の適用範囲

要件の編集原本は `design.md` です。この記録は、文書改善に用いたスキルと、既存の文書構成へ合わせた点を示します。スキルやテンプレートを使ったことを、顧客の承認・製品試験の合格・規格認証とは扱いません。

## requirements-author

- 提供元: Microsoft HVE-Core。
- 参照した版: `6cd810c7b9448d98ea07db0a7a9124824d32dacc`、`spec_version: 1.1`。
- 手順: [SKILL.md](https://github.com/microsoft/hve-core/blob/6cd810c7b9448d98ea07db0a7a9124824d32dacc/.github/skills/project-planning/requirements-author/SKILL.md)。
- 使用した観点: 要件の分類、開始条件と観測可能な結果、Given/When/Then形式の受入ケース、目標・測定・責任、要件と受入条件・目標の対応、未決事項、MVPの切り方、品質レビュー。

新規文書を一から作る手順を、既存の要件定義書の改訂に合わせて適用しました。PRDテンプレートの見出しへ全体を置換せず、目的・利用主体・目標・要件・受入・未決事項を既存13章へ配置しています。既存のFR・NFR・ACのIDは維持し、スキルの3桁採番との差分を明記しました。新しいGOAL・CON・DD・OQは3桁です。

FRは能力のまとまり、ACは受入のまとまりとして残し、受入ケースごとに前提・操作・期待結果を分けました。実装チケットへの分割・見積は未実施です。上流の承認済みBRDや実現可能性調査の引き継ぎは提供されていないため、それらを取り込んだとは記録しません。

PRD Validateの指定に従って読み取り専用の品質レビューを行い、`PRD_STANDARD_FINDINGS_V1` と `PRD_QUALITY_REPORT_V1` の結果を `docs/quality/` に記録します。レビュー結果は文書品質の評価であり、利用者の同意、顧客の承認、製品受入とは別です。製品の承認前なのでFinalizeには進めず、文書状態は `draft` とします。

Microsoftのスキルおよび参照文書はCC BY 4.0です。上記の構成・点検方法をMobilTracerの既存文書へ合わせて改変・適用しています。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)と、[参照文書のライセンス記載](https://github.com/microsoft/hve-core/blob/6cd810c7b9448d98ea07db0a7a9124824d32dacc/.github/skills/project-planning/requirements-author/references/prd/prd-quality-formats.md)を参照してください。ISO・NIST等の規格本文や元のスキル一式を転載していません。

## marp-creatorとClassmethod Marp Theme

- 提供元: `classmethod/classmethod-marp-theme`。
- 参照した版: `250b43a3cfd64fc0e2db4e5f3a235739d4f9ff39`。
- 手順: [marp-creator/SKILL.md](https://github.com/classmethod/classmethod-marp-theme/blob/250b43a3cfd64fc0e2db4e5f3a235739d4f9ff39/.claude/skills/marp-creator/SKILL.md)。
- 適用対象: 要件レビューに使う説明内容。`01_organized_mobiltracer-review.md` がステップ1の出力です。

本スキルは「内容整理→スライド設計→Marp生成」の各段階で明示承認を求めます。内容整理を作成してからユーザーへ確認し、回答を得た段階まで進めます。A4の要件定義書をスライド形式へ置き換えず、原本と説明用の派生資料を分けます。

内容整理案に対するユーザーの「次のステップに進んでください」を受け、ステップ2の `02_slide-design_mobiltracer-review.md` を作成しました。発表時間の指定がないため、15分・18枚を仮置きしています。今回の承認は内容整理からスライド設計への移行を対象とし、製品要件の承認とは分けて記録しています。

ユーザーの「お願いします」により、18枚の設計からMarp資料・PDFの生成へ進む承認を得ました。ステップ3として `03_marp_mobiltracer-review.md` とPDFを作成し、図7点、話者メモ、要件参照を配置しました。承認された設計に従い、固定ロゴを使うサンプル例から変更してClassmethodのロゴ・外部画像を入れず、MobilTracerを文字で表記しています。

生成前に最新版の `sample-slide.md` と `classmethod-theme.css` を取得し、リポジトリのコミットが上記の版と一致することを確認しました。元CSSは `scripts/slides/themes/classmethod.css` に保存し、SHA-256は `d9be5deadaf9f43bf3fb9aac66ad9c07f07e5e6d266495ef8f7680e2054d2e65`。追加の `mobiltracer.css` で1920×1080px、文字サイズ、レイアウト、参照・ページ番号の配置を調整しています。

Marp Core 5.0.2とPlaywright 1.64.1を文書専用の固定依存とし、ChromiumでPDFを生成します。新規生成時の外部リソース取得は止め、SVGを埋め込みます。ビルド・再検証・改訂版保存の手順は `docs/README.md` に記載しています。要件定義書の原本とA4 PDFは変更していません。

## natural-japanese

既存の日本語文書スキルも継続し、文章lint、構成、用語、読みにくさを点検します。必須項目や状態名を読みやすさのために省略せず、追加した測定条件や責任役割は、実績・合意済み事項ではなく提案・未決として区別します。
