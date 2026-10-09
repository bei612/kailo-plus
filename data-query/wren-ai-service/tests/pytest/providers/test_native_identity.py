"""Actual native provider and credential reader, with an HTTP transport boundary."""

import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[3] / "src/providers/engine"
spec = importlib.util.spec_from_file_location("native_identity", SOURCE / "native_identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


class NativeClientRegistrationTest(unittest.TestCase):
    """Execute the original bootstrap branch, retaining its actual file reader."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.ai = self.root / "ai"
        self.ai.mkdir()
        (self.root / "secrets").mkdir()
        self.secret_env = self.root / "oidc-env"
        self.secret_env.write_text("WREN_OIDC_CLIENT_SECRET=fixture-browser-secret\nOIDC_COOKIE_SECRET=" + "a1" * 32 + "\n")
        self.secret_env.chmod(0o600)
        self.ai_secret = self.ai / "client-secret"
        self.ai_secret.write_text("fixture-ai-secret\n")
        self.ai_secret.chmod(0o600)
        admin = self.root / "secrets/keycloak_admin_password"
        admin.write_text("fixture-admin-password")
        admin.chmod(0o600)
        self.native = {
            "issuer": "https://issuer.example/realms/fixture",
            "audience": "fixture-native-browser", "serviceAudience": "fixture-native-ai",
            "jwksUrl": "https://issuer.example/realms/fixture/protocol/openid-connect/certs",
            "accessClaim": "native_instances", "accessValue": "fixture-explicit-instance",
            "publicOrigin": "https://wren.example",
        }
        self.ai_delivery = {
            "uiEndpoint": "http://wren-ui:3000", "publicOrigin": self.native["publicOrigin"],
            "tokenEndpoint": self.native["issuer"] + "/protocol/openid-connect/token",
            "clientId": self.native["serviceAudience"], "secretFile": "/run/wren-ai-native/client-secret",
        }
        self.ai_file = self.ai / "identity.json"
        self.ai_file.write_text(json.dumps(self.ai_delivery))
        self.ai_file.chmod(0o600)
        source = (SOURCE.parents[4] / "deploy/local/bootstrap.sh").read_text()
        self.source = source.split("<<'PYWRENCLIENTS'\n", 1)[1].split("\nPYWRENCLIENTS", 1)[0]
        self.clients = {}
        self.calls = []
        self.lose_ack = False
        self.unknown_create = False
        self.openers = []

    def transport(self, request, data=None, **kwargs):
        if isinstance(request, str):
            self.calls.append(("POST", urllib.parse.urlsplit(request).path))
            return io.BytesIO(json.dumps({"access_token": "fixture-admin-token"}).encode())
        path = urllib.parse.urlsplit(request.full_url)
        self.calls.append((request.method, path.path))
        base = "/admin/realms/fixture/clients"
        if path.path == base and request.method == "POST":
            body = json.loads(request.data)
            self.assertNotIn(body["clientId"], self.clients)
            if not self.unknown_create:
                self.clients[body["clientId"]] = {**body, "id": body["clientId"]}
            if self.lose_ack or self.unknown_create:
                raise urllib.error.URLError("fixture lost ACK")
            return io.BytesIO()
        self.assertEqual(request.method, "GET")
        if path.path == base:
            client_id = urllib.parse.parse_qs(path.query)["clientId"][0]
            result = [self.clients[client_id]] if client_id in self.clients else []
        else:
            parts = path.path[len(base) + 1:].split("/")
            client = self.clients[parts[0]]
            if parts[1:] == ["client-secret"]:
                result = {"value": client["secret"]}
            elif parts[1:] == ["protocol-mappers", "models"]:
                result = client.get("protocolMappers", [])
            else:
                self.assertEqual(parts[1:], [])
                result = client
        return io.BytesIO(json.dumps(result).encode())

    def run_registration(self):
        env = {
            "WREN_OIDC_CLIENT_ID": self.native["audience"],
            "WREN_NATIVE_IDENTITY_JSON": json.dumps(self.native),
            "WREN_PUBLIC_ORIGIN": self.native["publicOrigin"], "WREN_UI_PORT": "3000",
            "WREN_OIDC_SECRET_ENV_FILE": str(self.secret_env), "WREN_AI_IDENTITY_DIR": str(self.ai),
        }
        args = ["bootstrap", "8081", "fixture", "admin", "1", self.native["issuer"],
                "https://platform.example", "platform-core", "platform-worker", "platform-browser", "platform-native"]
        output = io.StringIO()
        def open_request(opener, request, data=None, **kwargs):
            self.openers.append(opener)
            return self.transport(request, data=data, **kwargs)
        with patch.dict(os.environ, env), patch.object(sys, "argv", args), \
                patch("urllib.request.OpenerDirector.open", open_request), contextlib.chdir(self.root), \
                contextlib.redirect_stdout(output):
            exec(compile(self.source, "bootstrap:PYWRENCLIENTS", "exec"), {})
        return output.getvalue()

    def test_registers_two_native_clients_with_separate_secrets_and_no_instance_grant(self):
        output = self.run_registration()
        self.assertEqual(set(self.clients), {"fixture-native-browser", "fixture-native-ai"})
        browser, ai = self.clients[self.native["audience"]], self.clients[self.native["serviceAudience"]]
        self.assertEqual(browser["redirectUris"], ["https://wren.example/oauth/callback"])
        self.assertFalse(browser["serviceAccountsEnabled"])
        self.assertTrue(ai["serviceAccountsEnabled"])
        self.assertFalse(ai["standardFlowEnabled"])
        self.assertNotEqual(ai["secret"], browser["secret"])
        self.assertEqual(ai["protocolMappers"][0]["config"]["included.custom.audience"], self.native["serviceAudience"])
        self.assertNotIn("protocolMappers", browser)
        self.assertNotIn(self.native["accessClaim"], json.dumps(browser) + json.dumps(ai))
        self.assertIn("未授予实例权限", output)
        self.assertNotIn("fixture-browser-secret", output)
        self.assertNotIn("fixture-ai-secret", output)

    def test_admin_login_and_client_registration_never_forward_redirected_credentials(self):
        self.run_registration()
        self.assertTrue(self.openers)
        request = urllib.request.Request("http://127.0.0.1:8081/admin/realms/fixture/clients",
                                         data=b"fixture-client-secret",
                                         headers={"Authorization": "Bearer fixture-admin-token"})
        for opener in self.openers:
            handlers = [handler for handler in opener.handlers
                        if isinstance(handler, urllib.request.HTTPRedirectHandler)]
            self.assertEqual(len(handlers), 1)
            for status in (301, 302, 303, 307, 308):
                with self.subTest(status=status):
                    self.assertIsNone(handlers[0].redirect_request(
                        request, None, status, "redirect", {}, "https://untrusted.invalid/receive"))

    def test_repeat_only_reads_existing_clients_and_does_not_rotate(self):
        self.run_registration()
        before = json.dumps(self.clients, sort_keys=True)
        self.calls.clear()
        self.run_registration()
        self.assertEqual(json.dumps(self.clients, sort_keys=True), before)
        self.assertFalse(any(method == "POST" and path.endswith("/clients") for method, path in self.calls))

    def test_lost_ack_reads_unique_native_client_without_second_create(self):
        self.lose_ack = True
        self.run_registration()
        self.assertEqual(sum(method == "POST" and path.endswith("/clients") for method, path in self.calls), 2)

    def test_absent_native_readback_is_not_failure_cleanup_or_second_dispatch(self):
        self.unknown_create = True
        with self.assertRaises(SystemExit):
            self.run_registration()
        self.assertEqual(sum(method == "POST" and path.endswith("/clients") for method, path in self.calls), 1)

    def test_existing_disabled_client_and_changed_secret_are_not_overwritten(self):
        self.run_registration()
        for kind in ("disabled", "secret", "mapper"):
            with self.subTest(kind=kind):
                client = self.clients[self.native["audience"] if kind != "mapper" else self.native["serviceAudience"]]
                original = dict(client)
                if kind == "disabled":
                    client["enabled"] = False
                elif kind == "secret":
                    client["secret"] = "fixture-different-secret"
                else:
                    client["protocolMappers"] = []
                self.calls.clear()
                with self.assertRaises(SystemExit):
                    self.run_registration()
                self.assertFalse(any(method != "GET" and path.endswith("/clients") for method, path in self.calls))
                client.clear()
                client.update(original)

    def test_incomplete_origin_native_claim_or_shared_client_has_no_idp_side_effect(self):
        original = dict(self.native)
        for key, value in (("publicOrigin", ""), ("audience", "platform-browser"),
                           ("serviceAudience", "platform-core"),
                           ("serviceAudience", self.native["audience"]), ("accessClaim", "aud")):
            with self.subTest(key=key, value=value):
                self.native = {**original, key: value}
                self.calls.clear()
                with self.assertRaises(SystemExit):
                    self.run_registration()
                self.assertEqual(self.calls, [])
        self.native = original

    def test_world_readable_secret_and_shared_native_secret_refuse_before_idp(self):
        self.ai_secret.chmod(0o644)
        with self.assertRaises(SystemExit):
            self.run_registration()
        self.assertEqual(self.calls, [])
        self.ai_secret.chmod(0o600)
        self.ai_secret.write_text("fixture-browser-secret")
        with self.assertRaises(SystemExit):
            self.run_registration()
        self.assertEqual(self.calls, [])

    def test_ai_runtime_delivery_mismatch_and_symlink_have_no_idp_side_effect(self):
        self.ai_file.write_text(json.dumps({**self.ai_delivery, "clientId": self.native["audience"]}))
        with self.assertRaises(SystemExit):
            self.run_registration()
        self.assertEqual(self.calls, [])
        self.ai_file.write_text(json.dumps(self.ai_delivery))
        link = self.ai / "linked-secret"
        link.symlink_to(self.ai_secret)
        self.ai_file.write_text(json.dumps({**self.ai_delivery, "secretFile": "/run/wren-ai-native/linked-secret"}))
        with self.assertRaises(SystemExit):
            self.run_registration()
        self.assertEqual(self.calls, [])


class Response:
    def __init__(self, status, body):
        self.status, self.body = status, body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def json(self):
        return self.body

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError("HTTP rejected")


class Session:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class NativeIdentityTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.secret = Path(self.directory.name) / "secret"
        self.secret.write_text("fixture-native-secret")
        self.secret.chmod(0o400)
        self.config = Path(self.directory.name) / "identity.json"
        self.delivery = {
            "uiEndpoint": "http://wren-ui:3000",
            "publicOrigin": "https://wren.example",
            "tokenEndpoint": "https://issuer.example/token",
            "clientId": "native-ai",
            "secretFile": str(self.secret),
        }
        self.config.write_text(json.dumps(self.delivery))
        env = patch.dict(os.environ, {"WREN_NATIVE_SERVICE_IDENTITY_FILE": str(self.config)})
        env.start()
        self.addCleanup(env.stop)

    async def test_reads_rotation_without_cache_or_platform_token(self):
        session = Session([
            Response(200, {"token_type": "Bearer", "access_token": "signed-native-one"}),
            Response(200, {"token_type": "Bearer", "access_token": "signed-native-two"}),
        ])
        first = await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.secret.chmod(0o600)
        self.secret.write_text("rotated-native-secret")
        self.secret.chmod(0o400)
        second = await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.assertEqual(first, {"Authorization": "Bearer signed-native-one", "Origin": "https://wren.example"})
        self.assertEqual(second["Authorization"], "Bearer signed-native-two")
        self.assertEqual(session.calls[0][1]["data"]["client_secret"], "fixture-native-secret")
        self.assertEqual(session.calls[1][1]["data"]["client_secret"], "rotated-native-secret")
        self.assertEqual(session.calls[0][1]["data"]["grant_type"], "client_credentials")
        self.assertFalse(session.calls[0][1]["allow_redirects"])

    async def test_endpoint_mismatch_and_missing_delivery_do_not_send(self):
        session = Session([])
        with self.assertRaises(identity.NativeIdentityUnavailable):
            await identity.native_headers(session, "http://other-ui:3000", 5)
        self.config.unlink()
        with self.assertRaises(identity.NativeIdentityUnavailable):
            await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.assertEqual(session.calls, [])

    async def test_controlled_native_secret_has_no_invented_length_ceiling(self):
        delivered = "fixture-native-client-secret-" * 200
        self.secret.chmod(0o600)
        self.secret.write_text(delivered)
        self.secret.chmod(0o400)
        session = Session([
            Response(200, {"token_type": "Bearer", "access_token": "native-jwt"}),
        ])
        await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.assertEqual(session.calls[0][1]["data"]["client_secret"], delivered)

    async def test_revoked_or_redirected_token_and_malformed_reply_are_not_forwarded(self):
        for response in [
            Response(401, {"error": "fixture-native-secret"}),
            Response(302, {}),
            Response(200, {"token_type": "Basic", "access_token": "value"}),
            Response(200, {"token_type": "Bearer", "access_token": "bad\ntoken"}),
            Response(200, {"token_type": "Bearer", "access_token": "bad\x00token"}),
        ]:
            session = Session([response])
            with self.assertRaisesRegex(identity.NativeIdentityUnavailable, "^Native service identity unavailable$"):
                await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
            self.assertEqual(len(session.calls), 1)

    async def test_secret_file_is_not_world_readable_or_symlinked(self):
        session = Session([])
        self.secret.chmod(0o644)
        with self.assertRaises(identity.NativeIdentityUnavailable):
            await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.secret.unlink()
        self.secret.symlink_to(self.config)
        with self.assertRaises(identity.NativeIdentityUnavailable):
            await identity.native_headers(session, self.delivery["uiEndpoint"], 5)
        self.assertEqual(session.calls, [])

    async def test_actual_wren_provider_authenticates_before_original_graphql_and_fails_closed(self):
        # No second provider implementation: execute the production module,
        # substituting only its external engine/config/HTTP library boundaries.
        aiohttp = types.SimpleNamespace(ClientSession=Session, ClientTimeout=lambda **kw: kw)
        dependencies = {
            "aiohttp": aiohttp,
            "orjson": json,
            "src.config": types.SimpleNamespace(settings=types.SimpleNamespace(engine_timeout=5)),
            "src.core.engine": types.SimpleNamespace(Engine=object, remove_limit_statement=lambda sql: sql),
            "src.providers.loader": types.SimpleNamespace(provider=lambda name: lambda cls: cls),
            "src.providers.engine.native_identity": identity,
        }
        with patch.dict(sys.modules, dependencies):
            source = importlib.util.spec_from_file_location("native_wren_test", SOURCE / "wren.py")
            module = importlib.util.module_from_spec(source)
            source.loader.exec_module(module)
        provider = module.WrenUI(endpoint=self.delivery["uiEndpoint"])
        session = Session([
            Response(200, {"token_type": "Bearer", "access_token": "native-jwt"}),
            Response(200, {"data": {"previewSql": {"data": []}}}),
        ])
        result = await provider.execute_sql("select 1", session, project_id="native-project", dry_run=True)
        self.assertTrue(result[0])
        url, request = session.calls[1]
        self.assertEqual(url, "http://wren-ui:3000/api/graphql")
        self.assertEqual(request["headers"], {"Authorization": "Bearer native-jwt", "Origin": "https://wren.example"})
        self.assertFalse(request["allow_redirects"])
        self.assertEqual(request["json"]["variables"]["data"]["projectId"], "native-project")
        denied = Session([Response(403, {})])
        failure = await provider.execute_sql("select 1", denied)
        self.assertFalse(failure[0])
        self.assertEqual(len(denied.calls), 1)

    async def test_original_force_deploy_callback_uses_native_identity_without_printing_payload(self):
        session = Session([
            Response(200, {"token_type": "Bearer", "access_token": "native-jwt"}),
            Response(200, {"data": {"deploy": {"status": "SUCCESS"}}, "private": "fixture-payload"}),
        ])
        dependencies = {
            "aiohttp": types.SimpleNamespace(ClientSession=lambda: session, ClientTimeout=lambda **kw: kw, ClientError=OSError),
            "dotenv": types.SimpleNamespace(load_dotenv=lambda **kw: None),
            "src.providers.engine.native_identity": identity,
        }
        with patch.dict(sys.modules, dependencies), patch.dict(os.environ, {"ENGINE": "test-import-only", "WREN_UI_ENDPOINT": self.delivery["uiEndpoint"]}):
            source = importlib.util.spec_from_file_location("native_force_deploy_test", SOURCE.parents[1] / "force_deploy.py")
            module = importlib.util.module_from_spec(source)
            source.loader.exec_module(module)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                await module.force_deploy()
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(session.calls[1][1]["headers"]["Authorization"], "Bearer native-jwt")
        self.assertFalse(session.calls[1][1]["allow_redirects"])
        self.assertNotIn("fixture-payload", output.getvalue())
        self.assertNotIn("native-jwt", output.getvalue())

        # The real GraphQL mutation returns DeployResponse, not a Boolean.
        # HTTP success or a data envelope alone is not deployment success.
        for payload in [
            {"data": None},
            {"data": {"deploy": True}},
            {"data": {"deploy": {"status": "FAILED"}}},
            {"data": {"deploy": {"status": "IN_PROGRESS"}}},
            {"data": {"deploy": {"status": "future-status"}}},
            {"data": {"deploy": {"status": "SUCCESS", "error": "private-detail"}}},
            {"data": {"deploy": {"status": "SUCCESS"}}, "errors": ["private-detail"]},
        ]:
            with self.subTest(payload=payload):
                session = Session([
                    Response(200, {"token_type": "Bearer", "access_token": "native-jwt"}),
                    Response(200, payload),
                ])
                with patch.dict(os.environ, {"WREN_UI_ENDPOINT": self.delivery["uiEndpoint"]}):
                    with self.assertRaisesRegex(RuntimeError, "^Native model deployment was not confirmed$"):
                        await module.force_deploy()
                self.assertEqual(len(session.calls), 2)

    async def test_original_force_deploy_does_not_replay_unknown_mutation(self):
        class LostReceipt(Response):
            async def json(self):
                raise OSError("lost after native acceptance")

        session = Session([
            Response(200, {"token_type": "Bearer", "access_token": "native-jwt"}),
            LostReceipt(200, {}),
        ])
        dependencies = {
            "aiohttp": types.SimpleNamespace(ClientSession=lambda: session, ClientTimeout=lambda **kw: kw, ClientError=OSError),
            "dotenv": types.SimpleNamespace(load_dotenv=lambda **kw: None),
            "src.providers.engine.native_identity": identity,
        }
        with patch.dict(sys.modules, dependencies), patch.dict(os.environ, {"ENGINE": "test-import-only", "WREN_UI_ENDPOINT": self.delivery["uiEndpoint"]}):
            source = importlib.util.spec_from_file_location("native_force_deploy_unknown_test", SOURCE.parents[1] / "force_deploy.py")
            module = importlib.util.module_from_spec(source)
            source.loader.exec_module(module)
            with self.assertRaisesRegex(OSError, "lost after native acceptance"):
                await module.force_deploy()
        self.assertEqual(len(session.calls), 2)
        self.assertEqual(sum(url.endswith('/api/graphql') for url, _ in session.calls), 1)


class NativeEntrypointTest(unittest.TestCase):
    """Run the original Bash entrypoint; only its three external commands are fixtures."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        command = f"""#!{sys.executable}
import json
import os
from pathlib import Path
import signal
import sys
import time

directory = Path(os.environ['NATIVE_ENTRYPOINT_FIXTURE'])
name = Path(sys.argv[0]).name
with (directory / (name + '.calls')).open('a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\\n')
if name == 'uvicorn':
    def stopped(signum, frame):
        (directory / 'server.stopped').write_text(str(signum))
        sys.exit(0)
    signal.signal(signal.SIGTERM, stopped)
    signal.signal(signal.SIGINT, stopped)
    (directory / 'server.pid').write_text(str(os.getpid()))
    if os.environ['FIXTURE_SERVER_MODE'] == 'running':
        while not (directory / 'server.release').exists():
            time.sleep(0.01)
    sys.exit(int(os.environ['FIXTURE_SERVER_EXIT']))
if name == 'python':
    if os.environ['FIXTURE_FORCE_RELEASE'] == 'true':
        (directory / 'server.release').touch()
    sys.exit(int(os.environ['FIXTURE_FORCE_EXIT']))
if name == 'nc' and sys.argv[2] == 'localhost':
    deadline = time.monotonic() + 5
    while not (directory / 'server.pid').exists():
        if time.monotonic() >= deadline:
            sys.exit(1)
        time.sleep(0.01)
sys.exit(0)
"""
        for name in ('uvicorn', 'nc', 'python'):
            target = self.path / name
            target.write_text(command)
            target.chmod(0o700)
        self.env = {
            **os.environ,
            'PATH': f'{self.path}:{os.defpath}',
            'NATIVE_ENTRYPOINT_FIXTURE': str(self.path),
            'QDRANT_HOST': 'fixture-qdrant',
            'WREN_AI_SERVICE_PORT': '15555',
            'WREN_UI_PORT': '13000',
            'SHOULD_FORCE_DEPLOY': '',
            'FIXTURE_SERVER_MODE': 'exit',
            'FIXTURE_SERVER_EXIT': '0',
            'FIXTURE_FORCE_EXIT': '0',
            'FIXTURE_FORCE_RELEASE': 'false',
        }

    def launch(self, **env):
        process = subprocess.Popen(
            ['/bin/bash', str(SOURCE.parents[2] / 'entrypoint.sh')],
            env={**self.env, **env},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        def cleanup():
            if process.poll() is None:
                process.kill()
            pid = self.path / 'server.pid'
            if pid.exists():
                try:
                    os.kill(int(pid.read_text()), signal.SIGTERM)
                except ProcessLookupError:
                    pass
            process.communicate(timeout=5)

        self.addCleanup(cleanup)
        return process

    def wait_for(self, name):
        deadline = time.monotonic() + 5
        while not (self.path / name).exists():
            if time.monotonic() >= deadline:
                self.fail(f'Original entrypoint did not produce {name}')
            time.sleep(0.01)

    def calls(self, name):
        path = self.path / (name + '.calls')
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_native_server_success_preserves_original_command_and_optional_deploy(self):
        process = self.launch()
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, output)
        self.assertEqual(self.calls('uvicorn'), [[
            'src.__main__:app', '--host', '0.0.0.0', '--port', '15555',
            '--loop', 'uvloop', '--http', 'httptools',
        ]])
        self.assertEqual(self.calls('nc'), [['-z', 'fixture-qdrant', '6333']])
        self.assertEqual(self.calls('python'), [])

    def test_native_server_initialization_failure_is_not_a_successful_bootstrap(self):
        process = self.launch(FIXTURE_SERVER_EXIT='17')
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 17, output)
        self.assertEqual(len(self.calls('uvicorn')), 1)
        self.assertEqual(self.calls('python'), [])

    def test_successful_optional_deploy_does_not_hide_later_server_failure(self):
        process = self.launch(
            SHOULD_FORCE_DEPLOY='1', FIXTURE_SERVER_MODE='running',
            FIXTURE_SERVER_EXIT='19', FIXTURE_FORCE_RELEASE='true',
        )
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 19, output)
        self.assertEqual(self.calls('python'), [['-m', 'src.force_deploy']])
        self.assertIn(['-z', 'localhost', '15555'], self.calls('nc'))
        self.assertIn(['-z', 'wren-ui', '13000'], self.calls('nc'))

    def test_unknown_optional_deploy_is_not_repeated_and_cleans_up_server(self):
        process = self.launch(
            SHOULD_FORCE_DEPLOY='1', FIXTURE_SERVER_MODE='running',
            FIXTURE_FORCE_EXIT='23',
        )
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 23, output)
        self.assertEqual(self.calls('python'), [['-m', 'src.force_deploy']])
        self.assertEqual(len(self.calls('uvicorn')), 1)
        self.assertEqual((self.path / 'server.stopped').read_text(), str(signal.SIGTERM))

    def test_compose_term_reaches_server_and_reaps_it(self):
        process = self.launch(FIXTURE_SERVER_MODE='running')
        self.wait_for('server.pid')
        process.send_signal(signal.SIGTERM)
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 143, output)
        self.assertEqual((self.path / 'server.stopped').read_text(), str(signal.SIGTERM))
        self.assertEqual(self.calls('python'), [])

    def test_interrupt_reaches_server_and_reaps_it(self):
        process = self.launch(FIXTURE_SERVER_MODE='running')
        self.wait_for('server.pid')
        process.send_signal(signal.SIGINT)
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 130, output)
        self.assertEqual((self.path / 'server.stopped').read_text(), str(signal.SIGTERM))
        self.assertEqual(self.calls('python'), [])


if __name__ == "__main__":
    unittest.main()
