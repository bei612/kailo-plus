"""Write the build values of the legal-notice page (DD-132(7)②).

  legal-render.py TEMPLATE DISPLAY_NAME VERSION SOURCE_COMMIT BUILD_TIME
"""
import html
import re
import sys


def render(text, name, version, commit, stamp):
    if not name or len(name) > 64 or re.search(r'["<>&{}\\]', name):
        raise ValueError("PLATFORM_DISPLAY_NAME must be 1-64 characters without quotes or markup")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("the source commit must be a full commit id")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", stamp):
        raise ValueError("the build time must be UTC YYYY-MM-DDTHH:MM:SS")
    if not re.fullmatch(r"[0-9.]+ build [0-9]+", version):
        raise ValueError("version must be '<version> build <number>'")
    for key, value in (("@BUILD_DISPLAY_NAME@", name), ("@BUILD_VERSION@", version),
                       ("@BUILD_SOURCE@", commit), ("@BUILD_TIME@", stamp)):
        if key not in text:
            raise ValueError("template lacks " + key)
        text = text.replace(key, html.escape(value))
    if "@BUILD_" in text or "@RUNTIME_SOURCE_OFFER_URL@" not in text:
        raise ValueError("template placeholders are inconsistent")
    return text


def main(argv):
    path = argv[0]
    with open(path, encoding="utf-8") as stream:
        text = render(stream.read(), *argv[1:])
    with open(path, "w", encoding="utf-8") as stream:
        stream.write(text)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, TypeError) as error:
        print("legal notices refused: " + str(error), file=sys.stderr)
        sys.exit(2)
