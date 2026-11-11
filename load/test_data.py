import copy
import hashlib
import io
import unittest
from unittest import mock

from PIL import Image

from data import estimate, image, load_config, plan, query


class FixtureTests(unittest.TestCase):
    def test_plan_is_reproducible_and_keeps_unapproved_cases_idle(self):
        cfg = load_config("small")
        first = plan(cfg)
        self.assertEqual(first, plan(cfg))
        self.assertNotEqual(first, plan({**cfg, "seed": cfg["seed"] + 1}))
        approved = {row["id"] for row in first["cases"] if row["state"] == "approved"}
        self.assertTrue(approved)
        self.assertLessEqual({row["case"] for row in first["events"]}, approved)
        self.assertLessEqual({row["case"] for row in first["records"]}, approved)
        self.assertEqual(sum(row["state"] == "reserved" for row in first["cases"]), cfg["reserved"])

    def test_estimate_matches_photo_configuration(self):
        cfg = load_config("small")
        first = estimate(cfg, plan(cfg))
        self.assertEqual(first["photo_bytes"], first["photos"] * cfg["photo_bytes"])
        self.assertEqual(first["photos_per_photo_case"], 10)
        self.assertLess(first["photos_per_all_case"], first["photos_per_photo_case"])
        no_photo = copy.deepcopy(cfg)
        no_photo["photo_percent"] = 0
        stats = estimate(no_photo, plan(no_photo))
        self.assertEqual(stats["photos"], 0)
        self.assertEqual(stats["tables"]["app.records"], stats["tables"]["app.record_versions"])

    def test_all_photo_formats_are_decodable_and_exact_size(self):
        for fmt in ("png", "webp"):
            for size in (1024, 65538, 1 << 20):
                with self.subTest(fmt=fmt, size=size):
                    first = image(fmt, size, 76)
                    self.assertEqual(len(first), size)
                    self.assertEqual(first, image(fmt, size, 76))

    def test_smartphone_jpeg_is_exact_reproducible_and_has_exif(self):
        first = image("jpeg", 3_000_000, 76)
        self.assertEqual(len(first), 3_000_000)
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(image("jpeg", 3_000_000, 76)).hexdigest())
        with Image.open(io.BytesIO(first)) as decoded:
            decoded.load()
            self.assertEqual(decoded.size, (4032, 3024))
            self.assertEqual(decoded.format, "JPEG")
            self.assertEqual(decoded.getexif()[36867], "2026:01:01 08:00:00")
            self.assertEqual(decoded.getexif().get_ifd(34853)[1], "N")

    @mock.patch("data.subprocess.run")
    def test_query_sends_more_than_4000_ids_on_stdin_not_argv(self, run):
        run.return_value = mock.Mock(returncode=0, stdout="", stderr="")
        ids = [f"00000000-0000-4000-8000-{index:012d}" for index in range(4001)]
        sql = "COPY requested_cases(id) FROM STDIN;\n" + "\n".join(ids) + "\n\\.\n"
        query(sql)
        args, kwargs = run.call_args
        self.assertNotIn(sql, args[0])
        self.assertEqual(kwargs["input"], sql)


if __name__ == "__main__":
    unittest.main()
