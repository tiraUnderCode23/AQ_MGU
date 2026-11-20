"""Keep documentation aligned with AQ feeds and original external helpers."""

import json
from pathlib import Path
import re
import unittest
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "COMPONENT_README_INSTALL_MATRIX.md"
ROW = re.compile(r"^\| `([^@`]+)@([^`]+)` \|")
README_LINK = re.compile(r"\[[^]]+\]\(([^)]+)\)")


class ComponentReadmeMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def read(relative):
            return json.loads((ROOT / relative).read_text(encoding="utf-8"))

        cls.source = read("mgu-repo.json")["components"]
        cls.release = read("release/catalog.json")["components"]
        cls.external = read("data/external-store-components.json")
        cls.rows = cls.source + cls.release + cls.external["components"]
        cls.known = {row["id"]: row for row in cls.rows}
        cls.inventory = {row["id"]: row for row in read("data/components.json")["components"]}
        cls.settings = read("data/store-sources.json")
        cls.document = DOC.read_text(encoding="utf-8")
        cls.component_lines = [line for line in cls.document.splitlines() if ROW.match(line)]

    def test_every_source_package_and_external_helper_has_its_exact_version(self):
        self.assertEqual(len(self.rows), len(self.known), "IDs must not overlap between delivery routes")
        documented = [ROW.match(line).groups() for line in self.component_lines]
        self.assertEqual(len(documented), len(self.known))
        self.assertEqual(len({cid for cid, _ in documented}), len(self.known))
        self.assertEqual(dict(documented), {cid: row["version"] for cid, row in self.known.items()})
        self.assertEqual({cid: row["version"] for cid, row in self.inventory.items()}, dict(documented))
        self.assertTrue(self.external["reference_only"])

    def test_each_readme_exists_locally_or_is_the_pinned_original_in_metadata(self):
        for line in self.component_lines:
            cid = ROW.match(line)[1]
            cells = [cell.strip() for cell in line.split("|")[1:-1]]
            with self.subTest(component=cid):
                self.assertEqual(len(cells), 6)
                links = README_LINK.findall(cells[4])
                self.assertEqual(len(links), 1, line)
                target = links[0]
                parsed = urlsplit(target)
                if parsed.scheme:
                    item = self.inventory[cid]
                    self.assertEqual(target, item.get("upstream_readme"), line)
                    self.assertEqual(parsed.scheme, "https")
                    self.assertFalse(parsed.username or parsed.password or parsed.query)
                    parts = parsed.path.strip("/").split("/")
                    if parsed.hostname == "raw.githubusercontent.com":
                        self.assertGreaterEqual(len(parts), 4)
                        repository, commit, filename = "/".join(parts[:2]), parts[2], "/".join(parts[3:])
                    else:
                        self.assertEqual(parsed.hostname, "github.com")
                        self.assertGreaterEqual(len(parts), 5)
                        self.assertEqual(parts[2], "blob")
                        repository, commit, filename = "/".join(parts[:2]), parts[3], "/".join(parts[4:])
                    self.assertEqual(repository, item["source_repository"])
                    self.assertRegex(commit, r"^[0-9a-f]{40}$")
                    self.assertTrue(Path(filename).name.lower().startswith("readme"))
                else:
                    self.assertFalse(parsed.netloc)
                    path = (DOC.parent / parsed.path).resolve()
                    self.assertTrue(path.is_relative_to(ROOT), target)
                    self.assertTrue(path.is_file(), target)
                    self.assertTrue(path.name.lower().startswith("readme"), target)
                    metadata_ref = self.inventory[cid].get("upstream_readme")
                    if metadata_ref:
                        self.assertEqual(path, (ROOT / metadata_ref).resolve())

    def test_hmi_and_minimum_dependencies_match_the_actual_delivery_feeds(self):
        for line in self.component_lines:
            cid = ROW.match(line)[1]
            cells = [cell.strip() for cell in line.split("|")[1:-1]]
            component = self.known[cid]
            with self.subTest(component=cid):
                self.assertEqual(cells[2], "/".join(component.get("mguHmi") or []) or "Not declared")
                requirements = "; ".join(f"{key}>={value}" for key, value in sorted(component.get("requires", {}).items()))
                self.assertEqual(cells[3], requirements or "None declared")
                self.assertTrue(cells[1].startswith(component["kind"] + " / "))
                if component.get("build") == "unit":
                    self.assertIn("unit linker", cells[1])
                if component.get("artifact"):
                    self.assertIn(f"{component['artifact']['size']:,} compressed bytes", cells[1])

    def test_main_readme_uses_the_same_explicit_source_configuration(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        config = re.search(r"```json\n(.*?)\n```", text, flags=re.DOTALL)
        self.assertIsNotNone(config)
        self.assertEqual(json.loads(config[1]), self.settings)
        self.assertIn(self.external["source_id"], {row["id"] for row in self.settings["sources"]})
        self.assertIn("not a live install result", self.document)
        self.assertIn("NOT OBSERVED", self.document)

    def test_gallery_covers_every_app_with_verified_icon_and_assets(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        apps = [row for row in self.inventory.values() if row["kind"] == "app"]
        app_imgs = json.loads((ROOT / "data/app-images.json").read_text(encoding="utf-8"))
        for row in apps:
            cid = row["id"]
            with self.subTest(component=cid):
                self.assertIn(cid, app_imgs)
                icon = app_imgs[cid]["icon"]
                self.assertTrue(icon and (ROOT / icon).is_file(), f"missing icon for {cid}")
                self.assertIn(f'src="{icon}"', text, f"icon not rendered in README for {cid}")
                for img in app_imgs[cid]["images"][:3]:
                    self.assertTrue((ROOT / img).is_file(), f"missing screenshot {img} for {cid}")
                    self.assertIn(f'src="{img}"', text, f"screenshot {img} not rendered in README")
        self.assertGreaterEqual(len(apps), 180)


if __name__ == "__main__":
    unittest.main()
