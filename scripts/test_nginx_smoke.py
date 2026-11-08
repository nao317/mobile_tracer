"""Regression checks for SSR home detection without Docker."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "nginx_smoke", Path(__file__).with_name("nginx-smoke.py")
)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class HomeChecks(unittest.TestCase):
    def test_current_guest_home(self):
        body = ('<main><h1>ホーム</h1><a href="/login">ログイン</a>'
                '<a href="/login?mode=register">新規登録</a></main>'
                '<script src="/assets/app.js"></script>').encode()
        self.assertIn("/assets/app.js", smoke.check_home(body, "text/html").paths)

    def test_hydration_data_does_not_count_as_ssr_content(self):
        body = ('<main></main><script>"ホーム /login /login?mode=register"</script>').encode()
        with self.assertRaises(RuntimeError):
            smoke.check_home(body, "text/html")

    def test_missing_sign_in_links(self):
        with self.assertRaises(RuntimeError):
            smoke.check_home("<main><h1>ホーム</h1></main>".encode(), "text/html")


if __name__ == "__main__":
    unittest.main()
