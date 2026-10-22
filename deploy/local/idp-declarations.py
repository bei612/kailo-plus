#!/usr/bin/env python3
"""IdP 声明式配置的唯一期望值定义（DD-133(3)(6)、SS-AGW-END-SESSION、`.design/07` §4.7.3/§4.7.5、ADR-20 §1）。

由 bootstrap.sh 的同名模式调用（bootstrap 先解析运行目录并以 allexport 读入运行 .env）；声明与回读
共用本文件中的同一份期望值，不另写第二份：

  sync-redirects            平台浏览器与原生客户端的回调、来源与模板声明的属性（如 post.logout.redirect.uris）
                            收敛到目标 commit 的 realm 模板；期望值只由模板与非密 .env 键渲染，不读取运行目录里
                            渲染过的导入文件（那份文件只在 bootstrap 初始化时写入，发布不会更新它）。
  sync-redirects --verify   同一期望值的只读回读。
  native-profiles           组件专属 browser client 的 profile/email 默认 scope、kailo-picture/kailo-locale mapper、
                            back-channel 退出属性，realm 用户资料的 picture 属性，以及全部用户的 picture。
  native-profiles --users-only   只收敛用户 picture（新用户），客户端与用户资料只读核对。
  native-profiles --verify  同一期望值的只读回读。

NATIVE_OIDC_CLIENTS 为空时组件专属客户端未声明：声明与回读都如实输出 UNDECLARED 并以 0 退出，不写入任何东西；
值存在但无效时拒绝。已有同名而不一致的 mapper 或资料属性一律拒绝，不覆写。只读取 INPUT_ENV 中的键；
管理口令只从运行目录的 secrets/keycloak_admin_password 读入内存。标准输出只有一行 JSON（状态与计数），
任何输出都不含配置值、口令或令牌。
"""
import json
import os
import pathlib
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

# 本步骤读取的全部 .env 键。发布入口（tools/release/model.py idp_inputs）以 ast 读取这一常量计算配置摘要，
# 新增读取必须加在这里，否则摘要不随之变化。
INPUT_ENV = (
    "PUBLIC_ORIGIN", "OIDC_ISSUER", "OIDC_REALM", "KEYCLOAK_ADMIN_USER", "VERIFY_BOOTSTRAP_WAIT_SECONDS",
    "NATIVE_OIDC_CLIENTS", "NATIVE_PAGE_ORIGINS",
    "OIDC_SERVICE_CLIENT_ID", "OIDC_WORKER_CLIENT_ID", "OIDC_BROWSER_CLIENT_ID", "OIDC_NATIVE_CLIENT_ID",
    "OIDC_NATIVE_AUDIENCE", "OIDC_NATIVE_MOBILE_REDIRECT_URI", "AGENTGATEWAY_ADMIN_AUDIENCE",
    "TEMPORAL_NAMESPACE", "VERIFY_USER", "BOOTSTRAP_USER", "PLATFORM_ADMIN_USER",
)
# 摘要另覆盖的仓库文件（相对 deploy/local）。
INPUT_FILES = ("idp-declarations.py", "identity-provider/realm.json")
# 回调同步只收敛这两个平台客户端的这三类字段（与 bootstrap 初始化导入同一模板）。
REDIRECT_KEYS = ("redirectUris", "webOrigins", "attributes")
# 消息里只写角色，不写 client id（它们也是 .env 值）。
LABELS = {"OIDC_BROWSER_CLIENT_ID": "平台浏览器客户端", "OIDC_NATIVE_CLIENT_ID": "平台原生客户端"}
PLACEHOLDER = re.compile(r"__[A-Z][A-Z_]*__")


class Refused(Exception):
    pass


def env(name):
    value = os.environ.get(name)
    if name not in INPUT_ENV:
        raise Refused(f"{name} 不是本步骤登记的输入")
    if value is None or not value.strip():
        raise Refused(f".env 缺少 {name}")
    return value


# ---- 期望值 -------------------------------------------------------------------

def template_substitutions(values):
    """realm 模板中可以出现在回调字段里的非密占位符 → 值。两条回调由 PUBLIC_ORIGIN 派生，
    与 bootstrap 初始化渲染（OIDC_REDIRECT_URI、OIDC_POST_LOGOUT_REDIRECT_URI）同一规则。"""
    subs = {f"__{k}__": values[k] for k in INPUT_ENV if k in values}
    origin = values["PUBLIC_ORIGIN"]
    subs["__OIDC_REDIRECT_URI__"] = origin + "/oauth/callback"
    subs["__OIDC_POST_LOGOUT_REDIRECT_URI__"] = origin + "/app/"
    return subs


def substitute(node, subs):
    if isinstance(node, str):
        return PLACEHOLDER.sub(lambda m: subs.get(m.group(), m.group()), node)
    if isinstance(node, list):
        return [substitute(item, subs) for item in node]
    if isinstance(node, dict):
        return {key: substitute(value, subs) for key, value in node.items()}
    return node


def desired_redirects(template, values):
    """{clientId: {redirectUris, webOrigins, attributes}}：只取模板中浏览器与原生客户端的回调字段，
    只代入非密占位符；字段里留有其他占位符（例如 secret）即拒绝，而不是读取 secret 补齐。"""
    subs = template_substitutions(values)
    wanted = {}
    for key in ("OIDC_BROWSER_CLIENT_ID", "OIDC_NATIVE_CLIENT_ID"):
        entries = [c for c in template.get("clients", []) if c.get("clientId") == f"__{key}__"]
        if len(entries) != 1:
            raise Refused(f"realm 模板中 {key} 客户端不唯一")
        fields = substitute({k: entries[0][k] for k in REDIRECT_KEYS if k in entries[0]}, subs)
        if PLACEHOLDER.search(json.dumps(fields)):
            raise Refused(f"realm 模板中 {key} 的回调字段含非 .env 占位符")
        wanted[values[key]] = (LABELS[key], fields)
    return wanted


def same_redirects(current, desired):
    # Keycloak 把回调与来源当作集合保存；属性只核对模板声明的键，其余属性不读不写。
    for k, v in desired.items():
        if k == "attributes":
            actual = current.get(k) or {}
            if any(actual.get(name) != value for name, value in v.items()):
                return False
        elif sorted(current.get(k) or []) != sorted(v):
            return False
    return True


def exact_origin(value):
    parts = urllib.parse.urlsplit(value)
    return (parts.scheme in ("http", "https") and bool(parts.netloc) and not parts.username
            and not parts.password and not parts.path and not parts.query and not parts.fragment)


# .design/07 §4.7.5 固定接收路径（Cells、WeKnora、Wren）。新组件先在设计表中登记路径，再加入此集合。
BACKCHANNEL_LOGOUT_PATHS = frozenset({
    "/auth/kailo/backchannel-logout",
    "/api/v1/auth/oidc/backchannel-logout",
    "/oauth/backchannel-logout",
})


def declared_clients(values):
    """NATIVE_OIDC_CLIENTS 的已校验声明；空值返回 []（未声明），无效即拒绝。"""
    raw = (values.get("NATIVE_OIDC_CLIENTS") or "").strip()
    if not raw:
        return []
    # .env 同时被 Compose 与 bash `.` 读取、经发布入口 env.set 声明，值不得含空白与引号：
    # 每项为 <clientId>=<back-channel 地址>，以逗号分隔（地址不带 query，故不含 = 与 ,）。
    declared = []
    for item in raw.split(","):
        client_id, sep, url = item.partition("=")
        if not sep:
            raise Refused("NATIVE_OIDC_CLIENTS 每项必须是 <clientId>=<backchannelLogoutUrl>，以逗号分隔")
        declared.append({"clientId": client_id, "backchannelLogoutUrl": url})
    allowed = set((values.get("NATIVE_PAGE_ORIGINS") or "").split())
    if not allowed or not all(exact_origin(o) for o in allowed) or values["PUBLIC_ORIGIN"] in allowed:
        raise Refused("NATIVE_PAGE_ORIGINS 必须是精确 origin 且不含平台 origin")
    platform = {values[k] for k in ("OIDC_SERVICE_CLIENT_ID", "OIDC_WORKER_CLIENT_ID",
                                    "OIDC_BROWSER_CLIENT_ID", "OIDC_NATIVE_CLIENT_ID")}
    seen = set()
    for entry in declared:
        if (not isinstance(entry, dict) or set(entry) != {"clientId", "backchannelLogoutUrl"}
                or not all(isinstance(v, str) and v and v.strip() == v for v in entry.values())):
            raise Refused("NATIVE_OIDC_CLIENTS 每项必须恰为 clientId 与 backchannelLogoutUrl")
        url = urllib.parse.urlsplit(entry["backchannelLogoutUrl"])
        origin = urllib.parse.urlunsplit((url.scheme, url.netloc, "", "", ""))
        if (entry["clientId"] in platform or entry["clientId"] in seen or origin not in allowed
                or url.path not in BACKCHANNEL_LOGOUT_PATHS or url.query or url.fragment
                or url.username or url.password):
            raise Refused("clientId 须是组件专属且唯一，back-channel 地址须在该组件自身 origin 且为 07 §4.7.5 的固定路径")
        seen.add(entry["clientId"])
    return declared


PICTURE_ATTRIBUTE = {"name": "picture", "displayName": "picture", "multivalued": False,
                     "permissions": {"view": ["admin", "user"], "edit": ["admin"]},
                     "validations": {"uri": {}}}


def same_picture_attribute(actual):
    permissions = actual.get("permissions") or {}
    return (actual.get("multivalued", False) is False
            and sorted(permissions.get("view") or []) == ["admin", "user"]
            and permissions.get("edit") == ["admin"]
            and "uri" in (actual.get("validations") or {}))


def attribute_mapper(name, attribute):
    return {"name": name, "protocol": "openid-connect",
            "protocolMapper": "oidc-usermodel-attribute-mapper", "consentRequired": False,
            "config": {"user.attribute": attribute, "claim.name": attribute,
                       "jsonType.label": "String", "multivalued": "false",
                       "id.token.claim": "true", "access.token.claim": "true",
                       "userinfo.token.claim": "true", "introspection.token.claim": "true"}}


MAPPERS = (attribute_mapper("kailo-picture", "picture"), attribute_mapper("kailo-locale", "locale"))
DEFAULT_SCOPES = ("profile", "email")


def mapper_matches(current, wanted):
    return (len(current) == 1
            and all(current[0].get(k) == wanted[k] for k in ("protocol", "protocolMapper"))
            and all((current[0].get("config") or {}).get(k) == v for k, v in wanted["config"].items()))


def logout_attributes(entry):
    return {"frontchannelLogout": False,
            "attributes": {"backchannel.logout.url": entry["backchannelLogoutUrl"],
                           "backchannel.logout.session.required": "true",
                           "backchannel.logout.revoke.offline.tokens": "false"}}


def same_logout(client, wanted):
    attrs = client.get("attributes") or {}
    return client.get("frontchannelLogout") is False and all(attrs.get(k) == v for k, v in wanted["attributes"].items())


def picture_url(values, user_id):
    return values["PUBLIC_ORIGIN"] + "/api/v1/identity/avatars/" + urllib.parse.quote(user_id, safe="")


# ---- Keycloak 管理 API ---------------------------------------------------------------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Admin:
    """realm 管理 API。管理令牌不经跳转转发、不经代理、不输出。"""

    def __init__(self, values, runtime):
        timeout = int(env("VERIFY_BOOTSTRAP_WAIT_SECONDS"))
        if timeout <= 0:
            raise Refused("VERIFY_BOOTSTRAP_WAIT_SECONDS 必须为正整数")
        self.timeout = timeout
        issuer = urllib.parse.urlsplit(values["OIDC_ISSUER"])
        self.base = urllib.parse.urlunsplit((issuer.scheme, issuer.netloc, "", "", ""))
        self.realm = "/admin/realms/" + urllib.parse.quote(values["OIDC_REALM"], safe="")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        descriptor = os.open(str(pathlib.Path(runtime, "secrets", "keycloak_admin_password")),
                             os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, encoding="utf-8") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise Refused("管理口令文件不是普通文件")
            password = stream.read().strip()
        form = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                       "username": values["KEYCLOAK_ADMIN_USER"], "password": password}).encode()
        with self.opener.open(self.base + "/realms/master/protocol/openid-connect/token", form,
                              timeout=timeout) as response:
            self.token = json.load(response)["access_token"]
        self.writes = 0

    def __call__(self, path, body=None, method=None):
        method = method or ("POST" if body is not None else "GET")
        if method != "GET":
            self.writes += 1
        req = urllib.request.Request(self.base + self.realm + path,
                                     data=json.dumps(body).encode() if body is not None else None, method=method,
                                     headers={"Authorization": "Bearer " + self.token,
                                              "Content-Type": "application/json"})
        with self.opener.open(req, timeout=self.timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw and method == "GET" else None


class ReadOnly:
    """回读模式的 API 包装：任何写请求都是程序错误，当场拒绝。"""

    def __init__(self, api):
        self.api = api

    def __call__(self, path, body=None, method=None):
        if body is not None or (method or "GET") != "GET":
            raise Refused("回读模式不写入")
        return self.api(path)


def one_client(api, client_id, label):
    found = api("/clients?" + urllib.parse.urlencode({"clientId": client_id}))
    if not isinstance(found, list) or len(found) != 1 or found[0].get("clientId") != client_id:
        raise Refused(f"{label}不存在或不唯一（不在这里创建）")
    return "/clients/" + urllib.parse.quote(found[0]["id"], safe="")


# ---- 收敛与回读 ---------------------------------------------------------------------

def sync_redirects(api, wanted, verify):
    """返回 {changed, problems}。verify 时只读；否则不一致即只发送回调字段，再回读确认。"""
    changed, problems = 0, []
    for client_id, (label, desired) in sorted(wanted.items()):
        path = one_client(api, client_id, label)
        if same_redirects(api(path), desired):
            continue
        if verify:
            problems.append(f"{label}的回调字段与模板不一致")
            continue
        api(path, desired, "PUT")
        if not same_redirects(api(path), desired):
            raise Refused(f"{label}回调回读不一致")
        changed += 1
    return dict(clients=len(wanted), changed=changed, problems=problems)


def converge_profile(api, verify):
    profile = api("/users/profile")
    current = [a for a in profile.get("attributes", []) if a.get("name") == "picture"]
    if current and not same_picture_attribute(current[0]):
        raise Refused("realm 用户资料已有不同定义的 picture 属性")
    if current:
        return []
    if verify:
        return ["realm 用户资料缺少 picture 属性"]
    profile["attributes"] = profile.get("attributes", []) + [PICTURE_ATTRIBUTE]
    api("/users/profile", profile, "PUT")
    current = [a for a in api("/users/profile").get("attributes", []) if a.get("name") == "picture"]
    if len(current) != 1 or not same_picture_attribute(current[0]):
        raise Refused("picture 属性回读不一致")
    return []


def converge_client(api, entry, label, scopes, verify):
    problems = []
    path = one_client(api, entry["clientId"], label)
    defaults = {s.get("name") for s in api(path + "/default-client-scopes")}
    for name in DEFAULT_SCOPES:
        if name in defaults:
            continue
        if verify:
            problems.append(f"{label}默认 scope 缺少 {name}")
            continue
        api(path + "/default-client-scopes/" + urllib.parse.quote(scopes[name], safe=""), {}, "PUT")
    if not verify and not set(DEFAULT_SCOPES) <= {s.get("name") for s in api(path + "/default-client-scopes")}:
        raise Refused(f"{label}默认 scope 回读不含 profile/email")
    for wanted in MAPPERS:
        def matching():
            return [m for m in api(path + "/protocol-mappers/models") if m.get("name") == wanted["name"]]
        current = matching()
        if current and not mapper_matches(current, wanted):
            raise Refused(f"{label}的 {wanted['name']} mapper 不一致")
        if not current:
            if verify:
                problems.append(f"{label}缺少 {wanted['name']} mapper")
                continue
            try:
                api(path + "/protocol-mappers/models", wanted)
            except (urllib.error.URLError, OSError):
                pass  # 创建回应丢失只由下面的回读判定，不重复 POST
            if not mapper_matches(matching(), wanted):
                raise Refused(f"{label}的 {wanted['name']} mapper 回读不一致")
    logout = logout_attributes(entry)
    if not same_logout(api(path), logout):
        if verify:
            problems.append(f"{label}back-channel 退出配置不一致")
        else:
            api(path, logout, "PUT")  # Keycloak 合并 attributes；其他字段不发送
            if not same_logout(api(path), logout):
                raise Refused(f"{label}back-channel 配置回读不一致")
    return problems


def converge_users(api, values, verify):
    first, written, total, missing = 0, 0, 0, 0
    while True:
        page = api("/users?" + urllib.parse.urlencode({"first": first, "max": 100, "briefRepresentation": "false"}))
        if not page:
            break
        for user in page:
            total += 1
            wanted = picture_url(values, user["id"])
            if (user.get("attributes") or {}).get("picture") == [wanted]:
                continue
            if verify:
                missing += 1
                continue
            path = "/users/" + urllib.parse.quote(user["id"], safe="")
            full = api(path)
            full.setdefault("attributes", {})["picture"] = [wanted]
            api(path, full, "PUT")
            if (api(path).get("attributes") or {}).get("picture") != [wanted]:
                raise Refused("用户 picture 回读不一致")
            written += 1
        first += len(page)
    return dict(users=total, written=written, missing=missing)


def native_profiles(api, values, mode):
    """mode: declare | users-only | verify。返回结果 JSON（不含值）。"""
    declared = declared_clients(values)
    if not declared:
        return dict(nativeClientProfiles="UNDECLARED", clients=0, problems=[])
    verify_config = mode != "declare"
    scopes = {s.get("name"): s.get("id") for s in api("/client-scopes")}
    if not all(scopes.get(name) for name in DEFAULT_SCOPES):
        raise Refused("realm 缺少 profile 或 email client scope")
    problems = converge_profile(api, verify_config)
    for index, entry in enumerate(declared, 1):
        problems += converge_client(api, entry, f"组件专属客户端第 {index} 项", scopes, verify_config)
    if problems and mode == "users-only":
        # 配置漂移只能由完整声明修复：这里不改写客户端，也不先写用户，直接拒绝。
        raise Refused("组件专属客户端配置与声明不一致：" + "；".join(problems))
    users = converge_users(api, values, mode == "verify")
    if users["missing"]:
        problems.append(f"{users['missing']} 个用户的 picture 与期望不一致")
    return dict(nativeClientProfiles="DECLARED" if not problems else "DRIFTED", clients=len(declared),
                problems=problems, **users)


def main(argv):
    if len(argv) < 1 or argv[0] not in ("sync-redirects", "native-profiles"):
        raise Refused("用法：idp-declarations.py sync-redirects|native-profiles [--verify|--users-only]")
    flags = set(argv[1:])
    allowed = {"sync-redirects": {"--verify"}, "native-profiles": {"--verify", "--users-only"}}[argv[0]]
    if not flags <= allowed or len(flags) > 1:
        raise Refused("参数无效")
    runtime = os.environ.get("KAILO_RUNTIME_DIR")
    if not runtime or not os.path.isabs(runtime):
        raise Refused("KAILO_RUNTIME_DIR 必须由 runtime-dir.sh 解析为绝对路径")
    values = {k: os.environ[k] for k in INPUT_ENV if os.environ.get(k) is not None}
    for k in ("PUBLIC_ORIGIN", "OIDC_ISSUER", "OIDC_REALM", "KEYCLOAK_ADMIN_USER", "OIDC_SERVICE_CLIENT_ID",
              "OIDC_WORKER_CLIENT_ID", "OIDC_BROWSER_CLIENT_ID", "OIDC_NATIVE_CLIENT_ID"):
        env(k)
    verify = "--verify" in flags
    # 无效声明先于任何网络动作拒绝；空声明不联系 IdP
    if argv[0] == "native-profiles" and not declared_clients(values):
        return dict(nativeClientProfiles="UNDECLARED", clients=0, problems=[])
    api = Admin(values, runtime)
    if verify:
        api = ReadOnly(api)
    if argv[0] == "sync-redirects":
        here = pathlib.Path(__file__).resolve().parent
        with open(here / "identity-provider" / "realm.json", encoding="utf-8") as stream:
            template = json.load(stream)
        return sync_redirects(api, desired_redirects(template, values), verify)
    return native_profiles(api, values, "verify" if verify else "users-only" if "--users-only" in flags
                           else "declare")


if __name__ == "__main__":
    try:
        result = main(sys.argv[1:])
    except Refused as error:
        print(json.dumps(dict(error=str(error)), ensure_ascii=False))
        print(f"IdP 声明式配置拒绝：{error}；未覆写既有配置", file=sys.stderr)
        sys.exit(78)
    except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError):
        # 传输与解析错误可能带值，不回显
        print(json.dumps(dict(error="IdP 不可达或回应不可解析")), ensure_ascii=False)
        print("IdP 声明式配置未完成；修复 IdP 连接或配置后重跑查证", file=sys.stderr)
        sys.exit(75)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(1 if result.get("problems") else 0)
