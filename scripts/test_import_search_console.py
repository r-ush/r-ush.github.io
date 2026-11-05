import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("search_import", Path(__file__).with_name("import-search-console.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class SearchImportTest(unittest.TestCase):
    def setUp(self):
        self.history = {"sourceFile": "old.xlsx", "startDate": "2026-10-01", "endDate": "2026-10-04", "clicks": 3, "impressions": 10,
                        "countries": [{"code": "KR", "clicks": 3}], "daily": {"2026-10-01": 1, "2026-10-04": 2}}
        self.report = {"sourceFile": "new.zip", "exportedOn": "2026-11-05", "daily": {"2026-10-04": 2, "2026-10-05": 0, "2026-10-06": 0, "2026-10-07": 20},
                       "dailyImpressions": {"2026-10-04": 3, "2026-10-05": 4, "2026-10-06": 5, "2026-10-07": 30}}

    def test_csv_zip_is_read_in_memory_without_queries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "export.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("차트.csv", "\ufeff날짜,클릭수,노출\n2026-10-05,0,4\n")
                archive.writestr("국가.csv", "국가,클릭수,노출\n한국,0,4\n")
                archive.writestr("필터.csv", "필터,값\n검색 유형,웹(텍스트 기반)\n")
                archive.writestr("검색어 수.csv", "private search terms")
            sheets = importer.read_sheets(path)
            self.assertEqual(set(sheets), {"차트", "국가", "필터"})
            self.assertEqual(sheets["차트"][1], {"A": "2026-10-05", "B": "0", "C": "4"})

    def test_shorter_report_preserves_older_clicks_and_does_not_add_concurrent_views(self):
        original = copy.deepcopy(self.history)
        merged = importer.merge_history(self.history, self.report, "2026-10-07")
        self.assertEqual(self.history, original)
        self.assertEqual(merged["clicks"], 3)
        self.assertEqual(merged["countries"], original["countries"])
        self.assertEqual(merged["endDate"], "2026-10-06")
        self.assertEqual(merged["daily"]["2026-10-05"], 0)
        self.assertNotIn("2026-10-07", merged["daily"])
        self.assertEqual(merged["impressions"], 19)
        self.assertEqual(importer.merge_history(merged, self.report, "2026-10-07"), merged)

    def test_new_gap_clicks_are_not_assigned_an_invented_country(self):
        self.report["daily"]["2026-10-05"] = 4
        merged = importer.merge_history(self.history, self.report, "2026-10-07")
        self.assertEqual(merged["clicks"], 7)
        self.assertEqual(merged["unknown"], 4)
        self.assertEqual(merged["countries"], self.history["countries"])

    def test_revised_overlap_and_overlapping_baseline_fail(self):
        self.report["daily"]["2026-10-04"] = 3
        with self.assertRaisesRegex(ValueError, "Revised historical clicks"):
            importer.merge_history(self.history, self.report, "2026-10-07")
        self.history["endDate"] = "2026-10-07"
        with self.assertRaisesRegex(ValueError, "overlaps page-view"):
            importer.merge_history(self.history, self.report, "2026-10-07")

    def test_missing_days_are_not_treated_as_confirmed_zero(self):
        del self.report["daily"]["2026-10-05"]
        merged = importer.merge_history(self.history, self.report, "2026-10-07")
        self.assertEqual(merged["endDate"], "2026-10-04")
        self.assertNotIn("2026-10-06", merged["daily"])


if __name__ == "__main__":
    unittest.main()
