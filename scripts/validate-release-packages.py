"""Validate WXT production manifests and ZIPs using only the Python standard library."""

import argparse
import hashlib
import json
import re
import stat
import zipfile
from pathlib import Path


ICONS = {str(size): f"icons/icon-{size}.png" for size in (16, 32, 48, 128)}
ROOT_FILES = {"manifest.json", "popup.html", "background.js", "icon.png",
              "icons/icon.png", "branding/watchtower.png", *ICONS.values()}
TEST_MARKERS = (b"TEST_RESET_BACKGROUND_STATE", b"design-system-showcase")


def validate_archive(archive, root, version, browser, build=None):
    with zipfile.ZipFile(archive) as package:
        entries = [entry for entry in package.infolist() if not entry.is_dir()]
        names = [entry.filename for entry in entries]
        assert len(names) == len(set(names)), "Duplicate ZIP entries"
        for entry in entries:
            name = entry.filename
            assert name in ROOT_FILES or re.fullmatch(
                r"(?:chunks/[A-Za-z0-9_-]+\.js|assets/[A-Za-z0-9_-]+\.css)", name
            ), f"Unexpected/development file: {name}"
            assert not stat.S_ISLNK(entry.external_attr >> 16), f"Symlink: {name}"
        assert ROOT_FILES <= set(names), "Missing manifest, icons, branding, or entrypoints"
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["version"] == version, "ZIP manifest version mismatch"
        assert manifest["manifest_version"] == (3 if browser == "chrome" else 2), "Wrong manifest target"
        assert {key: value.removeprefix("/") for key, value in manifest["icons"].items()} == ICONS, "Toolbar icon mapping changed"
        action = "action" if browser == "chrome" else "browser_action"
        assert {key: value.removeprefix("/") for key, value in manifest[action]["default_icon"].items()} == ICONS, "Action icons changed"
        for name in {*ICONS.values(), "icons/icon.png", "icon.png", "branding/watchtower.png"}:
            assert package.read(name) == (root / "public" / name).read_bytes(), f"Asset changed: {name}"
        code = b"\n".join(package.read(name) for name in names if name.endswith((".js", ".html")))
        assert b"watchtower.png" in code, "Popup branding is not referenced"
        assert not any(marker in code for marker in TEST_MARKERS), "Test-only code in production package"
        if build:
            files = {str(path.relative_to(build)).replace("\\", "/") for path in build.rglob("*") if path.is_file()}
            assert set(names) == files, "ZIP differs from production build"
            for name in names:
                assert package.read(name) == (build / name).read_bytes(), f"ZIP/build mismatch: {name}"
        assert package.testzip() is None, "Corrupt ZIP"
    return hashlib.sha256(Path(archive).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", default=".output")
    parser.add_argument("--archives-only", action="store_true")
    args = parser.parse_args()
    root = Path.cwd()
    pkg = json.loads((root / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    version = pkg["version"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Invalid release version"
    assert version == lock["version"] == lock["packages"][""]["version"], "Package/lockfile versions differ"
    assert (root / f"docs/release-notes-{version}.md").is_file(), "Release notes are missing"
    for browser, target in (("chrome", "chrome-mv3"), ("firefox", "firefox-mv2")):
        build = None if args.archives_only else root / ".output" / target
        if build:
            manifest = json.loads((build / "manifest.json").read_text(encoding="utf-8"))
            assert manifest["version"] == version, f"{target} build version mismatch"
        archive = Path(args.archive_dir) / f"pr-tracker-{version}-{browser}.zip"
        digest = validate_archive(archive, root, version, browser, build)
        print(f"{archive}: version={version}, target={target}, sha256={digest}")


if __name__ == "__main__":
    main()
