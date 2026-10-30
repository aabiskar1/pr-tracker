import importlib.util
import json
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "release_packages", Path(__file__).parents[1] / "scripts/validate-release-packages.py"
)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class ReleasePackagesTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.archive = self.root / "extension.zip"
        self.files = {name: b"asset" for name in validator.ROOT_FILES}
        self.files["background.js"] = b"production"
        self.files["chunks/popup-123.js"] = b"branding/watchtower.png"
        for name in {*validator.ICONS.values(), "icons/icon.png", "icon.png", "branding/watchtower.png"}:
            asset = self.root / "public" / name
            asset.parent.mkdir(parents=True, exist_ok=True)
            asset.write_bytes(self.files[name])

    def write_archive(self, browser="chrome", version="1.0.22"):
        self.files["manifest.json"] = json.dumps({
            "version": version,
            "manifest_version": 3 if browser == "chrome" else 2,
            "icons": validator.ICONS,
            "action" if browser == "chrome" else "browser_action": {"default_icon": validator.ICONS},
        }).encode()
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, data in self.files.items():
                archive.writestr(name, data)

    def validate(self, browser="chrome", build=None):
        return validator.validate_archive(self.archive, self.root, "1.0.22", browser, build)

    def test_both_manifest_targets_and_original_assets(self):
        for browser in ("chrome", "firefox"):
            self.write_archive(browser)
            self.assertEqual(len(self.validate(browser)), 64)

    def test_wrong_version(self):
        self.write_archive(version="1.0.21")
        with self.assertRaisesRegex(AssertionError, "version mismatch"):
            self.validate()

    def test_root_relative_icon_paths(self):
        self.write_archive()
        manifest = json.loads(self.files["manifest.json"])
        manifest["icons"] = {key: "/" + value for key, value in validator.ICONS.items()}
        manifest["action"]["default_icon"] = manifest["icons"]
        self.files["manifest.json"] = json.dumps(manifest).encode()
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, data in self.files.items():
                archive.writestr(name, data)
        self.validate()

    def test_wrong_browser(self):
        self.write_archive("firefox")
        with self.assertRaisesRegex(AssertionError, "manifest target"):
            self.validate()

    def test_development_and_unsafe_paths(self):
        for name in (".env", "tests/fixture.js", "src/main.ts", "assets/popup.js.map", "../outside", "node_modules/x.js"):
            with self.subTest(name=name):
                self.files[name] = b"unwanted"
                self.write_archive()
                with self.assertRaisesRegex(AssertionError, "Unexpected/development"):
                    self.validate()
                del self.files[name]

    def test_missing_toolbar_icon(self):
        del self.files["icons/icon-16.png"]
        self.write_archive()
        with self.assertRaisesRegex(AssertionError, "Missing"):
            self.validate()

    def test_modified_branding(self):
        self.files["branding/watchtower.png"] = b"changed"
        self.write_archive()
        with self.assertRaisesRegex(AssertionError, "Asset changed"):
            self.validate()

    def test_test_only_code(self):
        self.files["background.js"] = b"TEST_RESET_BACKGROUND_STATE"
        self.write_archive()
        with self.assertRaisesRegex(AssertionError, "Test-only"):
            self.validate()

    def test_duplicate_entries(self):
        self.write_archive()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.archive, "a") as archive:
                archive.writestr("background.js", b"duplicate")
        with self.assertRaisesRegex(AssertionError, "Duplicate"):
            self.validate()

    def test_archive_matches_build_bytes(self):
        self.write_archive()
        build = self.root / "build"
        for name, data in self.files.items():
            path = build / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.validate(build=build)
        (build / "background.js").write_bytes(b"different")
        with self.assertRaisesRegex(AssertionError, "ZIP/build mismatch"):
            self.validate(build=build)


if __name__ == "__main__":
    unittest.main()
