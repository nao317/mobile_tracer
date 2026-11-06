"""Exercise the documentation workflow's APT step without installing packages."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SystemDependenciesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        folder = Path(self.temp.name)
        self.mirrors = folder / "apt-mirrors.txt"
        self.mirrors.write_text(
            "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
            "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
            "https://security.ubuntu.com/ubuntu/\tpriority:3\n")
        self.calls = folder / "apt-calls.jsonl"
        fakebin = folder / "bin"
        fakebin.mkdir()
        sudo = fakebin / "sudo"
        sudo.write_text('#!/bin/sh\nexec "$@"\n')
        sudo.chmod(0o700)
        apt = fakebin / "apt-get"
        apt.write_text('''#!/usr/bin/env python3
import json, os, sys, time
with open(os.environ['APT_TEST_CALLS'], 'a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
if 'update' in sys.argv:
    if os.environ.get('APT_TEST_FAIL_UPDATE'):
        sys.exit(100)
if os.environ.get('APT_TEST_DELAY_PHASE', 'update') in sys.argv:
    time.sleep(float(os.environ.get('APT_TEST_DELAY', '0')))
''')
        apt.chmod(0o700)
        self.env = {**os.environ, "PATH": str(fakebin) + os.pathsep + os.environ["PATH"],
                    "APT_TEST_CALLS": str(self.calls)}
        workflow = (ROOT / ".github/workflows/docs.yml").read_text()
        step = re.search(
            r"      - name: Install system libraries\n        run: \|\n"
            r"(?P<script>(?: {10}[^\n]*\n|\n)+)", workflow)
        self.assertIsNotNone(step)
        self.script = textwrap.dedent(step["script"]).replace("/etc/apt/apt-mirrors.txt", str(self.mirrors))

    def run_step(self, script=None, **env):
        return subprocess.run(["bash", "-e", "-o", "pipefail"], input=script or self.script,
                              text=True, capture_output=True, env={**self.env, **env}, timeout=5)

    def apt_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_uses_official_fallbacks_without_large_font_package(self):
        result = self.run_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.mirrors.read_text().splitlines(), [
            "https://archive.ubuntu.com/ubuntu/\tpriority:2",
            "https://security.ubuntu.com/ubuntu/\tpriority:3"])
        update, install = self.apt_calls()
        self.assertEqual(update[-1], "update")
        self.assertIn("install", install)
        self.assertNotIn("fonts-noto-cjk", install)
        self.assertIn("fontconfig", install)

    def test_works_when_runner_has_no_mirror_list(self):
        self.mirrors.unlink()
        result = self.run_step()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.apt_calls()), 2)

    def test_update_failure_does_not_continue_to_install(self):
        result = self.run_step(APT_TEST_FAIL_UPDATE="1")
        self.assertEqual(result.returncode, 100)
        self.assertEqual(len(self.apt_calls()), 1)

    def test_slow_transfer_hits_total_deadline(self):
        # Scale down the real workflow deadline; retain GNU timeout's behavior.
        for phase, count in (("update", 1), ("install", 2)):
            with self.subTest(phase=phase):
                self.calls.unlink(missing_ok=True)
                result = self.run_step(self.script.replace(" 5m ", " 0.2s "),
                                       APT_TEST_DELAY="1", APT_TEST_DELAY_PHASE=phase)
                self.assertEqual(result.returncode, 124)
                self.assertEqual(len(self.apt_calls()), count)


if __name__ == "__main__":
    unittest.main()
