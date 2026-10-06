"""Actual native provider and credential reader, with an HTTP transport boundary."""

import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[3] / "src/providers/engine"
spec = importlib.util.spec_from_file_location("native_identity", SOURCE / "native_identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


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


if __name__ == "__main__":
    unittest.main()
