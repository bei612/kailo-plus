"""Brand scan of the document-editor artifact (DD-132(7)①, DD-133 §4.7.1).

Searches every text file under the given roots for the upstream product and
publisher names and classifies each hit:

  legal       license files, the /kailo-legal/ notices and comment blocks that are
              copyright or license notices (kept by AGPLv3 §5 and the Additional
              Terms of the pinned LICENSE)
  comment     other source comments shipped inside code bundles (never rendered)
  identifier  the registered code identifiers, document-format namespaces and
              protocol keys below (never rendered; renaming breaks documents or APIs)
  path        installation paths of the official layer (/var/www/onlyoffice, ...)
              in configuration, never served to users
  finding     anything else: the scan exits 1 and lists the files and tokens

Markup, styles, locale data and images (.html .ejs .json .svg .css .less .txt)
get no comment allowance (JSON keeps lower-case configuration keys); display spellings (ONLYOFFICE, OnlyOffice) and
upstream host names are never registered identifiers. In package.json the
homepage/author/repository fields are origin notices (LICENSE Additional
Terms 1) and count as legal.

  python3 brand-scan.py ROOT...
"""
import json
import os
import re
import sys

BRAND = re.compile(r"onlyoffice|ascensio(?!n)", re.I)
TOKEN = re.compile(r"[A-Za-z0-9_$.:/\-]*(?:onlyoffice|ascensio(?!n))[A-Za-z0-9_$.\-]*", re.I)
BLOCK_COMMENT = re.compile(r"/\*.*?\*/|<!--.*?-->", re.S)
LINE_COMMENT = re.compile(r"(?:(?<=[\s;{}(),])|^)//[^\n]*", re.M)
LEGAL_MARKERS = re.compile(r"copyright|\(c\)|licen[cs]e|agpl|gnu affero|all rights reserved|warranty", re.I)
LEGAL_FILES = re.compile(r"(^|/)(LICENSE[^/]*|license\.(?:txt|md|html?)|3rd-Party[^/]*|THIRD[-_]?PARTY[^/]*|NOTICE[^/]*|COPYING[^/]*|AUTHORS[^/]*|[^/]*\.LICENSE\.txt)$")
LEGAL_DIRS = ("/license/", "/kailo-legal/", "/licenses/")
CODE = re.compile(r"\.(js|mjs|cjs)$", re.I)
TEXT = re.compile(r"\.(js|mjs|cjs|json|html?|ejs|css|less|svg|xml|txt|md|conf|tpl|template)$", re.I)

# Registered identifiers: lower-case token (after stripping a member-access
# prefix) -> why it is not user-visible and cannot be renamed.
IDENTIFIERS = {
    "asc_putOnlyOfficeTime": "sdkjs comment model API (document field)",
    "asc_getOnlyOfficeTime": "sdkjs comment model API (document field)",
    "OnlyOfficeTime": "sdkjs comment model field stored in documents",
    "ONLYOFFICEFORM": "PDF form signature written into and read from documents",
    "onlyofficeStyles": "sdkjs style-table identifier",
    "onlyofficeDefaultFont": "sdkjs default-font identifier",
    "onlyoffice_hatch": "sdkjs fill-pattern identifier",
    "onlyoffice_internal_guid": "sdkjs internal GUID key stored in documents",
    "onlyofficeChannel": "sdkjs/web-apps internal message channel name",
    "onlyoffice-spellchecker": "sdkjs spell-checker worker key",
    "http://schemas.onlyoffice.com": "document-format XML namespace (written into documents)",
    "onlyoffice": "lower-case protocol, drag-and-drop or library key",
    "OnlyOfficeStyles": "sdkjs paste-style table identifier",
    "changeOnlyOfficeUrl": "DocService storage helper function",
}
# Constants that also appear outside code bundles: the PDF form signature in
# inline scripts, the format namespace, and lower-case keys in JSON configuration
# (DocService defaults such as the unused SQL names, the config schema id).
MARKUP_IDENTIFIERS = {"ONLYOFFICEFORM", "http://schemas.onlyoffice.com"}
JSON_IDENTIFIERS = MARKUP_IDENTIFIERS | {"onlyoffice"}
PATH = re.compile(r"^(?:\.\./)*(?:/(?:var/www|var/lib|var/log|etc|usr/share|usr/bin)/onlyoffice(?:/|$)|.*document-formats/onlyoffice-docs-formats(?:\.json)?$)")
ORIGIN_FIELDS = re.compile(r'"(?:homepage|author|repository|url)"\s*:\s*"[^"]*(?:onlyoffice|ascensio)[^"]*"', re.I)


def normalise(token):
    """Exact-case identifier: a display spelling (ONLYOFFICE, OnlyOffice) never
    matches a registered key, and a host name stays whole, so an upstream site
    link is a finding unless it is the document-format namespace."""
    token = token.strip(".-$:/")
    if re.search(r"(?:onlyoffice|ascensio)\.[a-z]", token, re.I):
        return "http://schemas.onlyoffice.com" if re.match(r"https?://schemas\.onlyoffice\.com(/|$)", token) else token
    if token in IDENTIFIERS:
        return token
    return re.sub(r"^.*[.:](?=[A-Za-z_$-]*(?:onlyoffice|ascensio))", "", token, flags=re.I)


def scan(path, rel):
    try:
        with open(path, "rb") as stream:
            raw = stream.read(64 << 20)
    except OSError:
        return None
    if b"\0" in raw[:8192]:
        return None
    text = raw.decode("utf-8", "replace")
    if not BRAND.search(text):
        return {}
    if LEGAL_FILES.search(rel) or any(d in path.replace(os.sep, "/") + ("/" if os.path.isdir(path) else "") for d in LEGAL_DIRS):
        return {"legal": len(BRAND.findall(text))}
    result = {}
    code = bool(CODE.search(rel))

    def strip(match):
        body = match.group(0)
        if not BRAND.search(body):
            return body
        kind = "legal" if LEGAL_MARKERS.search(body) else ("comment" if code else None)
        if kind is None:
            return body
        result[kind] = result.get(kind, 0) + len(BRAND.findall(body))
        return " " * len(body)
    if os.path.basename(rel) == "package.json":
        def origin(match):
            result["legal"] = result.get("legal", 0) + 1
            return " " * len(match.group(0))
        text = ORIGIN_FIELDS.sub(origin, text)
    remaining = BLOCK_COMMENT.sub(strip, text)
    if code:
        remaining = LINE_COMMENT.sub(strip, remaining)
    for token in TOKEN.findall(remaining):
        key = normalise(token)
        if PATH.match(token.rstrip(".")):
            category = "path"
        elif key in IDENTIFIERS and (code or key in (JSON_IDENTIFIERS if rel.endswith(".json") else MARKUP_IDENTIFIERS)):
            category = "identifier:" + key
        else:
            index = remaining.find(token)
            category = "finding:" + token[:80] + " | " + re.sub(r"\s+", " ", remaining[max(0, index - 40):index + len(token) + 40])
        result[category] = result.get(category, 0) + 1
    return result


def main(roots):
    totals, findings, identifiers = {}, {}, {}
    for root in roots:
        for directory, _, names in os.walk(root):
            for name in names:
                path = os.path.join(directory, name)
                rel = os.path.relpath(path, root)
                if os.path.islink(path) or not (TEXT.search(name) or LEGAL_FILES.search(rel)):
                    continue
                for category, count in (scan(path, rel) or {}).items():
                    group, _, detail = category.partition(":")
                    totals[group] = totals.get(group, 0) + count
                    if group == "identifier":
                        identifiers[detail] = identifiers.get(detail, 0) + count
                    if group == "finding":
                        findings.setdefault(path, []).append(detail)
    print(json.dumps({"totals": totals, "identifiers": identifiers, "findingFiles": len(findings)}, sort_keys=True))
    for path, details in sorted(findings.items())[:300]:
        print("FINDING", path, sorted(set(details))[:5])
    return 1 if findings else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: brand-scan.py ROOT...", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
