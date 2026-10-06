"""Dedicated native-service OIDC credentials; never a platform user token."""

import json
import os
import stat
from urllib.parse import urlsplit


class NativeIdentityUnavailable(Exception):
    def __init__(self):
        super().__init__("Native service identity unavailable")


def _origin(value):
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise NativeIdentityUnavailable()
    return f"{parsed.scheme}://{parsed.netloc}"


def _delivery(endpoint):
    path = os.environ.get("WREN_NATIVE_SERVICE_IDENTITY_FILE", "")
    if not os.path.isabs(path):
        raise NativeIdentityUnavailable()
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    fields = ("uiEndpoint", "publicOrigin", "tokenEndpoint", "clientId", "secretFile")
    if not isinstance(value, dict) or set(value) != set(fields):
        raise NativeIdentityUnavailable()
    if any(
        not isinstance(value[key], str)
        or not value[key]
        or value[key].strip() != value[key]
        for key in fields
    ):
        raise NativeIdentityUnavailable()
    if (
        value["uiEndpoint"] != endpoint
        or value["uiEndpoint"] != _origin(value["uiEndpoint"])
        or value["publicOrigin"] != _origin(value["publicOrigin"])
        or not os.path.isabs(value["secretFile"])
    ):
        raise NativeIdentityUnavailable()
    _origin(value["tokenEndpoint"])
    # OpenBao/controlled delivery publishes owner-readable regular files.
    # Re-read every call to consume rotations without keeping a stale token.
    descriptor = os.open(value["secretFile"], os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, encoding="utf-8") as stream:
        metadata = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_mode & 0o077
        ):
            raise NativeIdentityUnavailable()
        secret = stream.read().removesuffix("\n").removesuffix("\r")
    if not secret or any(ord(c) < 32 or ord(c) == 127 for c in secret):
        raise NativeIdentityUnavailable()
    return value, secret


async def native_headers(session, endpoint, timeout):
    try:
        value, secret = _delivery(endpoint)
        # The issuer, not Wren, grants this native service account access to the
        # dedicated UI audience/instance. No default grant or token forwarding.
        async with session.post(
            value["tokenEndpoint"],
            data={
                "grant_type": "client_credentials",
                "client_id": value["clientId"],
                "client_secret": secret,
            },
            timeout=timeout,
            allow_redirects=False,
        ) as response:
            if response.status != 200:
                raise NativeIdentityUnavailable()
            token = await response.json()
        access = token.get("access_token")
        if (
            not isinstance(access, str)
            or not access
            or any(c.isspace() or ord(c) < 32 or ord(c) == 127 or c == "," for c in access)
            or token.get("token_type", "").lower() != "bearer"
        ):
            raise NativeIdentityUnavailable()
        return {
            "Authorization": f"Bearer {access}",
            "Origin": value["publicOrigin"],
        }
    except Exception:
        # Never surface issuer responses, file paths or credentials.
        raise NativeIdentityUnavailable() from None
