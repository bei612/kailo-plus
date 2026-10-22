"""发布入口的推导模型（ADR-20 §2）：从现有登记数据推出发布单元、过期判定、产物→服务映射、
需要改写的 pin、一次性前置、备份对象与部署顺序。

开发机的编排（orchestrator.py）与 CI 节点的执行（node.py）共用这一份；本模块只读文件与 Git，
不访问网络、不执行 Docker、不写任何文件——pin 的改写以「给定文本 → 新文本」的纯函数提供，由调用方落盘。

所有路径相对仓库根。命令行（供 tools/release.sh 读取自建单元的构建输入）：
  model.py unit-inputs <单元>
"""

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit

import yaml

# 代码所在的仓库根；分析对象可以是另一个检出（开发机的发布 worktree），以 use_root 切换。
CODE_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ROOT = CODE_ROOT
um = None  # 分析对象自己的 tools/upstream_manifest.py —— 来源记录的唯一算法，与被发布的 commit 同版本


def use_root(path):
    global ROOT, um
    ROOT = os.path.realpath(path)
    spec = importlib.util.spec_from_file_location("upstream_manifest", os.path.join(ROOT, "tools", "upstream_manifest.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    um = module


use_root(CODE_ROOT)

DECLARATIONS = "tools/release/release.yaml"
COMPOSE = "deploy/local/compose.yaml"
ENV_EXAMPLE = "deploy/local/.env.example"
TRACEABILITY = "tools/traceability"
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
# compose 中本仓库构建的镜像：${REGISTRY_HOST…}/<产物>@sha256:<64>
REGISTRY_IMAGE = re.compile(r"^\$\{REGISTRY_HOST[^}]*\}/(?P<name>[a-z][a-z0-9-]*)@(?P<digest>sha256:[0-9a-f]{64})$")
ENV_KEY = re.compile(r"[A-Z][A-Z0-9_]*")
# .env 同时被 Compose 与 bash `.` 读取：值只允许安全字符与 ${NAME} 引用，不允许空白、引号、$( 等
ENV_VALUE_SAFE = re.compile(r"[A-Za-z0-9_.,:/@%+=*\-]*")
ENV_REFERENCE = re.compile(r"\$\{[A-Z][A-Z0-9_]*\}")


class ReleaseError(Exception):
    """可报告的发布错误：阶段据此停止，消息不得包含 secret 或 .env 值。"""


def _path(rel):
    return os.path.join(ROOT, rel)


def _git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], check=True, capture_output=True, text=True).stdout


def head():
    return _git("rev-parse", "HEAD").strip()


def declarations(root=None):
    with open(os.path.join(root or ROOT, DECLARATIONS), encoding="utf-8") as stream:
        value = yaml.safe_load(stream) or {}
    for key in ("units", "services", "migrations", "order", "env", "node"):
        if not isinstance(value.get(key), dict):
            raise ReleaseError(f"{DECLARATIONS}: 缺少映射 {key}")
    return value


# ---- 发布单元 ----------------------------------------------------------------

class Unit:
    """一个 CI 构建目标。二开产物来自 */fork/upstream.yaml；自建单元来自声明。"""

    def __init__(self, name, kind, images, record=None, artifact=None, inputs=None):
        self.name, self.kind, self.images = name, kind, images
        self.record, self.artifact, self.inputs = record, artifact, inputs or []

    @property
    def upstream(self):
        return self.kind == "upstream"

    def __repr__(self):
        return f"Unit({self.name})"


def units(decl=None):
    decl = decl or declarations()
    out = {}
    cwd = os.getcwd()
    os.chdir(ROOT)  # upstream_manifest 的路径一律相对 apps/
    try:
        for _, path in um.records().items():
            for art in um.load(path).get("artifacts") or []:
                images = [art["name"]] if art.get("kind") == "image" else []
                out[art["name"]] = Unit(art["name"], "upstream", images, record=path, artifact=art)
    finally:
        os.chdir(cwd)
    for name, spec in decl["units"].items():
        if name in out:
            raise ReleaseError(f"{DECLARATIONS}: 自建单元 {name} 与 */fork/upstream.yaml 的产物重名")
        inputs = [str(x) for x in spec.get("inputs") or []]
        images = [str(x) for x in spec.get("images") or []]
        if not inputs or not images:
            raise ReleaseError(f"{DECLARATIONS}: 自建单元 {name} 必须声明 inputs 与 images")
        out[name] = Unit(name, "self", images, inputs=inputs)
    return out


def unit_of_image(all_units):
    return {image: unit for unit in all_units.values() for image in unit.images}


def upstream_state(unit):
    """二开产物与当前源码的关系：current / stale / unbuilt（记录 none 且未阻断）/ blocked（none 且阻断）。"""
    art = unit.artifact
    recorded = str(art.get("source_digest") or "none")
    cwd = os.getcwd()
    os.chdir(ROOT)
    try:
        current = um.source_digest(art)
    finally:
        os.chdir(cwd)
    if recorded == "none":
        return ("blocked" if art.get("blocked") else "unbuilt"), recorded, current
    return ("current" if recorded == current else "stale"), recorded, current


def tree_digest(commit, inputs):
    """自建单元在某 commit 的输入摘要：`git ls-tree -r` 的模式、对象与路径。与工作树无关，
    同一摘要即同一份构建输入，可据此复用已有构建。"""
    listing = _git("ls-tree", "-r", "--full-tree", commit, "--", *inputs)
    if not listing.strip():
        raise ReleaseError(f"{commit[:12]} 中找不到构建输入 {inputs}")
    return "sha256:" + hashlib.sha256(listing.encode()).hexdigest()


def changed_inputs(base, commit, inputs):
    """base..commit 之间构建输入上的变化路径；base 不在本仓库时返回 None（无法证明未变化）。"""
    if subprocess.run(["git", "-C", ROOT, "cat-file", "-e", base + "^{commit}"], capture_output=True).returncode:
        return None
    return [p for p in _git("diff", "--name-only", base, commit, "--", *inputs).splitlines() if p]


# ---- compose：产物 → 服务 ------------------------------------------------------

def compose_text(rel=COMPOSE):
    with open(_path(rel), encoding="utf-8") as stream:
        return stream.read()


def compose_services(text):
    """{服务: {image, digest, depends_on: {依赖: 条件}, restart, order}}；image 只对本仓库构建的镜像有值。"""
    doc = yaml.safe_load(text) or {}
    out = {}
    for order, (name, spec) in enumerate((doc.get("services") or {}).items()):
        m = REGISTRY_IMAGE.match(str(spec.get("image") or ""))
        deps = spec.get("depends_on") or {}
        if isinstance(deps, list):
            deps = {d: "service_started" for d in deps}
        out[name] = dict(image=m["name"] if m else None, digest=m["digest"] if m else None,
                         raw_image=str(spec.get("image") or ""),
                         depends_on={d: (c or {}).get("condition", "service_started") if isinstance(c, dict) else c
                                     for d, c in deps.items()},
                         restart=str(spec.get("restart")) if spec.get("restart") is not None else None,
                         order=order)
    return out


def project_name(text):
    return str((yaml.safe_load(text) or {}).get("name") or "")


def managed_services(services, all_units):
    """受管服务：镜像是某个发布单元产出的服务 → {服务: 镜像名}。"""
    images = unit_of_image(all_units)
    return {svc: spec["image"] for svc, spec in services.items() if spec["image"] in images}


def is_postgres(spec):
    return spec["raw_image"].startswith("postgres@") or spec["raw_image"].startswith("postgres:")


def config_oneoffs(text, compose_dir):
    """One-shot services (restart "no") whose input is compose configuration read from the release
    tree, e.g. the SpiceDB schema write: {service: sha256 of the configs it consumes}. Their input is
    a file, not an image digest, so a deploy runs one when this digest differs from the last applied
    one. Configs resolved from the runtime directory (interpolated paths) are deliveries, not inputs."""
    doc = yaml.safe_load(text) or {}
    files = {name: (spec or {}).get("file") for name, spec in (doc.get("configs") or {}).items()}
    out = {}
    for name, spec in (doc.get("services") or {}).items():
        if str(spec.get("restart")) != "no":
            continue
        used = sorted({c.get("source") if isinstance(c, dict) else c for c in spec.get("configs") or []})
        paths = [files.get(u) for u in used]
        if not used or any(p is None or "${" in str(p) for p in paths):
            continue
        h = hashlib.sha256()
        for config, path in zip(used, paths):
            with open(os.path.join(compose_dir, path), "rb") as stream:
                h.update(config.encode() + b"\0" + stream.read() + b"\0")
        out[name] = "sha256:" + h.hexdigest()
    return out


def prerequisites(services, service):
    """一次性前置：被依赖、以完成为条件、不重启、且与该服务使用同一产物镜像（例如以 Relay 镜像执行迁移的 buzz-schema）。"""
    spec = services[service]
    return [dep for dep, condition in spec["depends_on"].items()
            if condition == "service_completed_successfully"
            and services.get(dep, {}).get("restart") == "no"
            and services[dep]["image"] is not None and services[dep]["image"] == spec["image"]]


def databases_for(services, targets):
    """备份对象：被部署服务及其一次性前置直接依赖的 Postgres 服务。"""
    out = []
    for svc in targets:
        for node in [svc, *prerequisites(services, svc)]:
            for dep in services[node]["depends_on"]:
                if dep in services and is_postgres(services[dep]) and dep not in out:
                    out.append(dep)
    return out


def deploy_order(services, targets, decl=None):
    """03 §7：order.first 的镜像 → 其余 → order.last 的镜像；同组按 compose 定义顺序。"""
    decl = decl or declarations()
    first = [str(x) for x in decl["order"].get("first") or []]
    last = [str(x) for x in decl["order"].get("last") or []]

    def key(svc):
        image = services[svc]["image"]
        group = 0 if image in first else (2 if image in last else 1)
        rank = first.index(image) if image in first else (last.index(image) if image in last else 0)
        return (group, rank, services[svc]["order"])
    return sorted(targets, key=key)


# ---- pin：结构化改写 -----------------------------------------------------------

def pin_compose(text, image, new):
    """把 compose 中 image: ${REGISTRY_HOST…}/<image>@sha256:… 的 digest 换成 new；返回 (新文本, 改写行数)。"""
    if not DIGEST.fullmatch(new):
        raise ReleaseError(f"{image}: 新 digest 格式不对")
    pattern = re.compile(r"^(\s*image:\s*\$\{REGISTRY_HOST[^}]*\}/" + re.escape(image) + r"@)sha256:[0-9a-f]{64}(\s*)$", re.M)
    return pattern.subn(lambda m: m.group(1) + new + m.group(2), text)


def pin_traceability(text, image, new):
    """把追溯记录 release.artifacts[] 中 name == image 的 digest 换成 new；逐行改写保留注释，
    再以 YAML 解析核对只改了该项。返回 (新文本, 改写项数)。"""
    lines = text.split("\n")
    in_release = in_artifacts = False
    current, count = None, 0
    for i, line in enumerate(lines):
        if re.match(r"^\S", line):
            in_release = line.startswith("release:")
            in_artifacts, current = False, None
            continue
        if in_release and re.match(r"^\s+artifacts:\s*$", line):
            in_artifacts = True
            continue
        if not in_artifacts:
            continue
        m = re.match(r"^\s*-\s+name:\s*(\S+)\s*$", line)
        if m:
            current = m.group(1)
            continue
        m = re.match(r"^(\s*digest:\s*)(sha256:[0-9a-f]{64})(\s*)$", line)
        if m and current == image:
            lines[i] = m.group(1) + new + m.group(3)
            count += 1
    out = "\n".join(lines)
    if count:
        before, after = yaml.safe_load(text), yaml.safe_load(out)
        for entry in (before.get("release") or {}).get("artifacts") or []:
            if entry.get("name") == image:
                entry["digest"] = new
        if before != after:
            raise ReleaseError(f"追溯记录改写 {image} 时触及了其他内容")
    return out, count


def traceability_files():
    folder = _path(TRACEABILITY)
    return sorted(os.path.join(TRACEABILITY, f) for f in os.listdir(folder) if f.endswith(".yaml"))


def pin_consistency(all_units, proofs=None):
    """pin 之后的自检（不是新门禁，是入口对自身输出的核对，与 check.sh trace/security 的
    digest 规则同义）：compose 与追溯记录中二开产物的 digest 等于来源记录；自建镜像的 digest
    在 compose 与追溯记录间一致，且（给出 proofs 时）在证明库中存在。返回问题列表。"""
    bad = []
    records = {u.name: str(u.artifact.get("artifact_digest") or "none") for u in all_units.values() if u.upstream}
    self_images = {i for u in all_units.values() if not u.upstream for i in u.images}
    services = compose_services(compose_text())
    pinned_self = {}
    for svc, spec in services.items():
        name = spec["image"]
        if name in records and records[name] != "none" and spec["digest"] != records[name]:
            bad.append(f"compose {svc}: {name} 的 digest 与来源记录不一致")
        if name in self_images:
            if pinned_self.setdefault(name, spec["digest"]) != spec["digest"]:
                bad.append(f"compose: {name} 在多个服务中 pin 了不同 digest")
    for rel in traceability_files():
        with open(_path(rel), encoding="utf-8") as stream:
            doc = yaml.safe_load(stream) or {}
        for entry in (doc.get("release") or {}).get("artifacts") or []:
            name, digest = entry.get("name"), str(entry.get("digest") or "")
            if name in records and digest != records[name]:
                bad.append(f"{rel}: {name} 的 digest 与来源记录不一致")
            if name in pinned_self and digest != pinned_self[name]:
                bad.append(f"{rel}: {name} 的 digest 与 compose 的 pin 不一致")
    if proofs is not None:
        for name, digest in pinned_self.items():
            if f"{name}.{digest.removeprefix('sha256:')}.provenance.json" not in proofs:
                bad.append(f"compose: {name}@{digest[:19]} 在 CI 证明库中没有 provenance")
    return bad


def residual_digests(digests):
    """deploy/ 与 tools/ 中仍出现的旧 digest：结构化改写之外的残留 → {digest: [文件]}。"""
    out = {}
    for digest in digests:
        r = subprocess.run(["git", "-C", ROOT, "grep", "-l", "-F", digest, "--", "deploy", "tools"],
                           capture_output=True, text=True)
        files = [f for f in r.stdout.splitlines() if f]
        if files:
            out[digest] = files
    return out


# ---- 声明式 .env ---------------------------------------------------------------

def env_example_keys():
    keys = set()
    with open(_path(ENV_EXAMPLE), encoding="utf-8") as stream:
        for line in stream:
            m = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]*)=", line)
            if m:
                keys.add(m.group(1))
    return keys


def env_declaration(decl=None):
    """校验并返回 (set: {键: 值}, unset: [键])。错误消息只含键名。"""
    decl = decl or declarations()
    spec = decl["env"]
    to_set = spec.get("set") or {}
    to_unset = [str(k) for k in spec.get("unset") or []]
    if not isinstance(to_set, dict):
        raise ReleaseError(f"{DECLARATIONS}: env.set 必须是 键: 值 映射")
    known = env_example_keys()
    for key, value in to_set.items():
        if not ENV_KEY.fullmatch(str(key)):
            raise ReleaseError(f"env.set: 键 {key!r} 不合法")
        if key not in known:
            raise ReleaseError(f"env.set: {key} 不是 {ENV_EXAMPLE} 登记的公共输入")
        if not isinstance(value, str) or not ENV_VALUE_SAFE.fullmatch(ENV_REFERENCE.sub("", value)):
            raise ReleaseError(f"env.set: {key} 的值必须是单行、无空白与引号，只允许 ${{NAME}} 引用")
    for key in to_unset:
        if not ENV_KEY.fullmatch(key) or key in to_set:
            raise ReleaseError(f"env.unset: 键 {key} 不合法或同时出现在 env.set")
    return {str(k): v for k, v in to_set.items()}, to_unset


def required_env(text):
    """compose 以 ${NAME:?…} 要求必须提供的键名。"""
    return sorted(set(re.findall(r"\$\{([A-Z][A-Z0-9_]*):\?", text)))


def env_value_digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


# ---- 迁移 ---------------------------------------------------------------------

def migration_versions(name, decl=None):
    decl = decl or declarations()
    spec = decl["migrations"].get(name)
    if not spec:
        raise ReleaseError(f"{DECLARATIONS}: 未声明迁移 {name}")
    folder = _path(str(spec["source"]))
    return sorted(int(f.split("_", 1)[0]) for f in os.listdir(folder)
                  if re.fullmatch(r"\d+_[^/]+\.up\.sql", f))


# ---- 运维域运行体与投递（ADR-20 §8）--------------------------------------------

# 运维域运行体：上游固定 digest 的外部镜像（不是本仓库构建单元）
UPSTREAM_IMAGE = re.compile(r"^(?P<repo>[a-z0-9][a-z0-9._/-]*)@(?P<digest>sha256:[0-9a-f]{64})$")
PEER_DIRECTORY_FILE = "adapter-directory.json"
PEER_CONFORMANCE_FILE = "conformance-environment.json"
DIRECTORY_ENV = "APPLICATION_ADAPTER_DIRECTORY_FILE"
CONFORMANCE_ENV = "COMPONENT_CONFORMANCE_ENVIRONMENT_FILE"
# 原生 MCP peer 的一致性投递只有 environment（start-core.sh），HTTP adapter 的另两项须同时缺省
CONFORMANCE_HTTP_ONLY = ("COMPONENT_CONFORMANCE_FIXTURE_FILE", "COMPONENT_CONFORMANCE_IDENTITY_FILE")
# contracts/domain/application_adapter_directory.schema.json 的 protocolPeers 条目
PEER_REQUIRED = {"adapterServiceRef", "mcpUrl", "nativeInstanceRef", "artifactDigest", "timeoutSeconds",
                 "maxResponseBytes", "bindings"}
PEER_OPTIONAL = {"secretReaders", "modelCredentialDeliveries"}
BINDING_REQUIRED = {"bindingId", "tenantId", "servicePrincipalId", "nativeScopeRef", "configDigest", "isolationMode"}
BINDING_OPTIONAL = {"workspaceId", "credentialGeneration", "nativeCredentials"}
ISOLATION_MODES = {"DEDICATED_INSTANCE", "NATIVE_TENANT", "NAMESPACE", "RESOURCE_FILTER", "RESOURCE_INSTANCE"}
# contracts/domain/component_protocol_peer_environment.schema.json
CONFORMANCE_REQUIRED = {"artifactDigest", "mcpUrl", "timeoutSeconds", "maxResponseBytes", "maxSteps", "readOnlyTools",
                        "initializeResultJson", "listResultJson"}
CONFORMANCE_OPTIONAL = {"nativeCredentials"}
UUID_TEXT = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
REFERENCE = re.compile(r"[a-z][a-z0-9-]*")
RUNTIME_SUBDIR = re.compile(r"data(/[a-z0-9][a-z0-9-]*)+")


def operated_services(services, decl=None):
    """release.yaml operated：{服务: 固定 digest}。只接受上游固定 digest 的常驻服务，不接受本仓库产物或一次性服务。"""
    decl = decl or declarations()
    names = decl.get("operated") or []
    if not isinstance(names, list):
        raise ReleaseError(f"{DECLARATIONS}: operated 必须是服务名列表")
    out = {}
    for name in names:
        spec = services.get(str(name))
        if spec is None:
            raise ReleaseError(f"{DECLARATIONS}: operated 的 {name} 不是 compose 服务")
        m = UPSTREAM_IMAGE.match(spec["raw_image"])
        if spec["image"] is not None or not m or spec["restart"] == "no":
            raise ReleaseError(f"{DECLARATIONS}: operated 的 {name} 必须是按 digest 固定的上游镜像常驻服务")
        out[str(name)] = m["digest"]
    return out


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ReleaseError(f"重复的 JSON 键 {key}")
        value[key] = item
    return value


def load_json(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=_unique_object)


def _positive(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _peer_url(raw, where):
    url = urlsplit(raw) if isinstance(raw, str) else None
    if (not url or url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
            or url.query or url.fragment or "?" in raw or "#" in raw):
        raise ReleaseError(f"{where}: mcpUrl 必须是不含凭据、query 与 fragment 的 http(s) 地址")
    return url


def _check_binding(fact, where):
    if not isinstance(fact, dict) or BINDING_REQUIRED - set(fact) or set(fact) - BINDING_REQUIRED - BINDING_OPTIONAL:
        raise ReleaseError(f"{where}: binding 归属事实字段与 ApplicationProtocolPeerBindingDelivery 不符")
    for key in ("bindingId", "tenantId", "servicePrincipalId", "workspaceId"):
        if key in fact and not (isinstance(fact[key], str) and UUID_TEXT.fullmatch(fact[key])):
            raise ReleaseError(f"{where}: {key} 必须是小写 UUID")
    if fact["isolationMode"] not in ISOLATION_MODES or not fact["nativeScopeRef"] \
            or not re.fullmatch(r"[0-9a-f]{64}", str(fact["configDigest"])):
        raise ReleaseError(f"{where}: isolationMode、nativeScopeRef 或 configDigest 不合法")
    if "credentialGeneration" in fact and not _positive(fact["credentialGeneration"]):
        raise ReleaseError(f"{where}: credentialGeneration 必须是正整数")


def peer_delivery(decl=None, services=None):
    """release.yaml delivery.protocol_peers 的声明经校验后的投递内容；未声明时为 None。

    交付目录 protocolPeers 与一致性环境是运维域事实（DD-94(2)(5)、DD-98、DD-134(5)）：端点只能是本拓扑
    operated 中的运行体，artifactDigest 等于该运行体固定的镜像 digest；一致性环境只登记同一 peer，期望应答
    由 record-conformance.py 经同一 Gateway 构建记录。.env 的两个投递键必须指向本声明的运行目录文件，
    HTTP adapter 才有的另两项一致性投递必须由同一声明删除（单一候选，start-core.sh 只接受 environment）。"""
    decl = decl or declarations()
    spec = (decl.get("delivery") or {}).get("protocol_peers")
    if spec is None:
        return None
    if not isinstance(spec, dict) or set(spec) != {"directory", "conformance", "runtime", "restart"}:
        raise ReleaseError(f"{DECLARATIONS}: delivery.protocol_peers 只声明 directory、conformance、runtime、restart")
    runtime = str(spec["runtime"])
    if not RUNTIME_SUBDIR.fullmatch(runtime):
        raise ReleaseError(f"{DECLARATIONS}: delivery.protocol_peers.runtime 必须是运行目录 data/ 下的子目录")
    restart = str(spec["restart"])
    if not (decl["services"].get(restart) or {}).get("command"):
        raise ReleaseError(f"{DECLARATIONS}: delivery.protocol_peers.restart 必须是以启动入口部署的服务")
    services = services if services is not None else compose_services(compose_text())
    operated = operated_services(services, decl)
    directory = load_json(_path(str(spec["directory"])))
    if not isinstance(directory, dict) or set(directory) != {"protocolPeers"} \
            or not isinstance(directory["protocolPeers"], list) or not directory["protocolPeers"]:
        raise ReleaseError(f"{spec['directory']}: 只声明非空的 protocolPeers（adapters 由组件入口维护）")
    peers, refs = directory["protocolPeers"], set()
    for peer in peers:
        where = f"{spec['directory']}: {peer.get('adapterServiceRef') if isinstance(peer, dict) else peer}"
        if not isinstance(peer, dict) or PEER_REQUIRED - set(peer) or set(peer) - PEER_REQUIRED - PEER_OPTIONAL:
            raise ReleaseError(f"{where}: 字段与 ApplicationProtocolPeerDelivery 不符")
        ref = peer["adapterServiceRef"]
        if not isinstance(ref, str) or not REFERENCE.fullmatch(ref) or ref in refs:
            raise ReleaseError(f"{where}: adapterServiceRef 不合法或重复")
        refs.add(ref)
        host = _peer_url(peer["mcpUrl"], where).hostname
        if host not in operated:
            raise ReleaseError(f"{where}: 端点必须是 operated 中的运维域运行体（DD-94(5)）")
        if peer["artifactDigest"] != operated[host].removeprefix("sha256:"):
            raise ReleaseError(f"{where}: artifactDigest 必须等于 {host} 固定的镜像 digest")
        if not isinstance(peer["nativeInstanceRef"], str) or not peer["nativeInstanceRef"] \
                or not _positive(peer["timeoutSeconds"]) or not _positive(peer["maxResponseBytes"]):
            raise ReleaseError(f"{where}: nativeInstanceRef、timeoutSeconds 或 maxResponseBytes 不合法")
        if not isinstance(peer["bindings"], list):
            raise ReleaseError(f"{where}: bindings 必须是数组")
        ids = [fact.get("bindingId") for fact in peer["bindings"] if isinstance(fact, dict)]
        if len(set(ids)) != len(ids):
            raise ReleaseError(f"{where}: bindingId 重复")
        for fact in peer["bindings"]:
            _check_binding(fact, where)
    conformance = load_json(_path(str(spec["conformance"])))
    where = str(spec["conformance"])
    if not isinstance(conformance, dict) or CONFORMANCE_REQUIRED - set(conformance) \
            or set(conformance) - CONFORMANCE_REQUIRED - CONFORMANCE_OPTIONAL:
        raise ReleaseError(f"{where}: 字段与 ComponentProtocolPeerEnvironment 不符")
    matching = [p for p in peers if p["artifactDigest"] == conformance["artifactDigest"]
                and p["mcpUrl"] == conformance["mcpUrl"]]
    if len(matching) != 1:
        raise ReleaseError(f"{where}: 必须且只能对应交付目录中的一个 peer（同一 artifactDigest 与 mcpUrl）")
    if not all(_positive(conformance[k]) for k in ("timeoutSeconds", "maxResponseBytes", "maxSteps")):
        raise ReleaseError(f"{where}: timeoutSeconds、maxResponseBytes、maxSteps 必须是正整数")
    tools = conformance["readOnlyTools"]
    if not isinstance(tools, list) or not all(isinstance(t, str) and t for t in tools) or len(set(tools)) != len(tools):
        raise ReleaseError(f"{where}: readOnlyTools 必须是不重复的工具名")
    try:
        initialize = json.loads(conformance["initializeResultJson"])
        listed = json.loads(conformance["listResultJson"])
    except (TypeError, ValueError):
        raise ReleaseError(f"{where}: 期望应答尚未记录（deploy/local/protocol-peers/record-conformance.py）") from None
    if not isinstance(initialize, dict) or not initialize.get("protocolVersion") \
            or not isinstance(listed, dict) or not isinstance(listed.get("tools"), list):
        raise ReleaseError(f"{where}: initializeResultJson 或 listResultJson 不是 MCP 结果")
    missing = sorted(set(tools) - {t.get("name") for t in listed["tools"] if isinstance(t, dict)})
    if missing:
        raise ReleaseError(f"{where}: readOnlyTools 不在记录的 tools/list 中：{missing}")
    to_set, to_unset = env_declaration(decl)
    for key, name in ((DIRECTORY_ENV, PEER_DIRECTORY_FILE), (CONFORMANCE_ENV, PEER_CONFORMANCE_FILE)):
        if to_set.get(key) != "${KAILO_RUNTIME_DIR}/" + runtime + "/" + name:
            raise ReleaseError(f"{DECLARATIONS}: env.set.{key} 必须指向 ${{KAILO_RUNTIME_DIR}}/{runtime}/{name}")
    if set(CONFORMANCE_HTTP_ONLY) - set(to_unset):
        raise ReleaseError(f"{DECLARATIONS}: env.unset 必须包含 {list(CONFORMANCE_HTTP_ONLY)}（原生 peer 只投递 environment）")
    digest = "sha256:" + hashlib.sha256(canonical_json(
        dict(protocolPeers=peers, conformance=conformance, runtime=runtime)).encode()).hexdigest()
    return dict(peers=peers, conformance=conformance, runtime=runtime, restart=restart, digest=digest)


def render_peer_directory(existing, peers):
    """运行目录中的交付目录：adapters 保留已有条目（组件入口按 adapter-directory.mjs --existing 维护），
    protocolPeers 整体取声明；adapterServiceRef 在两类条目间唯一（与 Core 的解析一致）。"""
    adapters = []
    if existing is not None:
        if not isinstance(existing, dict) or set(existing) - {"adapters", "protocolPeers"} \
                or not isinstance(existing.get("adapters"), list):
            raise ReleaseError("运行目录中的交付目录不是 ApplicationAdapterDirectory，拒绝覆盖")
        adapters = existing["adapters"]
    refs = [a.get("adapterServiceRef") if isinstance(a, dict) else None for a in adapters]
    refs += [p["adapterServiceRef"] for p in peers]
    if None in refs or len(set(refs)) != len(refs):
        raise ReleaseError("交付目录中 adapterServiceRef 重复或缺失，拒绝覆盖")
    return {"adapters": adapters, "protocolPeers": peers}


if __name__ == "__main__":
    args = sys.argv[1:]
    try:
        if len(args) == 2 and args[0] == "unit-inputs":
            unit = declarations()["units"].get(args[1])
            if not unit or not unit.get("inputs"):
                raise ReleaseError(f"{DECLARATIONS}: 未声明自建单元 {args[1]} 的 inputs")
            print("\n".join(str(x) for x in unit["inputs"]))
        else:
            sys.exit(__doc__)
    except ReleaseError as error:
        sys.exit(str(error))
