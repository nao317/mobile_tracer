#!/usr/bin/env python3
"""Check Markdown, render Japanese PDF, and retain immutable revisions."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
from html import escape
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

from requirements_check import IDENTIFIER, analyze

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
SOURCE = DOCS / "design.md"
HERE = Path(__file__).resolve().parent


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_source(source: Path | None = None) -> tuple[str, str]:
    source = source or SOURCE
    text = source.read_bytes().decode("utf-8")
    versions = re.findall(r"^文書版: (\d+\.\d+\.\d+)$", text, re.M)
    if len(versions) != 1:
        raise ValueError("文書版: x.y.z を原本に1行だけ指定してください")
    version = versions[0]
    if not re.search(rf"^\| {re.escape(version)} \|", text, re.M):
        raise ValueError("現行版が改訂履歴にありません")
    numbers = re.findall(r"^## (\d+)\.", text, re.M)
    if numbers != [str(n) for n in range(1, 14)]:
        raise ValueError("第1〜13章の順序・欠落を確認してください")
    report = analyze(text)
    if re.search(r"(?:TODO|TBD|FIXME)", text):
        raise ValueError("未記入マーカーがあります。未決事項は第13章に具体的に記載してください")
    if text.count("```") % 2:
        raise ValueError("コードブロックが閉じていません")
    print(f"文書チェック成功: v{version}, FR {report['counts']['FR']} / NFR {report['counts']['NFR']} / AC {report['counts']['AC']}, 明示対応100%")
    return version, text


def font_path() -> Path:
    configured = os.environ.get("DOCS_FONT_PATH")
    if configured:
        path = Path(configured).resolve()
    elif (ROOT / ".venv-docs/fonts/NotoSansCJK-Regular.ttc").is_file():
        path = ROOT / ".venv-docs/fonts/NotoSansCJK-Regular.ttc"
    else:
        result = subprocess.run(
            ["fc-match", "-f", "%{family}\n%{file}", "Noto Sans CJK JP"],
            check=True, text=True, capture_output=True,
        ).stdout.splitlines()
        if len(result) < 2 or "Noto Sans CJK JP" not in result[0]:
            raise ValueError("Noto Sans CJK JPがありません。docs/README.mdの準備手順を参照してください")
        path = Path(result[1])
    if not path.is_file():
        raise ValueError(f"日本語フォントが見つかりません: {path}")
    from fontTools.ttLib import TTFont
    font = TTFont(path, fontNumber=0)
    try:
        cmap = font.getBestCmap()
        if any(ord(c) not in cmap for c in "車両記録要件確認異議承認"):
            raise ValueError("指定フォントには必要な日本語グリフがありません")
    finally:
        font.close()
    return path


def build_inputs() -> tuple[dict, Path]:
    font = font_path()
    # Hash only rendering inputs. README/CI edits do not create document revisions.
    files = {p.name: sha(p.read_bytes()) for p in [Path(__file__), HERE / "requirements_check.py", HERE / "print.css", HERE / "requirements.txt"]}
    packages = {line.split("==")[0]: importlib.metadata.version(line.split("==")[0])
                for line in (HERE / "requirements.txt").read_text().splitlines()
                if line and not line.startswith("#")}
    expected = {line.split("==")[0]: line.split("==")[1] for line in
                (HERE / "requirements.txt").read_text().splitlines() if line and not line.startswith("#")}
    if packages != expected:
        raise ValueError("依存バージョンが固定ファイルと異なります。pip install -r scripts/docs/requirements.txt を実行してください")
    info = {"files": files, "packages": packages}
    return info, font


def validate_pdf(path: Path, version: str, text: str, source_sha: str) -> int:
    import pymupdf
    with pymupdf.open(path) as pdf:
        if not len(pdf):
            raise ValueError("生成PDFにページがありません")
        full = "\n".join(page.get_text() for page in pdf)
        compact = re.sub(r"\s", "", full)
        if "\ufffd" in full or "\x00" in full:
            raise ValueError("PDFの文字抽出で欠損文字を検出しました")
        for value in ["MobilTracer", f"文書版:{version}", source_sha,
                      *re.findall(rf"^### ({IDENTIFIER})", text, re.M),
                      *re.findall(r"^\| ((?:CON|DD|OQ)-\d{3,})\s", text, re.M)]:
            if value not in compact:
                raise ValueError(f"PDFから文字を確認できません: {value}")
        # Unique Japanese characters help detect missing glyphs in any chapter.
        needed = set(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", text))
        if needed - set(full):
            raise ValueError(f"PDFで欠落した日本語文字: {sorted(needed - set(full))}")
        for i, page in enumerate(pdf, 1):
            if f"{i} / {len(pdf)}" not in page.get_text():
                raise ValueError(f"ページ番号が不正です: p.{i}")
            for x0, y0, x1, y1, word, *_ in page.get_text("words"):
                if x0 < 35 or x1 > page.rect.width - 35 or y0 < 15 or y1 > page.rect.height - 15:
                    raise ValueError(f"ページ領域のはみ出し: p.{i}, {word}")
        return len(pdf)


def render(text: str, version: str, source_sha: str, generated_at: str, font: Path, target: Path) -> None:
    from markdown_it import MarkdownIt
    from weasyprint import HTML, CSS
    from weasyprint.text.fonts import FontConfiguration
    from weasyprint.urls import URLFetcher, URLFetcherResponse
    parser = MarkdownIt("commonmark", {"html": False}).enable("table")
    tokens = parser.parse(text)
    toc = []
    for i, token in enumerate(tokens):
        if token.type == "heading_open" and token.tag == "h2":
            anchor = f"chapter-{len(toc) + 1}"
            token.attrSet("id", anchor)
            toc.append(f'<li><a href="#{anchor}">{escape(tokens[i+1].content)}</a></li>')
    body = parser.renderer.render(tokens, parser.options, {})
    title_end = body.index("</h1>") + len("</h1>")
    front = (f'<p class="version">文書版: {version}</p>'
             f'<p class="build-info">生成日時（日本時間）: {generated_at}<br>'
             f'原本 SHA-256: {source_sha}</p>'
             '<nav class="toc"><h2>目次</h2><ol>' + "".join(toc) + '</ol></nav>')
    body = body[:title_end] + front + body[title_end:]
    html = f'<!doctype html><html lang="ja"><meta charset="utf-8"><title>MobilTracer 要件定義書 v{version}</title><body>{body}</body></html>'
    font_config = FontConfiguration()
    css = f'@font-face {{ font-family: "Noto Sans CJK JP"; src: url("{font.as_uri()}"); }}\n'
    # No network or other repository files are ever read by the renderer.
    class LocalFontFetcher(URLFetcher):
        def fetch(self, url, headers=None):
            if url != font.as_uri():
                raise ValueError(f"PDF生成では外部リソースを読み込めません: {url}")
            return URLFetcherResponse(url, font.read_bytes(), {"Content-Type": "font/collection"})
    fetcher = LocalFontFetcher(fail_on_errors=True)
    class Errors(logging.Handler):
        def __init__(self):
            super().__init__(); self.messages = []
        def emit(self, record):
            if record.levelno >= logging.WARNING:
                if len(self.messages) < 10:
                    self.messages.append(record.getMessage())
    errors = Errors()
    logger = logging.getLogger("weasyprint")
    logger.addHandler(errors)
    try:
        HTML(string=html, url_fetcher=fetcher).write_pdf(
            target, stylesheets=[CSS(string=css + (HERE / "print.css").read_text(),
                                    font_config=font_config, url_fetcher=fetcher)],
            font_config=font_config,
        )
        if errors.messages:
            raise ValueError("PDF生成時の警告: " + " / ".join(errors.messages))
    finally:
        logger.removeHandler(errors)


@contextmanager
def locked():
    with (DOCS / ".build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def archives() -> list[tuple[Path, dict]]:
    folder = DOCS / "pdf"
    items = []
    for pdf in sorted(folder.glob("*.pdf")):
        manifest = pdf.with_suffix(".json")
        if not manifest.exists():
            raise ValueError(f"対応する生成情報がありません: {pdf}")
        item = json.loads(manifest.read_text())
        if sha(pdf.read_bytes()) != item["pdf_sha256"]:
            raise ValueError(f"改訂版PDFのハッシュ不一致: {pdf}")
        if item["pdf"] != pdf.name:
            raise ValueError(f"生成情報とPDF名が一致しません: {manifest}")
        if any(existing[1]["version"] == item["version"] for existing in items):
            raise ValueError(f"同じ版の改訂版PDFが複数あります: {item['version']}")
        items.append((pdf, item))
    for manifest in folder.glob("*.json"):
        if not manifest.with_suffix(".pdf").exists():
            raise ValueError(f"対応するPDFがありません: {manifest}")
    return items


def replace_latest(pdf: Path) -> None:
    fd, temp = tempfile.mkstemp(prefix=".design-", suffix=".tmp", dir=DOCS)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(pdf.read_bytes())
        os.replace(temp, DOCS / "design.pdf")
    finally:
        Path(temp).unlink(missing_ok=True)


def traceability(text: str, verify_only: bool = False) -> None:
    expected = analyze(text)
    path = DOCS / "quality/traceability.json"
    if verify_only:
        if not path.exists() or json.loads(path.read_text(encoding="utf-8")) != expected:
            raise ValueError("対応検査レポートが原本と一致しません。buildまたはqualityを実行してください")
        return
    path.parent.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False,
                                     prefix=".traceability-", suffix=".tmp", dir=path.parent) as output:
        temp = Path(output.name)
        json.dump(expected, output, ensure_ascii=False, indent=2)
        output.write("\n")
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def build(verify_only: bool = False) -> None:
    version, text = check_source()
    source_sha = sha(text.encode("utf-8"))
    inputs, font = build_inputs()
    inputs_sha = sha(json.dumps(inputs, sort_keys=True).encode())
    with locked():
        items = archives()
        matching = [(pdf, meta) for pdf, meta in items if meta["version"] == version]
        if matching:
            pdf, meta = matching[0]
            if meta["source_sha256"] != source_sha or meta["build_inputs_sha256"] != inputs_sha:
                raise ValueError(f"v{version} は保存済みの内容・生成環境と異なります。文書版と改訂履歴を更新してください")
            pages = validate_pdf(pdf, version, text, source_sha)
            if verify_only:
                latest = DOCS / "design.pdf"
                if not latest.exists() or sha(latest.read_bytes()) != meta["pdf_sha256"]:
                    raise ValueError("最新版PDFが原本の改訂版と一致しません。buildを実行してください")
                traceability(text, verify_only=True)
            else:
                replace_latest(pdf)
                traceability(text)
            print(f"保存済み改訂版を検証・再利用: {pdf.relative_to(ROOT)} ({pages}ページ)")
            return
        if verify_only:
            raise ValueError("現行版の改訂版PDFがありません。buildを実行してください")
        existing_versions = [tuple(map(int, meta["version"].split("."))) for _, meta in items]
        if existing_versions and tuple(map(int, version.split("."))) <= max(existing_versions):
            raise ValueError("新しい版番号は保存済みの最大版番号より大きくしてください")
        now = datetime.now(ZoneInfo("Asia/Tokyo"))
        filename = f"design-v{version}-{now:%Y%m%dT%H%M%S}-JST.pdf"
        with tempfile.TemporaryDirectory(prefix="mobiltracer-docs-") as temp:
            staged = Path(temp) / filename
            render(text, version, source_sha, now.isoformat(timespec="seconds"), font, staged)
            pages = validate_pdf(staged, version, text, source_sha)
            if SOURCE.read_bytes() != text.encode("utf-8"):
                raise ValueError("PDF生成中に原本が変わりました。保存せず終了します。再実行してください")
            meta = {"version": version, "generated_at_jst": now.isoformat(timespec="seconds"),
                    "source": "docs/design.md", "source_sha256": source_sha,
                    "pdf": filename, "pdf_sha256": sha(staged.read_bytes()), "pages": pages,
                    "build_inputs_sha256": inputs_sha, "build_inputs": inputs,
                    "render_environment": {"python": sys.version.split()[0],
                                           "font_sha256": sha(font.read_bytes())},
                    "source_material_sha256": sha((DOCS / "10_22中間発表.pdf").read_bytes())}
            folder = DOCS / "pdf"
            folder.mkdir(exist_ok=True)
            destination = folder / filename
            # Exclusive creation: never overwrite a historical revision.
            with destination.open("xb") as output:
                output.write(staged.read_bytes())
            with destination.with_suffix(".json").open("x", encoding="utf-8") as output:
                output.write(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
            replace_latest(destination)
            traceability(text)
        print(f"PDF生成成功: docs/design.pdf / {destination.relative_to(ROOT)} ({pages}ページ)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "quality", "build", "verify", "preview"])
    parser.add_argument("--output", type=Path, default=Path("/tmp/mobiltracer-pdf-preview"))
    args = parser.parse_args()
    try:
        if args.command == "check":
            check_source()
        elif args.command == "quality":
            _, text = check_source()
            traceability(text)
            print("対応検査レポート: docs/quality/traceability.json（製品テスト結果とは別）")
        elif args.command in ("build", "verify"):
            build(args.command == "verify")
        else:
            import pymupdf
            args.output.mkdir(parents=True, exist_ok=True)
            with pymupdf.open(DOCS / "design.pdf") as pdf:
                for i, page in enumerate(pdf, 1):
                    page.get_pixmap(dpi=100).save(args.output / f"page-{i:03}.png")
            print(f"全ページのプレビュー: {args.output}")
    except Exception as error:
        print(f"文書処理失敗: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
