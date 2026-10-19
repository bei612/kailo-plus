"""Tests of reconcile.py against an in-process stand-in of the native Cells
REST entries it calls and a stand-in `docker exec ... cells` CLI.

  python3 -I -B -m unittest -v test_reconcile      (from file-storage/deploy)
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import stat
import sys
import tempfile
import threading
import unittest
import uuid

spec = importlib.util.spec_from_file_location("reconcile", Path(__file__).with_name("reconcile.py"))
reconcile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reconcile)

# Fixture values only; not credentials of any deployment.
TOKEN = "fixture-admin-pat.Zm9yLXRlc3RzLW9ubHk"
FAKE_DOCKER = r'''
import json, sys, urllib.request
state, args = sys.argv[1], sys.argv[2:]
assert args[:2] == ["exec", "cells-container"] and args[2] == "cells", args
cmd = args[3:]
if cmd[:3] == ["admin", "user", "token"]:
    print("bootstrap log line that is not a token")
    print(json.load(open(state))["token"])
elif cmd[:3] == ["admin", "file", "mkdir"]:
    path = cmd[cmd.index("--path") + 1]
    request = urllib.request.Request(json.load(open(state))["control"] + "/__mkdir", data=path.encode(), method="POST")
    with urllib.request.urlopen(request) as response:
        sys.exit(0 if response.status == 200 else 1)
else:
    sys.exit(3)
'''


def fresh():
    return str(uuid.uuid4())


class Cells:
    """Minimal native state: datasources, namespaces, plugin params, tree,
    workspaces, ACLs and users, with the original entries' shapes."""

    def __init__(self):
        self.policies = ["default-policy", "keep-all", "regular-pruning"]
        self.datasources = {name: {"Name": name, "StorageConfiguration": {"folder": f"/var/cells/data/{name}"},
                                   "ApiKey": "fixture-key", "ApiSecret": fresh(), "ObjectsServiceName": "local1"}
                            for name in ("pydiods1", "personal", "cellsdata", "versions", "thumbnails")}
        self.namespaces = {}
        self.params = {"PYDIO_PLUGIN_ENABLED": True}
        self.nodes = {}  # path -> node
        self.workspaces = {}
        self.acls = []
        self.users = {login: fresh() for login in ("admin", "svc", "actor")}
        # The image entrypoint creates the binding datasource before the
        # server starts (cells admin datasource ensure); it shares the vault
        # reference of its object service.
        self.datasources["kailobinding"] = self.binding_datasource()
        common = fresh()
        self.workspaces["common-files"] = {"UUID": common, "Slug": "common-files", "Label": "Common Files", "RootNodes": {"DATASOURCE:pydiods1": {}}}
        self.acls.append({"ID": fresh(), "NodeID": "DATASOURCE:pydiods1", "WorkspaceID": common, "Action": {"Name": "workspace-path", "Value": "pydiods1"}})
        self.mutations = []

    def writes(self):
        """Mutations other than the original search entries (POST reads)."""
        return [m for m in self.mutations if not (m[0] == "POST" and m[1] in ("acl", "workspace", "tree/admin/stat"))]

    def binding_datasource(self, policy="keep-all"):
        return {"Name": "kailobinding", "StorageConfiguration": {"folder": "/var/cells/data/kailobinding"},
                "FlatStorage": True, "VersioningPolicyName": policy, "ApiKey": "fixture-key",
                "ApiSecret": self.datasources["pydiods1"]["ApiSecret"], "ObjectsServiceName": "local1"}

    def mkdir(self, path):
        ds = path.split("/")[0]
        if ds not in self.datasources:
            return False
        node = self.nodes.setdefault(path, {"Uuid": fresh(), "Path": path, "Type": "COLLECTION"})
        return node["Type"] == "COLLECTION"

    def acl_matches(self, query, acl):
        names = [a["Name"] for a in query.get("Actions", [])]
        return ((not names or acl["Action"]["Name"] in names)
                and (not query.get("NodeIDs") or acl.get("NodeID") in query["NodeIDs"])
                and (not query.get("WorkspaceIDs") or acl.get("WorkspaceID") in query["WorkspaceIDs"])
                and (not query.get("RoleIDs") or acl.get("RoleID") in query["RoleIDs"]))

    def handle(self, method, path, body):
        if method != "GET":
            self.mutations.append((method, path))
        if (method, path) == ("GET", "config/versioning"):
            return 200, {"Policies": [{"Uuid": p} for p in self.policies]}
        if (method, path) == ("GET", "config/datasource"):
            return 200, {"DataSources": list(self.datasources.values())}
        if path.startswith("config/datasource/"):
            name = path.rsplit("/", 1)[1]
            if method == "GET":
                return (200, copy.deepcopy(self.datasources[name])) if name in self.datasources else (404, {})
            # The original handler would save the whole in-memory configuration
            # and give the datasource a new vault entry: never called.
            return 500, {}
        if path == "user-meta/namespace":
            if method == "GET":
                return 200, {"Namespaces": list(self.namespaces.values())}
            for ns in body["Namespaces"]:
                stored = dict(ns, JsonDefinition=json.dumps(dict(json.loads(ns["JsonDefinition"]), entityId=fresh())))
                self.namespaces[ns["Namespace"]] = stored
            return 200, {"Namespaces": body["Namespaces"]}
        if path == "config/frontend/plugin/meta.user":
            if method == "PUT":
                self.params = json.loads(body["Data"])
            return 200, {"FullPath": "frontend/plugin/meta.user", "Data": json.dumps(self.params)}
        if (method, path) == ("POST", "tree/admin/stat"):
            wanted = body["Node"]
            for node in self.nodes.values():
                if node["Path"] == wanted.get("Path") or node["Uuid"] == wanted.get("Uuid"):
                    return 200, {"Node": node}
            return 404, {}
        if (method, path) == ("POST", "workspace"):
            slug = body["Queries"][0]["slug"]
            assert body["ResourcePolicyQuery"] == {"Type": "ANY"}
            return 200, {"Workspaces": [w for w in self.workspaces.values() if w["Slug"] == slug]}
        if method == "PUT" and path.startswith("workspace/"):
            ws = dict(body, UUID=fresh())
            assert json.loads(ws["Attributes"])["DEFAULT_RIGHTS"] == ""
            self.workspaces[ws["Slug"]] = ws
            for root, node in ws["RootNodes"].items():
                self.acls.append({"ID": fresh(), "NodeID": root, "WorkspaceID": ws["UUID"], "Action": {"Name": "workspace-path", "Value": node["Path"]}})
            return 200, ws
        if (method, path) == ("POST", "acl"):
            query = body["Queries"][0]
            return 200, {"ACLs": [a for a in self.acls if self.acl_matches(query, a)]}
        if (method, path) == ("PUT", "acl"):
            self.acls.append(dict(body, ID=fresh()))
            return 200, body
        if (method, path) == ("POST", "acl/bulk/delete"):
            before = len(self.acls)
            self.acls = [a for a in self.acls if not (a.get("RoleID") == body["RoleID"] and a.get("WorkspaceID") == body["WorkspaceID"]
                                                       and a.get("NodeID") == body["NodeID"] and a["Action"]["Name"] == body["Action"]["Name"])]
            return 200, {"Success": True, "NumRows": before - len(self.acls)}
        if method == "GET" and path.startswith("user/"):
            login = path.split("/", 1)[1]
            return (200, {"Login": login, "Uuid": self.users[login]}) if login in self.users else (404, {})
        return 500, {}


class Server:
    def __init__(self, cells):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, code, value):
                data = json.dumps(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def serve(self, method):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                if self.path == "/__mkdir":
                    return self.reply(200 if cells.mkdir(raw.decode()) else 409, {})
                if self.headers.get("Authorization") != "Bearer " + TOKEN or not self.path.startswith("/a/"):
                    return self.reply(401, {})
                code, value = cells.handle(method, self.path[3:], json.loads(raw) if raw else None)
                self.reply(code, value)

            def do_GET(self):
                self.serve("GET")

            def do_POST(self):
                self.serve("POST")

            def do_PUT(self):
                self.serve("PUT")

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        outer.cells = cells

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        os.chmod(self.dir, 0o700)
        self.cells = Cells()
        self.server = Server(self.cells)
        self.addCleanup(self.server.close)
        state = self.dir / "state.json"
        state.write_text(json.dumps({"token": TOKEN, "control": self.server.url}))
        docker = self.dir / "docker.py"
        docker.write_text(FAKE_DOCKER)
        self.docker = [sys.executable, "-I", str(docker), str(state)]
        install = self.dir / "install.json"
        install.write_text(json.dumps({"frontendLogin": "admin", "frontendPassword": "fixture-not-a-password"}))
        os.chmod(install, 0o600)
        self.env = {
            "CELLS_EXTERNAL": self.server.url, "CELLS_INSTALL_FILE": str(install), "CELLS_START_TIMEOUT_SECONDS": "30",
            "CELLS_DRAFT_NAMESPACE": "usermeta-kailo-draft", "CELLS_BINDING_DATASOURCE": "kailobinding",
            "CELLS_BINDING_VERSIONING_POLICY": "keep-all", "CELLS_BINDING_ROOT_FOLDER": "kailo-binding",
            "CELLS_BINDING_WORKSPACE_SLUG": "kailo-binding", "CELLS_BINDING_WORKSPACE_LABEL": "Kailo binding",
            "CELLS_BINDING_PRINCIPALS": "svc:r actor:rw", "CELLS_BINDING_SERVICE_LOGIN": "svc",
            "CELLS_BINDING_FACTS_FILE": str(self.dir / "facts.json"),
        }

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        saved = os.environ.copy()
        os.environ.clear()
        os.environ.update(self.env)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = reconcile.main(list(argv) or ["--container", "cells-container", "--"] + self.docker)
        finally:
            os.environ.clear()
            os.environ.update(saved)
        self.assertNotIn(TOKEN, out.getvalue() + err.getvalue())
        self.assertNotIn("fixture-not-a-password", out.getvalue() + err.getvalue())
        return code, out.getvalue(), err.getvalue()

    def test_fresh_instance_is_configured_and_second_run_is_a_noop(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        ds = self.cells.datasources["kailobinding"]
        self.assertEqual(ds["VersioningPolicyName"], "keep-all")
        self.assertEqual(ds["StorageConfiguration"]["folder"], "/var/cells/data/kailobinding")
        ns = self.cells.namespaces["usermeta-kailo-draft"]
        self.assertEqual(json.loads(ns["JsonDefinition"])["type"], "boolean")
        self.assertEqual(self.cells.params, {"PYDIO_PLUGIN_ENABLED": True, "USERMETA_DRAFT_API": True,
                                             "USERMETA_DRAFT_NAMESPACE": "usermeta-kailo-draft"})
        facts_path = Path(self.env["CELLS_BINDING_FACTS_FILE"])
        self.assertEqual(stat.S_IMODE(facts_path.stat().st_mode), 0o600)
        facts = json.loads(facts_path.read_text())
        root = self.cells.nodes["kailobinding/kailo-binding"]["Uuid"]
        workspace = self.cells.workspaces["kailo-binding"]["UUID"]
        self.assertEqual((facts["nativeRootRef"], facts["nativeScopeRef"]), (root, workspace))
        self.assertEqual(facts["instanceServiceUuid"], self.cells.users["svc"])
        self.assertEqual(json.loads(out)["nativeScopeRef"], workspace)
        grants = {(a["RoleID"], a["Action"]["Name"]) for a in self.cells.acls if a.get("RoleID")}
        self.assertEqual(grants, {(self.cells.users["svc"], "read"), (self.cells.users["actor"], "read"), (self.cells.users["actor"], "write")})
        self.assertFalse([m for m in self.cells.mutations if m[1].startswith("config/datasource")])
        self.cells.mutations.clear()
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)["changes"], ["none"])
        # Only searches/stats (POST reads) remain; nothing is written again.
        self.assertFalse([m for m in self.cells.mutations if m[0] == "PUT" or m[1] in ("acl/bulk/delete",) or m[1].startswith("config/datasource/")])

    def test_datasource_rooting_another_workspace_is_refused_before_any_change(self):
        self.env["CELLS_BINDING_DATASOURCE"] = "pydiods1"
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("another workspace is rooted on the binding datasource", err)
        self.assertNotIn("VersioningPolicyName", self.cells.datasources["pydiods1"])
        self.assertEqual(self.cells.nodes, {})
        self.assertNotIn("kailo-binding", self.cells.workspaces)

    def test_binding_datasource_is_never_created_through_the_running_server(self):
        del self.cells.datasources["kailobinding"]
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("the image entrypoint creates it before start", err)
        self.assertNotIn("kailobinding", self.cells.datasources)
        self.assertFalse([m for m in self.cells.mutations if m[1].startswith("config/")])
        self.assertEqual(self.cells.nodes, {})

    def test_binding_datasource_with_another_policy_is_refused_not_rewritten(self):
        self.cells.datasources["kailobinding"] = self.cells.binding_datasource("regular-pruning")
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("another versioning policy", err)
        self.assertEqual(self.cells.datasources["kailobinding"]["VersioningPolicyName"], "regular-pruning")
        self.assertFalse(self.cells.writes())

    def test_binding_datasource_must_be_local_flat_and_enabled(self):
        for change in ({"FlatStorage": False}, {"Disabled": True}, {"StorageType": "S3"}):
            self.cells.datasources["kailobinding"] = dict(self.cells.binding_datasource(), **change)
            code, _, err = self.run_main()
            self.assertEqual(code, 2, change)
            self.assertIn("enabled LOCAL flat datasource", err)
        self.assertFalse(self.cells.writes())

    def test_unknown_versioning_policy_fails_closed(self):
        self.env["CELLS_BINDING_VERSIONING_POLICY"] = "no-such-policy"
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("versioning policy is not defined", err)
        self.assertEqual(self.cells.datasources["kailobinding"], self.cells.binding_datasource())
        self.assertFalse(self.cells.writes())

    def test_existing_non_boolean_namespace_is_never_rewritten(self):
        self.cells.namespaces["usermeta-kailo-draft"] = {"Namespace": "usermeta-kailo-draft", "JsonDefinition": json.dumps({"type": "string"}),
                                                         "Policies": [{"Action": "WRITE", "Subject": "*", "Effect": "allow"}]}
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("boolean usermeta namespace", err)
        self.assertNotIn("USERMETA_DRAFT_API", self.cells.params)

    def test_missing_principal_fails_closed(self):
        self.env["CELLS_BINDING_PRINCIPALS"] = "svc:r ghost:rw"
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("native user ghost does not exist", err)
        self.assertFalse(Path(self.env["CELLS_BINDING_FACTS_FILE"]).exists())

    def test_undeclared_grants_are_removed(self):
        self.assertEqual(self.run_main()[0], 0)
        facts = json.loads(Path(self.env["CELLS_BINDING_FACTS_FILE"]).read_text())
        self.cells.acls.append({"ID": fresh(), "NodeID": facts["nativeRootRef"], "WorkspaceID": facts["nativeScopeRef"],
                                "RoleID": "ROOT_GROUP", "Action": {"Name": "write", "Value": "1"}})
        self.env["CELLS_BINDING_PRINCIPALS"] = "svc:r"
        self.env["CELLS_BINDING_SERVICE_LOGIN"] = "svc"
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        grants = {(a["RoleID"], a["Action"]["Name"]) for a in self.cells.acls if a.get("RoleID")}
        self.assertEqual(grants, {(self.cells.users["svc"], "read")})

    def test_native_action_delivery_must_match_the_facts(self):
        self.assertEqual(self.run_main()[0], 0)
        facts = json.loads(Path(self.env["CELLS_BINDING_FACTS_FILE"]).read_text())
        native = self.dir / "native.json"
        delivery = {"nativeScopeRef": facts["nativeScopeRef"], "nativeRootRef": facts["nativeRootRef"],
                    "instanceServiceUuid": self.cells.users["svc"], "actors": [{"principalId": fresh(), "kind": "HUMAN", "userUuid": self.cells.users["actor"]}]}
        native.write_text(json.dumps(delivery))
        os.chmod(native, 0o600)
        self.env["CELLS_NATIVE_ACTION_CONFIG_FILE"] = str(native)
        self.assertEqual(self.run_main()[0], 0)
        delivery["actors"][0]["userUuid"] = self.cells.users["svc"]
        native.write_text(json.dumps(delivery))
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("not a declared rw principal", err)
        delivery["actors"] = []
        delivery["nativeScopeRef"] = fresh()
        native.write_text(json.dumps(delivery))
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("nativeScopeRef is not the binding workspace", err)

    def test_settings_are_checked_without_network(self):
        self.assertEqual(self.run_main("--check")[0], 0)
        for key, value in (("CELLS_DRAFT_NAMESPACE", "kailo-draft"), ("CELLS_BINDING_DATASOURCE", "versions"),
                           ("CELLS_BINDING_ROOT_FOLDER", "a/b"), ("CELLS_BINDING_PRINCIPALS", "svc:x"),
                           ("CELLS_BINDING_SERVICE_LOGIN", "actor2"), ("CELLS_BINDING_FACTS_FILE", "relative.json")):
            saved = self.env[key]
            self.env[key] = value
            code, _, err = self.run_main("--check")
            self.assertEqual(code, 2, key)
            self.assertNotIn(value, err) if key == "CELLS_BINDING_PRINCIPALS" else None
            self.env[key] = saved
        os.chmod(self.env["CELLS_INSTALL_FILE"], 0o644)
        self.assertEqual(self.run_main("--check")[0], 2)


if __name__ == "__main__":
    unittest.main()
