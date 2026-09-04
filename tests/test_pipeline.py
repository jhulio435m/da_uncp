import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from download_uncp_datasets import download_resource  # noqa: E402
from uncp_common import clean, normalize_period, sex_for  # noqa: E402
from uncp_db import build_database, row_fingerprint  # noqa: E402


CSV_CONTENT = """FECHA_CORTE,UUID,PERIODO_APLICANDO,ESCUELA,DEPARTAMENTO,PROVINCIA,DISTRITO,SEXO
2026-01-01,persona-1,2026-1,INGENIERIA DE SISTEMAS,JUNIN,HUANCAYO,EL TAMBO,M
2026-01-01,persona-2,2026-1,MEDICINA HUMANA,JUNIN,HUANCAYO,CHILCA,F
"""


class CommonTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(clean("  Ingeniería   de Sistemas "), "INGENIERIA DE SISTEMAS")
        self.assertEqual(normalize_period("2026_1"), "2026-I")
        self.assertEqual(sex_for({"SEXO": "mujer"}), "FEMENINO")

    def test_fingerprint_is_independent_of_column_order(self):
        first = {"UUID": "abc", "ESCUELA": "Sistemas"}
        second = {"ESCUELA": "Sistemas", "UUID": "abc"}
        self.assertEqual(row_fingerprint("postulantes", first), row_fingerprint("postulantes", second))


class DatabaseTests(unittest.TestCase):
    def test_rebuild_is_atomic_and_deduplicates_identical_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            datasets = root / "datasets"
            for folder in ("01-postulantes", "02-postulantes-copia"):
                target = datasets / folder
                target.mkdir(parents=True)
                (target / "datos.csv").write_text(CSV_CONTENT, encoding="utf-8")
            database = root / "uncp.sqlite3"

            first = build_database(database, datasets, root / "manifest-ausente.json")
            second = build_database(database, datasets, root / "manifest-ausente.json")

            self.assertEqual(first["raw_rows"], 4)
            self.assertEqual(first["inserted_records"], 2)
            self.assertEqual(first["duplicate_rows"], 2)
            self.assertEqual(first, second)

            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM academic_records").fetchone()[0], 2)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM imports").fetchone()[0], 2)
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(academic_records)")
            }
            self.assertFalse({"uuid", "fecha_nacimiento", "codigo_estudiante"} & columns)
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM academic_records WHERE subject_token IS NOT NULL"
                ).fetchone()[0],
                0,
            )
            connection.close()


class DownloaderTests(unittest.TestCase):
    def test_download_reuses_the_same_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            target_base = Path(tmp) / "01-descargar"
            response = (b"a,b\n1,2\n", {"Content-Type": "text/csv"}, "https://example.test/data.csv")
            with patch("download_uncp_datasets.fetch", return_value=response):
                first = download_resource("https://example.test/data.csv", target_base)
                second = download_resource("https://example.test/data.csv", target_base)
            self.assertTrue(first[4])
            self.assertFalse(second[4])
            self.assertEqual(first[0], second[0])
            self.assertEqual([path.name for path in Path(tmp).iterdir()], ["01-descargar.csv"])


if __name__ == "__main__":
    unittest.main()
