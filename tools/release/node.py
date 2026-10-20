#!/usr/bin/env python3
"""CI 节点上的发布阶段（ADR-20 §5）。

  node.py inspect <请求 JSON 的 base64>   只读探针：经 SSH 标准输入执行（python3 -I - inspect …），
                                         不写任何文件；规划阶段用它读取节点现场
  node.py backup --commit <pin commit>   从固定发布树执行：备份受影响 Postgres 与 .env 快照
  node.py deploy --commit <pin commit>   从固定发布树执行：权限规范、声明式 .env、迁移、按序替换服务、回读
  node.py verify --commit <pin commit>   从固定发布树执行：回读全部受管服务
  node.py runtime --commit <commit>      从固定发布树执行：输出 CI 配置的运行目录（组件入口据此导出
                                         KAILO_RUNTIME_DIR，ADR-20 §3）

backup/deploy/verify 只在 <sources>/<commit>/apps/tools/release/node.py 上运行，先核对发布树 HEAD、
干净与 full 回执；发布树只读，运行投递与数据只在运行目录。进度写 stderr，结果 JSON 写 stdout；
任何输出都不包含 .env 值或 secret。
"""

import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
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


class NodeError(Exception):
    pass


def say(message):
    print(message, file=sys.stderr, flush=True)


def run(argv, *, capture=True, check=True, env=None, cwd=None):
    """执行命令；失败时只报告命令名、子命令与 stderr 末行（Docker/Compose 的错误行不含 .env 值）。"""
    # 不捕获时输出进 stderr：stdout 只留给结果 JSON
    streams = dict(capture_output=True) if capture else dict(stdout=sys.stderr, stderr=sys.stderr)
    result = subprocess.run(argv, env=env, cwd=cwd, **streams)
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
            health=(state.get("Health") or {}).get("Status")))
    return found


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


# ---- inspect：只读探针 ---------------------------------------------------------

def inspect(request):
    cfg = ci_config(request["ci_config"])
    project = cfg["compose_project"]
    result = dict(sources=cfg["sources"], compose_project=project, runtime_present=os.path.isfile(
        os.path.join(cfg["runtime"], ".env")))
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
            env[key] = ("absent" if not values else "duplicate" if len(values) > 1 else
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
    result["active_ci_deploys"] = active_ci_deploys(cfg)
    return result


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
        # start-core.sh 与迁移容器所需的受限资源参数，取自 CI 执行配置（与 worker 同一来源）
        wanted = [str(k) for k in self.decl["node"].get("ci_environment") or []]
        self.ci_env = {k: str(v) for k, v in (self.cfg.get("environment") or {}).items() if k in wanted}
        if set(wanted) - set(self.ci_env):
            raise NodeError(f"CI 配置 environment 缺少 {sorted(set(wanted) - set(self.ci_env))}")

    def git(self, *args):
        return out(["git", "-C", self.tree, *args])

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

    def overlays(self):
        files = []
        for rel in self.decl.get("overlays") or []:
            path = os.path.join(self.runtime, str(rel))
            if os.path.isfile(path) and os.path.getsize(path):
                files += ["-f", path]
        return files

    def env(self, extra=None):
        value = dict(os.environ, KAILO_RUNTIME_DIR=self.runtime)
        value.update(extra or {})
        return value

    def compose(self, *args, capture=True, check=True):
        argv = DOCKER[:2] + ["--preserve-env=KAILO_RUNTIME_DIR"] + DOCKER[2:] + [
            "compose", "--env-file", os.path.join(self.runtime, ".env"),
            "-f", os.path.join(self.deploy_dir, "compose.yaml"), *self.overlays(), *args]
        return run(argv, capture=capture, check=check, env=self.env(), cwd=self.deploy_dir)

    def rendered(self):
        return json.loads(self.compose("config", "--format", "json").stdout)

    # -- 推导 --------------------------------------------------------------------

    def migration_plan(self, found):
        plans = []
        for name, spec in self.decl["migrations"].items():
            versions = self.model.migration_versions(name, self.decl)
            pending = sorted(set(versions) - set(applied_migrations(found, spec["database"])))
            plans.append(dict(name=name, database=spec["database"], pending=pending))
        return plans

    def targets(self, found):
        """运行 digest 不等于 pin 的受管服务（含未运行的）。"""
        out_ = []
        for svc in self.managed:
            ctr = single_container(found, svc)
            if not ctr or ref_digest(ctr["image_ref"]) != self.services[svc]["digest"]:
                out_.append(svc)
        return self.model.deploy_order(self.services, out_, self.decl)

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
        targets = self.targets(found)
        migrations = self.migration_plan(found)
        databases = self.model.databases_for(self.services, targets)
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
                        migrations=migrations, files=files, path=self.backups)
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

    def apply_env(self):
        """声明式 .env（ADR-20 §4）：只报告键与动作；有变化时同目录临时文件 + fsync + 原子替换。"""
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

    def deploy(self):
        lock = self.lock()
        if not os.path.isfile(os.path.join(self.backups, "manifest.json")):
            raise NodeError("缺少本次发布的备份 manifest（先执行 backup 阶段）")
        changed = self.normalize_tree()
        say(f"== 发布树权限按 Git 模式规范（调整 {changed} 项）")
        say("== 声明式 .env")
        env_actions = self.apply_env()
        rendered = self.rendered()
        self.check_rendered(rendered)
        found = containers(self.cfg["compose_project"])
        targets = self.targets(found)
        migrations = [m for m in self.migration_plan(found) if m["pending"]]
        journal = dict(commit=self.commit, started_at=time.time(), env=env_actions, targets=targets,
                       migrations=migrations, services=[], state="RUNNING")
        self.write_journal("deploy.json", journal)
        touched = set(targets) | {p for t in targets for p in self.model.prerequisites(self.services, t)}
        replaced = {c["id"] for svc in touched for c in found.get(svc, [])}
        before = {cid: name for cid, name in running_containers().items() if cid not in replaced}
        say("== 目标：" + (", ".join(targets) or "无（运行镜像均已等于 pin）"))
        if targets:
            pulls = sorted(touched)
            self.compose("pull", "--quiet", *pulls, capture=False)
        for plan in migrations:
            say(f"== 迁移 {plan['name']}：待执行 {len(plan['pending'])} 个")
            self.migrate(plan)
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
            journal["services"].append(self.readback(svc))
            self.write_journal("deploy.json", journal)
        # 部署前已运行、且不属于本次替换的容器必须仍在运行。同名但 ID 变化的（例如 start-core.sh
        # 按投递变化重建 Worker）如实记为重建，不当作停止；不再运行的才是失败。
        after = running_containers()
        names_after = set(after.values())
        stopped = sorted(name for cid, name in before.items() if cid not in after and name not in names_after)
        recreated = sorted(name for cid, name in before.items() if cid not in after and name in names_after)
        journal.update(state="SUCCEEDED" if not stopped else "FAILED", finished_at=time.time(),
                       unrelated_stopped=stopped, unrelated_recreated=recreated)
        self.write_journal("deploy.json", journal)
        lock.close()
        if stopped:
            raise NodeError(f"部署后不再运行的无关容器：{stopped}")
        return journal

    def verify(self):
        results, bad = [], []
        for svc in self.model.deploy_order(self.services, list(self.managed), self.decl):
            try:
                results.append(self.readback(svc))
            except NodeError as error:
                bad.append(str(error))
        journal_path = os.path.join(self.journal, "deploy.json")
        deploy = None
        if os.path.isfile(journal_path):
            with open(journal_path, encoding="utf-8") as stream:
                deploy = json.load(stream)
        value = dict(commit=self.commit, services=results, problems=bad,
                     deploy_state=(deploy or {}).get("state"),
                     unrelated_stopped=(deploy or {}).get("unrelated_stopped"),
                     business_acceptance="NOT_RUN：业务验收由开发端发起与判定")
        if bad:
            raise NodeError("回读失败：\n" + "\n".join(bad))
        return value


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
    for stage in ("backup", "deploy", "verify", "normalize", "runtime"):
        sub.add_parser(stage).add_argument("--commit", required=True)
    args = parser.parse_args()
    try:
        if args.stage == "inspect":
            value = inspect(json.loads(base64.b64decode(args.request)))
        else:
            if FROM_STDIN:
                raise NodeError("从标准输入执行时只允许只读 inspect")
            # normalize: every deploy from this fixed tree (platform or component) first gives
            # tracked files their Git modes, so non-root containers can read bind-mounted config.
            release = Release(args.commit, need_receipt=args.stage not in ("verify", "normalize", "runtime"))
            if args.stage == "normalize":
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
