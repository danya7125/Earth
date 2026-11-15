import csv
import io
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from .catalog import calculate, catalog_path, ranked, refresh
from .science import COLUMNS


class CatalogTests(SimpleTestCase):
    def catalog(self):
        earth = dict(hostname="Sun", pl_rade="1", pl_bmasse="1", pl_bmassprov="Mass",
                     st_lum="0", st_teff="5780", pl_orbsmax="1", pl_orbeccen="0")
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=COLUMNS)
        writer.writeheader()
        for i in range(55):
            writer.writerow(dict(earth, pl_name=f"Planet {i:02}", pl_orbsmax="1" if i==0 else "0.1"))
        writer.writerow(dict(earth, pl_name="Model", pl_bmassprov="M-R relationship"))
        return buf.getvalue().encode()

    def test_rank_and_zones(self):
        catalog = calculate(self.catalog())
        result = ranked(catalog)
        self.assertEqual((result["total"], result["candidates"], result["count"]), (56,55,50))
        planet = ranked(catalog, "conservative")["data"][0]
        self.assertEqual(planet["esi_interior"], 1)
        self.assertEqual(planet["hz_time_fraction_cons"], 1)
        self.assertIsNone(planet["esi_global"])
        self.assertEqual(ranked(catalog, "optimistic")["count"], 1)

    def test_refresh_and_http(self):
        with tempfile.TemporaryDirectory() as tmp, self.settings(BASE_DIR=Path(tmp)):
            refresh(self.catalog())
            before = catalog_path().read_bytes()
            with self.assertRaises(ValueError):
                refresh(b"error response")
            self.assertEqual(catalog_path().read_bytes(), before)
            self.assertEqual(self.client.get("/api/v1/planets/").json()["count"], 50)
            subset = self.client.get("/api/v1/planets/?zone=optimistic&rank_by=esi_equilibrium_proxy").json()
            self.assertEqual(subset["data"][0]["esi_score"], 1)
            self.assertEqual(self.client.get("/api/v1/planets/?zone=other").status_code, 400)
