"""发布入口的推导模型（ADR-20 §2）：从现有登记数据推出发布单元、过期判定、产物→服务映射、
需要改写的 pin、一次性前置、备份对象与部署顺序。

开发机的编排（orchestrator.py）与 CI 节点的执行（node.py）共用这一份；本模块只读文件与 Git，
不访问网络、不执行 Docker、不写任何文件——pin 的改写以「给定文本 → 新文本」的纯函数提供，由调用方落盘。

所有路径相对仓库根。命令行（供 tools/release.sh 读取自建单元的构建输入）：
  model.py unit-inputs <单元>
"""

import hashlib
import importlib.util
import os
import re
import subprocess
import sys

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
