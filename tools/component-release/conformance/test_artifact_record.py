"""CI unit checks of exact source-record selection through the original parser."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("conformance_auto", ROOT / "tools/component-release/conformance-auto.py")
auto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto)


class ArtifactRecord(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "tools").mkdir()
        shutil.copyfile(ROOT / "tools/upstream_manifest.py", self.root / "tools/upstream_manifest.py")
        self.record = self.root / "knowledge/fork/upstream.yaml"
        self.record.parent.mkdir(parents=True)

    def read(self, text):
        self.record.write_text(text)
        return auto.recorded_artifact(self.root, "knowledge", "wanted")

    def test_exact_entry_selected(self):
        self.assertEqual(self.read("artifacts:\n  - name: wanted\n    kind: image\n    artifact_digest: sha256:" + "a" * 64
                                   + "\n  - name: other\n    kind: image\n    artifact_digest: sha256:" + "b" * 64 + "\n"), "sha256:" + "a" * 64)

    def test_missing_digest_cannot_borrow_the_following_artifact(self):
        with self.assertRaises(auto.Refused):
            self.read("artifacts:\n  - name: wanted\n    kind: image\n  - name: other\n    kind: image\n    artifact_digest: sha256:" + "b" * 64 + "\n")

    def test_duplicate_names_refuse(self):
        entry = "  - name: wanted\n    kind: image\n    artifact_digest: sha256:" + "a" * 64 + "\n"
        with self.assertRaises(auto.Refused):
            self.read("artifacts:\n" + entry + entry)

    def test_unrecorded_digest_refuses(self):
        with self.assertRaises(auto.Refused):
            self.read("artifacts:\n  - name: wanted\n    kind: image\n    artifact_digest: none\n")


if __name__ == "__main__":
    unittest.main()
