"""Post-implementation tests of the actual native process entrypoint."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


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


if __name__ == "__main__":
    unittest.main()
