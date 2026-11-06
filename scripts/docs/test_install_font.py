import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import install_font


class FontDownloadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / "fonts" / "font.ttc"
        self.data = b"verified-test-font"
        self.digest = patch.object(install_font, "FONT_SHA256", hashlib.sha256(self.data).hexdigest())
        self.digest.start()
        self.addCleanup(self.digest.stop)

    def download(self, command, **kwargs):
        Path(command[command.index("--output") + 1]).write_bytes(self.data)

    def test_valid_cache_is_used_without_network(self):
        self.target.parent.mkdir()
        self.target.write_bytes(self.data)
        with patch.object(install_font.subprocess, "run") as run:
            self.assertFalse(install_font.prepare_font(self.target))
            run.assert_not_called()

    def test_missing_font_is_downloaded_and_verified(self):
        with patch.object(install_font.subprocess, "run", side_effect=self.download):
            self.assertTrue(install_font.prepare_font(self.target))
        self.assertEqual(self.target.read_bytes(), self.data)
        self.assertEqual(list(self.target.parent.iterdir()), [self.target])

    def test_corrupt_cache_is_replaced_after_verification(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"corrupt-cache")
        with patch.object(install_font.subprocess, "run", side_effect=self.download):
            self.assertTrue(install_font.prepare_font(self.target))
        self.assertEqual(self.target.read_bytes(), self.data)

    def test_wrong_download_is_not_installed(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"old-file")
        with patch.object(install_font.subprocess, "run"):
            with self.assertRaises(ValueError):
                install_font.prepare_font(self.target)
        self.assertEqual(self.target.read_bytes(), b"old-file")
        self.assertEqual(list(self.target.parent.iterdir()), [self.target])

    def test_failed_download_is_not_installed(self):
        with patch.object(install_font.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "curl")):
            with self.assertRaises(subprocess.CalledProcessError):
                install_font.prepare_font(self.target)
        self.assertFalse(self.target.exists())
        self.assertEqual(list(self.target.parent.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
