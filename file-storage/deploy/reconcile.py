#!/usr/bin/env python3
"""Declarative native Cells configuration needed by the governed file_storage@2
actions (design 18, 08 §4, 07 §2.6, DD-124). Run by start.sh after the
independent Cells service is healthy; every step is idempotent, read back and
fails closed. Only original native admin entries are used:

  REST /a/config/versioning, /a/config/datasource/{Name} (read only),
       /a/user-meta/namespace, /a/config/frontend/plugin/meta.user,
       /a/tree/admin/stat, /a/workspace, /a/acl, /a/user/{Login}
  CLI  cells admin user token (short-lived admin PAT, never printed)
       cells admin file mkdir (binding root folder in the admin tree)

No SQL, no config-store file edit, no credential or token is printed.

The binding datasource is not created here: the running server holds the
configuration and the vault in memory and rewrites both files whole on every
save (common/config/file/opener_file.go, no reload), so a datasource created
through the running server was saved with a configuration predating the
post-start key verification (resurrecting a cleared previous credential), the
REST handler gave it a new vault entry and moved its object service onto it
(desynchronising the other datasources), and it was only served after a
restart. The image entrypoint creates it before the server starts
(cells admin datasource ensure, CELLS_BINDING_DATASOURCE and
CELLS_BINDING_VERSIONING_POLICY passed to the container), like the install
creates the default datasources; this script reads it back.

Why each item is required (verified in this fork):
  draft mode   idm/meta/client.go fromNodeMeta/fromAmzHeaders map Draft-Mode to
               USERMETA_DRAFT_NAMESPACE only when USERMETA_DRAFT_API is true
               (frontend/plugin/meta.user; frontend/assets/meta.user/manifest.xml
               defaults it off). A namespace that does not exist is silently
               ignored, so it must exist, be boolean and be writable.
  versioning   data/versions/init.go PolicyForNode: a datasource without a
               versioning policy keeps no revisions; governed draft promote and
               list_revisions need them. Set when the entrypoint creates the
               datasource; an existing datasource with another policy is
               refused there (the Cells console changes it and versions the
               existing files).
  workspace    the binding's nativeScopeRef/nativeRootRef. A datasource root
               (DATASOURCE:<ds>) is not a node UUID (common/nodes/uuid
               handler-uuid-workspace.go resolves node UUIDs only against real
               roots; the adapter refuses DATASOURCE: roots), so the workspace is
               rooted on a real folder <datasource>/<folder>. A datasource that
               already roots another workspace (stock common-files on pydiods1)
               would expose the binding root through that workspace's paths, so
               it is refused.

  python3 -I reconcile.py --check
  python3 -I reconcile.py --container <cells container id> -- <docker argv...>

Environment (controlled deploy env; deploy/components/file-storage.env.template):
  CELLS_EXTERNAL                    native origin (REST under /a/)
  CELLS_INSTALL_FILE                install JSON; only frontendLogin is read
  CELLS_START_TIMEOUT_SECONDS       overall deadline
  CELLS_DRAFT_NAMESPACE             boolean usermeta-* namespace for Draft Mode
  CELLS_BINDING_DATASOURCE          datasource holding the binding root
                                    (created LOCAL flat beside the existing
                                    local datasources by the entrypoint)
  CELLS_BINDING_VERSIONING_POLICY   existing versioning policy id (e.g. keep-all)
  CELLS_BINDING_ROOT_FOLDER         folder name directly under that datasource
  CELLS_BINDING_WORKSPACE_SLUG      binding workspace slug
  CELLS_BINDING_WORKSPACE_LABEL     binding workspace label
  CELLS_BINDING_PRINCIPALS          space separated <login>:r|rw native users
                                    granted on the binding root (exactly these)
  CELLS_BINDING_SERVICE_LOGIN       optional: native user behind cells_bearer
                                    (one of the principals)
  CELLS_BINDING_FACTS_FILE          owner-only output: nativeScopeRef,
                                    nativeRootRef and the principals' UUIDs
  CELLS_NATIVE_ACTION_CONFIG_FILE   optional: delivered native action config is
                                    cross-checked against the facts
"""
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

NAMESPACE = re.compile(r"usermeta-[a-z0-9][a-z0-9-]{0,62}")
DATASOURCE = re.compile(r"[a-z0-9]{1,33}")
# Native datasources whose role is fixed by the installation.
RESERVED_DATASOURCES = {"personal", "cellsdata", "versions", "thumbnails"}
POLICY = re.compile(r"[A-Za-z0-9_-]{1,128}")
FOLDER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,62}")
LOGIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@-]{0,127}")
TOKEN = re.compile(r"[A-Za-z0-9._~+/=-]{20,2048}")
WORKSPACE_ROOT_ACTION = "workspace-path"


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def canonical_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value and uuid.UUID(value).int != 0
    except ValueError:
        return False


def owner_only(path, label):
    path = pathlib.Path(path)
    require(path.is_absolute(), label + ": absolute path required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077, label + ": owner-only regular file required")
        return stream.read(1 << 20).decode("utf-8")


def settings(env):
    """Validated, non-secret settings. Raises Refused without echoing values."""
    s = {}
    origin = urllib.parse.urlsplit(env["CELLS_EXTERNAL"])
    require(origin.scheme in ("http", "https") and origin.hostname and not origin.username and not origin.password
            and origin.path in ("", "/") and not origin.query and not origin.fragment, "CELLS_EXTERNAL: native origin required")
    s["rest"] = f"{origin.scheme}://{origin.netloc}/a/"
    install = json.loads(owner_only(env["CELLS_INSTALL_FILE"], "CELLS_INSTALL_FILE"))
    require(isinstance(install, dict) and isinstance(install.get("frontendLogin"), str) and LOGIN.fullmatch(install["frontendLogin"]),
            "CELLS_INSTALL_FILE: native admin login required")
    s["admin"] = install["frontendLogin"]
    timeout = int(env["CELLS_START_TIMEOUT_SECONDS"])
    require(timeout > 0, "CELLS_START_TIMEOUT_SECONDS: positive deadline required")
    s["timeout"] = timeout
    s["namespace"] = env["CELLS_DRAFT_NAMESPACE"]
    require(NAMESPACE.fullmatch(s["namespace"]), "CELLS_DRAFT_NAMESPACE: usermeta-<lowercase name> required")
    s["datasource"] = env["CELLS_BINDING_DATASOURCE"]
    require(DATASOURCE.fullmatch(s["datasource"]) and s["datasource"] not in RESERVED_DATASOURCES,
            "CELLS_BINDING_DATASOURCE: lowercase alphanumeric name of a content datasource required")
    s["policy"] = env["CELLS_BINDING_VERSIONING_POLICY"]
    require(POLICY.fullmatch(s["policy"]), "CELLS_BINDING_VERSIONING_POLICY: versioning policy id required")
    s["folder"] = env["CELLS_BINDING_ROOT_FOLDER"]
    require(FOLDER.fullmatch(s["folder"]) and s["folder"] not in (".", ".."), "CELLS_BINDING_ROOT_FOLDER: one folder name required")
    s["slug"] = env["CELLS_BINDING_WORKSPACE_SLUG"]
    require(SLUG.fullmatch(s["slug"]), "CELLS_BINDING_WORKSPACE_SLUG: lowercase slug required")
    s["label"] = env["CELLS_BINDING_WORKSPACE_LABEL"]
    require(s["label"].strip() == s["label"] != "" and len(s["label"]) <= 200 and s["label"].isprintable(),
            "CELLS_BINDING_WORKSPACE_LABEL: printable label required")
    principals = []
    for item in env.get("CELLS_BINDING_PRINCIPALS", "").split():
        login, _, rights = item.rpartition(":")
        require(LOGIN.fullmatch(login) and rights in ("r", "rw"), "CELLS_BINDING_PRINCIPALS: <login>:r|rw entries required")
        require(login not in [p[0] for p in principals], "CELLS_BINDING_PRINCIPALS: duplicate login")
        principals.append((login, rights))
    s["principals"] = principals
    s["service"] = env.get("CELLS_BINDING_SERVICE_LOGIN", "")
    require(s["service"] == "" or s["service"] in [p[0] for p in principals],
            "CELLS_BINDING_SERVICE_LOGIN must be one of CELLS_BINDING_PRINCIPALS")
    facts = pathlib.Path(env["CELLS_BINDING_FACTS_FILE"])
    require(facts.is_absolute() and facts.parent.is_dir() and facts.parent == facts.parent.resolve()
            and not stat.S_IMODE(facts.parent.stat().st_mode) & 0o077 and not facts.is_symlink(),
            "CELLS_BINDING_FACTS_FILE: path in an existing owner-only (0700) real directory required")
    for key in ("CELLS_DATA_DIR", "CELLS_DB_DATA_DIR"):
        if env.get(key):
            data = pathlib.Path(env[key]).resolve()
            require(data != facts.parent and data not in facts.parent.parents, "CELLS_BINDING_FACTS_FILE must be outside native state")
    s["facts"] = facts
    s["native"] = env.get("CELLS_NATIVE_ACTION_CONFIG_FILE", "")
    return s


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Native:
    """Original Cells REST v1 with a bearer; errors carry method, path, status."""

    def __init__(self, base, token, timeout=30):
        self.base, self.token, self.timeout = base, token, timeout
        self.opener = urllib.request.build_opener(NoRedirect)

    def call(self, method, path, body=None, missing=False):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Authorization", "Bearer " + self.token)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8 << 20)
        except urllib.error.HTTPError as error:
            error.close()
            if missing and error.code == 404:
                return None
            raise Refused(f"{method} /a/{path.split('?')[0]}: native HTTP {error.code}") from None
        except (urllib.error.URLError, OSError):
            raise Refused(f"{method} /a/{path.split('?')[0]}: native service unreachable") from None
        try:
            return json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise Refused(f"{method} /a/{path.split('?')[0]}: native answer is not JSON") from None


class Cli:
    """The original Cells CLI inside the running container (docker exec)."""

    def __init__(self, docker, container):
        self.docker, self.container = list(docker), container

    def run(self, args, timeout):
        try:
            result = subprocess.run(self.docker + ["exec", self.container, "cells"] + args, stdin=subprocess.DEVNULL,
                                    capture_output=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return 1, ""
        return result.returncode, result.stdout.decode("utf-8", "replace")

    def token(self, login, seconds):
        code, out = self.run(["admin", "user", "token", "-u", login, "-e", f"{seconds}s", "-q"], 180)
        candidates = [line.strip() for line in out.splitlines() if TOKEN.fullmatch(line.strip())]
        require(code == 0 and len(candidates) == 1, "native admin token could not be minted")
        return candidates[0]

    def mkdir(self, path, login):
        code, _ = self.run(["admin", "file", "mkdir", "--path", path, "--user", login], 180)
        return code == 0


def wait_ready(native, deadline):
    while True:
        try:
            native.call("GET", "config/versioning")
            native.call("GET", "user-meta/namespace")
            return
        except Refused:
            if time.monotonic() >= deadline:
                raise
            time.sleep(5)


def ensure_datasource(native, s):
    """Read back the binding datasource the entrypoint created before start."""
    policies = native.call("GET", "config/versioning").get("Policies") or []
    require(any(p.get("Uuid") == s["policy"] for p in policies), "versioning policy is not defined in this instance")
    observed = native.call("GET", "config/datasource/" + s["datasource"], missing=True)
    require(observed is not None and observed.get("Name") == s["datasource"],
            "binding datasource does not exist: the image entrypoint creates it before start (cells admin datasource ensure); redeploy with CELLS_BINDING_DATASOURCE passed to the container")
    require(observed.get("StorageType", "LOCAL") == "LOCAL" and observed.get("FlatStorage") is True and not observed.get("Disabled"),
            "binding datasource must be an enabled LOCAL flat datasource")
    require(observed.get("VersioningPolicyName") == s["policy"],
            "binding datasource has another versioning policy; change it in the Cells console (it also versions the existing files)")


def namespace_ok(ns):
    try:
        definition = json.loads(ns.get("JsonDefinition") or "{}")
    except ValueError:
        return False
    writable = any(p.get("Action") == "WRITE" and p.get("Effect") == "allow" and p.get("Subject") == "*" for p in ns.get("Policies") or [])
    return isinstance(definition, dict) and definition.get("type") == "boolean" and writable


def ensure_draft_mode(native, s, changes):
    def listed():
        return {n.get("Namespace"): n for n in native.call("GET", "user-meta/namespace").get("Namespaces") or []}
    ns = listed().get(s["namespace"])
    if ns is None:
        native.call("PUT", "user-meta/namespace", {"Operation": "PUT", "Namespaces": [{
            "Namespace": s["namespace"], "Label": "Kailo draft", "Order": 0, "Indexable": False,
            "JsonDefinition": json.dumps({"type": "boolean"}),
            "Policies": [{"Action": "READ", "Subject": "*", "Effect": "allow"},
                         {"Action": "WRITE", "Subject": "*", "Effect": "allow"}]}]})
        changes.append("draft namespace created")
        ns = listed().get(s["namespace"])
    # An existing namespace of another type or policy is never rewritten.
    require(ns is not None and namespace_ok(ns), "draft namespace must be a boolean usermeta namespace writable by every user")
    path = "config/frontend/plugin/meta.user"

    def params():
        raw = native.call("GET", path).get("Data") or ""
        value = json.loads(raw) if raw.strip() not in ("", "null") else {}
        require(isinstance(value, dict), "meta.user plugin parameters are not an object")
        return value
    current = params()
    if current.get("USERMETA_DRAFT_API") is not True or current.get("USERMETA_DRAFT_NAMESPACE") != s["namespace"]:
        # The original handler replaces the whole map: send it back merged.
        merged = dict(current, USERMETA_DRAFT_API=True, USERMETA_DRAFT_NAMESPACE=s["namespace"])
        native.call("PUT", path, {"FullPath": "frontend/plugin/meta.user", "Data": json.dumps(merged)})
        changes.append("meta.user draft API enabled")
    current = params()
    require(current.get("USERMETA_DRAFT_API") is True and current.get("USERMETA_DRAFT_NAMESPACE") == s["namespace"],
            "meta.user draft parameters read-back differs")


def admin_stat(native, path):
    try:
        found = native.call("POST", "tree/admin/stat", {"Node": {"Path": path}}, missing=True)
    except Refused:
        # Absence may surface as another native status; mkdir decides.
        return None
    return None if found is None else found.get("Node")


def ensure_root(native, cli, s, deadline, changes):
    path = f"{s['datasource']}/{s['folder']}"
    existed = admin_stat(native, path) is not None
    # The native mkdir only creates a missing folder and refuses a file; a
    # just-created datasource needs its sync/index services first.
    while not cli.mkdir(path, s["admin"]):
        require(time.monotonic() < deadline, "binding root folder could not be ensured before the deadline")
        time.sleep(5)
    if not existed:
        changes.append("binding root folder created")
    node = admin_stat(native, path)
    require(node is not None and node.get("Type") == "COLLECTION" and canonical_uuid(node.get("Uuid"))
            and node.get("Path", "").strip("/") == path, "binding root must be a folder with a node UUID")
    return path, node["Uuid"]


def root_acls(native, s, root):
    query = {"Queries": [{"Actions": [{"Name": WORKSPACE_ROOT_ACTION}], "NodeIDs": ["DATASOURCE:" + s["datasource"], root]}]}
    return native.call("POST", "acl", query).get("ACLs") or []


def ensure_workspace(native, s, path, root, changes):
    def search():
        found = native.call("POST", "workspace", {"Queries": [{"slug": s["slug"]}], "ResourcePolicyQuery": {"Type": "ANY"}})
        return [w for w in found.get("Workspaces") or [] if w.get("Slug") == s["slug"]]
    found = search()
    if not found:
        foreign = {a.get("WorkspaceID") for a in root_acls(native, s, root)}
        require(not foreign, "another workspace is rooted on the binding datasource or folder; refusing to share its root")
        native.call("PUT", "workspace/" + s["slug"], {
            "Slug": s["slug"], "Label": s["label"], "Description": "Kailo FILE_STORAGE binding root",
            "Scope": "ADMIN", "Attributes": json.dumps({"DEFAULT_RIGHTS": "", "QUOTA": "0"}),
            "RootNodes": {root: {"Uuid": root, "Path": path}}})
        changes.append("binding workspace created")
        found = search()
    require(len(found) == 1 and canonical_uuid(found[0].get("UUID")), "binding workspace could not be read back")
    workspace = found[0]
    require(set((workspace.get("RootNodes") or {}).keys()) == {root},
            "binding workspace exists with another root; it is never re-rooted automatically")
    foreign = {a.get("WorkspaceID") for a in root_acls(native, s, root)} - {workspace["UUID"]}
    require(not foreign, "another workspace is rooted on the binding datasource or folder")
    return workspace["UUID"]


def ensure_principals(native, s, workspace, root, changes):
    wanted, users = set(), []
    for login, rights in s["principals"]:
        user = native.call("GET", "user/" + urllib.parse.quote(login, safe=""), missing=True)
        require(isinstance(user, dict) and user.get("Login") == login and canonical_uuid(user.get("Uuid")),
                f"native user {login} does not exist")
        users.append({"login": login, "userUuid": user["Uuid"], "rights": rights})
        wanted |= {(user["Uuid"], "read")} | ({(user["Uuid"], "write")} if rights == "rw" else set())

    def existing():
        query = {"Queries": [{"WorkspaceIDs": [workspace], "NodeIDs": [root], "Actions": [{"Name": "read"}, {"Name": "write"}]}]}
        acls = native.call("POST", "acl", query).get("ACLs") or []
        return {(a.get("RoleID") or "", (a.get("Action") or {}).get("Name"))
                for a in acls if a.get("WorkspaceID") == workspace and a.get("NodeID") == root}
    present = existing()
    for role, name in sorted(wanted - present):
        native.call("PUT", "acl", {"NodeID": root, "WorkspaceID": workspace, "RoleID": role, "Action": {"Name": name, "Value": "1"}})
        changes.append(f"{name} granted")
    for role, name in sorted(present - wanted):
        native.call("POST", "acl/bulk/delete", {"NodeID": root, "WorkspaceID": workspace, "RoleID": role, "Action": {"Name": name, "Value": "1"}})
        changes.append(f"{name} removed from an undeclared role")
    require(existing() == wanted, "binding root grants read-back differs from CELLS_BINDING_PRINCIPALS")
    return users


def cross_check_native(native, s, facts, path):
    if not s["native"]:
        return
    delivery = json.loads(owner_only(s["native"], "CELLS_NATIVE_ACTION_CONFIG_FILE"))
    require(isinstance(delivery, dict) and delivery.get("nativeScopeRef") == facts["nativeScopeRef"],
            "delivered native action nativeScopeRef is not the binding workspace")
    if delivery.get("nativeRootRef") != facts["nativeRootRef"]:
        found = native.call("POST", "tree/admin/stat", {"Node": {"Uuid": delivery.get("nativeRootRef")}}, missing=True) or {}
        inner = (found.get("Node") or {}).get("Path", "").strip("/")
        require(inner.startswith(path + "/"), "delivered native action nativeRootRef is outside the binding root")
    by_uuid = {p["userUuid"]: p for p in facts["principals"]}
    require(delivery.get("instanceServiceUuid") in by_uuid, "delivered instanceServiceUuid is not a declared principal")
    require(not s["service"] or by_uuid[delivery["instanceServiceUuid"]]["login"] == s["service"],
            "delivered instanceServiceUuid is not CELLS_BINDING_SERVICE_LOGIN")
    for actor in delivery.get("actors") or []:
        require(by_uuid.get(actor.get("userUuid"), {}).get("rights") == "rw", "a delivered actor is not a declared rw principal")


def write_facts(path, facts):
    temporary = path.with_name("." + path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(json.dumps(facts, indent=2, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def refuse_shared_datasource(native, s):
    # Checked before any change: the binding workspace is rooted on a folder,
    # never on the datasource root, so any root ACL there is another workspace.
    query = {"Queries": [{"Actions": [{"Name": WORKSPACE_ROOT_ACTION}], "NodeIDs": ["DATASOURCE:" + s["datasource"]]}]}
    require(not native.call("POST", "acl", query).get("ACLs"),
            "another workspace is rooted on the binding datasource; its paths would expose the binding root")


def reconcile(s, native, cli, deadline):
    changes = []
    wait_ready(native, deadline)
    refuse_shared_datasource(native, s)
    ensure_datasource(native, s)
    ensure_draft_mode(native, s, changes)
    path, root = ensure_root(native, cli, s, deadline, changes)
    workspace = ensure_workspace(native, s, path, root, changes)
    users = ensure_principals(native, s, workspace, root, changes)
    facts = {"component": "file-storage", "nativeScopeRef": workspace, "nativeRootRef": root,
             "workspaceSlug": s["slug"], "rootPath": path, "datasource": s["datasource"],
             "versioningPolicy": s["policy"], "draftNamespace": s["namespace"], "principals": users}
    if s["service"]:
        facts["instanceServiceUuid"] = next(u["userUuid"] for u in users if u["login"] == s["service"])
    cross_check_native(native, s, facts, path)
    write_facts(s["facts"], facts)
    return facts, changes


def main(argv):
    try:
        s = settings(os.environ)
        if argv == ["--check"]:
            print("Cells declarative configuration settings validated")
            return 0
        require(len(argv) >= 4 and argv[0] == "--container" and argv[2] == "--", "usage: reconcile.py --container <id> -- <docker argv...>")
        deadline = time.monotonic() + s["timeout"]
        cli = Cli(argv[3:], argv[1])
        native = Native(s["rest"], cli.token(s["admin"], s["timeout"] + 120))
        facts, changes = reconcile(s, native, cli, deadline)
    except Refused as error:
        print(f"Cells declarative configuration refused: {error}", file=sys.stderr)
        return 2
    except (KeyError, ValueError, TypeError, OSError):
        # Parser errors could carry values; report only the class of failure.
        print("Cells declarative configuration refused: missing or invalid controlled input", file=sys.stderr)
        return 2
    print(json.dumps({"nativeScopeRef": facts["nativeScopeRef"], "nativeRootRef": facts["nativeRootRef"],
                      "workspaceSlug": facts["workspaceSlug"], "factsFile": str(s["facts"]),
                      "changes": changes or ["none"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
