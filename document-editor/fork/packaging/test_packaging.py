"""Tests of the document-editor packaging helpers (DD-132(7)).

  python3 -I -B -m unittest discover -s document-editor/fork/packaging -p test_packaging.py   (from apps/)
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
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
fonts = load("kailo_fonts", HERE / "kailo-fonts.py")
TOKENS = (ROOT / "client-kit/embed/kailo-theme-tokens.css").read_text(encoding="utf-8")


class Themes(unittest.TestCase):
    def test_both_themes_come_from_the_token_package(self):
        generated = themes.themes(TOKENS)
        self.assertEqual(set(generated), {"theme-kailo-light", "theme-kailo-dark"})
        light, dark = generated["theme-kailo-light"], generated["theme-kailo-dark"]
        self.assertEqual((light["type"], dark["type"]), ("light", "dark"))
        self.assertEqual(set(light["colors"]), set(themes.MAPPING) | set(themes.HEADER_ICONS["light"]) | {"font-family-base"})
        self.assertEqual(set(dark["colors"]), set(themes.MAPPING) | {"font-family-base"})
        # DD-157: dark header glyphs on the light Kailo header, fully opaque.
        self.assertEqual(light["colors"]["button-header-normal-icon-offset-x"], "0")
        self.assertEqual(light["colors"]["header-component-normal-icon-opacity"], "1")
        # Light canvas is Kailo's white background; dark is its content canvas.
        self.assertEqual(light["colors"]["background-normal"], "#ffffff")
        self.assertEqual(dark["colors"]["background-normal"], "#121218")
        for theme in generated.values():
            colors = dict(theme["colors"])
            self.assertEqual(colors.pop("font-family-base"), fonts.font_stack(TOKENS))
            for name in themes.HEADER_ICONS[theme["type"]]:
                colors.pop(name)
            self.assertTrue(all(len(v) == 7 and v.startswith("#") for v in colors.values()))

    def test_a_missing_block_or_token_is_refused(self):
        with self.assertRaises(themes.Refused):
            themes.themes(TOKENS.replace(':root[data-kailo-theme="dark"]', ":root.other"))
        with self.assertRaises(themes.Refused):
            themes.themes(TOKENS.replace("--kailo-hsl-sidebar-background:", "--kailo-hsl-gone:"))

    def test_hsl_conversion(self):
        self.assertEqual(themes.hex_color(("0", "0", "100.0")), "#ffffff")
        self.assertEqual(themes.hex_color(("0", "100", "50")), "#ff0000")


LOCK = (ROOT / "web-client/web/package-lock.json").read_text(encoding="utf-8")
STYLESHEET = """/* inter-latin-wght-normal */
@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url(./files/inter-latin-wght-normal.woff2) format('woff2-variations');
  unicode-range: U+0000-00FF,U+0131,U+2000-206F;
}
"""


def package(stylesheet=STYLESHEET, extra=()):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, data in (("package/wght.css", stylesheet.encode()), ("package/LICENSE", b"SIL OPEN FONT LICENSE Version 1.1"),
                           ("package/files/inter-latin-wght-normal.woff2", b"wOF2\0face")) + tuple(extra):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class Fonts(unittest.TestCase):
    def test_the_web_client_lock_names_the_registry_tarball_and_its_sha512(self):
        url, digest = fonts.locked(LOCK)
        self.assertRegex(url, r"^https://registry\.npmjs\.org/@fontsource-variable/inter/-/inter-[0-9.]+\.tgz$")
        self.assertEqual(len(digest), 64)
        entry = json.loads(LOCK)["packages"]["node_modules/@fontsource-variable/inter"]
        for change in ({"resolved": "https://mirror.example/inter.tgz"}, {"integrity": "sha1-AAAA"}):
            with self.assertRaises(fonts.Refused):
                fonts.locked(json.dumps({"packages": {"node_modules/@fontsource-variable/inter": {**entry, **change}}}))
        with self.assertRaises(fonts.Refused):
            fonts.locked(json.dumps({"packages": {}}))

    def test_only_the_locked_bytes_are_accepted(self):
        data = package()
        self.assertEqual(fonts.verified(data, hashlib.sha512(data).digest()), data)
        with self.assertRaises(fonts.Refused):
            fonts.verified(data + b"x", hashlib.sha512(data).digest())

    def test_the_token_stack_and_the_package_faces_become_the_editor_font(self):
        stack = fonts.font_stack(TOKENS)
        self.assertTrue(stack.startswith('"Inter Variable"'))
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual(fonts.write(out, package(), stack), ["inter-latin-wght-normal.woff2"])
            less = Path(out, "kailo-font.less").read_text(encoding="utf-8")
            self.assertIn("@{common-image-const-path}/../fonts/kailo/inter-latin-wght-normal.woff2", less)
            self.assertIn("unicode-range: U+0000-00FF,U+0131,U+2000-206F;", less)
            self.assertIn("--font-family-base: " + stack + ";", less)
            self.assertEqual(sorted(os.listdir(Path(out, "fonts/kailo"))), ["LICENSE", "inter-latin-wght-normal.woff2"])

    def test_a_package_that_does_not_carry_the_token_family_is_refused(self):
        with tempfile.TemporaryDirectory() as out:
            with self.assertRaises(fonts.Refused):
                fonts.write(out, package(STYLESHEET.replace("'Inter Variable'", "'Other'")), fonts.font_stack(TOKENS))
            with self.assertRaises(fonts.Refused):
                fonts.write(out, package("/* none */"), fonts.font_stack(TOKENS))
        with self.assertRaises(fonts.Refused):
            fonts.font_stack(TOKENS.replace("--kailo-font-sans:", "--kailo-font-gone:"))
        with self.assertRaises(fonts.Refused):
            fonts.font_stack(":root { --kailo-font-sans: x; } .a { --kailo-font-sans: url(evil); }")


TEMPLATE = (HERE / "legal/index.html.template").read_text(encoding="utf-8")
COMMIT = "0123456789abcdef0123456789abcdef01234567"


class Legal(unittest.TestCase):
    def test_build_values_are_written_and_escaped(self):
        page = legal.render(TEMPLATE, "Kailo", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00")
        self.assertNotIn("@BUILD_", page)
        self.assertNotIn("@RUNTIME", page)
        offer = "https://github.com/bei612/kailo-plus/tree/" + COMMIT + "/document-editor"
        self.assertEqual(page.count('href="' + offer + '"'), 2)
        for required in ("Ascensio System SIA", "ONLYOFFICE", "WITHOUT ANY WARRANTY", "LICENSE.txt", "3rd-Party.txt", "Inter-OFL.txt",
                         "CC BY-SA 4.0", COMMIT, "2026-10-22T10:00:00", "Kailo"):
            self.assertIn(required, page)

    def test_unsafe_or_missing_values_are_refused(self):
        for args in (("<b>", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00"), ("Kailo", "9.4.0 build 131", "HEAD", "2026-10-22T10:00:00"),
                     ("Kailo", "9.4.0 build 131", COMMIT, "today"), ("", "9.4.0 build 131", COMMIT, "2026-10-22T10:00:00")):
            with self.assertRaises(ValueError):
                legal.render(TEMPLATE, *args)

    def test_the_source_offer_is_the_repository_tree_at_a_full_commit(self):
        self.assertEqual(legal.source_offer(COMMIT), "https://github.com/bei612/kailo-plus/tree/" + COMMIT + "/document-editor")
        for bad in ("", "HEAD", COMMIT[:12], COMMIT.upper(), COMMIT + "0", "main", COMMIT[:-1] + "g"):
            with self.assertRaises(ValueError):
                legal.source_offer(bad)


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
