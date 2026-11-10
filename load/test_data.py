import copy
import unittest

from data import estimate, image, load_config, plan


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
        no_photo = copy.deepcopy(cfg)
        no_photo["photo_percent"] = 0
        stats = estimate(no_photo, plan(no_photo))
        self.assertEqual(stats["photos"], 0)
        self.assertEqual(stats["tables"]["app.records"], stats["tables"]["app.record_versions"])

    def test_all_photo_formats_are_decodable_and_exact_size(self):
        for fmt in ("jpeg", "png", "webp"):
            for size in (1024, 65538, 1 << 20):
                with self.subTest(fmt=fmt, size=size):
                    first = image(fmt, size, 76)
                    self.assertEqual(len(first), size)
                    self.assertEqual(first, image(fmt, size, 76))


if __name__ == "__main__":
    unittest.main()
