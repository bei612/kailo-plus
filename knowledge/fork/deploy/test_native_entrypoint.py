"""Post-implementation tests of the actual native process entrypoint."""

import importlib.util
import hashlib
import hmac
import io
import json
from contextlib import redirect_stdout
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock

import provision


spec = importlib.util.spec_from_file_location(
    "native_entrypoint", Path(__file__).with_name("native_entrypoint.py")
)
entrypoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entrypoint)


class NativeEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = {
            "DB_DRIVER": "postgres",
            "DB_HOST": "postgres",
            "DB_PORT": "5432",
            "DB_USER": "native_fixture",
            "DB_NAME": "native_fixture",
            "REDIS_ADDR": "redis:6379",
            "DOCREADER_ADDR": "docreader:50051",
            "OIDC_AUTH_ENABLE": "true",
            "AUTO_RECOVER_DIRTY": "false",
            "OIDC_AUTH_ISSUER_URL": "https://idp.example.test/realms/native",
            "OIDC_AUTH_DISCOVERY_URL": "https://idp.example.test/realms/native/.well-known/openid-configuration",
            "OIDC_AUTH_CLIENT_ID": "native-fixture-client",
            "OIDC_AUTH_SCOPES": "openid profile email",
            "FRONTEND_BASE_URL": "https://knowledge.example.test",
        }
        for index, name in enumerate(entrypoint.SECRET_NAMES):
            raw = bytes([65 + index]) * (32 if name == "SYSTEM_AES_KEY" else 17)
            file = Path(self.directory.name) / name.lower()
            file.write_bytes(raw)
            file.chmod(0o600)
            self.env[name + "_FILE"] = str(file)

    def assert_refused(self, env=None):
        with self.assertRaises(entrypoint.ConfigurationError) as error:
            entrypoint.prepare_environment(self.env if env is None else env)
        # Errors only identify configuration names: never echo supplied values.
        for name in entrypoint.SECRET_NAMES:
            value = Path(self.env[name + "_FILE"]).read_bytes().decode("utf-8", errors="ignore")
            if value:
                self.assertNotIn(value, str(error.exception))

    def test_exact_bytes_enter_native_environment_without_file_variables(self):
        original = dict(self.env)
        delivered = entrypoint.prepare_environment(self.env)
        self.assertEqual(original, self.env)
        for name in entrypoint.SECRET_NAMES:
            self.assertEqual(
                delivered[name].encode(), Path(original[name + "_FILE"]).read_bytes()
            )
            self.assertNotIn(name + "_FILE", delivered)

    def test_aes_is_exactly_32_bytes_not_trimmed_or_hex_decoded(self):
        file = Path(self.env["SYSTEM_AES_KEY_FILE"])
        for raw in (b"A" * 31, b"A" * 33, b"ab" * 32, b"A" * 32 + b"\n"):
            with self.subTest(length=len(raw)):
                file.write_bytes(raw)
                self.assert_refused()

    def test_platform_model_host_is_exact_and_keeps_existing_oidc_exception(self):
        self.env["KNOWLEDGE_PLATFORM_MODEL_BASE_URL"] = "http://model-edge:18081/v1"
        self.env["SSRF_WHITELIST_EXTRA"] = "192.0.2.20"
        delivered = entrypoint.prepare_environment(self.env)
        self.assertEqual(delivered["SSRF_WHITELIST_EXTRA"], "192.0.2.20,model-edge")
        self.assertNotIn("KNOWLEDGE_PLATFORM_MODEL_BASE_URL", delivered)
        self.env["SSRF_WHITELIST_EXTRA"] = "192.0.2.20,model-edge"
        self.assertEqual(entrypoint.prepare_environment(self.env)["SSRF_WHITELIST_EXTRA"], "192.0.2.20,model-edge")

    def test_platform_model_never_turns_a_url_into_a_wildcard_or_proxy(self):
        for invalid in (
            "", "http://*.example.test/v1", "http://model-edge,other/v1",
            "http://model-edge/v1?key=secret", "http://owner:secret@model-edge/v1",
            "file:///v1", "http://model-edge/admin", "http://model-edge:0/v1",
            "http://model-edge%2fother/v1", "http://model-edge/v1#fragment",
        ):
            with self.subTest(value=invalid):
                self.env["KNOWLEDGE_PLATFORM_MODEL_BASE_URL"] = invalid
                self.assert_refused()

    def test_standalone_has_no_platform_model_prerequisite(self):
        delivered = entrypoint.prepare_environment(self.env)
        self.assertNotIn("SSRF_WHITELIST_EXTRA", delivered)
        self.assertNotIn("KNOWLEDGE_PLATFORM_MODEL_BASE_URL", delivered)

    def test_actual_start_consumes_sole_config_and_only_recreates_app(self):
        root = Path(self.directory.name)
        script = Path(__file__).with_name("start.sh")
        (root / "start.sh").write_bytes(script.read_bytes())
        (root / ".env").write_text("KNOWLEDGE_NATIVE_ORIGIN=https://native.example.test\n")
        platform = root / "platform.env"
        platform.write_text("PLATFORM_EDGE_NETWORK=fixture_edge\nAGENTGATEWAY_MODEL_HOST=fixture-gateway\nAGENTGATEWAY_MODEL_PORT=18081\nAGENTGATEWAY_MODEL_BASE_URL=http://${AGENTGATEWAY_MODEL_HOST}:${AGENTGATEWAY_MODEL_PORT}/v1\n")
        recorder = root / "docker"
        recorder.write_text("#!/usr/bin/env python3\nimport json,os,sys\nwith open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\nsys.exit(int(os.environ.get('REFUSE_CONFIG','0')) if 'config' in sys.argv else 0)\n")
        recorder.chmod(0o700)
        calls = root / "calls"
        env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "CALLS": str(calls)}
        command = ["bash", str(root / "start.sh"), "--platform-model", str(platform)]
        subprocess.run(command, env=env, check=True, capture_output=True)
        operations = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(operations), 2)
        self.assertEqual(operations[0][-2:], ["config", "--quiet"])
        self.assertEqual(operations[1][-8:], ["up", "-d", "--no-build", "--pull", "never", "--wait", "--no-deps", "app"])
        self.assertIn(str(root / "compose.model-gateway.yaml"), operations[1])
        env_indexes = [i for i, value in enumerate(operations[1]) if value == "--env-file"]
        self.assertEqual([operations[1][i+1] for i in env_indexes], [str(root / ".env"), str(platform)])
        calls.unlink()
        failed = subprocess.run(command, env={**env, "REFUSE_CONFIG": "1"}, capture_output=True)
        self.assertEqual(failed.returncode, 1)
        self.assertEqual(len(calls.read_text().splitlines()), 1)
        calls.unlink()
        platform.write_text("AGENTGATEWAY_MODEL_HOST=fixture-gateway\n")
        missing = subprocess.run(command, env=env, capture_output=True)
        self.assertEqual(missing.returncode, 78)
        self.assertFalse(calls.exists())

    def test_empty_missing_or_world_readable_secret_refuses(self):
        file = Path(self.env["DB_PASSWORD_FILE"])
        file.write_bytes(b"")
        self.assert_refused()
        file.write_bytes(b"fixture")
        file.chmod(0o644)
        self.assert_refused()
        missing = dict(self.env)
        missing["DB_PASSWORD_FILE"] = str(file.with_name("absent"))
        self.assert_refused(missing)

    def test_adapter_start_targets_only_existing_adapter_and_agent(self):
        root = Path(self.directory.name)
        (root / "start.sh").write_bytes(Path(__file__).with_name("start.sh").read_bytes())
        (root / ".env").write_text("KNOWLEDGE_NATIVE_ORIGIN=https://native.example.test\n")
        recorder = root / "docker"
        recorder.write_text("#!/usr/bin/env python3\nimport json,os,sys\nwith open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\nsys.exit(int(os.environ.get('REFUSE_CONFIG','0')) if 'config' in sys.argv else 0)\n")
        recorder.chmod(0o700)
        calls = root / "calls"
        env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "CALLS": str(calls)}
        command = ["bash", str(root / "start.sh"), "--platform-adapter"]
        subprocess.run(command, env=env, check=True, capture_output=True)
        operations = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(operations), 2)
        self.assertIn(str(root / "compose.adapter.yaml"), operations[1])
        self.assertEqual(operations[1][-9:], ["up", "-d", "--no-build", "--pull", "never", "--wait", "--no-deps", "adapter-agent", "adapter"])
        calls.unlink()
        result = subprocess.run(command, env={**env, "REFUSE_CONFIG": "1"}, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(calls.read_text().splitlines()), 1)

    def test_adapter_reader_generates_actual_scoped_uncached_agent_input(self):
        root = Path(self.directory.name)
        outputs, bootstrap = root / "outputs", root / "bootstrap"
        outputs.mkdir(mode=0o700)
        bootstrap.mkdir(mode=0o700)
        tenant = "11111111-1111-4111-8111-111111111111"
        namespace = "tenants/" + tenant
        deliveries = [{"secretKey": key, "locator": namespace + "/kv/" + key, "version": 2,
                       "audience": "fixture-" + key, "secretFile": str(outputs/key),
                       "secretSocket": str(outputs/"agent.sock"), "secretValueKey": "value"}
                      for key in ("native", "pep")]
        config = {"bindingId": tenant, "tenantId": tenant,
                  "nativeMcpBearerFile": deliveries[0]["secretFile"], "oidcClientSecretFile": deliveries[1]["secretFile"],
                  "actionTokenJwksFile": str(root/"jwks"),
                  "management": {"validation": {"bindingVersion": 1, "secretDeliveries": deliveries}}}
        config_file, operator = root/"adapter.json", root/"operator"
        config_file.write_text(json.dumps(config)); config_file.chmod(0o600)
        operator.write_text('{"root_token":"synthetic-operator"}'); operator.chmod(0o600)
        env = {"KNOWLEDGE_ADAPTER_CONFIG_FILE": str(config_file), "KNOWLEDGE_ADAPTER_JWKS_FILE": str(root/"jwks"),
               "KNOWLEDGE_ADAPTER_DELIVERY_DIRECTORY": str(outputs), "KNOWLEDGE_ADAPTER_BOOTSTRAP_DIRECTORY": str(bootstrap),
               "KNOWLEDGE_ADAPTER_UID": str(os.getuid()), "KNOWLEDGE_ADAPTER_GID": str(os.getgid()),
               "KNOWLEDGE_ADAPTER_BAO_ROLE": "adapter-reader", "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS": "2",
               "KNOWLEDGE_BAO_BOOTSTRAP_FILE": str(operator), "KNOWLEDGE_BAO_TOKEN_TTL": "60s", "KNOWLEDGE_BAO_WRAP_TTL": "60s"}
        policy = ''.join(f'path "kv/data/{key}" {{ capabilities = ["read"] }}\n' for key in ("native", "pep"))
        # Resume the actual adapter-reader consumer after a process died while
        # staging any of its three original Agent bootstrap inputs.
        for name in ("adapter-role-id", "adapter-wrapped-secret-id", "adapter-agent.hcl"):
            pending = bootstrap / (name + ".pending")
            pending.write_text("interrupted private delivery")
            pending.chmod(0o600)

        def response(path):
            method, _, headers, _ = received[-1]
            self.assertEqual(headers["X-Vault-Namespace"], namespace)
            self.assertNotIn("/data/", path)
            if path == "/v1/sys/mounts": data = {"kv/": {"type": "kv", "options": {"version": "2"}}}
            elif path == "/v1/sys/auth": data = {"approle/": {"type": "approle"}}
            elif path == "/v1/sys/policies/acl/adapter-reader": data = {"policy": policy}
            elif path == "/v1/auth/approle/role/adapter-reader":
                data = {"bind_secret_id": True, "secret_id_num_uses": 1, "token_policies": ["adapter-reader"], "token_ttl": 60, "token_max_ttl": 60}
            elif path.endswith("/role-id"): data = {"role_id": "synthetic-role"}
            elif path.endswith("/secret-id"):
                self.assertEqual(method, "POST")
                return 200, {}, b'{"wrap_info":{"token":"synthetic-one-use-wrap"}}'
            else: self.fail("unexpected native management endpoint")
            return 200, {}, json.dumps({"data": data}).encode()

        with NativeProvisioningTests.native_http(self, response) as (origin, received), redirect_stdout(io.StringIO()) as output:
            env["KNOWLEDGE_BAO_URL"] = origin
            provision.adapter_reader(env)
            generated = (bootstrap/"adapter-agent.hcl").read_text()
            self.assertIn('exit_after_auth = false', generated)
            self.assertIn('api_proxy { use_auto_auth_token = "force" }', generated)
            self.assertIn('listener "unix"', generated)
            self.assertIn('socket_mode = "0600"', generated)
            self.assertNotIn('cache {', generated)
            self.assertNotIn('sink ', generated)
            self.assertIn('?version=2', generated)
            self.assertEqual(generated.count('template {'), 2)
            self.assertIn(str(outputs/"agent.sock"), generated)
            self.assertNotIn('synthetic-operator', generated + output.getvalue())
            self.assertNotIn('synthetic-one-use-wrap', generated + output.getvalue())
            self.assertEqual(list(outputs.iterdir()), [])
            self.assertEqual((bootstrap/"adapter-agent.hcl").stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(bootstrap.glob("*.pending")), [])
            count = len(received)
            for failure in ("foreign-tenant", "outside-output", "bootstrap-mounted", "jwks-drift"):
                original = json.loads(json.dumps(config))
                changed_env = dict(env)
                if failure == "foreign-tenant": config["management"]["validation"]["secretDeliveries"][0]["locator"] = "tenants/22222222-2222-4222-8222-222222222222/kv/native"
                if failure == "outside-output": config["management"]["validation"]["secretDeliveries"][0]["secretFile"] = str(root/"native")
                if failure == "bootstrap-mounted": changed_env["KNOWLEDGE_ADAPTER_BOOTSTRAP_DIRECTORY"] = str(outputs)
                if failure == "jwks-drift": changed_env["KNOWLEDGE_ADAPTER_JWKS_FILE"] = str(root/"other-jwks")
                config_file.write_text(json.dumps(config))
                with self.assertRaises(provision.ConfigurationError): provision.adapter_reader(changed_env)
                self.assertEqual(len(received), count)
                config = original

    def test_relative_path_and_symlink_refuse(self):
        relative = dict(self.env)
        relative["DB_PASSWORD_FILE"] = "relative"
        self.assert_refused(relative)
        alias = Path(self.directory.name) / "alias"
        alias.symlink_to(self.env["DB_PASSWORD_FILE"])
        symlink = dict(self.env)
        symlink["DB_PASSWORD_FILE"] = str(alias)
        self.assert_refused(symlink)

    def test_native_lite_or_platform_database_cannot_be_substituted(self):
        for name, wrong in (
            ("REDIS_ADDR", ""),
            ("DB_HOST", "core-db"),
            ("DB_DRIVER", "sqlite"),
            ("AUTO_RECOVER_DIRTY", "true"),
            ("DOCREADER_ADDR", ""),
        ):
            with self.subTest(name=name):
                changed = {**self.env, name: wrong}
                self.assert_refused(changed)

    def test_direct_secret_is_not_a_second_configuration_source(self):
        for name in entrypoint.SECRET_NAMES:
            with self.subTest(name=name):
                self.assert_refused({**self.env, name: "conflicting-fixture"})

    def test_oidc_disabled_missing_client_or_ambiguous_url_refuses(self):
        for name, wrong in (
            ("OIDC_AUTH_ENABLE", "false"),
            ("OIDC_AUTH_CLIENT_ID", ""),
            ("OIDC_AUTH_ISSUER_URL", "https://user:password@idp.example.test"),
            ("OIDC_AUTH_DISCOVERY_URL", "file:///tmp/config"),
            ("OIDC_AUTH_DISCOVERY_URL", "https://idp.example.test/\nother"),
            ("FRONTEND_BASE_URL", "https://knowledge.example.test/other-app"),
            ("OIDC_AUTH_SCOPES", "profile email"),
            ("OIDC_AUTH_SCOPES", "openid openid"),
        ):
            with self.subTest(name=name):
                self.assert_refused({**self.env, name: wrong})

    def test_native_entrypoint_and_privilege_drop_are_preserved(self):
        with (
            patch.dict(os.environ, self.env, clear=True),
            patch.object(entrypoint.sys, "argv", ["native_entrypoint.py"]),
            patch.object(entrypoint.os, "execve") as execute,
        ):
            entrypoint.main()
        path, args, env = execute.call_args.args
        self.assertEqual(path, "/app/scripts/docker-entrypoint.sh")
        self.assertEqual(args, [path, "./WeKnora"])
        self.assertEqual(env["OIDC_AUTH_CLIENT_ID"], self.env["OIDC_AUTH_CLIENT_ID"])
        for name in entrypoint.SECRET_NAMES:
            self.assertNotIn(env[name], " ".join(args))

    def test_command_override_cannot_skip_file_validation(self):
        with (
            patch.dict(os.environ, self.env, clear=True),
            patch.object(entrypoint.sys, "argv", ["native_entrypoint.py", "sh"]),
            patch.object(entrypoint.os, "execve") as execute,
        ):
            with self.assertRaises(entrypoint.ConfigurationError):
                entrypoint.main()
            execute.assert_not_called()

    def test_actual_proxy_renderer_preserves_native_headers_except_fixed_origin(self):
        deploy = Path(__file__).parent
        original = (deploy.parent.parent / "frontend/nginx-api-proxy.conf").read_text()
        rendered = subprocess.run(
            ["awk", "-v", "authority=knowledge.example.test:9443", "-v", "scheme=https",
             "-f", str(deploy / "render_proxy.awk")],
            input=original, capture_output=True, text=True, check=False,
        )
        self.assertEqual(rendered.returncode, 0)
        self.assertEqual(
            rendered.stdout,
            original.replace(
                "proxy_set_header Host $http_host;",
                "proxy_set_header Host knowledge.example.test:9443;",
            ).replace(
                "proxy_set_header X-Forwarded-Proto $scheme;",
                "proxy_set_header X-Forwarded-Proto https;",
            ),
        )

    def test_actual_proxy_renderer_rejects_unknown_or_duplicate_native_template(self):
        deploy = Path(__file__).parent
        original = (deploy.parent.parent / "frontend/nginx-api-proxy.conf").read_text()
        for source in (
            original.replace("proxy_set_header Host $http_host;", "proxy_set_header Host $host;"),
            original + "proxy_set_header Host $http_host;\n",
        ):
            with self.subTest(source=source[:0]):
                result = subprocess.run(
                    ["awk", "-v", "authority=knowledge.example.test", "-v", "scheme=https",
                     "-f", str(deploy / "render_proxy.awk")],
                    input=source, capture_output=True, text=True, check=False,
                )
                self.assertEqual(result.returncode, 78)


class NativeProvisioningTests(unittest.TestCase):
    @contextmanager
    def model_delivery_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binding = "11111111-1111-4111-8111-111111111111"
            service = "22222222-2222-4222-8222-222222222222"
            tenant = "33333333-3333-4333-8333-333333333333"
            route = "44444444-4444-4444-8444-444444444444"
            model = "55555555-5555-4555-8555-555555555555"
            reference = {"locator": f"tenants/{tenant}/kv/application-model/{binding}/1", "version": 1, "audience": "native-fixture"}
            projection = {"bindingId": binding, "tenantId": tenant, "generation": 1, "configDigest": "ab"*32,
                "gatewayPrincipalId": service, "nativeScopeRef": "42", "serviceSecretRef": reference,
                "secretRef": {**reference, "audience": "core-fixture"},
                "secretReader": {"servicePrincipalId": service, "audience": "native-fixture", "roleName": "native-reader"},
                "routeResourceIds": [route], "routes": [{"resourceId": route, "nativeId": "fixture-route"}],
                "deliveryChallenges": [{"routeResourceId": route, "verificationNonce": "cd"*32}]}
            value = {"projection": projection, "models": [{"routeResourceId": route, "nativeModelRef": model, "baseUrl": "https://gateway.example.test/v1"}]}
            material = {"delivery": value, "requestId": "66666666-6666-4666-8666-666666666666", "version": 1, "value": "synthetic-model-key"}
            env = {"KNOWLEDGE_MODEL_DELIVERY_INPUT_FILE": str(root / "input"),
                   "KNOWLEDGE_MODEL_CREDENTIAL_FILE": str(root / "credential"),
                   "KNOWLEDGE_NATIVE_ADMIN_SESSION_FILE": str(root / "session"),
                   "KNOWLEDGE_PROVISION_TIMEOUT_SECONDS": "2", "KNOWLEDGE_DELIVERY_DIRECTORY": str(root)}
            for name, content in (("input", json.dumps(value)), ("credential", json.dumps(material)), ("session", "synthetic-native-session")):
                (root/name).write_text(content)
                (root/name).chmod(0o600)
            yield env, value, material, root

    def test_model_delivery_recovers_lost_ack_by_native_read_without_rewrite(self):
        with self.model_delivery_fixture() as (env, value, material, root):
            stored = {"key": "old-fixture", "writes": 0}
            projection = value["projection"]
            model = value["models"][0]

            def response(path):
                method, _, headers, raw = received[-1]
                self.assertEqual(headers["Authorization"], "Bearer synthetic-native-session")
                if method == "GET":
                    payload = {"id": model["nativeModelRef"], "tenant_id": 42, "name": "fixture-route",
                               "is_builtin": False, "parameters": {"base_url": model["baseUrl"]}}
                else:
                    body = json.loads(raw)
                    if "api_key" in body:
                        stored.update(key=body["api_key"], writes=stored["writes"]+1)
                        return 503, {}, b'{}'  # Committed by native service; acknowledgement lost.
                    nonce = body["verification_nonce"]
                    message = "application-model-key:v1\0" + projection["nativeScopeRef"] + "\0" + model["nativeModelRef"] + "\0" + nonce
                    payload = {"verification_nonce": nonce, "api_key_proof": hmac.new(stored["key"].encode(), message.encode(), hashlib.sha256).hexdigest()}
                return 200, {}, json.dumps({"success": True, "data": payload}).encode()

            with self.native_http(response) as (origin, received), redirect_stdout(io.StringIO()) as output:
                env["KNOWLEDGE_NATIVE_ORIGIN"] = origin
                provision.model_delivery(env)
                receipt = json.loads((root / "model-delivery-receipt.json").read_text())
                self.assertEqual(receipt[0]["requestId"], material["requestId"])
                self.assertEqual(receipt[0]["secretRef"], projection["serviceSecretRef"])
                self.assertEqual(stored["writes"], 1)
                provision.model_delivery(env)  # Receipt recovery does not rewrite already matching storage.
                self.assertEqual(stored["writes"], 1)
                self.assertNotIn(material["value"], output.getvalue())
                self.assertNotIn(material["value"], (root / "model-delivery-receipt.json").read_text())

    def test_model_delivery_rejects_configured_only_stale_nonce_and_wrong_native_scope(self):
        for failure in ("configured", "stale", "wrong-key", "foreign-tenant", "foreign-model", "wrong-endpoint"):
            with self.subTest(failure=failure), self.model_delivery_fixture() as (env, value, material, root):
                model = value["models"][0]
                nonce = value["projection"]["deliveryChallenges"][0]["verificationNonce"]
                writes = []

                def response(path):
                    method, _, _, raw = received[-1]
                    if method == "GET":
                        data = {"id": model["nativeModelRef"], "tenant_id": 42, "name": "fixture-route",
                                "is_builtin": False, "parameters": {"base_url": model["baseUrl"]}}
                        if failure == "foreign-tenant": data["tenant_id"] = 43
                        if failure == "foreign-model": data["id"] = "other"
                        if failure == "wrong-endpoint": data["parameters"]["base_url"] = "https://other.example.test"
                    else:
                        body = json.loads(raw)
                        if "api_key" in body:
                            writes.append(body)
                        chosen = "ef"*32 if failure == "stale" else nonce
                        key = "wrong-fixture" if failure == "wrong-key" else material["value"]
                        message = "application-model-key:v1\0" + "42\0" + model["nativeModelRef"] + "\0" + chosen
                        data = {"verification_nonce": chosen, "api_key_proof": hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()}
                        if failure == "configured": data = {"fields": {"api_key": {"configured": True}}}
                    return 200, {}, json.dumps({"success": True, "data": data}).encode()

                with self.native_http(response) as (origin, received), self.assertRaises(provision.ConfigurationError):
                    env["KNOWLEDGE_NATIVE_ORIGIN"] = origin
                    provision.model_delivery(env)
                self.assertLessEqual(len(writes), 1)
                self.assertFalse((root / "model-delivery-receipt.json").exists())

    def test_model_delivery_rejects_mismatched_agent_version_and_duplicate_route(self):
        with self.model_delivery_fixture() as (env, value, material, root):
            env["KNOWLEDGE_NATIVE_ORIGIN"] = "https://native.example.test"
            material["version"] = 2
            (root/"credential").write_text(json.dumps(material))
            with patch("provision.open_direct", side_effect=AssertionError("no HTTP allowed")):
                with self.assertRaises(provision.ConfigurationError): provision.model_delivery(env)
                value["models"].append(value["models"][0])
                (root/"input").write_text(json.dumps(value))
                with self.assertRaises(provision.ConfigurationError): provision.model_input(env)

    def test_model_reader_uses_existing_kv_and_agent_request_id_without_reading_value(self):
        for wrong_policy in (False, True):
            with self.subTest(wrong_policy=wrong_policy), self.model_delivery_fixture() as (env, value, _material, root):
                projection = value["projection"]
                namespace = "tenants/" + projection["tenantId"]
                locator = projection["serviceSecretRef"]["locator"]
                native_path = locator[len(namespace)+1:].replace("kv/", "kv/data/", 1)
                policy = f'path "{native_path}" {{ capabilities = ["read"] }}\n'
                bootstrap = root/"operator"
                bootstrap.write_text('{"root_token":"synthetic-operator"}')
                bootstrap.chmod(0o600)
                env.update(KNOWLEDGE_BAO_BOOTSTRAP_FILE=str(bootstrap), KNOWLEDGE_BAO_TOKEN_TTL="60s", KNOWLEDGE_BAO_WRAP_TTL="60s")

                def response(path):
                    method, _, headers, _ = received[-1]
                    self.assertEqual(headers["X-Vault-Namespace"], namespace)
                    self.assertNotIn("/data/", path)
                    if path == "/v1/sys/mounts": data = {"kv/": {"type":"kv", "options":{"version":"2"}}}
                    elif path == "/v1/sys/auth": data = {"approle/":{"type":"approle"}}
                    elif path == "/v1/sys/policies/acl/native-reader": data = {"policy": "wrong" if wrong_policy else policy}
                    elif path == "/v1/auth/approle/role/native-reader":
                        data = {"bind_secret_id":True,"secret_id_num_uses":1,"token_policies":["native-reader"],"token_ttl":60,"token_max_ttl":60}
                    elif path.endswith("/role-id"): data = {"role_id":"synthetic-role"}
                    elif path.endswith("/secret-id"):
                        self.assertEqual(method,"POST")
                        return 200, {}, b'{"wrap_info":{"token":"synthetic-one-use-wrap"}}'
                    else: self.fail("unexpected native management endpoint")
                    return 200, {}, json.dumps({"data":data}).encode()

                with self.native_http(response) as (origin, received), redirect_stdout(io.StringIO()) as output:
                    env["KNOWLEDGE_BAO_URL"] = origin
                    if wrong_policy:
                        with self.assertRaises(provision.ConfigurationError): provision.model_reader(env)
                        self.assertTrue(all(row[0] == "GET" for row in received))
                    else:
                        provision.model_reader(env)
                        rendered = (root/"model-agent.hcl").read_text()
                        self.assertIn(".RequestID | toJSON", rendered)
                        self.assertIn("?version=1", rendered)
                        self.assertIn(".Data.metadata.version | toJSON", rendered)
                        self.assertIn(".Data.data.value | toJSON", rendered)
                        self.assertNotIn("synthetic-operator", rendered + output.getvalue())
                        self.assertEqual((root/"model-agent.hcl").stat().st_mode & 0o777, 0o600)

    @contextmanager
    def native_http(self, response):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                requests.append((self.command, self.path, dict(self.headers), body))
                status, headers, payload = response(self.path)
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(payload)

            do_POST = do_GET
            do_PUT = do_GET

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
            thread.start()
            try:
                yield f"http://127.0.0.1:{server.server_port}", requests
            finally:
                server.shutdown()
                thread.join()

    def test_authenticated_native_requests_never_follow_redirects(self):
        for code in (301, 302, 303, 307, 308):
            for method in ("GET", "POST", "PUT"):
                with self.subTest(code=code, method=method), self.native_http(
                    lambda _path: (200, {}, b'{}')
                ) as (destination, forwarded), self.native_http(
                    lambda _path: (code, {"Location": destination + "/unexpected"}, b'')
                ) as (origin, received):
                    api = provision.API(origin, 2, {
                        "Authorization": "Bearer fixture-only", "X-Vault-Token": "fixture-only",
                    })
                    with self.assertRaisesRegex(provision.ConfigurationError, f"HTTP {code}$"):
                        api.request(method, "/native", None if method == "GET" else {"fixture": True})
                    self.assertEqual(len(received), 1)
                    self.assertEqual(forwarded, [])

    def test_native_oidc_password_exchange_does_not_follow_redirect(self):
        with tempfile.TemporaryDirectory() as directory, self.native_http(
            lambda _path: (200, {}, b'{"access_token":"fixture"}')
        ) as (destination, forwarded), self.native_http(
            lambda _path: (302, {"Location": destination + "/unexpected"}, b'')
        ) as (origin, received):
            password = Path(directory) / "operator"
            password.write_text("operator-fixture")
            password.chmod(0o600)
            env = {
                "KNOWLEDGE_NATIVE_ORIGIN": "https://knowledge.example.test",
                "KNOWLEDGE_IDP_ADMIN_URL": origin,
                "KNOWLEDGE_IDP_REALM": "native",
                "KNOWLEDGE_OIDC_CLIENT_ID": "knowledge-client",
                "KNOWLEDGE_OIDC_ISSUER_URL": origin + "/realms/native",
                "KNOWLEDGE_IDP_ADMIN_USER": "operator-fixture",
                "KNOWLEDGE_IDP_ADMIN_PASSWORD_FILE": str(password),
            }
            with self.assertRaises(provision.urllib.error.HTTPError) as error:
                provision.native_client(env, 2)
            self.assertEqual(error.exception.code, 302)
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0][0], "POST")
            self.assertEqual(forwarded, [])

    def test_native_requests_ignore_process_proxy_and_keep_normal_responses(self):
        def native_response(path):
            return (404, {}, b'{}') if path == "/missing" else (200, {}, b'{"data":"fixture"}')

        with self.native_http(lambda _path: (500, {}, b'{}')) as (proxy, forwarded), self.native_http(
            native_response
        ) as (origin, received), patch.dict(os.environ, {
            "http_proxy": proxy, "HTTP_PROXY": proxy, "https_proxy": proxy,
            "HTTPS_PROXY": proxy, "all_proxy": proxy, "ALL_PROXY": proxy,
            "no_proxy": "", "NO_PROXY": "",
        }):
            api = provision.API(origin, 2, {"X-Vault-Token": "fixture-only"})
            self.assertEqual(api.request("GET", "/native"), {"data": "fixture"})
            self.assertIsNone(api.request("GET", "/missing", missing=True))
            self.assertEqual(len(received), 2)
            self.assertEqual(forwarded, [])

    def test_existing_identity_callback_mismatch_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            password = Path(directory) / "operator"
            password.write_text("operator-fixture")
            password.chmod(0o600)
            env = {
                "KNOWLEDGE_NATIVE_ORIGIN": "https://knowledge.example.test",
                "KNOWLEDGE_IDP_ADMIN_URL": "https://idp.example.test",
                "KNOWLEDGE_IDP_REALM": "native",
                "KNOWLEDGE_OIDC_CLIENT_ID": "knowledge-client",
                "KNOWLEDGE_OIDC_ISSUER_URL": "https://idp.example.test/realms/native",
                "KNOWLEDGE_IDP_ADMIN_USER": "operator-fixture",
                "KNOWLEDGE_IDP_ADMIN_PASSWORD_FILE": str(password),
            }
            token_response = MagicMock()
            token_response.__enter__.return_value.read.return_value = b'{"access_token":"fixture"}'
            api = MagicMock()
            api.request.side_effect = [
                [{"id": "fixture-id", "clientId": "knowledge-client"}],
                {"id": "fixture-id", "clientId": "knowledge-client", "enabled": True,
                 "protocol": "openid-connect", "publicClient": False,
                 "standardFlowEnabled": True, "directAccessGrantsEnabled": False,
                 "serviceAccountsEnabled": False,
                 "redirectUris": ["https://different.example.test/callback"],
                 "webOrigins": ["https://knowledge.example.test"]},
                {"type": "secret", "value": "fixture-client-secret"},
            ]
            with (
                patch.object(provision, "open_direct", return_value=token_response),
                patch.object(provision, "API", return_value=api),
            ):
                with self.assertRaisesRegex(provision.ConfigurationError, "not overwritten"):
                    provision.native_client(env, 1)
            self.assertEqual([call.args[0] for call in api.request.call_args_list], ["GET", "GET"])

    def test_atomic_delivery_does_not_follow_symlink_or_emit_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "delivery"
            provision.write_private(target, "first")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            provision.write_private(target, "second")
            self.assertEqual(target.read_text(), "second")
            self.assertFalse(target.with_name("delivery.pending").exists())
            link = Path(directory) / "alias"
            link.symlink_to(target)
            with self.assertRaises(provision.ConfigurationError):
                provision.write_private(link, "not-delivered")
            self.assertEqual(target.read_text(), "second")

    def test_interrupted_delivery_preserves_original_and_recovers_its_private_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "delivery"
            provision.write_private(target, "original")
            with patch("provision.os.replace", side_effect=OSError("interrupted replacement")):
                with self.assertRaises(OSError): provision.write_private(target, "new")
            self.assertEqual(target.read_text(), "original")
            pending = target.with_name("delivery.pending")
            self.assertFalse(pending.exists())
            pending.write_text("crashed writer")
            pending.chmod(0o600)
            provision.write_private(target, "recovered")
            self.assertEqual(target.read_text(), "recovered")
            self.assertFalse(pending.exists())

    def test_delivery_refuses_unsafe_staging_and_a_concurrent_directory_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "delivery"
            provision.write_private(target, "original")
            pending = target.with_name("delivery.pending")
            pending.symlink_to(target)
            with self.assertRaises(provision.ConfigurationError): provision.write_private(target, "refused")
            self.assertTrue(pending.is_symlink())
            pending.unlink()
            pending.write_text("not owner private")
            pending.chmod(0o644)
            with self.assertRaises(provision.ConfigurationError): provision.write_private(target, "refused")
            self.assertEqual(pending.read_text(), "not owner private")
            pending.chmod(0o600)
            other = Path(directory) / "other"
            os.link(pending, other)
            with self.assertRaises(provision.ConfigurationError): provision.write_private(target, "refused")
            other.unlink()
            lock = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                provision.fcntl.flock(lock, provision.fcntl.LOCK_EX | provision.fcntl.LOCK_NB)
                with self.assertRaises(provision.ConfigurationError): provision.write_private(target, "refused")
                self.assertEqual(pending.read_text(), "not owner private")
            finally:
                os.close(lock)
            self.assertEqual(target.read_text(), "original")
            provision.write_private(target, "recovered")
            self.assertEqual(target.read_text(), "recovered")

    def test_operator_secret_refuses_world_or_group_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "credential"
            target.write_text("fixture")
            for permissions in (0o644, 0o640, 0o660):
                target.chmod(permissions)
                with self.assertRaises(provision.ConfigurationError):
                    provision.private_file(target)
            target.chmod(0o600)
            self.assertEqual(provision.private_file(target), "fixture")


if __name__ == "__main__":
    unittest.main()
