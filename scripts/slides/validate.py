"""Validate the exported deck using the existing documentation Python environment."""
import json
from pathlib import Path
import re
import sys

import pymupdf

pdf_path, expected_path = map(Path, sys.argv[1:3])
expected = json.loads(expected_path.read_text())
compact = lambda value: re.sub(r"\s", "", value)
with pymupdf.open(pdf_path) as pdf:
    if len(pdf) != len(expected):
        raise ValueError(f"スライド数が一致しません: {len(pdf)}")
    for i, (page, item) in enumerate(zip(pdf, expected), 1):
        if abs(page.rect.width - 1440) > 1 or abs(page.rect.height - 810) > 1:
            raise ValueError(f"16:9のページ寸法が不正です: p.{i}")
        text = page.get_text()
        if compact(item["title"]) not in compact(text):
            raise ValueError(f"タイトルを抽出できません: p.{i}")
        if "\ufffd" in text or "\x00" in text:
            raise ValueError(f"欠損文字があります: p.{i}")
        missing = set(re.findall(r"[\u3040-\u30ff\u3400-\u9fff]", item["text"])) - set(text)
        if missing:
            raise ValueError(f"日本語文字を抽出できません: p.{i}: {sorted(missing)}")
        if item["paginate"] and f"{i}/{len(pdf)}" not in compact(text):
            raise ValueError(f"ページ番号が不正です: p.{i}")
        for x0, y0, x1, y1, word, *_ in page.get_text("words"):
            if x0 < 0 or y0 < 0 or x1 > 1441 or y1 > 811:
                raise ValueError(f"描画領域を超えています: p.{i}, {word}")
    print(json.dumps({"slides": len(pdf), "text_and_page_numbers": "passed"}))
