"""The Store's partial source fetch must contain a needed icon generator.

Only original catalog parsing and local file inspection run. No app, icon
generator, SDK, installer, or head-unit process is executed.
"""

import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
PARSE_SELECTION = r"""
const fs = require('fs');
const sources = require('./tools/_sources/mgu-store/native/mgu-updater/js/sources.js');
const document = JSON.parse(fs.readFileSync(0, 'utf8'));
const readFile = (p) => p === 'mgu-repo.json' ? Promise.resolve(Buffer.from(JSON.stringify(document))) :
    fs.promises.readFile(p).catch((error) => {
        if (error.code === 'ENOENT') error.missing = true;
        throw error;
    });
sources.repoCatalog(readFile).then((catalog) => {
    process.stdout.write(JSON.stringify({ skipped: catalog.skipped,
        entries: catalog.components.map((entry) => ({ id: entry.id,
            path: entry.path, script: entry.script, paths: sources.partPaths(entry) })) }));
}).catch((error) => { console.error(error.stack); process.exitCode = 1; });
"""


def parse_selection(document):
    result = subprocess.run(
        ["node", "-e", PARSE_SELECTION],
        input=json.dumps(document), text=True, cwd=ROOT,
        capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def selected(paths, filename):
    """Mirror a path prefix match, without executing a selected file."""
    return paths is None or any(filename == p or filename.startswith(p + "/") for p in paths)


class IconBuildInputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = json.loads((ROOT / "mgu-repo.json").read_text(encoding="utf-8"))
        cls.selection = parse_selection(cls.document)

    def test_icon_fallback_inputs_are_selected_when_source_icon_is_absent(self):
        self.assertEqual(self.selection["skipped"], [])
        for entry in self.selection["entries"]:
            script = entry.get("script") or {}
            python = script.get("python")
            if not python or (ROOT / entry["path"] / "icon.png").is_file():
                continue
            text = (ROOT / python).read_text(encoding="utf-8")
            if '"make_icon.js"' not in text and "'make_icon.js'" not in text:
                continue
            with self.subTest(component=entry["id"]):
                helper = (Path(python).parent / "make_icon.js").as_posix()
                canvas = (Path(python).parent.parent / "runtime/canvas.js").as_posix()
                self.assertIsNotNone(entry["paths"], "Avoid the oversized whole-repo fallback")
                for filename in (helper, canvas):
                    self.assertTrue((ROOT / filename).is_file(), filename)
                    self.assertTrue(selected(entry["paths"], filename),
                                    "Missing icon fallback build input: " + filename)

    def test_omitted_helper_is_not_rescued_by_existing_full_checkout(self):
        # The actual source has no icon. Prove that dropping the helper from
        # its descriptor removes it from the original Store's selected inputs,
        # even though the same file remains present in the full checkout.
        row = next(c for c in self.document["components"] if c["id"] == "sys_monitor")
        if (ROOT / row["path"] / "icon.png").is_file():
            self.skipTest("A committed source icon now makes the fallback unnecessary")
        helper = (Path(row["build"]["python"]).parent / "make_icon.js").as_posix()
        self.assertTrue((ROOT / helper).is_file())
        narrowed = json.loads(json.dumps(row))
        narrowed["build"]["shared"] = [
            p for p in narrowed["build"]["shared"] if p != helper
        ]
        parsed = parse_selection({"schema": 1, "components": [narrowed]})
        self.assertEqual(parsed["skipped"], [])
        self.assertEqual(len(parsed["entries"]), 1)
        self.assertFalse(selected(parsed["entries"][0]["paths"], helper))


if __name__ == "__main__":
    unittest.main()
