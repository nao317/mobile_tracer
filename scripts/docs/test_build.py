"""Regression tests for immutable revision handling; no network or real archives."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build
from requirements_check import analyze


class DocumentChecks(unittest.TestCase):
    def test_source_is_valid(self):
        version, _ = build.check_source()
        self.assertRegex(version, r"^\d+\.\d+\.\d+$")

    def test_duplicate_and_unknown_ids_are_rejected(self):
        original = build.SOURCE.read_text()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "design.md"
            for content in [original.replace("### FR-C02", "### FR-C01", 1),
                            original + "\n参照: FR-Z99\n"]:
                path.write_text(content)
                with self.assertRaises(ValueError):
                    build.check_source(path)

    def test_missing_matrix_row_and_inconsistent_reverse_reference_are_rejected(self):
        original = build.SOURCE.read_text()
        line = next(line for line in original.splitlines() if line.startswith('| FR-C02 | AC-'))
        for content in [original.replace(line + '\n', '', 1),
                        original.replace(line, '| FR-C02 | AC-01 |', 1)]:
            with self.assertRaisesRegex(ValueError, '対応表'):
                analyze(content)

    def test_goal_and_case_gaps_are_rejected(self):
        original = build.SOURCE.read_text()
        changes = [
            original.replace('| FR-C02 | GOAL-001、GOAL-002 |', '| FR-C02 | (なし) |', 1),
            original.replace('| 1: レンタカーの貸出案件', '| 2: レンタカーの貸出案件', 1),
            original.replace('| 貸出前記録→提示→貸出→返却比較を行う |', '|  |', 1),
        ]
        for content in changes:
            self.assertNotEqual(content, original)
            with self.assertRaises(ValueError):
                analyze(content)


class RevisionHandling(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        docs = root / "docs"
        docs.mkdir()
        source = docs / "design.md"
        source.write_bytes(build.SOURCE.read_bytes())
        (docs / "10_22中間発表.pdf").write_bytes(b"source material")
        self.docs = docs
        self.source = source
        self.root = root
        self.version, _ = build.check_source(source)
        for key, value in [("ROOT", root), ("DOCS", docs), ("SOURCE", source)]:
            p = patch.object(build, key, value)
            p.start(); self.addCleanup(p.stop)
        p = patch.object(build, "build_inputs", return_value=({"renderer": "fixture"}, root / "font"))
        p.start(); self.addCleanup(p.stop)
        (root / "font").write_bytes(b"font")
        p = patch.object(build, "validate_pdf", return_value=1)
        p.start(); self.addCleanup(p.stop)
        def render(*args):
            args[-1].write_bytes(b"test PDF")
        p = patch.object(build, "render", side_effect=render)
        self.render = p.start(); self.addCleanup(p.stop)

    def bump_version(self):
        major, minor, patch_version = map(int, self.version.split('.'))
        self.source.write_text(self.source.read_text().replace(
            self.version, f'{major}.{minor}.{patch_version + 1}'))

    def test_rebuild_reuses_revision_and_restores_latest(self):
        build.build()
        archives = list((self.docs / "pdf").glob("*.pdf"))
        self.assertEqual(len(archives), 1)
        (self.docs / "design.pdf").write_bytes(b"stale latest")
        build.build()
        self.assertEqual((self.docs / "design.pdf").read_bytes(), archives[0].read_bytes())
        self.assertEqual(len(list((self.docs / "pdf").glob("*.pdf"))), 1)
        self.assertEqual(self.render.call_count, 1)
        build.build(verify_only=True)

    def test_content_change_without_version_bump_fails(self):
        build.build()
        before = (self.docs / "design.pdf").read_bytes()
        self.source.write_text(self.source.read_text() + "\n追記。\n")
        with self.assertRaisesRegex(ValueError, "保存済み"):
            build.build()
        self.assertEqual((self.docs / "design.pdf").read_bytes(), before)
        self.assertEqual(len(list((self.docs / "pdf").glob("*.pdf"))), 1)

    def test_renderer_change_without_version_bump_fails(self):
        build.build()
        with patch.object(build, "build_inputs", return_value=({"renderer": "changed"}, self.root / "font")):
            with self.assertRaisesRegex(ValueError, "保存済み"):
                build.build()

    def test_version_bump_creates_separate_revision(self):
        build.build()
        self.bump_version()
        build.build()
        self.assertEqual(len(list((self.docs / "pdf").glob("*.pdf"))), 2)

    def test_render_failure_preserves_previous_latest_and_history(self):
        build.build()
        before = (self.docs / "design.pdf").read_bytes()
        self.bump_version()
        self.render.side_effect = RuntimeError("injected render failure")
        with self.assertRaisesRegex(RuntimeError, "injected"):
            build.build()
        self.assertEqual((self.docs / "design.pdf").read_bytes(), before)
        self.assertEqual(len(list((self.docs / "pdf").glob("*.pdf"))), 1)

    def test_corrupted_archive_and_missing_latest_are_detected(self):
        build.build()
        (self.docs / "design.pdf").unlink()
        with self.assertRaisesRegex(ValueError, "最新版"):
            build.build(verify_only=True)
        archive = next((self.docs / "pdf").glob("*.pdf"))
        archive.write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "ハッシュ不一致"):
            build.build()

    def test_orphaned_manifest_is_detected(self):
        build.build()
        next((self.docs / "pdf").glob("*.pdf")).unlink()
        with self.assertRaisesRegex(ValueError, "対応するPDF"):
            build.build()

    def test_stale_traceability_report_is_detected(self):
        build.build()
        path = self.docs / 'quality/traceability.json'
        path.write_text('{}')
        with self.assertRaisesRegex(ValueError, '対応検査レポート'):
            build.build(verify_only=True)
        build.build()
        build.build(verify_only=True)


if __name__ == "__main__":
    unittest.main()
