"""Validate author-maintained requirement relationships without product code."""
from __future__ import annotations

import hashlib
import re

IDENTIFIER = r"(?:FR-[A-Z]\d{2}|NFR-\d{2}|AC-\d{2}|GOAL-\d{3,}|CON-\d{3,}|DD-\d{3,}|OQ-\d{3,})"


def analyze(text: str) -> dict:
    headings = re.findall(rf"^### ({IDENTIFIER}) ([^\n]+)\n(.*?)(?=^##|\Z)", text, re.M | re.S)
    registers = re.findall(r"^\| ((?:CON|DD|OQ)-\d{3,})\s", text, re.M)
    ids = [item[0] for item in headings] + registers
    if len(ids) != len(set(ids)):
        raise ValueError("要件・目標・判断・未決事項のIDが重複しています")
    referenced = set(re.findall(r"\b(?:FR|NFR|AC|GOAL|CON|DD|OQ)-[A-Za-z0-9_-]+", text))
    if referenced - set(ids):
        raise ValueError(f"形式不正または未定義のID: {sorted(referenced - set(ids))}")
    requirements = {key: {"title": title, "body": body} for key, title, body in headings}
    rules = {
        "FR-": ["利用主体", "開始条件", "目的", "動作", "例外", "適用範囲", "優先度", "受入条件", "根拠"],
        "NFR-": ["分類", "要件", "検証方法", "根拠"],
        "AC-": ["条件", "操作", "期待結果", "対応要件"],
        "GOAL-": ["目標", "指標", "基準値", "目標値", "測定方法", "測定期間", "判定責任者", "達成可能性"],
    }
    for prefix, labels in rules.items():
        matching = {key: item for key, item in requirements.items() if key.startswith(prefix)}
        if not matching:
            raise ValueError(f"{prefix} の定義がありません")
        for key, item in matching.items():
            for label in labels:
                if not re.search(rf"^- {label}: \S", item["body"], re.M):
                    raise ValueError(f"{key}: {label} がありません")
    for family in ("CON-", "DD-", "OQ-"):
        if not any(key.startswith(family) for key in registers):
            raise ValueError(f"{family} の台帳がありません")

    families = {name: sorted(key for key in requirements if key.startswith(name + "-"))
                for name in ("FR", "NFR", "AC", "GOAL")}

    def matrix(title: str, sources: list[str], targets: list[str]) -> dict:
        marker = f"### {title}\n"
        if text.count(marker) != 1:
            raise ValueError(f"対応表が欠落・重複しています: {title}")
        block = re.split(r"^##", text.split(marker, 1)[1], maxsplit=1, flags=re.M)[0]
        rows = re.findall(r"^\| ([^|]+) \| ([^|]+) \|$", block, re.M)
        found = {}
        for source, values in rows:
            source = source.strip()
            if source in sources:
                if source in found:
                    raise ValueError(f"対応表の行が重複しています: {source}")
                links = re.findall(IDENTIFIER, values)
                if not links or len(links) != len(set(links)) or set(links) - set(targets):
                    raise ValueError(f"対応表の参照が不正です: {source}")
                found[source] = sorted(links)
        if set(found) != set(sources):
            raise ValueError(f"対応表に未掲載の要件があります: {sorted(set(sources) - set(found))}")
        return found

    fr_ac = matrix("機能要件から受入条件への対応表", families["FR"], families["AC"])
    fr_goal = matrix("機能要件から製品目標への対応表", families["FR"], families["GOAL"])
    nfr_ac = matrix("非機能要件から受入条件への対応表", families["NFR"], families["AC"])
    reverse = {key: [] for key in families["FR"] + families["NFR"]}
    cases = {}
    for ac in families["AC"]:
        body = requirements[ac]["body"]
        values = re.search(r"^- 対応要件: (.+)$", body, re.M)[1]
        refs = re.findall(IDENTIFIER, values)
        if not refs or set(refs) - set(reverse):
            raise ValueError(f"受入条件の対応要件が不正です: {ac}")
        for key in refs:
            reverse[key].append(ac)
        numbers = re.findall(r"^\| (\d+):", body, re.M)
        if numbers != [str(i) for i in range(1, len(numbers) + 1)] or not numbers:
            raise ValueError(f"受入ケース番号の欠落・重複があります: {ac}")
        case_rows = [line for line in body.splitlines() if re.match(r"^\| \d+:", line)]
        if any(len(line.split("|")) != 5 or any(not cell.strip() for cell in line.split("|")[1:-1])
               for line in case_rows):
            raise ValueError(f"受入ケースの前提・操作・期待結果が空欄です: {ac}")
        cases[ac] = len(numbers)
    for key, links in {**fr_ac, **nfr_ac}.items():
        if links != sorted(reverse[key]):
            raise ValueError(f"受入条件と対応表が一致しません: {key}")
    linked_goals = {goal for links in fr_goal.values() for goal in links}
    if linked_goals != set(families["GOAL"]):
        raise ValueError("機能要件につながらない製品目標があります")

    mvp = [key for key in families["FR"]
           if re.search(r"^- 優先度: P0\b", requirements[key]["body"], re.M)]
    version = re.search(r"^文書版: (\d+\.\d+\.\d+)$", text, re.M)
    status = re.search(r"^文書状態: (draft|in-review|approved|superseded)\b", text, re.M)
    if not version or not status:
        raise ValueError("文書の版・状態を確認してください")
    return {
        "schema_version": "MOBILTRACER_REQUIREMENTS_TRACE_V1",
        "source": "docs/design.md", "source_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "document_id": "MT-REQ", "version": version[1],
        "status": status[1], "quality_phase": "Validate",
        "counts": {**{name: len(values) for name, values in families.items()},
                   "CON": len([key for key in registers if key.startswith("CON-")]),
                   "DD": len([key for key in registers if key.startswith("DD-")]),
                   "OQ": len([key for key in registers if key.startswith("OQ-")])},
        "coverage": {"fr_to_ac_pct": 100.0, "fr_to_goal_pct": 100.0, "nfr_to_ac_pct": 100.0,
                     "meaning": "明示された対応の存在率。製品テストの実施・合格率ではない。"},
        "mvp_fr_ids": mvp, "fr_to_ac": fr_ac, "fr_to_goal": fr_goal,
        "nfr_to_ac": nfr_ac, "acceptance_case_counts": cases,
        "product_test_results": "not_executed",
    }
