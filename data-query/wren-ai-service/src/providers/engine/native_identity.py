"""Dedicated service credentials and private original HUMAN task transport."""

import json
import os
import stat
import re
from contextvars import ContextVar
from dataclasses import dataclass, field
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


def _configuration(endpoint):
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
    return value


def _delivery(endpoint):
    value = _configuration(endpoint)
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


class NativeQueryPending(RuntimeError):
    def __init__(self):
        super().__init__("Native query outcome unavailable; observe the original query before retrying")


@dataclass(repr=False)
class NativeAskContext:
    # This object is never a Pydantic request, pipeline argument or trace input.
    human_token: str = field(repr=False)
    task_id: str
    project_id: str
    deployment_hash: str
    polling_interval: float
    query_scope: str | None = None


native_ask_context: ContextVar[NativeAskContext | None] = ContextVar("native_ask_context", default=None)


def native_ask_transport(headers, task_id, project_id, deployment_hash):
    authorization = headers.get("x-wren-native-authorization")
    interval = headers.get("x-wren-native-poll-interval-ms")
    if authorization is None and interval is None:
        return None
    if (
        not isinstance(authorization, str)
        or not re.fullmatch(r"Bearer [^\s,]+", authorization)
        or not isinstance(interval, str)
        or not interval.isascii()
        or not interval.isdecimal()
        or int(interval) <= 0
        or task_id is None
        or not isinstance(project_id, str)
        or not re.fullmatch(r"[1-9][0-9]*", project_id)
        or not isinstance(deployment_hash, str)
        or not re.fullmatch(r"[a-f0-9]{40}", deployment_hash)
    ):
        raise NativeIdentityUnavailable()
    return NativeAskContext(authorization[7:], str(task_id), project_id, deployment_hash, int(interval) / 1000)


async def run_native_ask(context, call, request, **kwargs):
    # Set/reset in the actual BackgroundTasks async task, not in the HTTP
    # router's task. All original pipeline descendants inherit this context.
    handle = native_ask_context.set(context)
    try:
        return await call(request, **kwargs)
    finally:
        native_ask_context.reset(handle)
        if context is not None:
            context.human_token = ""


def native_human_headers(endpoint, context):
    configuration = _configuration(endpoint)
    if not context.human_token:
        raise NativeQueryPending()
    return {"Authorization": f"Bearer {context.human_token}", "Origin": configuration["publicOrigin"]}


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
