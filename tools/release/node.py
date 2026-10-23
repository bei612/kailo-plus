#!/usr/bin/env python3
"""CI 节点上的发布阶段（ADR-20 §5）。

  node.py inspect <请求 JSON 的 base64>   只读探针：经 SSH 标准输入执行（python3 -I - inspect …），
                                         不写任何文件；规划阶段用它读取节点现场
  node.py backup --commit <pin commit>   从固定发布树执行：备份受影响 Postgres 与 .env 快照
  node.py deploy --commit <pin commit>   从固定发布树执行：权限规范、声明式 .env、迁移、按序替换服务、回读
  node.py verify --commit <pin commit>   从固定发布树执行：回读全部受管服务、运维域运行体与投递、配置漂移
  node.py runtime --commit <commit>      从固定发布树执行：输出 CI 配置的运行目录（组件入口据此导出
                                         KAILO_RUNTIME_DIR，ADR-20 §3）
  node.py drift --commit <commit>        从固定发布树执行，只读：列出长期运行服务的配置漂移（ADR-20 §9）
  node.py retention [--dry-run] [--ci-config 路径] [--keep <commit>]... [--prune-docker]
                                         发布树与代理暂存保留（ADR-20 §11）：deploy 成功后自动执行；
                                         CI worker 准入空间不足时以 origin/main 的本文件执行并加 --prune-docker

backup/deploy/verify 只在 <sources>/<commit>/apps/tools/release/node.py 上运行，先核对发布树 HEAD、
干净与 full 回执；发布树只读，运行投递与数据只在运行目录。进度写 stderr，结果 JSON 写 stdout；
任何输出都不包含 .env 值或 secret。
"""

import argparse
import base64
import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

# 发布树只读：不写 __pycache__
sys.dont_write_bytecode = True
FROM_STDIN = sys.argv[0] in ("-", "")
HERE = None if FROM_STDIN else os.path.dirname(os.path.realpath(__file__))
DOCKER = ["sudo", "-n", "docker"]
COMPOSE_PROJECT_LABEL = "com.docker.compose.project"
COMPOSE_SERVICE_LABEL = "com.docker.compose.service"
COMPOSE_ONEOFF_LABEL = "com.docker.compose.oneoff"
# 运维域投递已在启动入口生效的摘要（发布 journal 目录下，与 config-oneoffs.json 并列）
DELIVERIES = "deliveries.json"
DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")
COMPOSE_HASH_LABEL = "com.docker.compose.config-hash"
COMPOSE_WORKDIR_LABEL = "com.docker.compose.project.working_dir"
COMPOSE_FILES_LABEL = "com.docker.compose.project.config_files"


class NodeError(Exception):
    pass


def say(message):
    print(message, file=sys.stderr, flush=True)


def run(argv, *, capture=True, check=True, env=None, cwd=None, stdin=None):
    """执行命令；失败时只报告命令名、子命令与 stderr 末行（Docker/Compose 的错误行不含 .env 值）。"""
    # 不捕获时输出进 stderr：stdout 只留给结果 JSON
    streams = dict(capture_output=True) if capture else dict(stdout=sys.stderr, stderr=sys.stderr)
    result = subprocess.run(argv, env=env, cwd=cwd, input=stdin, **streams)
    if check and result.returncode:
        words = [a for a in argv if not a.startswith("-") and a not in ("sudo", "docker")][:2]
        tail = (result.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] if capture else []
        raise NodeError(f"{' '.join(words)} 退出 {result.returncode}" + (f"：{tail[0][:300]}" if tail else ""))
    return result


def out(argv, **kw):
    return run(argv, **kw).stdout.decode().strip()


def ci_config(path):
    with open(path, encoding="utf-8") as stream:
        cfg = json.load(stream)
    need = ("runtime", "sources", "release_proofs", "compose_project", "queue")
    missing = [k for k in need if not cfg.get(k)]
    if missing:
        raise NodeError(f"CI 配置缺少 {missing}")
    return cfg


def runtime_dir(cfg):
    """CI 节点运行目录（ADR-20 §3）：唯一来源是 CI 配置的 runtime，与 deploy/local/runtime-dir.sh 同一规则——
    规范化为真实路径，.env 必须存在，.env、secrets、data 不得是软链接。调用方已设置 KAILO_RUNTIME_DIR 时
    必须指向同一目录，否则拒绝（不允许第二个来源）。"""
    path = os.path.realpath(cfg["runtime"])
    if not os.path.isdir(path):
        raise NodeError(f"运行目录不存在：{cfg['runtime']}")
    linked = [n for n in (".env", "secrets", "data") if os.path.islink(os.path.join(path, n))]
    if linked:
        raise NodeError(f"运行目录中的 {linked} 是软链接：{path}")
    if not os.path.isfile(os.path.join(path, ".env")):
        raise NodeError(f"运行目录缺少 .env：{path}")
    given = os.environ.get("KAILO_RUNTIME_DIR")
    if given and os.path.realpath(given) != path:
        raise NodeError("KAILO_RUNTIME_DIR 与 CI 配置 runtime 不一致")
    return path


def read_env_file(path):
    """运行 .env 的 键 → 原始值（去掉成对引号）。只在内存比较，不输出。"""
    values = {}
    with open(path, encoding="utf-8") as stream:
        for line in stream:
            m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.rstrip("\n"))
            if m:
                v = m.group(2)
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
                    v = v[1:-1]
                values.setdefault(m.group(1), []).append(v)
    return values


def containers(project):
    """该 Compose 项目的服务容器（不含 run 产生的一次性容器）→ {服务: [容器]}。"""
    ids = out(DOCKER + ["ps", "-a", "-q", "--no-trunc", "--filter", f"label={COMPOSE_PROJECT_LABEL}={project}"]).split()
    found = {}
    if not ids:
        return found
    for entry in json.loads(out(DOCKER + ["inspect", *ids])):
        labels = entry["Config"].get("Labels") or {}
        if labels.get(COMPOSE_ONEOFF_LABEL) == "True":
            continue
        state = entry["State"]
        found.setdefault(labels.get(COMPOSE_SERVICE_LABEL, ""), []).append(dict(
            id=entry["Id"], name=entry["Name"].lstrip("/"), image_ref=entry["Config"]["Image"],
            image_id=entry["Image"], running=bool(state.get("Running")), exit_code=state.get("ExitCode"),
            health=(state.get("Health") or {}).get("Status"), config_hash=labels.get(COMPOSE_HASH_LABEL),
            working_dir=labels.get(COMPOSE_WORKDIR_LABEL),
            config_files=[f for f in (labels.get(COMPOSE_FILES_LABEL) or "").split(",") if f],
            binds={m["Destination"]: m.get("Source") for m in entry.get("Mounts") or [] if m.get("Type") == "bind"}))
    return found


# ---- 配置漂移（ADR-20 §9）--------------------------------------------------------

def compose_argv(tree, runtime, overlays, env_file=None):
    """节点上唯一的 Compose 调用参数：项目目录是固定发布树，.env 与叠加文件取自运行目录（ADR-20 §3）。
    deploy、verify 与只读漂移比较共用，保证比较的就是部署将要创建的配置。env_file 只在声明式 .env
    尚未落盘前（backup）指向其同目录预览，使预判与 deploy 落盘后的渲染一致（ADR-20 §4）。"""
    deploy_dir = os.path.join(tree, "deploy", "local")
    files = []
    for rel in overlays or []:
        path = os.path.join(runtime, str(rel))
        if os.path.isfile(path) and os.path.getsize(path):
            files += ["-f", path]
    argv = DOCKER[:2] + ["--preserve-env=KAILO_RUNTIME_DIR"] + DOCKER[2:] + [
        "compose", "--env-file", env_file or os.path.join(runtime, ".env"), "-f", os.path.join(deploy_dir, "compose.yaml"), *files]
    return argv, deploy_dir


def parse_config_hashes(text):
    """`docker compose config --hash '*'` 的输出：每行「服务 哈希」→ {服务: 哈希}。"""
    hashes = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{64}", parts[1]):
            hashes[parts[0]] = parts[1]
    return hashes


def config_payloads(rendered, service, read_file=None):
    """服务消费的 compose configs → [(名称, 容器内目标, 期望内容 bytes)]。content 取渲染后的文本，file 取文件内容；
    其他来源（environment/external）不在发布树里，跳过。secrets 不比较：它们是运行投递，由 bootstrap 与
    start-core.sh 管理轮换（DD-70 的一次性投递消费后即删除，比较它只会得到永久漂移）。"""
    read_file = read_file or _read_bytes
    tops = rendered.get("configs") or {}
    found = []
    for entry in rendered["services"][service].get("configs") or []:
        source = entry.get("source") if isinstance(entry, dict) else entry
        target = (entry.get("target") if isinstance(entry, dict) else None) or "/" + source
        top = tops.get(source) or {}
        if "content" in top:
            # config 输出把字面 $ 转义为 $$（再次加载时还原）；容器内文件是还原后的文本
            data = str(top["content"]).replace("$$", "$").encode()
        elif top.get("file"):
            data = read_file(top["file"])
        else:
            continue
        found.append((source, target, data))
    return found


def _read_bytes(path):
    with open(path, "rb") as stream:
        return stream.read()


def container_file(container_id, path):
    """容器内一个文件的内容（docker cp 到标准输出的 tar 流，只读，不需要容器内有 shell）；不存在时 None。"""
    r = run(DOCKER + ["cp", f"{container_id}:{path}", "-"], check=False)
    if r.returncode:
        return None
    with tarfile.open(fileobj=io.BytesIO(r.stdout)) as archive:
        for member in archive:
            if member.isfile():
                return archive.extractfile(member).read()
    return None


def secret_sources(rendered, service):
    """服务的文件型 secrets → [(名称, 容器内路径, 渲染出的宿主文件路径)]。只比较路径，不读内容。"""
    tops = rendered.get("secrets") or {}
    found = []
    for entry in rendered["services"][service].get("secrets") or []:
        source = entry.get("source") if isinstance(entry, dict) else entry
        target = (entry.get("target") if isinstance(entry, dict) else None) or source
        path = (tops.get(source) or {}).get("file")
        if path:
            found.append((source, target if target.startswith("/") else "/run/secrets/" + target, path))
    return found


def foreign_compose_files(ctr, overlays):
    """容器创建时用到、却不是「项目目录下的 compose.yaml 或登记叠加」的 Compose 文件——启动命令每次生成的
    一次性叠加（start-core.sh 以 mktemp 文件投递 DD-70 的一次性凭据）。有这样的文件时，容器的配置哈希
    含发布树渲染不出的内容，不可比较。"""
    base = os.path.join(ctr.get("working_dir") or "", "compose.yaml")
    return [f for f in ctr.get("config_files") or []
            if f != base and not any(f.endswith("/" + str(rel)) for rel in overlays or [])]


def config_drift(rendered, hashes, found, read_config, read_file=None, overlays=()):
    """长期运行服务的配置漂移：Compose 配置哈希（desired_config，与 up 写入标签的同一哈希）不等于运行容器的
    com.docker.compose.config-hash，或它消费的 configs 内容与容器内目标文件不同，或文件型 secrets 的挂载来源
    与渲染路径不同。Compose 的服务哈希不含 configs 内容与 configs/secrets 的文件路径（2.40.3 实测：只改
    content 或 file 内容，哈希不变），所以这两项单独回读比较；secret 只比路径，不读内容。

    排除：restart 为 "no" 的一次性服务（apply_config_oneoffs 管）；不在本 compose 文件中的服务
    （组件各自的 Compose 项目，found 只含本项目容器，这里只遍历本文件的服务）。没有唯一运行中容器的服务
    不判漂移，列入 absent，由 bootstrap 或受管服务的镜像判定负责创建。由启动命令以一次性叠加组合的容器
    （foreign_compose_files 非空，例如 start-core.sh 启动的 core-bff）只比较 configs 内容，列入 hash_skipped。
    → dict(drift=[{service, reasons, working_dir}], absent=[服务], hash_skipped=[服务])，按 compose 定义顺序。"""
    drift, absent, skipped = [], [], []
    for svc, spec in rendered["services"].items():
        if str(spec.get("restart") or "") == "no":
            continue
        ctr = single_container(found, svc)
        if not ctr:
            absent.append(svc)
            continue
        reasons = []
        want = hashes.get(svc)
        if not want:
            raise NodeError(f"{svc}: compose config --hash 没有给出哈希")
        if foreign_compose_files(ctr, overlays):
            skipped.append(svc)
        elif ctr.get("config_hash") != want:
            reasons.append("compose 配置哈希不同")
        for name, target, data in config_payloads(rendered, svc, read_file):
            if read_config(ctr["id"], target) != data:
                reasons.append(f"配置 {name} 内容与容器内 {target} 不同")
        # secret 文件路径同样不在服务哈希里：软链接时期从旧发布树挂载的投递，只有比较挂载来源才看得见
        for name, target, path in secret_sources(rendered, svc):
            if (ctr.get("binds") or {}).get(target) != path:
                reasons.append(f"secret {name} 的挂载来源不是运行目录中的投递")
        if reasons:
            drift.append(dict(service=svc, reasons=reasons, working_dir=ctr.get("working_dir")))
    return dict(drift=drift, absent=absent, hash_skipped=skipped)


def desired_config(argv, deploy_dir, runtime):
    """渲染发布树（与 up 同样解析 env_file）并求每个服务的 Compose 配置哈希。

    `docker compose config --hash` 以 WithoutEnvironmentResolution 加载项目（compose 2.40.3
    cmd/compose/config.go runHash），而 up 写入 com.docker.compose.config-hash 时 env_file 已并入
    environment，所以凡用 env_file 的服务两者必然不同。这里先以 `config --format json` 得到已解析
    env_file、已插值（$ 转义为 $$）的完整模型，再把它经标准输入交给 `config --hash`：模型中已没有
    env_file，求得的就是 up 所用的同一哈希。模型只在内存与管道中传递，不落盘、不输出。"""
    env = dict(os.environ, KAILO_RUNTIME_DIR=runtime)
    raw = run(argv + ["config", "--format", "json"], env=env, cwd=deploy_dir).stdout
    hashed = run(DOCKER + ["compose", "-f", "-", "--project-directory", deploy_dir, "config", "--hash", "*"],
                 cwd=deploy_dir, stdin=raw)
    return json.loads(raw), parse_config_hashes(hashed.stdout.decode())


def drift_facts(tree, runtime, overlays, project):
    """只读：以部署同一套 Compose 参数渲染发布树，与本项目运行容器比较。"""
    argv, deploy_dir = compose_argv(tree, runtime, overlays)
    rendered, hashes = desired_config(argv, deploy_dir, runtime)
    if rendered.get("name") != project:
        raise NodeError("渲染出的 Compose 项目名与 CI 配置不一致")
    return config_drift(rendered, hashes, containers(project), container_file, overlays=overlays)


def ref_digest(ref):
    m = re.search(r"@(sha256:[0-9a-f]{64})$", ref or "")
    return m.group(1) if m else None


MANIFEST_ACCEPT = ", ".join((
    "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json"))


def registry_has(ref, timeout=15):
    """The pinned manifest in its own registry: True when served under that exact digest,
    False on 404 (not reproducible), None when it cannot be established."""
    m = re.fullmatch(r"([^/@]+)/([^@]+)@(sha256:[0-9a-f]{64})", ref or "")
    if not m or "." not in m.group(1) and ":" not in m.group(1) and m.group(1) != "localhost":
        return None
    host, repo, digest = m.groups()
    scheme = "http" if host.split(":")[0] in ("127.0.0.1", "localhost") else "https"
    request = urllib.request.Request(f"{scheme}://{host}/v2/{repo}/manifests/{digest}", method="HEAD",
                                     headers={"Accept": MANIFEST_ACCEPT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            return reply.headers.get("Docker-Content-Digest") == digest
    except urllib.error.HTTPError as error:
        return False if error.code == 404 else None
    except (urllib.error.URLError, OSError):
        return None


def judge_image(want, ref, container_image_id, local_id, in_registry):
    """Readback verdict for one running service, valid for both image stores: with the
    containerd store an image ID is the manifest digest, with a graph driver it is the
    config digest, so the pin is compared as the container's reference and the local
    resolution of that reference must yield the image the container runs. The registry
    must serve the pinned manifest, otherwise the deployment is not reproducible."""
    problems = []
    if ref_digest(ref) != want:
        problems.append("运行镜像引用与 pin 不一致")
    if local_id is None:
        problems.append("本节点无法解析 pin 引用")
    elif local_id != container_image_id:
        problems.append("pin 引用解析出的镜像与容器运行镜像不同")
    if in_registry is False:
        problems.append("产物不在 registry，不可复现")
    elif in_registry is None:
        problems.append("无法确认产物在 registry 中")
    return problems


def resolve_local(ref):
    """Image ID of a pinned reference on this node; a missing name record (the content is
    still present, e.g. after a local re-tag) is restored by pulling the same digest."""
    for attempt in (False, True):
        try:
            if attempt:
                run(DOCKER + ["pull", "-q", ref])
            return out(DOCKER + ["image", "inspect", "--format", "{{.Id}}", ref])
        except NodeError:
            continue
    return None


def running_containers():
    """宿主上全部运行中容器 → {完整 ID: 名称}。比较一律用完整 ID（ADR-20 §7）。"""
    found = {}
    for line in out(DOCKER + ["ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"]).splitlines():
        cid, _, name = line.partition(" ")
        found[cid] = name
    return found


def single_container(found, service, running_only=True):
    items = [c for c in found.get(service, []) if c["running"] or not running_only]
    return items[0] if len(items) == 1 else None


def applied_migrations(found, database):
    """数据库容器内已成功执行的 sqlx 版本；表不存在视为空。凭据只取容器自身环境。"""
    ctr = single_container(found, database)
    if not ctr:
        raise NodeError(f"{database} 没有唯一运行中的容器")
    r = run(DOCKER + ["exec", ctr["id"], "sh", "-c",
                      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '
                      '"select version from _sqlx_migrations where success order by version"'], check=False)
    if r.returncode:
        if b"does not exist" in r.stderr:
            return []
        raise NodeError(f"{database} 读取迁移版本失败（退出 {r.returncode}）")
    return [int(x) for x in r.stdout.decode().split()]


def active_ci_deploys(cfg):
    jobs = []
    folder = os.path.join(cfg["queue"], "jobs")
    for job in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        try:
            with open(os.path.join(folder, job, "status.json"), encoding="utf-8") as stream:
                status = json.load(stream)
        except (OSError, ValueError):
            continue
        if status.get("stage") == "deploy" and status.get("state") in ("QUEUED", "RUNNING", "DEPLOYING"):
            jobs.append(job)
    return jobs


# ---- IdP 声明式配置（ADR-20 §1） ------------------------------------------------------

IDP_STATE = "idp-declarations.json"
ENV_NAME_REFERENCE = re.compile(r"\$\{?([A-Z][A-Z0-9_]*)")


def env_closure(values, keys):
    """keys 及其原始值中 ${NAME}/$NAME 引用的闭包 → {键: 原始值的 sha256 或 None}。.env 由 bash `.` 读取，
    派生值（如 PUBLIC_ORIGIN、OIDC_ISSUER）随被引用键变化，因此摘要覆盖整条引用链；只保留摘要。"""
    digests, todo = {}, list(keys)
    while todo:
        key = todo.pop()
        if key in digests:
            continue
        raw = (values.get(key) or [None])[-1]
        digests[key] = None if raw is None else hashlib.sha256(raw.encode()).hexdigest()
        todo += ENV_NAME_REFERENCE.findall(raw or "")
    return digests


def idp_digest(files_digest, values, keys):
    body = json.dumps(dict(files=files_digest, env=env_closure(values, keys)), sort_keys=True)
    return "sha256:" + hashlib.sha256(body.encode()).hexdigest()


def native_clients_declared(values):
    return bool(((values.get("NATIVE_OIDC_CLIENTS") or [""])[-1]).strip())


def directory_clients_declared(values):
    """DD-133(4)：COMPONENT_DIRECTORY_CLIENTS 非空即声明了组件成员目录 client（只报告是否声明，不输出值）。"""
    return bool(((values.get("COMPONENT_DIRECTORY_CLIENTS") or [""])[-1]).strip())


def read_json(path):
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def write_json_atomic(path, value):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".")
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def idp_plan(state_path, digest, values):
    """只读：本次 deploy 是否执行 apply（never/changed 执行，unchanged 跳过），组件专属客户端与目录 client 是否声明。"""
    recorded = read_json(state_path).get("digest")
    return dict(state="never" if not recorded else "unchanged" if recorded == digest else "changed",
                native_clients_declared=native_clients_declared(values),
                directory_clients_declared=directory_clients_declared(values))


class IdpStep:
    """IdP 声明式配置步骤。命令由 release.yaml idp 段声明，在发布树 deploy/local 下执行；run(argv) 返回
    (退出码, 标准输出)。命令的标准输出是一行状态 JSON（bootstrap 与 idp-declarations.py 保证不含值），
    这里只保留其中的状态与计数字段。"""

    KEEP = ("nativeClientProfiles", "directoryClients", "clients", "changed", "users", "written", "missing")

    def __init__(self, spec, digest, values, state_path, run):
        self.spec, self.digest, self.values, self.state_path, self.run = spec, digest, values, state_path, run

    def _one(self, argv):
        code, stdout = self.run([str(a) for a in argv])
        lines = (stdout or "").strip().splitlines()
        try:
            value = json.loads(lines[-1]) if lines else {}
        except ValueError:
            value = {}
        result = {k: value[k] for k in self.KEEP if k in value}
        result.update(command=str(argv[1]), exit_code=code, problems=len(value.get("problems") or []))
        return result

    def plan(self):
        return idp_plan(self.state_path, self.digest, self.values)

    def apply(self, commit):
        plan = self.plan()
        ran = []

        def step(argv):
            result = self._one(argv)
            ran.append(result)
            return result

        if plan["state"] != "unchanged":
            for argv in self.spec["apply"]:
                result = step(argv)
                if result["exit_code"] != 0:
                    # 摘要只在全部成功后记录；失败即停止 deploy，下一次 deploy 从头重跑（命令本身幂等）
                    raise NodeError(f"IdP 声明式配置 {result['command']} 退出 {result['exit_code']}")
        for argv in self.spec.get("always") or []:
            result = step(argv)
            if result["exit_code"] != 0:
                # always 只补新用户、对客户端只读核对；它发现的漂移只能由完整声明处理，作废已记录的摘要，
                # 使下一次 deploy 重新执行 apply（不一致的同名 mapper 仍由 apply 拒绝而不覆写）。
                if read_json(self.state_path).get("digest"):
                    write_json_atomic(self.state_path, dict(digest=None, commit=commit, at=time.time(),
                                                            invalidated=result["command"]))
                raise NodeError(f"IdP 声明式配置 {result['command']} 退出 {result['exit_code']}")
        if plan["state"] != "unchanged":
            write_json_atomic(self.state_path, dict(digest=self.digest, commit=commit, at=time.time(),
                                                    native_clients_declared=plan["native_clients_declared"],
                                                    directory_clients_declared=plan["directory_clients_declared"]))
        return dict(plan, applied=plan["state"] != "unchanged", commands=ran)

    def verify(self):
        results = [self._one(argv) for argv in self.spec["verify"]]
        problems = [f"{r['command']} 退出 {r['exit_code']}（不一致 {r['problems']} 项）"
                    for r in results if r["exit_code"] != 0]
        recorded = read_json(self.state_path).get("digest")
        if recorded != self.digest:
            problems.append("IdP 声明式配置摘要与本次输入不一致（deploy 未完成该步骤）")
        native = next((r.get("nativeClientProfiles") for r in results if "nativeClientProfiles" in r), None)
        directory = next((r.get("directoryClients") for r in results if "directoryClients" in r), None)
        return dict(commands=results, native_client_profiles=native, directory_clients=directory, problems=problems)


# ---- inspect：只读探针 ---------------------------------------------------------

def build_targets(cfg):
    """CI 登记的构建目标名（ci/config.json build_targets 的键）：规划据此区分"从未构建但可构建"的二开产物。"""
    targets = cfg.get("build_targets") or {}
    if not isinstance(targets, (dict, list)):
        raise NodeError("CI 配置 build_targets 不是映射")
    return sorted(str(t) for t in targets)


def inspect(request):
    cfg = ci_config(request["ci_config"])
    project = cfg["compose_project"]
    result = dict(sources=cfg["sources"], compose_project=project, runtime_present=os.path.isfile(
        os.path.join(cfg["runtime"], ".env")), build_targets=build_targets(cfg))
    commit = request.get("commit")
    if commit:
        root = os.path.join(cfg["sources"], commit)
        ready = os.path.join(root, "ready.json")
        receipt = os.path.join(root, "check.json")
        result["tree"] = dict(exists=os.path.isfile(ready))
        if os.path.isfile(receipt):
            with open(receipt, encoding="utf-8") as stream:
                value = json.load(stream)
            result["receipt"] = dict(commit=value.get("commit"), job=value.get("job"), clean=value.get("diff") == "")
    found = containers(project)
    result["running"] = {svc: [dict(digest=ref_digest(c["image_ref"]), running=c["running"], health=c["health"],
                                     exit_code=c["exit_code"]) for c in found.get(svc, [])]
                         for svc in request.get("services", [])}
    env_path = os.path.join(cfg["runtime"], ".env")
    if os.path.isfile(env_path):
        actual = read_env_file(env_path)
        env = {}
        for key, digest in (request.get("env_set") or {}).items():
            values = actual.get(key)
            # 声明要设置而运行 .env 没有的键由 deploy 追加，计划里如实列为 add（与 unset 的 absent 区分）
            env[key] = ("add" if not values else "duplicate" if len(values) > 1 else
                        "unchanged" if hashlib.sha256(values[0].encode()).hexdigest() == digest else "change")
        for key in request.get("env_unset") or []:
            env[key] = "remove" if key in actual else "absent"
        result["env"] = env
        declared = set(request.get("env_set") or {})
        result["missing_required"] = sorted(k for k in request.get("required_env") or []
                                            if k not in actual and k not in declared)
    migrations = {}
    for spec in request.get("migrations") or []:
        try:
            applied = applied_migrations(found, spec["database"])
            migrations[spec["name"]] = dict(pending=sorted(set(spec["versions"]) - set(applied)),
                                            applied=len(applied))
        except NodeError as error:
            migrations[spec["name"]] = dict(error=str(error))
    result["migrations"] = migrations
    proofs = {}
    for name in request.get("proofs") or []:
        if not re.fullmatch(r"[a-z][a-z0-9-]*\.[0-9a-f]{64}\.provenance\.json", name):
            raise NodeError(f"非法证明文件名 {name}")
        path = os.path.join(cfg["release_proofs"], name)
        if not os.path.isfile(path):
            proofs[name] = None
            continue
        with open(path, encoding="utf-8") as stream:
            doc = json.load(stream)
        deps = doc["predicate"]["buildDefinition"]["resolvedDependencies"]
        proofs[name] = dict(commit=next((d["digest"]["gitCommit"] for d in deps
                                         if d.get("digest", {}).get("gitCommit")), None),
                            subject=doc.get("subject"))
    result["proofs"] = proofs
    # 已生效的运维域投递摘要（ADR-20 §10）：只读回 deliveries.json 的摘要，不读投递内容
    journal = request.get("delivery_journal")
    if journal:
        path = os.path.join(str(journal), DELIVERIES)
        applied = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as stream:
                applied = json.load(stream)
        result["deliveries"] = {k: v for k, v in applied.items() if isinstance(v, str) and DIGEST_RE.fullmatch(v)}
    for job in request.get("artifacts") or []:
        if not re.fullmatch(r"[0-9a-f]{32}", job):
            raise NodeError("非法任务 ID")
        path = os.path.join(cfg["artifacts"], job, "dist")
        files = sorted(os.listdir(path)) if os.path.isdir(path) else None
        entries = {}
        for name in files or []:
            if name.endswith(".provenance.json"):
                with open(os.path.join(path, name), encoding="utf-8") as stream:
                    doc = json.load(stream)
                deps = doc["predicate"]["buildDefinition"]["resolvedDependencies"]
                entries[name] = next((d["digest"]["gitCommit"] for d in deps
                                      if d.get("digest", {}).get("gitCommit")), None)
        result.setdefault("artifacts", {})[job] = entries if files is not None else None
    idp = request.get("idp")
    if idp and os.path.isfile(env_path):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(idp.get("files"))) or not all(
                re.fullmatch(r"[A-Z][A-Z0-9_]*", str(k)) for k in idp.get("env") or []):
            raise NodeError("非法 IdP 摘要请求")
        values = read_env_file(env_path)
        result["idp"] = idp_plan(os.path.join(str(idp["journal"]), IDP_STATE),
                                 idp_digest(idp["files"], values, idp["env"]), values)
    drift_request = request.get("config_drift")
    if drift_request:
        # 只读：compose config 只渲染，docker cp 只读出容器内文件；发布树须已由 worker 就绪
        tree = os.path.join(cfg["sources"], str(drift_request["commit"]), "apps")
        if not re.fullmatch(r"[0-9a-f]{40}", str(drift_request["commit"])):
            raise NodeError("config_drift.commit 必须是 40 位完整 commit")
        if not os.path.isfile(os.path.join(cfg["sources"], drift_request["commit"], "ready.json")):
            result["config_drift"] = dict(tree_missing=True)
        else:
            try:
                result["config_drift"] = drift_facts(tree, runtime_dir(cfg), drift_request.get("overlays"), project)
            except NodeError as error:  # 例如目标 commit 要求的 .env 键缺失：plan 照常输出，deploy 时重算
                result["config_drift"] = dict(error=str(error))
    result["active_ci_deploys"] = active_ci_deploys(cfg)
    keep_request = request.get("retention")
    if keep_request is not None:
        keep = [str(c) for c in (keep_request or {}).get("keep") or []]
        if not all(TREE_NAME.fullmatch(c) for c in keep):
            raise NodeError("retention.keep 必须是 40 位完整 commit")
        try:
            result["retention"] = run_retention(cfg, dry_run=True, keep=keep)
        except (NodeError, OSError, ValueError) as error:  # plan 照常输出；deploy 结束时以届时现场重算
            result["retention"] = dict(error=str(error))
    return result


# ---- 发布树与代理暂存保留（ADR-20 §11）--------------------------------------------------

# 策略缺省值随代码版本化；节点路径（journal、回执归档、暂存根、链接扫描根）只来自 CI 配置的 retention 段
RETENTION_DEFAULTS = dict(keep_releases=3, grace_seconds=2 * 3600, scratch_max_age_seconds=24 * 3600, link_depth=6)
TREE_NAME = re.compile(r"[0-9a-f]{40}")
ACTIVE_JOB_STATES = ("QUEUED", "RUNNING", "DEPLOYING")
DOCKER_PRUNE_UNTIL = "72h"


def retention_policy(cfg):
    spec = cfg.get("retention")
    if not isinstance(spec, dict):
        raise NodeError("CI 配置缺少 retention 段")
    missing = [k for k in ("journal", "receipts") if not spec.get(k)]
    if missing:
        raise NodeError(f"CI 配置 retention 缺少 {missing}")
    policy = dict(RETENTION_DEFAULTS)
    for key in RETENTION_DEFAULTS:
        if key in spec:
            value = spec[key]
            if not isinstance(value, int) or isinstance(value, bool) or value < (1 if key == "keep_releases" else 0):
                raise NodeError(f"CI 配置 retention.{key} 不是合法的非负整数")
            policy[key] = value
    for key in ("scratch", "link_roots"):
        if not isinstance(spec.get(key, []), list):
            raise NodeError(f"CI 配置 retention.{key} 不是列表")
    policy.update(journal=str(spec["journal"]), receipts=str(spec["receipts"]),
                  scratch=[str(p) for p in spec.get("scratch") or []],
                  link_roots=[str(p) for p in spec.get("link_roots") or [cfg["runtime"]]])
    return policy


def tree_of(path, sources):
    """路径落在 <sources>/<40 位 commit>（含其自身）之内 → commit，否则 None。sources 可给多种写法。"""
    path = os.path.normpath(str(path))
    for base in sources:
        rel = os.path.relpath(path, base)
        head = rel.split(os.sep)[0]
        if not rel.startswith("..") and TREE_NAME.fullmatch(head):
            return head
    return None


def source_bases(sources):
    return sorted({os.path.normpath(sources), os.path.realpath(sources)})


def container_references(entries, sources):
    """docker inspect 条目（含已停止的容器：重启时仍用原挂载）→ {commit: [原因]}。引用包括挂载来源、
    挂载来源经软链接解析到的位置、Compose 项目目录与 Compose 文件。"""
    bases, found = source_bases(sources), {}
    for entry in entries:
        name = str(entry.get("Name") or entry.get("Id", "")[:12]).lstrip("/")
        labels = (entry.get("Config") or {}).get("Labels") or {}
        paths = [(m.get("Source"), "挂载") for m in entry.get("Mounts") or []]
        paths.append((labels.get(COMPOSE_WORKDIR_LABEL), "Compose 项目目录"))
        paths += [(f, "Compose 文件") for f in (labels.get(COMPOSE_FILES_LABEL) or "").split(",")]
        for path, kind in paths:
            if not path:
                continue
            direct = tree_of(path, bases)
            linked = tree_of(os.path.realpath(path), bases)
            for commit, how in ((direct, kind), (linked if linked != direct else None, kind + "经链接")):
                if commit:
                    kinds = found.setdefault(commit, {}).setdefault(name, [])
                    if how not in kinds:
                        kinds.append(how)
    return {commit: [f"容器 {name}（{'、'.join(kinds)}）" for name, kinds in by_name.items()]
            for commit, by_name in found.items()}


def link_references(roots, sources, max_depth):
    """链接扫描根下（不跟随目录链接，深度受限）指向发布树的软链接 → ({commit: [原因]}, [无法读取的子目录])。
    扫描根本身缺失或不可读即停止；根下由容器 uid 持有、本用户不可读的数据目录（如 OpenBao 存储）只报告：
    其中的链接只在容器内解析，宿主上消费发布树的路径都已出现在容器挂载与 Compose 标签里。"""
    bases, refs, unreadable = source_bases(sources), {}, []
    for root in roots:
        if not os.path.isdir(root) or not os.access(root, os.R_OK | os.X_OK):
            raise NodeError(f"链接扫描根不可读：{root}")
        depth0 = os.path.normpath(root).count(os.sep)
        for folder, dirs, files in os.walk(root, onerror=lambda e: unreadable.append(e.filename)):
            if tree_of(folder, bases):
                dirs[:] = []
                continue
            for name in dirs + files:
                path = os.path.join(folder, name)
                if not os.path.islink(path):
                    continue
                target = os.path.normpath(os.path.join(folder, os.readlink(path)))
                commit = tree_of(target, bases) or tree_of(os.path.realpath(path), bases)
                if commit:
                    refs.setdefault(commit, []).append(f"链接 {path}")
            if os.path.normpath(folder).count(os.sep) - depth0 >= max_depth:
                dirs[:] = []
    return refs, unreadable


def release_history(journal):
    """发布 journal：每个 commit 目录的 deploy.json → [dict(commit, state, started_at, finished_at)]。"""
    found = []
    for name in sorted(os.listdir(journal)) if os.path.isdir(journal) else []:
        path = os.path.join(journal, name, "deploy.json")
        if not TREE_NAME.fullmatch(name) or not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as stream:
            value = json.load(stream)
        found.append(dict(commit=name, state=value.get("state"), started_at=value.get("started_at") or 0,
                          finished_at=value.get("finished_at")))
    return found


def active_job_commits(queue):
    """CI 队列中未结束任务（含尚未领取的请求）引用的 commit。"""
    found = set()
    for path in [os.path.join(queue, "jobs", job, "status.json")
                 for job in (os.listdir(os.path.join(queue, "jobs")) if os.path.isdir(os.path.join(queue, "jobs")) else [])]:
        try:
            with open(path, encoding="utf-8") as stream:
                status = json.load(stream)
        except (OSError, ValueError):
            continue
        if status.get("state") in ACTIVE_JOB_STATES and TREE_NAME.fullmatch(str(status.get("commit"))):
            found.add(status["commit"])
    for folder in (os.path.join(queue, "pending"), os.path.join(queue, "pending", "feedback")):
        for name in os.listdir(folder) if os.path.isdir(folder) else []:
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(folder, name), encoding="utf-8") as stream:
                    commit = str(json.load(stream).get("commit"))
            except (OSError, ValueError, AttributeError):
                continue
            if TREE_NAME.fullmatch(commit):
                found.add(commit)
    return found


def newest_mtime(path, depth=1):
    """路径自身及 depth 层以内条目的最新 mtime（lstat，不跟随链接）。"""
    newest = os.lstat(path).st_mtime
    if depth and os.path.isdir(path) and not os.path.islink(path):
        for name in os.listdir(path):
            try:
                newest = max(newest, newest_mtime(os.path.join(path, name), depth - 1))
            except OSError:
                continue
    return newest


def source_trees(sources):
    """→ ({commit: 最新活动时间}, [不是发布树的条目])。活动时间取树根、ready.json、check.json 的 mtime。"""
    trees, other = {}, []
    for name in sorted(os.listdir(sources)):
        path = os.path.join(sources, name)
        if not TREE_NAME.fullmatch(name) or os.path.islink(path) or not os.path.isdir(path):
            other.append(name)
            continue
        stamps = [os.lstat(path).st_mtime] + [os.lstat(os.path.join(path, f)).st_mtime
                                               for f in ("ready.json", "check.json") if os.path.isfile(os.path.join(path, f))]
        trees[name] = max(stamps)
    return trees, other


def scratch_entries(roots):
    """代理暂存根（~/scratch）下每个条目 → 最新活动时间（条目自身与其直接子项）。链接条目不处理。"""
    found = {}
    for root in roots:
        for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            path = os.path.join(root, name)
            if not os.path.islink(path):
                found[path] = newest_mtime(path)
    return found


def current_pin(releases):
    """journal 中最近一次 SUCCEEDED 的 deploy 的 commit。"""
    succeeded = [r for r in releases if r.get("state") == "SUCCEEDED"]
    if not succeeded:
        return None
    return max(succeeded, key=lambda r: (r.get("finished_at") or r.get("started_at") or 0))["commit"]


def retention_decision(trees, *, now, policy, references=None, releases=(), active=(), main=None, keep=(),
                       scratch=None):
    """纯推导。trees: {commit: 最新活动时间}；references: {commit: [原因]}（容器挂载与链接）；
    releases: 发布 journal 摘要；active: 进行中任务的 commit；main: origin/main；keep: 调用方要求保留的 commit。
    保留：被引用、当前 pin（最近一次成功发布）、最近 keep_releases 次发布、进行中任务、origin/main、调用方指定、
    grace_seconds 内活动过的树；其余删除。暂存条目超过 scratch_max_age_seconds 未活动即删除。"""
    kept = {}

    def hold(commit, reason):
        if commit in trees and reason not in kept.setdefault(commit, []):
            kept[commit].append(reason)

    for commit, reasons in (references or {}).items():
        for reason in reasons:
            hold(commit, reason)
    pin = current_pin(releases)
    if pin:
        hold(pin, "当前 pin（最近一次成功发布）")
    ordered = sorted(releases, key=lambda r: r.get("started_at") or 0, reverse=True)
    for rank, r in enumerate(ordered[:policy["keep_releases"]], 1):
        hold(r["commit"], f"最近 {policy['keep_releases']} 次发布之一（第 {rank} 新）")
    for commit in sorted(active):
        hold(commit, "CI 队列中未结束的任务")
    if main:
        hold(main, "origin/main")
    for commit in keep:
        hold(commit, "本次发布")
    for commit, stamp in trees.items():
        if now - stamp < policy["grace_seconds"]:
            hold(commit, f"{policy['grace_seconds'] // 3600} 小时内活动")
    kept = {c: r for c, r in kept.items() if r}
    delete = sorted((c for c in trees if c not in kept), key=lambda c: trees[c])
    stale = sorted(p for p, stamp in (scratch or {}).items() if now - stamp >= policy["scratch_max_age_seconds"])
    return dict(keep=kept, delete=delete, scratch=stale)


def disk_usage(path):
    """(独占字节, 与其他位置共享的字节)：按块计；硬链接（git clone --local 的对象）删除本树并不释放。"""
    own = shared = 0
    seen = set()
    for folder, dirs, files in os.walk(path, onerror=lambda e: None):
        for name in dirs + files:
            try:
                info = os.lstat(os.path.join(folder, name))
            except OSError:
                continue
            size = info.st_blocks * 512
            if info.st_nlink > 1 and not os.path.isdir(os.path.join(folder, name)):
                if (info.st_dev, info.st_ino) in seen:
                    continue
                seen.add((info.st_dev, info.st_ino))
                shared += size
            else:
                own += size
    return own, shared


def archive_receipts(root, receipts, commit):
    """发布树根下的 *.json 回执（ready/check）→ <receipts>/<commit>/；已存在且内容相同则跳过，不同则加时间后缀。"""
    archived = []
    names = [n for n in sorted(os.listdir(root)) if n.endswith(".json")
             and os.path.isfile(os.path.join(root, n)) and not os.path.islink(os.path.join(root, n))]
    if not names:
        return archived
    folder = os.path.join(receipts, commit)
    os.makedirs(folder, mode=0o775, exist_ok=True)
    for name in names:
        data = _read_bytes(os.path.join(root, name))
        dest = os.path.join(folder, name)
        if os.path.isfile(dest):
            if _read_bytes(dest) == data:
                archived.append(name)
                continue
            dest = os.path.join(folder, f"{name[:-5]}.{int(time.time())}.json")
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".")
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, dest)
        archived.append(os.path.basename(dest))
    return archived


def remove_path(path):
    """删除可重建内容：先 chmod -R u+w（go module cache 等只读树），再删除；本用户无权限的条目经 sudo -n 删除。"""
    if os.path.islink(path) or not os.path.isdir(path):
        os.unlink(path)
        return
    try:
        for folder, dirs, files in os.walk(path):
            for name in [""] + dirs + files:
                item = os.path.join(folder, name) if name else folder
                if not os.path.islink(item):
                    mode = os.lstat(item).st_mode
                    if not mode & 0o200:
                        os.chmod(item, (mode & 0o7777) | 0o200)
        shutil.rmtree(path)
    except OSError:
        run(["sudo", "-n", "chmod", "-R", "u+w", "--", path])
        run(["sudo", "-n", "rm", "-rf", "--one-file-system", "--", path])
    if os.path.lexists(path):
        raise NodeError(f"删除后仍存在：{path}")


def free_bytes(path):
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def all_containers():
    ids = out(DOCKER + ["ps", "-a", "-q", "--no-trunc"]).split()
    return json.loads(out(DOCKER + ["inspect", *ids])) if ids else []


def origin_main(cfg):
    repo = cfg.get("source_repository")
    if not repo:
        return None
    r = run(["git", "-C", str(repo), "rev-parse", "--verify", "-q", "refs/remotes/origin/main"], check=False)
    value = r.stdout.decode().strip()
    return value if r.returncode == 0 and TREE_NAME.fullmatch(value) else None


CHECK_IMAGE = "local/kailo-check:"
CHECK_RECIPE = "tools/check.Dockerfile"
HOLD_LABEL = "io.kailo.retention.hold"


def git_show(repo):
    """(commit, 仓库内路径) → 文件内容 bytes；对象不存在时 None。"""
    def show(commit, path):
        r = run(["git", "-C", str(repo), "show", f"{commit}:{path}"], check=False)
        return r.stdout if r.returncode == 0 else None
    return show


def protected_check_images(commits, show):
    """检查镜像按配方 SHA-256 命名（local/kailo-check:<sha256(tools/check.Dockerfile)>）。commits: [(commit, 原因)]
    → {镜像引用: [原因]}：这些 commit 的配方对应的检查镜像不得被 prune（重建一次很贵）。"""
    found = {}
    for commit, reason in commits:
        if not commit:
            continue
        recipe = show(commit, CHECK_RECIPE)
        if recipe is None:
            raise NodeError(f"读不到 {commit[:12]} 的 {CHECK_RECIPE}，无法确定要保护的检查镜像，不执行 docker prune")
        ref = CHECK_IMAGE + hashlib.sha256(recipe).hexdigest()
        if reason not in found.setdefault(ref, []):
            found[ref].append(reason)
    return found


def docker_prune(dry_run, protect=None, docker=None):
    """未被任何容器使用、且早于 72h 的镜像与构建缓存。protect 中的镜像（{引用: [原因]}）在 image prune 期间各由一个
    从不启动的 created 容器（带 HOLD_LABEL）占用，prune 之后删除；上次异常遗留的占位容器先清掉。
    dry-run 只回报 docker system df 的可回收上界与受保护镜像。"""
    docker = docker or (lambda argv: out(DOCKER + argv))
    protect = protect or {}
    commands = [["image", "prune", "-a", "-f", "--filter", f"until={DOCKER_PRUNE_UNTIL}"],
                ["builder", "prune", "-f", "--filter", f"until={DOCKER_PRUNE_UNTIL}"]]

    def image_id(ref):
        try:
            return docker(["image", "inspect", "--format", "{{.Id}}", ref]) or None
        except NodeError:
            return None

    present = {ref: image_id(ref) for ref in sorted(protect)}
    report = dict(protected={ref: dict(image=present[ref], reasons=protect[ref]) for ref in sorted(protect)})
    if dry_run:
        rows = [json.loads(line) for line in docker(["system", "df", "--format", "{{json .}}"]).splitlines() if line]
        report.update(commands=[" ".join(["docker"] + c) for c in commands],
                      reclaimable_upper_bound={r.get("Type"): r.get("Reclaimable") for r in rows})
        return report

    def release_holds():
        stale = docker(["ps", "-a", "-q", "--no-trunc", "--filter", f"label={HOLD_LABEL}"]).split()
        if stale:
            docker(["rm", "-f", *stale])

    release_holds()
    reclaimed, holds = {}, []
    try:
        for ref, image in present.items():
            if image:
                holds.append(docker(["create", "--pull=never", "--network", "none", "--label", f"{HOLD_LABEL}={ref}",
                                     image, "/kailo-retention-hold"]))
        for argv in commands:
            text = docker(argv)
            m = re.search(r"Total(?: reclaimed space)?:\s*(.+)$", text, re.M)
            reclaimed[argv[0]] = m.group(1).strip() if m else "0B"
    finally:
        if holds:
            docker(["rm", "-f", *holds])
    report["reclaimed"] = reclaimed
    return report


@contextlib.contextmanager
def source_lock(cfg):
    """与 CI worker 的发布树准备（<queue>/source.lock）互斥：删除期间不会有任务正在准备同一棵树。"""
    with open(os.path.join(cfg["queue"], "source.lock"), "a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def run_retention(cfg, *, dry_run, keep=(), prune=False, now=None):
    """发布树与代理暂存保留（ADR-20 §11）。任何引用事实读不全（Docker、journal、链接扫描根）即停止，不删除。
    非 dry-run 在 source.lock 下重新取事实后删除；先归档回执再删树。"""
    policy = retention_policy(cfg)
    sources = cfg["sources"]
    workspace = (cfg.get("environment") or {}).get("TMPDIR") or sources

    def decide():
        trees, other = source_trees(sources)
        refs = container_references(all_containers(), sources)
        links, unreadable = link_references(policy["link_roots"], sources, policy["link_depth"])
        report["unscanned"] = unreadable
        for commit, reasons in links.items():
            refs.setdefault(commit, []).extend(reasons)
        releases, main = release_history(policy["journal"]), origin_main(cfg)
        decision = retention_decision(trees, now=time.time() if now is None else now, policy=policy,
                                      references=refs, releases=releases,
                                      active=active_job_commits(cfg["queue"]), main=main, keep=keep,
                                      scratch=scratch_entries(policy["scratch"]))
        anchors.extend([(main, "origin/main 的检查配方"), (current_pin(releases), "当前 pin 的检查配方")]
                       + [(c, "本次指定 commit 的检查配方") for c in keep])
        return trees, other, decision

    anchors = []

    stamp = time.time() if now is None else now
    before = free_bytes(workspace)
    report = dict(dry_run=dry_run, policy={k: policy[k] for k in RETENTION_DEFAULTS}, free_before=before)
    with (contextlib.nullcontext() if dry_run else source_lock(cfg)):
        trees, other, decision = decide()
        report.update(kept={c: decision["keep"][c] for c in sorted(decision["keep"])}, not_trees=other)
        removed, freed = [], 0
        for commit in decision["delete"]:
            root = os.path.join(sources, commit)
            own, shared = disk_usage(root)
            entry = dict(commit=commit, bytes=own, shared_bytes=shared, idle_hours=round((stamp - trees[commit]) / 3600, 1))
            if not dry_run:
                entry["receipts"] = archive_receipts(root, policy["receipts"], commit)
                remove_path(root)
            removed.append(entry)
            freed += own
        scratch = []
        for path in decision["scratch"]:
            own, shared = disk_usage(path) if os.path.isdir(path) else (os.lstat(path).st_blocks * 512, 0)
            if not dry_run:
                remove_path(path)
            scratch.append(dict(path=path, bytes=own))
            freed += own
    report.update(trees=removed, scratch=scratch, tree_bytes=sum(t["bytes"] for t in removed),
                  scratch_bytes=sum(s["bytes"] for s in scratch), estimated_bytes=freed)
    if prune:
        try:
            if not cfg.get("source_repository"):
                raise NodeError("CI 配置缺少 source_repository，无法确定要保护的检查镜像，不执行 docker prune")
            report["docker"] = docker_prune(dry_run, protected_check_images(anchors, git_show(cfg["source_repository"])))
        except NodeError as error:  # 发布树与暂存的保留已完成；prune 不在无保护时执行
            report["docker"] = dict(error=str(error))
    report["free_after"] = free_bytes(workspace)
    return report


# ---- 固定发布树上的阶段 ---------------------------------------------------------

class Release:
    """一个 pin commit 在 CI 节点上的发布上下文。"""

    def __init__(self, commit, need_receipt=True):
        if FROM_STDIN or HERE is None:
            raise NodeError("backup/deploy/verify 只能从固定发布树内的 node.py 执行")
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise NodeError("--commit 必须是 40 位完整 commit")
        sys.path.insert(0, HERE)
        import model  # 与开发机同一推导；ROOT 即本发布树
        self.model = model
        self.decl = model.declarations()
        self.cfg = ci_config(self.decl["node"]["ci_config"])
        self.commit = commit
        self.tree = os.path.realpath(os.path.join(self.cfg["sources"], commit, "apps"))
        if os.path.realpath(model.ROOT) != self.tree:
            raise NodeError(f"node.py 不在 {commit[:12]} 的固定发布树内")
        self.runtime = runtime_dir(self.cfg)
        self.deploy_dir = os.path.join(self.tree, "deploy", "local")
        self.journal = os.path.join(self.decl["node"]["journal"], commit)
        self.backups = os.path.join(self.decl["node"]["backups"], commit)
        self._preflight(need_receipt)
        self.compose_text = model.compose_text()
        if model.project_name(self.compose_text) != self.cfg["compose_project"]:
            raise NodeError("compose 项目名与 CI 配置不一致")
        self.services = model.compose_services(self.compose_text)
        self.units = model.units(self.decl)
        self.managed = {s: i for s, i in model.managed_services(self.services, self.units).items()
                        if self.services[s]["restart"] != "no"}
        # 运维域运行体与投递（ADR-20 §10）：上游固定 digest 的服务，以及 Core 启动入口消费的投递文件
        self.operated = model.operated_services(self.services, self.decl)
        self.delivery = model.peer_delivery(self.decl, self.services)
        # start-core.sh 与迁移容器所需的受限资源参数，取自 CI 执行配置（与 worker 同一来源）
        wanted = [str(k) for k in self.decl["node"].get("ci_environment") or []]
        self.ci_env = {k: str(v) for k, v in (self.cfg.get("environment") or {}).items() if k in wanted}
        if set(wanted) - set(self.ci_env):
            raise NodeError(f"CI 配置 environment 缺少 {sorted(set(wanted) - set(self.ci_env))}")

    def git(self, *args):
        return out(["git", "-C", self.tree, *args])

    def idp_step(self):
        """本发布树的 IdP 声明式配置：摘要输入取自发布树（期望值定义文件与 realm 模板）与运行 .env。"""
        spec = self.model.idp_declaration(self.decl)
        files, keys = self.model.idp_inputs(self.decl)
        values = read_env_file(os.path.join(self.runtime, ".env"))

        def execute(argv):
            # stderr 直通（拒绝原因只含键名与角色）；stdout 只取状态 JSON
            r = subprocess.run(argv, cwd=self.deploy_dir, env=self.env(), stdout=subprocess.PIPE, stderr=sys.stderr)
            return r.returncode, r.stdout.decode(errors="replace")

        return IdpStep(spec, idp_digest(files, values, keys), values,
                       os.path.join(self.decl["node"]["journal"], IDP_STATE), execute)

    def _preflight(self, need_receipt):
        root = os.path.dirname(self.tree)
        with open(os.path.join(root, "ready.json"), encoding="utf-8") as stream:
            if json.load(stream).get("commit") != self.commit:
                raise NodeError("ready.json 与 commit 不符")
        if self.git("rev-parse", "HEAD") != self.commit:
            raise NodeError("发布树 HEAD 与 commit 不符")
        dirty = self.git("status", "--porcelain", "--untracked-files=all")
        if dirty:
            raise NodeError("发布树不干净：\n" + "\n".join(dirty.splitlines()[:20]))
        if need_receipt:
            receipt = os.path.join(root, "check.json")
            if not os.path.isfile(receipt):
                raise NodeError("该 commit 没有成功的 full 检查回执")
            with open(receipt, encoding="utf-8") as stream:
                value = json.load(stream)
            if value.get("commit") != self.commit or value.get("diff") != "" or self.git("diff", "HEAD"):
                raise NodeError("full 检查回执与发布树不符")

    # -- Compose -----------------------------------------------------------------

    def env(self, extra=None):
        value = dict(os.environ, KAILO_RUNTIME_DIR=self.runtime)
        value.update(extra or {})
        return value

    def compose_argv(self):
        return compose_argv(self.tree, self.runtime, self.decl.get("overlays"), getattr(self, "env_preview", None))[0]

    def compose(self, *args, capture=True, check=True):
        return run(self.compose_argv() + list(args), capture=capture, check=check, env=self.env(), cwd=self.deploy_dir)

    def desired(self):
        """(渲染结果, {服务: up 所用的配置哈希})：与 up 同一套参数与 env_file 解析。"""
        return desired_config(self.compose_argv(), self.deploy_dir, self.runtime)

    def drift(self, rendered, hashes, found):
        return config_drift(rendered, hashes, found, container_file, overlays=self.decl.get("overlays"))

    def converge(self, drift, targets):
        """配置漂移 → 收敛计划（ADR-20 §9）；漂移服务一律按 release.yaml 的 drift 策略处理，不设数量阈值。"""
        names = [d["service"] for d in drift["drift"] if d["service"] in self.services]
        return self.model.converge_plan(self.services, names, targets, self.managed, self.decl)

    # -- 推导 --------------------------------------------------------------------

    def migration_plan(self, found):
        plans = []
        for name, spec in self.decl["migrations"].items():
            versions = self.model.migration_versions(name, self.decl)
            pending = sorted(set(versions) - set(applied_migrations(found, spec["database"])))
            plans.append(dict(name=name, database=spec["database"], pending=pending))
        return plans

    def targets(self, found):
        """运行 digest 不等于 pin 的受管服务（含未运行的）；运维域投递尚未经启动入口生效时，
        加上消费它的服务（start-core.sh 按文件原路径只读挂载，替换文件不会进入已运行的容器）。"""
        out_ = []
        for svc in self.managed:
            ctr = single_container(found, svc)
            if not ctr or ref_digest(ctr["image_ref"]) != self.services[svc]["digest"]:
                out_.append(svc)
        if self.delivery_pending() and self.delivery["restart"] not in out_:
            out_.append(self.delivery["restart"])
        return self.model.deploy_order(self.services, out_, self.decl)

    def operated_targets(self, found):
        """没有唯一运行中容器的运维域运行体，由本入口创建（ADR-20 §10）。已运行者镜像引用或配置与发布树不同
        即是 §9 的配置漂移（镜像在 Compose 配置哈希内），由漂移收敛重建，不在这里重复处理。"""
        return [svc for svc in self.operated if not single_container(found, svc)]

    # -- 运维域投递 ----------------------------------------------------------------

    def applied_deliveries(self):
        path = os.path.join(self.decl["node"]["journal"], DELIVERIES)
        if not os.path.isfile(path):
            return {}
        with open(path, encoding="utf-8") as stream:
            return json.load(stream)

    def delivery_pending(self):
        return bool(self.delivery) and self.applied_deliveries().get("protocol_peers") != self.delivery["digest"]

    def delivery_folder(self):
        folder = os.path.join(self.runtime, self.delivery["runtime"])
        parts = os.path.relpath(folder, self.runtime).split(os.sep)
        for i in range(1, len(parts) + 1):
            path = os.path.join(self.runtime, *parts[:i])
            if os.path.islink(path):
                raise NodeError(f"运行目录中的投递路径是软链接：{path}")
        return folder

    def write_deliveries(self):
        """把 delivery.protocol_peers 渲染为运行目录内的真实规范文件（0644，Core uid 与 Worker 只读挂载）：
        交付目录的 adapters 保留已有条目，protocolPeers 与一致性环境取发布树声明。内容不变的文件不改写；
        写入用同目录临时文件 + fsync + 原子替换。返回改写的文件名（不含内容）。"""
        folder = self.delivery_folder()
        os.makedirs(folder, mode=0o755, exist_ok=True)
        os.chmod(folder, 0o755)
        directory_path = os.path.join(folder, self.model.PEER_DIRECTORY_FILE)
        conformance_path = os.path.join(folder, self.model.PEER_CONFORMANCE_FILE)
        for path in (directory_path, conformance_path):
            if os.path.islink(path) or (os.path.exists(path) and not os.path.isfile(path)):
                raise NodeError(f"投递文件不是普通文件：{path}")
        existing = self.model.load_json(directory_path) if os.path.isfile(directory_path) else None
        documents = {directory_path: self.model.render_peer_directory(existing, self.delivery["peers"]),
                     conformance_path: self.delivery["conformance"]}
        written = []
        for path, value in documents.items():
            text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as stream:
                    if stream.read() == text:
                        os.chmod(path, 0o644)
                        continue
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".delivery-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    stream.write(text)
                    stream.flush()
                    os.fchmod(stream.fileno(), 0o644)
                    os.fsync(stream.fileno())
                os.replace(tmp, path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            written.append(os.path.basename(path))
        return written

    def record_delivery(self):
        """启动入口回读成功后记下已生效的投递摘要。"""
        path = os.path.join(self.decl["node"]["journal"], DELIVERIES)
        applied = self.applied_deliveries()
        applied["protocol_peers"] = self.delivery["digest"]
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".")
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(applied, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)

    def delivery_problems(self):
        """回读：运行目录文件等于声明（protocolPeers 与一致性环境），且已经启动入口生效。"""
        if not self.delivery:
            return []
        bad = []
        folder = os.path.join(self.runtime, self.delivery["runtime"])
        try:
            directory = self.model.load_json(os.path.join(folder, self.model.PEER_DIRECTORY_FILE))
            conformance = self.model.load_json(os.path.join(folder, self.model.PEER_CONFORMANCE_FILE))
        except (OSError, ValueError, self.model.ReleaseError):
            return ["运维域投递文件缺失或不可解析"]
        if directory.get("protocolPeers") != self.delivery["peers"]:
            bad.append("交付目录 protocolPeers 与发布树声明不一致")
        if conformance != self.delivery["conformance"]:
            bad.append("一致性环境与发布树声明不一致")
        if self.delivery_pending():
            bad.append(f"运维域投递尚未经 {self.delivery['restart']} 的启动入口生效")
        return bad

    def lock(self):
        os.makedirs(self.decl["node"]["journal"], mode=0o700, exist_ok=True)
        stream = open(os.path.join(self.decl["node"]["journal"], ".deploy.lock"), "a")
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise NodeError("另一个发布正在节点上执行（releases/.deploy.lock）") from None
        active = active_ci_deploys(self.cfg)
        if active:
            raise NodeError(f"CI 队列中有进行中的 deploy 任务 {active}，部署保持串行")
        return stream

    def write_journal(self, name, value):
        os.makedirs(self.journal, mode=0o700, exist_ok=True)
        path = os.path.join(self.journal, name)
        fd, tmp = tempfile.mkstemp(dir=self.journal, prefix=".")
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)

    # -- backup ------------------------------------------------------------------

    def backup(self):
        lock = self.lock()
        manifest_path = os.path.join(self.backups, "manifest.json")
        if os.path.isfile(manifest_path):
            with open(manifest_path, encoding="utf-8") as stream:
                manifest = json.load(stream)
            for item in manifest["files"]:
                if sha256_file(os.path.join(self.backups, item["file"])) != item["sha256"]:
                    raise NodeError(f"已有备份 {item['file']} 摘要不符，停止")
            say(f"备份已存在且摘要一致：{self.backups}")
            manifest["reused"] = True
            return manifest
        found = containers(self.cfg["compose_project"])
        # 配置漂移按声明后的 .env 预判（未落盘）；deploy 在声明式 .env 落盘后重算，以那时为准
        with self.declared_env_preview():
            rendered, hashes = self.desired()
        converge = self.converge(self.drift(rendered, hashes, found), self.targets(found))
        targets = converge["targets"]
        migrations = self.migration_plan(found)
        databases = self.model.databases_for(self.services, targets)
        for database in self.model.converge_databases(self.services, converge):
            if database not in databases:
                databases.append(database)
        for plan in migrations:
            if plan["pending"] and plan["database"] not in databases:
                databases.append(plan["database"])
        os.umask(0o077)
        os.makedirs(self.backups, mode=0o700, exist_ok=True)
        files = []
        for database in databases:
            ctr = single_container(found, database)
            if not ctr:
                raise NodeError(f"{database} 没有唯一运行中的容器")
            target = os.path.join(self.backups, f"{database}.dump")
            say(f"== 备份 {database}（pg_dump -Fc）")
            with open(target + ".tmp", "wb") as stream:
                # 用户与库名只取数据库容器自身环境，不经命令行或本进程
                r = subprocess.run(DOCKER + ["exec", ctr["id"], "sh", "-c",
                                             'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                                   stdout=stream, stderr=subprocess.PIPE)
            if r.returncode or not os.path.getsize(target + ".tmp"):
                raise NodeError(f"{database} pg_dump 失败（退出 {r.returncode}）")
            with open(target + ".tmp", "rb") as stream:
                listing = subprocess.run(DOCKER + ["exec", "-i", ctr["id"], "pg_restore", "--list"],
                                         stdin=stream, capture_output=True)
            entries = sum(1 for line in listing.stdout.decode(errors="replace").splitlines()
                          if line and not line.startswith(";"))
            if listing.returncode or not entries:
                raise NodeError(f"{database} 备份未通过 pg_restore --list 校验")
            os.replace(target + ".tmp", target)
            files.append(dict(kind="postgres", service=database, file=os.path.basename(target),
                              bytes=os.path.getsize(target), sha256=sha256_file(target), entries=entries))
            say(f"   {database}: {files[-1]['bytes']} 字节，{entries} 个对象")
        snapshot = os.path.join(self.backups, "env.snapshot")
        shutil.copyfile(os.path.join(self.runtime, ".env"), snapshot)
        os.chmod(snapshot, 0o600)
        files.append(dict(kind="env", file="env.snapshot", bytes=os.path.getsize(snapshot),
                          sha256=sha256_file(snapshot)))
        manifest = dict(commit=self.commit, created_at=time.time(), targets=targets,
                        config_converge=converge, migrations=migrations, files=files, path=self.backups)
        fd, tmp = tempfile.mkstemp(dir=self.backups, prefix=".")
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(manifest, stream, ensure_ascii=False, indent=2)
        os.replace(tmp, manifest_path)
        lock.close()
        return manifest

    # -- deploy ------------------------------------------------------------------

    def normalize_tree(self):
        """已跟踪文件按 Git 模式：目录与可执行文件 0755，其余 0644；sources/ 与 sources/<commit>/ 只开放遍历。
        与 upstream_manifest.stage 对构建输入的规则相同；不触碰 .git 与未跟踪内容。"""
        sources = os.path.realpath(self.cfg["sources"])
        for path in (sources, os.path.dirname(self.tree)):
            os.chmod(path, os.stat(path).st_mode & 0o7777 | 0o711)
        os.chmod(self.tree, 0o755)
        raw = run(["git", "-C", self.tree, "ls-files", "-s", "-z"]).stdout.decode()
        dirs, changed = set(), 0
        for entry in raw.split("\0"):
            if not entry:
                continue
            meta, rel = entry.split("\t", 1)
            mode = meta.split(" ")[0]
            path = os.path.join(self.tree, rel)
            parent = os.path.dirname(rel)
            while parent and parent not in dirs:
                dirs.add(parent)
                parent = os.path.dirname(parent)
            want = {"100644": 0o644, "100755": 0o755}.get(mode)
            if want is None or os.path.islink(path) or not os.path.isfile(path):
                continue
            if os.stat(path).st_mode & 0o7777 != want:
                os.chmod(path, want)
                changed += 1
        for rel in dirs:
            path = os.path.join(self.tree, rel)
            if not os.path.islink(path) and os.stat(path).st_mode & 0o7777 != 0o755:
                os.chmod(path, 0o755)
                changed += 1
        if self.git("status", "--porcelain", "--untracked-files=all"):
            raise NodeError("权限规范后发布树不再干净")
        return changed

    def render_env(self):
        """声明式 .env（ADR-20 §4）应用到运行 .env 后的 (路径, 行, {键: 动作})；不写盘、不输出值。"""
        to_set, to_unset = self.model.env_declaration(self.decl)
        path = os.path.join(self.runtime, ".env")
        with open(path, encoding="utf-8") as stream:
            lines = stream.read().split("\n")
        actions, seen = {}, set()
        result = []
        for line in lines:
            m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
            key = m.group(1) if m else None
            if key in to_unset:
                actions[key] = "removed"
                continue
            if key in to_set:
                if key in seen:
                    raise NodeError(f".env 中 {key} 重复，停止")
                seen.add(key)
                current = m.group(2)
                if len(current) >= 2 and current[0] == current[-1] and current[0] in "'\"":
                    current = current[1:-1]
                if current != to_set[key]:
                    line = f"{key}={to_set[key]}"
                    actions[key] = "changed"
                else:
                    actions[key] = "unchanged"
            result.append(line)
        missing = [k for k in to_set if k not in seen]
        if missing:
            if result and result[-1] == "":
                result.pop()
            result += [f"{k}={to_set[k]}" for k in missing] + [""]
            actions.update({k: "added" for k in missing})
        for key in to_unset:
            actions.setdefault(key, "absent")
        return path, result, actions

    @contextlib.contextmanager
    def declared_env_preview(self):
        """deploy 之前（backup 的漂移与数据库推导）按声明后的 .env 渲染：同目录 0600 临时文件，用后即删。
        compose 以 ${NAME:?} 要求的新键此时尚未落盘，直接用运行 .env 会插值失败。"""
        path, result, actions = self.render_env()
        if not any(a in ("changed", "added", "removed") for a in actions.values()):
            yield
            return
        fd, tmp = tempfile.mkstemp(dir=self.runtime, prefix=".env.preview-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write("\n".join(result))
            self.env_preview = tmp
            yield
        finally:
            self.env_preview = None
            os.unlink(tmp)

    def apply_env(self):
        """声明式 .env（ADR-20 §4）：只报告键与动作；有变化时同目录临时文件 + fsync + 原子替换。"""
        path, result, actions = self.render_env()
        if any(a in ("changed", "added", "removed") for a in actions.values()):
            info = os.stat(path)
            fd, tmp = tempfile.mkstemp(dir=self.runtime, prefix=".env.release-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    stream.write("\n".join(result))
                    stream.flush()
                    os.fchmod(stream.fileno(), info.st_mode & 0o7777)
                    os.fsync(stream.fileno())
                os.replace(tmp, path)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            journal = os.path.join(self.decl["node"]["journal"], "env-journal.jsonl")
            fd = os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as stream:
                for key, action in sorted(actions.items()):
                    if action in ("changed", "added", "removed"):
                        stream.write(json.dumps(dict(at=time.time(), commit=self.commit, key=key, action=action)) + "\n")
        for key, action in sorted(actions.items()):
            say(f"   .env {key}: {action}")
        return actions

    def check_rendered(self, rendered):
        """渲染结果：受管服务镜像 = pin；运行投递与数据不解析到发布树内。"""
        bad = []
        for svc in self.managed:
            image = rendered["services"][svc]["image"]
            if ref_digest(image) != self.services[svc]["digest"]:
                bad.append(f"{svc}: 渲染镜像与 pin 不一致")
        inside = tuple(os.path.join(self.deploy_dir, d) + os.sep for d in ("secrets", "data"))
        for svc, spec in rendered["services"].items():
            for volume in spec.get("volumes") or []:
                if volume.get("type") == "bind" and str(volume.get("source", "")).startswith(inside):
                    bad.append(f"{svc}: bind source 解析到发布树内的运行投递")
        for kind in ("secrets", "configs"):
            for name, spec in (rendered.get(kind) or {}).items():
                if str((spec or {}).get("file", "")).startswith(inside):
                    bad.append(f"{kind}.{name}: 文件解析到发布树内的运行投递")
        proofs = set(os.listdir(self.cfg["release_proofs"]))
        bad += self.model.pin_consistency(self.units, proofs)
        if bad:
            raise NodeError("部署前核对失败：\n" + "\n".join(bad))

    def migrate(self, plan):
        spec = self.decl["migrations"][plan["name"]]
        recipe = sha256_file(os.path.join(self.tree, "tools", "check.Dockerfile"))
        image = run(DOCKER + ["image", "inspect", "--format", "{{.Id}}", f"local/kailo-check:{recipe}"], check=False)
        if image.returncode:
            raise NodeError("缺少本 commit 配方的检查镜像（先完成 check 阶段）")
        found = containers(self.cfg["compose_project"])
        db = single_container(found, spec["database"])
        if not db:
            raise NodeError(f"{spec['database']} 没有唯一运行中的容器")
        networks = list(json.loads(out(DOCKER + ["inspect", db["id"]]))[0]["NetworkSettings"]["Networks"].values())
        if len(networks) != 1:
            raise NodeError(f"{spec['database']} 网络不唯一")
        with open(os.path.join(self.runtime, str(spec["url_env_file"])), encoding="utf-8") as stream:
            line = stream.readline().rstrip("\n")
        if not line.startswith("DATABASE_URL=") or len(line) <= len("DATABASE_URL="):
            raise NodeError("迁移连接投递缺失")
        env = self.ci_env
        scratch = tempfile.mkdtemp()
        try:
            cid = out(DOCKER + ["create", "--pull=never", "--interactive", "--cpus", env["CHECK_CPUS"],
                                "--memory", env["CHECK_MEMORY"], "--memory-swap", env["CHECK_MEMORY"],
                                "--user", f"{os.getuid()}:{os.getgid()}", "--network", networks[0]["NetworkID"],
                                "--mount", f"type=bind,src={os.path.join(self.tree, str(spec['source']))},dst=/migrations,readonly",
                                "--mount", f"type=bind,src={scratch},dst=/tmp", "--env", "TMPDIR=/tmp",
                                image.stdout.decode().strip(), "bash", "-ec",
                                "IFS= read -r DATABASE_URL; export DATABASE_URL; exec sqlx migrate run --source /migrations"])
            try:
                started = subprocess.run(DOCKER + ["start", "-ai", cid], input=(line[len("DATABASE_URL="):] + "\n").encode(),
                                         stdout=sys.stderr, stderr=sys.stderr)
                code = out(DOCKER + ["wait", cid])
            finally:
                run(DOCKER + ["rm", "-f", cid], check=False)
            if started.returncode or code != "0":
                raise NodeError(f"迁移 {plan['name']} 退出 {code}")
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    def wait_ready(self, service, timeout=600):
        deadline = time.monotonic() + timeout
        while True:
            ctr = single_container(containers(self.cfg["compose_project"]), service)
            if ctr and ctr["running"] and ctr["health"] in (None, "healthy"):
                return ctr
            if ctr and ctr["health"] == "unhealthy":
                raise NodeError(f"{service} unhealthy")
            if time.monotonic() >= deadline:
                raise NodeError(f"{service} 在 {timeout} 秒内未就绪")
            time.sleep(3)

    def apply_config_oneoffs(self):
        """Run every configuration one-shot whose config digest differs from the last applied one
        (ADR-20 §5), before any service is replaced, and record the digest only after success."""
        path = os.path.join(self.decl["node"]["journal"], "config-oneoffs.json")
        applied = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as stream:
                applied = json.load(stream)
        ran = []
        for svc, digest in sorted(self.model.config_oneoffs(self.compose_text, self.deploy_dir).items()):
            if applied.get(svc) == digest:
                continue
            say(f"== 配置一次性服务 {svc}（输入 {digest[:19]}）")
            self.run_prerequisite(svc)
            applied[svc] = digest
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".")
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(applied, stream, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, path)
            ran.append(svc)
        return ran

    def run_prerequisite(self, service):
        say(f"   一次性前置 {service}")
        self.compose("up", "-d", "--no-deps", "--force-recreate", "--no-build", service, capture=False)
        ctr = single_container(containers(self.cfg["compose_project"]), service, running_only=False)
        if not ctr:
            raise NodeError(f"{service} 没有唯一容器")
        code = out(DOCKER + ["wait", ctr["id"]])
        if code != "0":
            raise NodeError(f"一次性前置 {service} 退出 {code}")

    def readback(self, service):
        ctr = single_container(containers(self.cfg["compose_project"]), service)
        if not ctr:
            raise NodeError(f"{service} 未运行")
        want = self.services[service]["digest"]
        state = dict(service=service, digest=ref_digest(ctr["image_ref"]), image_id=ctr["image_id"],
                     health=ctr["health"], running=ctr["running"], container=ctr["name"])
        problems = judge_image(want, ctr["image_ref"], ctr["image_id"], resolve_local(ctr["image_ref"]),
                               registry_has(ctr["image_ref"]))
        if problems:
            raise NodeError(f"{service}：" + "；".join(problems))
        if ctr["health"] not in (None, "healthy"):
            raise NodeError(f"{service} 健康状态 {ctr['health']}")
        build_info = (self.decl["services"].get(service) or {}).get("build_info")
        if build_info:
            unit = self.model.unit_of_image(self.units)[self.managed[service]]
            if not unit.upstream:
                raise NodeError(f"{service}: build_info 只适用于来源记录中的产物")
            path = self.cfg.get(build_info)
            if not path:
                raise NodeError(f"CI 配置缺少 {build_info}")
            info = json.loads(out(DOCKER + ["exec", ctr["id"], "cat", path]))
            if info.get("buildId") != unit.artifact.get("source_digest"):
                raise NodeError(f"{service} build-info 与来源记录不一致")
            state["build_id"] = info.get("buildId")
        return state

    def readback_operated(self, service):
        """运维域运行体：容器引用等于 compose 的固定引用，本节点解析出的镜像就是容器正在运行的镜像，健康。
        上游镜像来自其原 registry，不做本仓库产物的 registry 复现核对。"""
        ctr = single_container(containers(self.cfg["compose_project"]), service)
        if not ctr:
            raise NodeError(f"{service} 未运行")
        want = self.services[service]["raw_image"]
        state = dict(service=service, digest=ref_digest(ctr["image_ref"]), image_id=ctr["image_id"],
                     health=ctr["health"], running=ctr["running"], container=ctr["name"], operated=True)
        if ctr["image_ref"] != want:
            raise NodeError(f"{service}：运行镜像引用与 compose 固定引用不一致")
        if resolve_local(want) != ctr["image_id"]:
            raise NodeError(f"{service}：固定引用解析出的镜像与容器运行镜像不同")
        if ctr["health"] not in (None, "healthy"):
            raise NodeError(f"{service} 健康状态 {ctr['health']}")
        return state
    def readback_config(self, service, rendered, hashes):
        """配置回读（ADR-20 §9）：唯一运行容器的配置哈希等于渲染结果（由启动命令以一次性叠加组合的除外）、
        configs 内容等于容器内文件、健康。"""
        found = containers(self.cfg["compose_project"])
        ctr = single_container(found, service)
        if not ctr:
            raise NodeError(f"{service} 未运行")
        left = config_drift(dict(rendered, services={service: rendered["services"][service]}), hashes,
                            {service: [ctr]}, container_file, overlays=self.decl.get("overlays"))
        if left["drift"]:
            raise NodeError(f"{service} 重建后配置仍不一致：" + "；".join(left["drift"][0]["reasons"]))
        if ctr["health"] not in (None, "healthy"):
            raise NodeError(f"{service} 健康状态 {ctr['health']}")
        return dict(service=service, config_hash=ctr["config_hash"], health=ctr["health"], container=ctr["name"])

    def recreate_drifted(self, services, rendered, hashes, journal):
        """按依赖顺序重建配置漂移的非受管服务：up -d --no-deps --force-recreate --wait，回读后写日志。
        --force-recreate 是必须的：configs 内容不在 Compose 的哈希里，不强制时 up 会认为无需重建。"""
        for svc in services:
            say(f"== 配置漂移 {svc}")
            self.compose("up", "-d", "--no-deps", "--force-recreate", "--no-build", "--wait", svc, capture=False)
            journal["config_recreated"].append(self.readback_config(svc, rendered, hashes))
            self.write_journal("deploy.json", journal)

    def drift_report(self):
        """只读：本发布树相对现场的配置漂移与收敛计划。"""
        found = containers(self.cfg["compose_project"])
        rendered, hashes = self.desired()
        drift = self.drift(rendered, hashes, found)
        return dict(commit=self.commit, drift=drift["drift"], absent=drift["absent"],
                    converge=self.converge(drift, self.targets(found)))

    def deploy_history(self):
        """同一 commit 之前各次 deploy 的摘要：重跑时 deploy.json 重写为本次，已完成的动作留在 history 里。"""
        path = os.path.join(self.journal, "deploy.json")
        if not os.path.isfile(path):
            return []
        with open(path, encoding="utf-8") as stream:
            prior = json.load(stream)
        return prior.get("history", []) + [dict(
            started_at=prior.get("started_at"), finished_at=prior.get("finished_at"), state=prior.get("state"),
            services=[s.get("service") for s in prior.get("services", [])],
            config_recreated=[s.get("service") for s in prior.get("config_recreated", [])])]

    def deploy(self):
        lock = self.lock()
        if not os.path.isfile(os.path.join(self.backups, "manifest.json")):
            raise NodeError("缺少本次发布的备份 manifest（先执行 backup 阶段）")
        changed = self.normalize_tree()
        say(f"== 发布树权限按 Git 模式规范（调整 {changed} 项）")
        say("== 声明式 .env")
        env_actions = self.apply_env()
        rendered, hashes = self.desired()
        self.check_rendered(rendered)
        # 运维域投递先落到运行目录：只有启动入口重建消费者后才生效（已运行容器仍挂着旧文件）
        delivered = self.write_deliveries() if self.delivery else []
        found = containers(self.cfg["compose_project"])
        # 配置漂移以现场为准：重跑时已收敛的服务哈希与内容一致，不再出现（幂等）
        drift = self.drift(rendered, hashes, found)
        converge = self.converge(drift, self.targets(found))
        targets = converge["targets"]
        # 运维域运行体（ADR-20 §10）：这里只创建缺失的；已运行者的镜像或配置变化由 §9 的漂移收敛重建
        operated = self.operated_targets(found)
        migrations = [m for m in self.migration_plan(found) if m["pending"]]
        journal = dict(commit=self.commit, started_at=time.time(), env=env_actions, targets=targets,
                       operated=operated, delivery=dict(written=delivered, pending=self.delivery_pending(),
                                                        digest=(self.delivery or {}).get("digest")),
                       config_drift=drift["drift"], config_converge=converge, config_recreated=[],
                       migrations=migrations, services=[], state="RUNNING",
                       history=self.deploy_history())
        self.write_journal("deploy.json", journal)
        swapped = set(targets) | {p for t in targets for p in self.model.prerequisites(self.services, t)}
        touched = swapped | set(converge["before"]) | set(converge["after"]) | set(operated)
        replaced = {c["id"] for svc in touched for c in found.get(svc, [])}
        before = {cid: name for cid, name in running_containers().items() if cid not in replaced}
        say("== 目标：" + (", ".join(targets) or "无（运行镜像均已等于 pin，也无受管服务配置漂移）"))
        say("== 运维域运行体，创建：" + (", ".join(operated) or "无（均已运行）"))
        if delivered:
            say("== 运维域投递改写：" + ", ".join(delivered))
        for key, label in (("before", "替换前"), ("after", "替换后")):
            if converge[key]:
                say(f"== 配置漂移，{label}重建：" + ", ".join(converge[key]))
        if converge["report"]:
            say("== 配置漂移，仅报告（release.yaml drift: report）：" + ", ".join(converge["report"]))
        if targets or operated:
            self.compose("pull", "--quiet", *sorted(swapped | set(operated)), capture=False)
        for plan in migrations:
            say(f"== 迁移 {plan['name']}：待执行 {len(plan['pending'])} 个")
            self.migrate(plan)
        journal["config_oneoffs"] = self.apply_config_oneoffs()
        # 缺失的运维域运行体先于漂移收敛与服务替换创建：Core 经启动入口重建后交付目录中的端点即可达
        for svc in operated:
            say(f"== {svc}（运维域运行体，创建）")
            self.compose("up", "-d", "--no-deps", "--force-recreate", "--no-build", "--wait", svc, capture=False)
            journal["services"].append(self.readback_operated(svc))
            self.write_journal("deploy.json", journal)
        # 配置漂移的基础服务先于 IdP 声明重建（ADR-20 §9）：keycloak 若漂移，声明作用于重建后的实例，
        # 且下面的就绪等待覆盖它。
        self.recreate_drifted(converge["before"], rendered, hashes, journal)
        # IdP 声明式配置先于任何服务替换：新增回调、mapper 与退出属性对旧服务是兼容的增量，而新 Core/网关/Web
        # 依赖它们（网关 end-session 的 post_logout_redirect_uri 必须已登记，03 §7 兼容顺序）。
        idp_spec = self.model.idp_declaration(self.decl)
        say(f"== IdP 声明式配置（等待 {idp_spec['wait']} 就绪）")
        self.wait_ready(idp_spec["wait"])
        journal["idp"] = self.idp_step().apply(self.commit)
        say("   " + ("摘要变化，已声明并回读" if journal["idp"]["applied"] else "摘要未变，跳过声明")
            + ("" if journal["idp"]["native_clients_declared"] else "；组件专属客户端未声明（NATIVE_OIDC_CLIENTS 为空）")
            + ("" if journal["idp"].get("directory_clients_declared") else "；成员目录 client 未声明（COMPONENT_DIRECTORY_CLIENTS 为空）"))
        self.write_journal("deploy.json", journal)
        extra = self.ci_env
        for svc in targets:
            say(f"== {svc}")
            for pre in self.model.prerequisites(self.services, svc):
                self.run_prerequisite(pre)
            command = (self.decl["services"].get(svc) or {}).get("command")
            if command:
                code = subprocess.run([str(c) for c in command], cwd=self.deploy_dir, env=self.env(extra),
                                      stdout=sys.stderr, stderr=sys.stderr).returncode
                if code:
                    raise NodeError(f"{svc}: {' '.join(command)} 退出 {code}")
                self.wait_ready(svc)
            else:
                self.compose("up", "-d", "--no-deps", "--force-recreate", "--no-build", "--wait", svc, capture=False)
            state = self.readback(svc)
            state["config"] = self.readback_config(svc, rendered, hashes)
            journal["services"].append(state)
            if self.delivery and svc == self.delivery["restart"] and self.delivery_pending():
                self.record_delivery()
                journal["delivery"]["pending"] = False
            self.write_journal("deploy.json", journal)
        self.recreate_drifted(converge["after"], rendered, hashes, journal)
        # 部署前已运行、且不属于本次替换的容器必须仍在运行。同名但 ID 变化的（例如 start-core.sh
        # 按投递变化重建 Worker）如实记为重建，不当作停止；不再运行的才是失败。
        after = running_containers()
        names_after = set(after.values())
        stopped = sorted(name for cid, name in before.items() if cid not in after and name not in names_after)
        recreated = sorted(name for cid, name in before.items() if cid not in after and name in names_after)
        journal.update(state="SUCCEEDED" if not stopped else "FAILED", finished_at=time.time(),
                       unrelated_stopped=stopped, unrelated_recreated=recreated)
        self.write_journal("deploy.json", journal)
        if not stopped:
            journal["retention"] = self.retention()
            self.write_journal("deploy.json", journal)
        lock.close()
        if stopped:
            raise NodeError(f"部署后不再运行的无关容器：{stopped}")
        return journal

    def retention(self):
        """deploy 成功后的发布树保留（ADR-20 §11）：本 commit 已是当前 pin。发布本身已成功，保留失败只记入
        journal 与输出，不改变 deploy 结果。"""
        say("== 发布树与代理暂存保留")
        try:
            policy = retention_policy(self.cfg)
            if os.path.realpath(policy["journal"]) != os.path.realpath(self.decl["node"]["journal"]):
                raise NodeError("CI 配置 retention.journal 与 release.yaml node.journal 不一致")
            report = run_retention(self.cfg, dry_run=False, keep=[self.commit])
        except (NodeError, OSError, ValueError) as error:
            say(f"   保留未执行：{error}")
            return dict(error=str(error))
        say(f"   删除发布树 {len(report['trees'])} 棵、暂存 {len(report['scratch'])} 项，约释放 "
            f"{report['estimated_bytes'] / 2**30:.1f} GiB；保留 {len(report['kept'])} 棵")
        return dict(deleted=[t["commit"] for t in report["trees"]], scratch=[s["path"] for s in report["scratch"]],
                    estimated_bytes=report["estimated_bytes"], kept=report["kept"],
                    free_before=report["free_before"], free_after=report["free_after"])

    def verify(self):
        results, bad = [], []
        for svc in self.model.deploy_order(self.services, list(self.managed), self.decl):
            try:
                results.append(self.readback(svc))
            except NodeError as error:
                bad.append(str(error))
        for svc in self.operated:
            try:
                results.append(self.readback_operated(svc))
            except NodeError as error:
                bad.append(str(error))
        bad += self.delivery_problems()
        idp = self.idp_step().verify()
        bad += idp["problems"]
        found = containers(self.cfg["compose_project"])
        rendered, hashes = self.desired()
        drift = self.drift(rendered, hashes, found)
        reported = self.model.converge_plan(self.services, [d["service"] for d in drift["drift"]], [],
                                            self.managed, self.decl)["report"]
        for entry in drift["drift"]:
            if entry["service"] not in reported:
                bad.append(f"{entry['service']}：配置漂移未收敛（" + "；".join(entry["reasons"]) + "）")
        for svc, spec in rendered["services"].items():
            if str(spec.get("restart") or "") == "no" or svc in self.managed:
                continue
            ctr = single_container(found, svc)
            if ctr and ctr["health"] not in (None, "healthy"):
                bad.append(f"{svc} 健康状态 {ctr['health']}")
        journal_path = os.path.join(self.journal, "deploy.json")
        deploy = None
        if os.path.isfile(journal_path):
            with open(journal_path, encoding="utf-8") as stream:
                deploy = json.load(stream)
        value = dict(commit=self.commit, services=results, problems=bad, idp=idp,
                     config_drift_reported=[d for d in drift["drift"] if d["service"] in reported],
                     not_running=drift["absent"],
                     deploy_state=(deploy or {}).get("state"),
                     unrelated_stopped=(deploy or {}).get("unrelated_stopped"),
                     business_acceptance="NOT_RUN：业务验收由开发端发起与判定")
        if bad:
            raise NodeError("回读失败：\n" + "\n".join(bad))
        return value


def default_ci_config():
    """本文件所在仓库 release.yaml 的 node.ci_config（从标准输入或仓库外执行时必须显式 --ci-config）。"""
    if FROM_STDIN or HERE is None:
        raise NodeError("从标准输入执行 retention 需要 --ci-config")
    sys.path.insert(0, HERE)
    import model
    return model.declarations()["node"]["ci_config"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="stage", required=True)
    probe = sub.add_parser("inspect")
    probe.add_argument("request")
    for stage in ("backup", "deploy", "verify", "normalize", "runtime", "drift"):
        sub.add_parser(stage).add_argument("--commit", required=True)
    keep = sub.add_parser("retention")
    keep.add_argument("--dry-run", action="store_true", help="只读：列出将删除的发布树与暂存及其大小")
    keep.add_argument("--ci-config", help="缺省取本发布树 release.yaml 的 node.ci_config")
    keep.add_argument("--keep", action="append", default=[], help="额外保留的 40 位 commit")
    keep.add_argument("--prune-docker", action="store_true",
                      help=f"另外清理未被容器使用、早于 {DOCKER_PRUNE_UNTIL} 的镜像与构建缓存")
    args = parser.parse_args()
    try:
        if args.stage == "inspect":
            value = inspect(json.loads(base64.b64decode(args.request)))
        elif args.stage == "retention":
            if not all(TREE_NAME.fullmatch(c) for c in args.keep):
                raise NodeError("--keep 必须是 40 位完整 commit")
            value = run_retention(ci_config(args.ci_config or default_ci_config()), dry_run=args.dry_run,
                                  keep=args.keep, prune=args.prune_docker)
        else:
            if FROM_STDIN:
                raise NodeError("从标准输入执行时只允许 inspect 与 retention")
            # normalize: every deploy from this fixed tree (platform or component) first gives
            # tracked files their Git modes, so non-root containers can read bind-mounted config.
            release = Release(args.commit, need_receipt=args.stage not in ("verify", "normalize", "runtime", "drift"))
            if args.stage == "drift":
                value = release.drift_report()
            elif args.stage == "normalize":
                value = {"normalized": release.normalize_tree()}
            elif args.stage == "runtime":
                value = {"runtime": release.runtime}
            else:
                value = getattr(release, args.stage)()
    except (NodeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps(dict(error=f"{type(error).__name__}: {error}"), ensure_ascii=False))
        sys.exit(1)
    except Exception as error:  # 模型层的 ReleaseError 等
        print(json.dumps(dict(error=f"{type(error).__name__}: {error}"), ensure_ascii=False))
        sys.exit(1)
    print(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
