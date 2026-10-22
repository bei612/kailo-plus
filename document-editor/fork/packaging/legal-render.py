"""Write the build values of the legal-notice page (DD-132(7)②).

The Corresponding Source offer (AGPLv3 §13) is the public repository tree at the
source commit of this build: SOURCE_REPOSITORY/tree/<commit>/document-editor.
It is a build fact, not a deployment input.

  legal-render.py TEMPLATE OUTPUT DISPLAY_NAME VERSION SOURCE_COMMIT BUILD_TIME
"""
import html
import re
import sys

# The public Git repository the artifact is built from (build constant).
SOURCE_REPOSITORY = "https://github.com/bei612/kailo-plus"


def source_offer(commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit or ""):
        raise ValueError("the source commit must be a full 40-hex commit id")
    return SOURCE_REPOSITORY + "/tree/" + commit + "/document-editor"


def render(text, name, version, commit, stamp):
    if not name or len(name) > 64 or re.search(r'["<>&{}\\]', name):
        raise ValueError("PLATFORM_DISPLAY_NAME must be 1-64 characters without quotes or markup")
    offer = source_offer(commit)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", stamp):
        raise ValueError("the build time must be UTC YYYY-MM-DDTHH:MM:SS")
    if not re.fullmatch(r"[0-9.]+ build [0-9]+", version):
        raise ValueError("version must be '<version> build <number>'")
    for key, value in (("@BUILD_DISPLAY_NAME@", name), ("@BUILD_VERSION@", version),
                       ("@BUILD_SOURCE@", commit), ("@BUILD_TIME@", stamp), ("@BUILD_SOURCE_OFFER_URL@", offer)):
        if key not in text:
            raise ValueError("template lacks " + key)
        text = text.replace(key, html.escape(value))
    if "@BUILD_" in text or "@RUNTIME" in text:
        raise ValueError("template placeholders are inconsistent")
    return text


def main(argv):
    template, output = argv[0], argv[1]
    with open(template, encoding="utf-8") as stream:
        text = render(stream.read(), *argv[2:])
    with open(output, "w", encoding="utf-8") as stream:
        stream.write(text)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (ValueError, TypeError) as error:
        print("legal notices refused: " + str(error), file=sys.stderr)
        sys.exit(2)
