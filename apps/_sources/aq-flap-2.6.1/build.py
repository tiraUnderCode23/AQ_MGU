#!/usr/bin/env python3
"""Package the AQFlap module tree with the SDK supplied by the Store build."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
SDK = ROOT / "target-sdk"


def source_files():
    spec = json.loads((ROOT / "SOURCE_FILES.json").read_text(encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if (package.get("name"), package.get("version")) != (spec["id"], spec["version"]):
        raise ValueError("package identity differs from the source inventory")
    result = {}
    for row in spec["files"]:
        name = row["path"]
        parts = PurePosixPath(name).parts
        if (not name or name.startswith("/") or "\\" in name or ":" in name
                or any(p in ("", ".", "..", "node_modules", "target-sdk") for p in parts)):
            raise ValueError("invalid source path: " + name)
        source = ROOT.joinpath(*parts)
        current = source
        while current != ROOT:
            if current.is_symlink():
                raise ValueError("symlink in source path: " + name)
            current = current.parent
        if name in result or not source.is_file():
            raise ValueError("missing or duplicate source file: " + name)
        data = source.read_bytes()
        if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise ValueError("source file differs from its inventory: " + name)
        result[name] = data
    main = package.get("main")
    if main not in result:
        raise ValueError("package main is missing from the source inventory")
    if not any(n.startswith("rhmiData/uiDescriptions/ID7/") for n in result):
        raise ValueError("ID7 RHMI files are missing")
    return package, result


def pack():
    package, files = source_files()
    if not SDK.is_dir() or SDK.is_symlink():
        raise ValueError("target SDK is missing; the Store must populate build.sdk")
    for name in ("index.js", "package.json"):
        source = SDK / name
        if not source.is_file() or source.is_symlink():
            raise ValueError("target SDK is missing " + name)
        files["node_modules/oap-sdk/" + name] = source.read_bytes()
    sdk_package = json.loads(files["node_modules/oap-sdk/package.json"])
    if sdk_package.get("name") != "oap-sdk":
        raise ValueError("target SDK package identity is not oap-sdk")
    output = os.environ.get("MGU_OUT")
    if not output:
        raise ValueError("MGU_OUT is not set")
    out = Path(output)
    out.mkdir(parents=True, exist_ok=True)
    target = out / (package["name"] + "@" + package["version"] + ".tgz")
    with tempfile.NamedTemporaryFile(dir=out, suffix=".part", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with temporary.open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                    for name, data in sorted(files.items()):
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        member.mode = 0o644
                        member.mtime = 0
                        member.uid = member.gid = 0
                        member.uname = member.gname = ""
                        archive.addfile(member, io.BytesIO(data))
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    print(str(target))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check tracked source inputs only")
    args = parser.parse_args()
    if args.check:
        package, files = source_files()
        print(package["name"] + "@" + package["version"] + ": " + str(len(files)) + " source files verified")
    else:
        pack()


if __name__ == "__main__":
    main()

