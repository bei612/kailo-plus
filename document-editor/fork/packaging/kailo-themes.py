"""Generate the editor's Kailo themes from the Kailo token package (DD-132(7)③).

Reads client-kit/embed/kailo-theme-tokens.css (light tokens on the `:root` block
that declares `color-scheme: light`, dark tokens on `:root[data-kailo-theme="dark"]`)
and writes web-apps custom theme files theme-kailo-light.json and
theme-kailo-dark.json (Common.UI.Themes: id, type, colors). The mapping below
is the only place editor variables meet Kailo tokens; colors not mapped keep
the editor's own light/dark defaults (canvas page colour, document content).
Both themes also carry the Kailo UI font stack (`--kailo-font-sans`) as the
editor variable font-family-base (the faces come from kailo-fonts.py).

  python3 kailo-themes.py TOKENS_CSS OUTPUT_DIR
"""
import colorsys
import json
import os
import re
import sys

# editor theme variable -> Kailo token (--kailo-hsl-<token>)
MAPPING = {
    "toolbar-header-document": "sidebar-background",
    "toolbar-header-spreadsheet": "sidebar-background",
    "toolbar-header-presentation": "sidebar-background",
    "toolbar-header-pdf": "sidebar-background",
    "toolbar-header-visio": "sidebar-background",
    "text-toolbar-header-on-background-document": "sidebar-foreground",
    "text-toolbar-header-on-background-spreadsheet": "sidebar-foreground",
    "text-toolbar-header-on-background-presentation": "sidebar-foreground",
    "text-toolbar-header-on-background-pdf": "sidebar-foreground",
    "text-toolbar-header-on-background-visio": "sidebar-foreground",
    "text-toolbar-header": "sidebar-foreground",
    "icon-toolbar-header": "sidebar-foreground",
    "highlight-header-button-hover": "sidebar-accent",
    "highlight-header-button-pressed": "sidebar-active",
    "background-normal": "background",
    "background-toolbar": "card",
    "background-toolbar-additional": "secondary",
    "background-primary-dialog-button": "primary",
    "background-accent-button": "primary",
    "background-notification-popover": "popover",
    "background-contrast-popover": "popover",
    "highlight-button-hover": "accent",
    "highlight-button-pressed": "muted",
    "highlight-button-pressed-hover": "muted",
    "highlight-primary-dialog-button-hover": "ring",
    "highlight-text-select": "ring",
    "border-toolbar": "border",
    "border-divider": "border",
    "border-regular-control": "input",
    "border-preview-hover": "ring",
    "border-preview-select": "ring",
    "border-control-focus": "ring",
    "border-contrast-popover": "border",
    "text-normal": "foreground",
    "text-normal-pressed": "foreground",
    "text-secondary": "muted-foreground",
    "text-tertiary": "muted-foreground",
    "text-link": "primary",
    "text-link-hover": "primary",
    "text-link-active": "primary",
    "text-link-visited": "primary",
    "text-inverse": "primary-foreground",
    "text-contrast-background": "primary-foreground",
    "icon-normal": "foreground",
    "icon-normal-pressed": "foreground",
    "canvas-background": "muted",
    "canvas-page-border": "border",
}
THEMES = {
    "light": {"id": "theme-kailo-light", "name": "Light", "l10n": {"zh": "浅色"}},
    "dark": {"id": "theme-kailo-dark", "name": "Dark", "l10n": {"zh": "深色"}},
}
FONT_SANS = re.compile(r"--kailo-font-sans:\s*([^;]+);")
HSL = re.compile(r"--kailo-hsl-([a-z0-9-]+):\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%\s*;")


class Refused(Exception):
    pass


def blocks(css):
    """Token triplets of the light and the dark block."""
    found = {}
    for selector, body in re.findall(r"(:root[^{]*)\{([^}]*)\}", css):
        selector = selector.strip()
        if selector == ':root[data-kailo-theme="dark"]':
            found["dark"] = dict((m[0], m[1:]) for m in HSL.findall(body))
        elif selector == ":root" and re.search(r"color-scheme:\s*light", body):
            found["light"] = dict((m[0], m[1:]) for m in HSL.findall(body))
    if set(found) != {"light", "dark"}:
        raise Refused("token file must have one light and one dark block")
    return found


def hex_color(triplet):
    h, s, l = (float(v) for v in triplet)
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l / 100.0, s / 100.0)
    return "#{:02x}{:02x}{:02x}".format(*(round(c * 255) for c in (r, g, b)))


def font_stack(css):
    values = {v.strip() for v in FONT_SANS.findall(css)}
    if len(values) != 1 or not re.fullmatch(r"[A-Za-z0-9 ,\"'-]+", next(iter(values))):
        raise Refused("token file must define one plain --kailo-font-sans")
    return values.pop()


def themes(css):
    tokens = blocks(css)
    font = font_stack(css)
    result = {}
    for kind, meta in THEMES.items():
        missing = sorted({t for t in MAPPING.values() if t not in tokens[kind]})
        if missing:
            raise Refused(kind + " tokens missing: " + ",".join(missing))
        result[meta["id"]] = {"name": meta["name"], "l10n": meta["l10n"], "id": meta["id"], "type": kind,
                              "colors": {**{var: hex_color(tokens[kind][token]) for var, token in MAPPING.items()},
                                         "font-family-base": font}}
    return result


def main(argv):
    if len(argv) != 2:
        print("usage: kailo-themes.py TOKENS_CSS OUTPUT_DIR", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as stream:
        generated = themes(stream.read())
    for theme_id, theme in generated.items():
        with open(os.path.join(argv[1], theme_id + ".json"), "w", encoding="utf-8") as out:
            json.dump(theme, out, ensure_ascii=False, indent=2)
            out.write("\n")
    print("generated " + ", ".join(sorted(generated)))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Refused as error:
        print("kailo themes refused: " + str(error), file=sys.stderr)
        sys.exit(2)
