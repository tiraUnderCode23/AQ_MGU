#!/usr/bin/env python3
"""Build a pinned original app and retain its notices in the Store .tgz.

The original builder remains byte-for-byte in apps/_sources. The SDK is supplied
by the native Store on the destination unit; this script does not fetch an SDK,
contact a unit, install a package, or alter an original source file.
"""

import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
RECIPES = ROOT / "data/extra-source-builds.json"


def inside(root, relative):
    part = PurePosixPath(relative)
    if part.is_absolute() or ".." in part.parts or "\\" in relative:
        raise ValueError("recipe path must stay inside the source tree")
    result = (root / relative).resolve()
    if result != root.resolve() and root.resolve() not in result.parents:
        raise ValueError("recipe path resolves outside the source tree")
    return result


def retained_package(archive, recipe, source):
    """Retain existing payload bytes and add notices plus packaging provenance."""
    notices = {}
    for relative in recipe["notices"]:
        path = inside(source, relative)
        notices["package/aq-notices/" + relative] = path.read_bytes()
    attribution = {
        "recipe": "aq-original-source-notices/1",
        "id": recipe["id"],
        "version": recipe["version"],
        "repository": recipe["repository"],
        "commit": recipe["commit"],
        "sourceLicense": recipe["source_license"],
        "originalSourceModified": False,
        "sdkSource": "destination unit; not distributed in AQ_MGU",
    }
    with tarfile.open(archive, "r:gz") as original:
        members = original.getmembers()
        names = set()
        for item in members:
            path = PurePosixPath(item.name)
            if path.is_absolute() or ".." in path.parts or "\\" in item.name or not path.parts or path.parts[0] != "package":
                raise ValueError("builder emitted an invalid npm package path")
            if item.name in names:
                raise ValueError("builder emitted duplicate package paths")
            names.add(item.name)
            if not (item.isfile() or item.isdir()):
                raise ValueError("builder emitted an unsupported package member")
            if item.size > 64 * 1024 * 1024:
                raise ValueError("builder emitted an oversized package member")
        member = original.getmember("package/package.json")
        package = json.load(original.extractfile(member))
        if (package.get("name"), package.get("version")) != (recipe["id"], recipe["version"]):
            raise ValueError("builder package identity does not match the reviewed recipe")
        app = json.load(original.extractfile("package/rhmiData/application.json"))["application"]
        declared = sorted({hmi for desc in app.get("uiDescriptions", []) for hmi in desc.get("hmi", [])})
        if declared != sorted(recipe.get("generatedHmi", recipe["mguHmi"])):
            raise ValueError("generated HMI resources do not match the reviewed recipe")
        if not set(recipe["mguHmi"]).issubset(declared):
            raise ValueError("catalog support exceeds the generated HMI resources")
        package["mguHmi"] = recipe["mguHmi"]
        package["requires"] = recipe["requires"]
        if "mguNeeds" in recipe:
            package["mguNeeds"] = list(recipe["mguNeeds"])
        package["aqSourcePackaging"] = attribution
        extra = dict(notices)
        extra["package/package.json"] = (json.dumps(package, ensure_ascii=False, indent=2) + "\n").encode()
        extra["package/aq-notices/SOURCE.json"] = (json.dumps(attribution, indent=2) + "\n").encode()
        fd, temporary = tempfile.mkstemp(prefix="aq-notices-", suffix=".tgz", dir=archive.parent)
        os.close(fd)
        try:
            with tarfile.open(temporary, "w:gz") as output:
                for item in members:
                    if item.name in extra:
                        continue
                    output.addfile(item, original.extractfile(item) if item.isfile() else None)
                for name, data in sorted(extra.items()):
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o644
                    info.mtime = 0
                    output.addfile(info, io.BytesIO(data))
            # Windows cannot replace an archive while its input handle is open.
            # All payload reads are complete before the atomic replacement.
            original.close()
            os.replace(temporary, archive)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_id")
    args = parser.parse_args()
    recipes = json.loads(RECIPES.read_text(encoding="utf-8"))["recipes"]
    matches = [row for row in recipes if row["id"] == args.app_id]
    if len(matches) != 1:
        parser.error("app_id must identify one reviewed source recipe")
    recipe = matches[0]
    source = inside(ROOT, recipe["source_root"])
    manifest = json.loads(inside(source, recipe["app_path"] + "/app.json").read_text(encoding="utf-8"))
    if (manifest["id"], manifest["version"]) != (recipe["id"], recipe["version"]):
        raise ValueError("source manifest identity changed")
    builder = inside(source, recipe.get("builder", "kit/tools/build.py"))
    substitutions = {"id": args.app_id,
                     "app_dir": str(inside(source, recipe["app_path"]))}
    builder_args = [value.format(**substitutions)
                    for value in recipe.get("builder_args", ["{id}"])]
    output = recipe.get("output", "dist/{id}@{version}.tgz")
    archive = inside(source, output.format(id=recipe["id"], version=recipe["version"]))
    environment = os.environ.copy()
    if recipe.get("builder_store_mode"):
        # This original builder has a reviewed SDK-free Store mode. Keep its
        # output inside the declared recipe path so Store's normal collector
        # and the notice wrapper read the very same archive.
        archive.parent.mkdir(parents=True, exist_ok=True)
        environment["MGU_OUT"] = str(archive.parent)
    result = subprocess.run([sys.executable, "-B", str(builder)] + builder_args,
                            cwd=source, env=environment)
    if result.returncode:
        return result.returncode
    retained_package(archive, recipe, source)
    print("AQ packaging: original application retained; source notices and HMI/dependency metadata included")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print("AQ packaging failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
