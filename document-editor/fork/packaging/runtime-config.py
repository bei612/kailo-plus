"""Runtime configuration of the Kailo document-editor container (DD-132(3)).

Inputs, all delivered by document-editor/deploy/compose.yaml:
  /etc/kailo-ds/local.json          declarative local.json rendered by
                                    deploy/components/native-config.py (no secret)
  /run/secrets/ds_token_secret      instance-only JWT secret (browser, inbox,
                                    outbox, session)
  /run/secrets/ds_secure_link_secret instance-only cache-file signing secret
                                    (DocService storage.fs.secretString = nginx
                                    $secure_link_secret)
  DS_FRAME_ANCESTORS                exact host origins allowed to frame the editor

Outputs in the /run/kailo-ds tmpfs (root:ds, never printed):
  config/   NODE_CONFIG_DIR: the image default.json and production-linux.json,
            local.json unchanged, local-production-linux.json holding only the
            signing secret (node-config loads it after local.json)
  secrets/token   the JWT secret file local.json points to (DocService reads
                  secret.*.file natively, Common/sources/utils.js getSecretByElem)
  nginx/secure-link.conf, nginx/frame-ancestors.conf
"""
import grp
import json
import os
import pathlib
import pwd
import re
import shutil
import sys
from urllib.parse import urlsplit

RUN = pathlib.Path(os.environ.get("DS_RUNTIME_DIR", "/run/kailo-ds"))
LOCAL = pathlib.Path("/etc/kailo-ds/local.json")
TOKEN_FILE = "/run/kailo-ds/secrets/token"
SECRET = re.compile(r"[A-Za-z0-9._~+/=-]{32,256}")


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def origin(value):
    parts = urlsplit(value)
    require(parts.scheme in ("http", "https") and parts.hostname and not parts.username and not parts.password
            and parts.path == "" and not parts.query and not parts.fragment and value == f"{parts.scheme}://{parts.netloc}"
            and not any(c in value for c in "*;'\"\\ ") and (parts.port is None or 0 < parts.port <= 65535),
            "origin must be an explicit scheme://host[:port]")
    return value


def ancestors(raw):
    values = raw.split()
    require(values and len(values) == len(set(values)), "DS_FRAME_ANCESTORS must list distinct explicit origins")
    for value in values:
        parts = urlsplit(value)
        if parts.scheme == "tauri":  # Desktop main window origin (07 §4.6)
            require(value == f"tauri://{parts.netloc}" and re.fullmatch(r"[a-z0-9.-]+", parts.netloc or ""),
                    "native host origin must be tauri://host")
        else:
            origin(value)
    return values


def invariants(config, required_origin):
    """The fixed DD-132(3) combination, checked again where it is consumed."""
    services = config["services"]["CoAuthoring"]
    token = services["token"]["enable"]
    require(token["browser"] is True and token["request"]["inbox"] is True and token["request"]["outbox"] is True,
            "browser, inbox and outbox tokens must be enabled")
    for kind in ("browser", "inbox", "outbox", "session"):
        require(services["secret"][kind] == {"string": "", "file": TOKEN_FILE}, "token secrets must come from the runtime secret file")
    wopi = config["wopi"]
    require(wopi["enable"] is True and origin(wopi["host"]) == wopi["host"], "wopi.enable and an explicit wopi.host are required")
    direct = config["externalRequest"]["directIfIn"]
    require(direct["jwtToken"] is False and len(direct["allowList"]) == 1, "outbound requests need exactly one WOPI allow-list entry")
    prefix = direct["allowList"][0]
    require(prefix.endswith("/wopi/files/") and origin(prefix[:-len("/wopi/files/")]), "allow-list entry must be <Cells origin>/wopi/files/")
    require(config["externalRequest"]["action"]["allow"] is False, "every other outbound request must be refused")
    rules = services["ipfilter"]["rules"]
    host = urlsplit(prefix).hostname
    require(rules == [{"address": host, "allowed": True}, {"address": "*", "allowed": False}],
            "ipfilter must allow only the Cells host")
    require("storage" not in config or "secretString" not in config["storage"].get("fs", {}),
            "the cache signing secret must not be in the declarative file")
    require(required_origin is None or wopi["host"] == required_origin, "wopi.host differs from the deployment")


def write(path, text, mode, gid):
    temporary = path.with_name("." + path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(text)
    os.chown(temporary, 0, gid)
    os.chmod(temporary, mode)
    os.replace(temporary, path)


def secret(name):
    path = pathlib.Path("/run/secrets") / name
    value = path.read_text(encoding="utf-8").strip()
    require(SECRET.fullmatch(value), name + " must hold 32-256 URL-safe characters")
    return value


def state_directories(uid, gid):
    """The bind-mounted state (deployment DOCUMENT_EDITOR_DATA_DIR) belongs to ds;
    the App_Data layout of run-document-server.sh is created inside it."""
    root = pathlib.Path("/var/lib/onlyoffice")
    info = root.stat()
    require(info.st_uid == uid and not info.st_mode & 0o007, "/var/lib/onlyoffice must belong to ds and not be world-accessible")
    for sub in ("documentserver", "documentserver/App_Data", "documentserver/App_Data/cache",
                "documentserver/App_Data/cache/files", "documentserver/App_Data/docbuilder"):
        path = root / sub
        if not path.exists():
            path.mkdir(mode=0o750)
            os.chown(path, uid, gid)
        require(path.is_dir() and not path.is_symlink() and path.stat().st_uid == uid, str(path) + " must be a ds directory")


def main():
    ds = grp.getgrnam("ds").gr_gid
    state_directories(pwd.getpwnam("ds").pw_uid, ds)
    config = json.loads(LOCAL.read_text(encoding="utf-8"))
    invariants(config, os.environ.get("DS_PUBLIC_ORIGIN") or None)
    frames = ancestors(os.environ.get("DS_FRAME_ANCESTORS", ""))
    token, signing = secret("ds_token_secret"), secret("ds_secure_link_secret")
    require(token != signing, "token and signing secrets must differ")
    for sub, mode in (("config", 0o750), ("secrets", 0o750), ("nginx", 0o700)):
        directory = RUN / sub
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True, mode=mode)
        os.chown(directory, 0, ds if mode == 0o750 else 0)
        os.chmod(directory, mode)
    for name in ("default.json", "production-linux.json"):
        write(RUN / "config" / name, (pathlib.Path("/etc/onlyoffice/documentserver") / name).read_text(encoding="utf-8"), 0o640, ds)
    write(RUN / "config" / "local.json", LOCAL.read_text(encoding="utf-8"), 0o640, ds)
    write(RUN / "config" / "local-production-linux.json",
          json.dumps({"storage": {"fs": {"secretString": signing}}}) + "\n", 0o640, ds)
    write(RUN / "secrets" / "token", token, 0o440, ds)
    write(RUN / "nginx" / "secure-link.conf", "set $secure_link_secret " + signing + ";\n", 0o600, 0)
    write(RUN / "nginx" / "frame-ancestors.conf",
          "add_header Content-Security-Policy \"frame-ancestors 'self' " + " ".join(frames) + "\" always;\n", 0o600, 0)
    print("document-editor runtime configuration ready: invariants hold, "
          f"{len(frames)} frame ancestor(s); no secret value emitted")


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print("document-editor refused to start: " + str(error), file=sys.stderr)
        sys.exit(78)
    except (OSError, KeyError, TypeError, ValueError):
        print("document-editor refused to start: missing or malformed configuration or secret", file=sys.stderr)
        sys.exit(78)
