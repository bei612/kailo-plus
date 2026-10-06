#!/usr/bin/env python3
"""Deliver file-backed secrets to the unchanged native WeKnora process."""

import os
import ipaddress
import re
import stat
import sys
from urllib.parse import urlsplit


class ConfigurationError(Exception):
    """Only field names, never supplied values, may appear in this exception."""


SECRET_NAMES = (
    "DB_PASSWORD",
    "REDIS_PASSWORD",
    "SYSTEM_AES_KEY",
    "SYSTEM_SIGNING_KEY",
    "JWT_SECRET",
    "OIDC_AUTH_CLIENT_SECRET",
)


def required(env, name):
    value = env.get(name, "")
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or any(character in value for character in ("\x00", "\r", "\n"))
    ):
        raise ConfigurationError(f"{name}: required exact nonempty value")
    return value


def read_secret(env, name):
    if env.get(name):
        raise ConfigurationError(f"{name}: direct environment delivery is forbidden")
    path = required(env, name + "_FILE")
    if not os.path.isabs(path):
        raise ConfigurationError(f"{name}_FILE: absolute file path required")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as secret_file:
            info = os.fstat(secret_file.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o007:
                raise ConfigurationError(f"{name}_FILE: private regular file required")
            raw = secret_file.read(65537)
    except OSError:
        raise ConfigurationError(f"{name}_FILE: unreadable") from None
    if not raw or len(raw) > 65536 or b"\x00" in raw or b"\r" in raw or b"\n" in raw:
        raise ConfigurationError(f"{name}_FILE: exact single-line bytes required")
    if name == "SYSTEM_AES_KEY" and len(raw) != 32:
        raise ConfigurationError("SYSTEM_AES_KEY_FILE: exactly 32 bytes required")
    try:
        return raw.decode("utf-8")
    except UnicodeError:
        raise ConfigurationError(f"{name}_FILE: UTF-8 required") from None


def http_url(env, name, origin=False):
    value = required(env, name)
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in ("http", "https")
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and (not origin or parsed.path in ("", "/"))
        )
        # Force validation of a malformed/non-numeric port before exec.
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ConfigurationError(f"{name}: absolute HTTP(S) URL without credentials required")
    return value


def prepare_environment(original):
    env = dict(original)
    # This entrypoint belongs to the adjacent independent-service Compose only.
    # It must not silently use native Lite mode or a platform Core database.
    for name, expected in (
        ("DB_DRIVER", "postgres"),
        ("DB_HOST", "postgres"),
        ("DB_PORT", "5432"),
        ("REDIS_ADDR", "redis:6379"),
        ("DOCREADER_ADDR", "docreader:50051"),
        ("OIDC_AUTH_ENABLE", "true"),
        ("AUTO_RECOVER_DIRTY", "false"),
    ):
        if env.get(name) != expected:
            raise ConfigurationError(f"{name}: independent deployment value required")
    required(env, "DB_USER")
    required(env, "DB_NAME")
    required(env, "OIDC_AUTH_CLIENT_ID")
    http_url(env, "OIDC_AUTH_ISSUER_URL")
    http_url(env, "OIDC_AUTH_DISCOVERY_URL")
    http_url(env, "FRONTEND_BASE_URL", origin=True)
    if "KNOWLEDGE_PLATFORM_MODEL_BASE_URL" in env:
        value = http_url(env, "KNOWLEDGE_PLATFORM_MODEL_BASE_URL")
        parsed = urlsplit(value)
        host = parsed.hostname
        try:
            ipaddress.ip_address(host)
            exact_host = True
        except ValueError:
            exact_host = len(host) <= 253 and all(
                re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
                for label in host.split(".")
            )
        if not exact_host or parsed.path != "/v1" or parsed.port == 0:
            raise ConfigurationError("KNOWLEDGE_PLATFORM_MODEL_BASE_URL: exact Gateway host and /v1 required")
        # Reuse the native global SSRF allowlist, preserving existing approved
        # IdP hosts. No wildcard/CIDR is derived and other targets stay denied.
        allowed = [item.strip() for item in env.get("SSRF_WHITELIST_EXTRA", "").split(",") if item.strip()]
        if host not in allowed:
            allowed.append(host)
        env["SSRF_WHITELIST_EXTRA"] = ",".join(allowed)
        del env["KNOWLEDGE_PLATFORM_MODEL_BASE_URL"]
    scopes = required(env, "OIDC_AUTH_SCOPES").replace(",", " ").split()
    if "openid" not in scopes or len(scopes) != len(set(scopes)):
        raise ConfigurationError("OIDC_AUTH_SCOPES: unique scopes including openid required")
    for name in SECRET_NAMES:
        env[name] = read_secret(env, name)
        del env[name + "_FILE"]
    return env


def main():
    if sys.argv[1:]:
        raise ConfigurationError("entrypoint: command override is forbidden")
    env = prepare_environment(os.environ)
    # Preserve the native ownership/drop-privilege entrypoint and its native app.
    # No shell evaluation, secret argv, registration, migration API, or role grant.
    os.execve(
        "/app/scripts/docker-entrypoint.sh",
        ["/app/scripts/docker-entrypoint.sh", "./WeKnora"],
        env,
    )


if __name__ == "__main__":
    try:
        main()
    except ConfigurationError as error:
        print(f"knowledge configuration refused: {error}", file=sys.stderr)
        sys.exit(78)
