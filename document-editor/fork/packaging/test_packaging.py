"""Tests of the document-editor packaging helpers (DD-132(7)).

  python3 -I -B -m unittest discover -s document-editor/fork/packaging -p test_packaging.py   (from apps/)
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


themes = load("kailo_themes", HERE / "kailo-themes.py")
legal = load("legal_render", HERE / "legal-render.py")
scan = load("brand_scan", HERE / "brand-scan.py")
runtime = load("runtime_config", HERE / "runtime-config.py")
TOKENS = (ROOT / "client-kit/embed/kailo-theme-tokens.css").read_text(encoding="utf-8")


class Themes(unittest.TestCase):
    def test_both_themes_come_from_the_token_package(self):
        generated = themes.themes(TOKENS)
        self.assertEqual(set(generated), {"theme-kailo-light", "theme-kailo-dark"})
        light, dark = generated["theme-kailo-light"], generated["theme-kailo-dark"]
        self.assertEqual((light["type"], dark["type"]), ("light", "dark"))
        self.assertEqual(set(light["colors"]), set(themes.MAPPING))
        # Light canvas is Kailo's white background; dark is its content canvas.
        self.assertEqual(light["colors"]["background-normal"], "#ffffff")
        self.assertEqual(dark["colors"]["background-normal"], "#1a1a1a")
        for theme in generated.values():
            self.assertTrue(all(len(v) == 7 and v.startswith("#") for v in theme["colors"].values()))

    def test_a_missing_block_or_token_is_refused(self):
        with self.assertRaises(themes.Refused):
            themes.themes(TOKENS.replace(':root[data-kailo-theme="dark"]', ":root.other"))
        with self.assertRaises(themes.Refused):
            themes.themes(TOKENS.replace("--kailo-hsl-sidebar-background:", "--kailo-hsl-gone:"))

    def test_hsl_conversion(self):
        self.assertEqual(themes.hex_color(("0", "0", "100.0")), "#ffffff")
        self.assertEqual(themes.hex_color(("0", "100", "50")), "#ff0000")


TEMPLATE = (HERE / "legal/index.html.template").read_text(encoding="utf-8")
COMMIT = "0123456789abcdef0123456789abcdef01234567"


class Legal(unittest.TestCase):
    def test_build_values_are_written_and_escaped(self):
        page = legal.render(TEMPLATE, "Kailo", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00")
        self.assertNotIn("@BUILD_", page)
        self.assertIn("@RUNTIME_SOURCE_OFFER_URL@", page)
        for required in ("Ascensio System SIA", "ONLYOFFICE", "WITHOUT ANY WARRANTY", "LICENSE.txt", "3rd-Party.txt",
                         "CC BY-SA 4.0", COMMIT, "2026-10-22T10:00:00", "Kailo"):
            self.assertIn(required, page)

    def test_unsafe_or_missing_values_are_refused(self):
        for args in (("<b>", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00"), ("Kailo", "9.4.0 build 131", "HEAD", "2026-10-22T10:00:00"),
                     ("Kailo", "9.4.0 build 131", COMMIT, "today"), ("", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00")):
            with self.assertRaises(ValueError):
                legal.render(TEMPLATE, *args)

    def test_the_runtime_writes_only_an_explicit_source_offer(self):
        self.assertEqual(runtime.source_offer("https://example.org/src/kailo.tar.gz"), "https://example.org/src/kailo.tar.gz")
        for bad in ("", "ftp://example.org/x", "https://example.org/x\"onmouseover=1", "javascript:alert(1)", "https://u:p@example.org/"):
            with self.assertRaises(runtime.Refused):
                runtime.source_offer(bad)


class BrandScan(unittest.TestCase):
    def run_scan(self, files):
        with tempfile.TemporaryDirectory() as root:
            for rel, text in files.items():
                path = Path(root) / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            result = subprocess.run([sys.executable, "-I", str(HERE / "brand-scan.py"), root], capture_output=True, text=True)
            return result.returncode, json.loads(result.stdout.splitlines()[0]), result.stdout

    def test_legal_notices_comments_and_registered_identifiers_pass(self):
        code, report, _ = self.run_scan({
            "web-apps/app.js": "/*\n * Copyright (C) Ascensio System SIA, 2009-2026\n * AGPL\n */\n"
                               "/** only for ONLYOFFICE Docs Enterprise */\nvar a = c.asc_getOnlyOfficeTime(); // see onlyoffice bug\n"
                               "var n = 'http://schemas.onlyoffice.com/x'; dt.setData('onlyoffice', s); var f='ONLYOFFICEFORM';\n",
            "license/LICENSE.txt": "Ascensio System SIA ONLYOFFICE",
            "kailo-legal/index.html": "based on the original ONLYOFFICE software developed by Ascensio System SIA",
            "etc/supervisord.conf": "command=/usr/local/bin/node /var/www/onlyoffice/documentserver/server/x.js",
            "server/package.json": '{"name": "x", "homepage": "https://www.onlyoffice.com"}',
            "web-apps/index.html": "<script>let signature = 'ONLYOFFICEFORM';</script>",
            "server/locale.json": '{"location": "St Helena, Ascension, Tristan da Cunha"}',
            "server/config/default.json": '{"dbName": "onlyoffice", "$id": "urn:onlyoffice:config:superset:1"}',
        })
        self.assertEqual(code, 0)
        self.assertEqual(report["findingFiles"], 0)
        self.assertGreater(report["totals"]["legal"], 0)
        self.assertGreater(report["totals"]["comment"], 0)
        self.assertEqual(set(report["identifiers"]), {"asc_getOnlyOfficeTime", "http://schemas.onlyoffice.com", "onlyoffice", "ONLYOFFICEFORM"})
        self.assertEqual(report["totals"]["path"], 1)

    def test_visible_spellings_links_and_markup_are_findings(self):
        for rel, text in (("a.js", "title = 'ONLYOFFICE Docs';"), ("a.js", "open('https://helpcenter.onlyoffice.com')"),
                          ("a.js", "x = 'OnlyOffice';"), ("index.html", "<title>ONLYOFFICE</title>"),
                          ("en.json", '{"t": "ONLYOFFICE"}'), ("logo.svg", "<svg><title>onlyoffice</title></svg>"),
                          ("index.html", "<!-- onlyoffice note -->"), ("a.css", "/* by Ascensio */"),
                          ("package.json", '{"description": "ONLYOFFICE server"}'), ("a.conf", "x https://onlyoffice.github.io")):
            with self.subTest(rel=rel, text=text):
                code, report, out = self.run_scan({rel: text})
                self.assertEqual(code, 1)
                self.assertEqual(report["findingFiles"], 1)
                self.assertIn("FINDING", out)


if __name__ == "__main__":
    unittest.main()
