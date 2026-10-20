#!/usr/bin/env python3
"""Kailo 统一发布入口（ADR-20）。开发机只编排：构建与 full 检查经 CI worker，部署由 CI 节点从固定发布树执行。

  kailo-release.sh plan   [--commit SHA] [--json]
  kailo-release.sh run    [--commit SHA] [--until STAGE] [--dry-run] [--retry-failed] [--trailer TEXT]...
  kailo-release.sh status [--commit SHA]

SHA 缺省为当前检出的 HEAD，必须已在 origin/main。阶段：plan → build → record → pin → check → backup →
deploy → verify；run 从第一个未完成的阶段继续，每个阶段执行前按真实状态判定是否已完成。

发布在独立的发布 worktree（<状态目录>/worktrees/<源 commit>）中进行，不改动调用者的检出；
日志为 <状态目录>/<源 commit>.json。状态目录是工作树属主的 ~/.local/state/kailo-release。
"""

import argparse
import base64
import fcntl
import json
import os
import pwd
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import model  # noqa: E402
from model import ReleaseError  # noqa: E402

STAGES = ["plan", "build", "record", "pin", "check", "backup", "deploy", "verify"]
NODE_PROGRAM = os.path.join(HERE, "node.py")
WAIT_SLICE = 300  # 每次 kailo-ci wait 的秒数；到期只结束本次等待，不取消任务


def say(message=""):
    print(message, flush=True)


# ---- 外部边界：Git、kailo-ci、节点 ---------------------------------------------

class Git:
    """以工作树属主身份执行 Git（root 运行时切换，与 kailo-ci 包装同一做法）。"""

    def __init__(self, root):
        self.root = os.path.realpath(root)
        info = pwd.getpwuid(os.stat(self.root).st_uid)
        self.owner, self.uid, self.gid, self.home = info.pw_name, info.pw_uid, info.pw_gid, info.pw_dir
        self.prefix = ["runuser", "-u", self.owner, "--"] if os.geteuid() == 0 and self.uid != 0 else []

    def run(self, *args, check=True, root=None):
        r = subprocess.run(self.prefix + ["git", "-C", root or self.root, *args], capture_output=True, text=True)
        if check and r.returncode:
            raise ReleaseError(f"git {args[0]} 退出 {r.returncode}：{r.stderr.strip()[-300:]}")
        return r

    def __call__(self, *args, root=None):
        return self.run(*args, root=root).stdout.strip()

    def ok(self, *args, root=None):
        return self.run(*args, check=False, root=root).returncode == 0

    def as_owner(self, *argv, cwd=None):
        r = subprocess.run(self.prefix + list(argv), capture_output=True, text=True, cwd=cwd or self.root)
        if r.returncode:
            raise ReleaseError(f"{os.path.basename(argv[-1] if argv[0] == 'python3' else argv[0])} 退出 "
                               f"{r.returncode}：{r.stderr.strip()[-300:]}")
        return r.stdout

    def own(self, path):
        if os.geteuid() == 0:
            os.chown(path, self.uid, self.gid)


class CI:
    """已登记 CI 任务的客户端（kailo-ci）。"""

    def _call(self, *args, check=True):
        r = subprocess.run(["kailo-ci", *args], capture_output=True, text=True)
        if check and r.returncode:
            raise ReleaseError(f"kailo-ci {args[0]} 退出 {r.returncode}：{(r.stderr or r.stdout).strip()[-300:]}")
        return r

    def submit(self, commit, stage, *targets):
        job = self._call("submit", commit, stage, *targets).stdout.strip().splitlines()[-1]
        if not re.fullmatch(r"[0-9a-f]{32}", job):
            raise ReleaseError(f"kailo-ci submit 未返回任务 ID：{job[:80]}")
        return job

    def status(self, job):
        return json.loads(self._call("status", job).stdout)

    def wait(self, job, label):
        started = time.monotonic()
        while True:
            r = self._call("wait", job, "--timeout", str(WAIT_SLICE), check=False)
            if r.returncode in (0, 1):
                return json.loads(r.stdout)
            if r.returncode != 124:
                raise ReleaseError(f"kailo-ci wait {job[:8]} 退出 {r.returncode}")
            say(f"   … {label} 仍在执行（{job[:8]}，已等待 {int(time.monotonic() - started)} 秒）")

    def failure_lines(self, job, tail=400):
        text = re.sub(r"\x1b\[[0-9;]*m", "", self._call("logs", job, "--tail", str(tail), check=False).stdout)
        keep = [line for line in text.splitlines() if re.search(r"FAIL|error|错误|^== |EXIT ", line)]
        return keep[-40:] or text.splitlines()[-20:]


class Node:
    """CI 节点。只读探针经标准输入执行 node.py inspect；其余阶段执行固定发布树内的 node.py。"""

    def __init__(self, decl):
        self.ssh = ["ssh", "-o", "BatchMode=yes", str(os.environ.get("KAILO_RELEASE_NODE") or decl["node"]["ssh"])]
        self.ci_config = str(decl["node"]["ci_config"])

    def inspect(self, request):
        payload = base64.b64encode(json.dumps(dict(request, ci_config=self.ci_config)).encode()).decode()
        with open(NODE_PROGRAM, "rb") as program:
            r = subprocess.run(self.ssh + ["python3", "-I", "-", "inspect", payload], stdin=program,
                               capture_output=True, text=True)
        return self._result(r, "inspect", r.stderr)

    def stage(self, sources, commit, stage):
        program = f"{sources}/{commit}/apps/tools/release/node.py"
        say(f"   节点执行 {program} {stage}")
        # stderr 直通终端（进度、Compose 输出）；stdout 只有结果 JSON
        r = subprocess.run(self.ssh + ["python3", "-I", program, stage, "--commit", commit],
                           stdout=subprocess.PIPE, text=True)
        return self._result(r, stage, "")

    @staticmethod
    def _result(r, stage, stderr):
        lines = (r.stdout or "").strip().splitlines()
        try:
            value = json.loads(lines[-1]) if lines else {}
        except ValueError:
            value = {}
        if r.returncode or "error" in value:
            detail = value.get("error") or stderr.strip()[-300:] or f"退出 {r.returncode}"
            raise ReleaseError(f"节点 {stage} 失败：{detail}")
        return value


# ---- 状态：日志、构建索引、发布 worktree --------------------------------------------

class State:
    def __init__(self, git, source):
        self.git, self.source = git, source
        self.dir = os.path.join(git.home, ".local", "state", "kailo-release")
        self._mkdir(self.dir)
        self.path = os.path.join(self.dir, f"{source}.json")
        self.index_path = os.path.join(self.dir, "builds.json")
        self.worktree = os.path.join(self.dir, "worktrees", source)
        self.data = self._load(self.path) or dict(source=source, created_at=time.time(), stages={}, builds={})
        self._lock = None

    def _mkdir(self, path):
        for part in (os.path.dirname(os.path.dirname(path)), os.path.dirname(path), path):
            if not os.path.isdir(part):
                os.makedirs(part, mode=0o700, exist_ok=True)
                self.git.own(part)

    @staticmethod
    def _load(path):
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as stream:
                return json.load(stream)
        return None

    def _dump(self, path, value):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
        os.chmod(tmp, 0o600)
        self.git.own(tmp)
        os.replace(tmp, path)

    def lock(self):
        self._lock = open(self.path + ".lock", "a")
        self.git.own(self.path + ".lock")
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError("同一源 commit 的另一个 run 正在执行") from None

    def save(self):
        self._dump(self.path, self.data)

    def done(self, stage):
        return (self.data["stages"].get(stage) or {}).get("state") == "done"

    def mark(self, stage, state, **details):
        self.data["stages"][stage] = dict(state=state, at=time.time(), **details)
        self.save()

    def index(self):
        return self._load(self.index_path) or {}

    def remember_build(self, key, value):
        data = self.index()
        data[key] = value
        self._dump(self.index_path, data)

    def ensure_worktree(self):
        """源 commit 的独立检出：只由入口写入（record/pin），HEAD 只能是源 commit 或本次 pin 提交。"""
        wt = self.worktree
        if not os.path.isdir(wt):
            self._mkdir(os.path.dirname(wt))
            self.git("worktree", "add", "--quiet", "--detach", wt, self.source)
        head = self.git("rev-parse", "HEAD", root=wt)
        if head not in (self.source, self.data.get("pin_commit")):
            raise ReleaseError(f"发布 worktree {wt} 的 HEAD {head[:12]} 既不是源 commit 也不是本次 pin 提交")
        if self.git("status", "--porcelain", "--untracked-files=all", root=wt) and not self.data.get("pin_files_pending"):
            raise ReleaseError(f"发布 worktree {wt} 有未知改动；核对后删除该 worktree 重新执行")
        return wt


# ---- plan ---------------------------------------------------------------------

def proof_name(image, digest):
    return f"{image}.{digest.removeprefix('sha256:')}.provenance.json"


def pin_names(unit):
    """发布单元在 pin 登记处使用的名字：二开产物用产物名（镜像与安装包同在追溯记录），自建单元用各镜像名。"""
    return unit.images if not unit.upstream else [unit.name]


def compute_plan(root, node, decl, source):
    units = model.units(decl)
    text = model.compose_text()
    services = model.compose_services(text)
    all_managed = model.managed_services(services, units)
    managed = {s: i for s, i in all_managed.items() if services[s]["restart"] != "no"}
    by_name = {n: u for u in units.values() for n in pin_names(u)}

    pinned = {}
    for svc, image in all_managed.items():
        if pinned.setdefault(image, services[svc]["digest"]) != services[svc]["digest"]:
            raise ReleaseError(f"compose 中 {image} 在多个服务 pin 了不同 digest")
    self_units = [u for u in units.values() if not u.upstream]
    proofs = [proof_name(i, pinned[i]) for u in self_units for i in u.images if i in pinned]
    env_set, env_unset = model.env_declaration(decl)
    migrations = [dict(name=name, database=str(spec["database"]), versions=model.migration_versions(name, decl))
                  for name, spec in decl["migrations"].items()]
    facts = node.inspect(dict(commit=source, services=sorted(managed), proofs=proofs,
                              env_set={k: model.env_value_digest(v) for k, v in env_set.items()},
                              env_unset=env_unset, required_env=model.required_env(text), migrations=migrations))

    plan = dict(source=source, head=model.head(), compose_project=model.project_name(text), units={},
                sources=facts["sources"])
    for u in units.values():
        if u.upstream:
            state, recorded, current = model.upstream_state(u)
            plan["units"][u.name] = dict(kind=u.artifact.get("kind"), type="upstream", state=state, key=current,
                                         recorded_source=recorded, artifact=str(u.artifact.get("artifact_digest")),
                                         images=u.images, record=u.record, blocked=bool(u.artifact.get("blocked")))
            continue
        commits = {(facts["proofs"].get(proof_name(i, pinned[i])) or {}).get("commit") if i in pinned else None
                   for i in u.images}
        entry = dict(kind="image", type="self", images=u.images, key=model.tree_digest(plan["head"], u.inputs),
                     pinned={i: pinned.get(i) for i in u.images})
        if None in commits or len(commits) != 1:
            entry.update(state="stale", reason="已固定产物在 CI 证明库中缺 provenance，或各镜像来自不同 commit")
        else:
            base = commits.pop()
            changed = model.changed_inputs(base, plan["head"], u.inputs)
            entry.update(built_from=base, changed=changed if changed is not None else ["<产物源 commit 不在本仓库>"])
            entry["state"] = "current" if changed == [] else "stale"
        plan["units"][u.name] = entry
    rebuild = [n for n, x in sorted(plan["units"].items()) if x["state"] == "stale"]
    # 03 §7：自建单元（Core/Worker）先于其余产物
    plan["rebuild"] = sorted(rebuild, key=lambda n: plan["units"][n]["type"] != "self")
    rebuilt = {n: name for name in rebuild for n in pin_names(units[name])}

    traces = {}
    for rel in model.traceability_files():
        with open(os.path.join(root, rel), encoding="utf-8") as stream:
            doc = model.yaml.safe_load(stream) or {}
        for entry in (doc.get("release") or {}).get("artifacts") or []:
            traces.setdefault(entry.get("name"), []).append(rel)
    plan["pins"] = {n: dict(unit=rebuilt[n],
                            old=(pinned.get(n) or by_name[n].artifact.get("artifact_digest")) if by_name[n].upstream
                            else pinned.get(n),
                            services=[s for s, spec in services.items() if spec["image"] == n],
                            traceability=traces.get(n, []))
                    for n in sorted(rebuilt)}

    running = facts["running"]
    drift, absent = [], []
    for svc in managed:
        live = [c for c in running.get(svc, []) if c["running"]]
        if not live:
            absent.append(svc)
        elif live[0]["digest"] != services[svc]["digest"]:
            drift.append(svc)
    targets = set(drift) | set(absent) | {s for s, i in managed.items() if i in rebuilt}
    order = model.deploy_order(services, targets, decl)
    plan["deploy"] = dict(
        order=order, drift=sorted(drift), absent=sorted(absent),
        prerequisites={t: model.prerequisites(services, t) for t in order if model.prerequisites(services, t)},
        commands={t: (decl["services"].get(t) or {}).get("command") for t in order
                  if (decl["services"].get(t) or {}).get("command")})
    plan["migrations"] = facts["migrations"]
    backups = model.databases_for(services, targets)
    for name, m in facts["migrations"].items():
        db = str(decl["migrations"][name]["database"])
        if m.get("pending") and db not in backups:
            backups.append(db)
    plan["backups"] = backups
    plan["env"] = dict(changes=facts.get("env", {}), missing_required=facts.get("missing_required", []),
                       runtime_present=facts.get("runtime_present"))
    plan["receipt"] = facts.get("receipt")
    plan["active_ci_deploys"] = facts.get("active_ci_deploys", [])
    return plan


def render_plan(plan, note=None):
    p = plan
    say(f"发布计划：源 {p['source']}" + (f"（发布 worktree HEAD {p['head'][:12]}）" if p["head"] != p["source"] else "")
        + f"，Compose 项目 {p['compose_project']}")
    if note:
        say(f"注意：{note}")
    say("\n[1] 发布单元（重建 = 当前输入与已登记产物不一致）")
    for name, u in sorted(p["units"].items(), key=lambda kv: (kv[1]["state"] != "stale", kv[0])):
        if u["type"] == "self":
            detail = (f"已固定产物来自 {u['built_from'][:12]}，此后构建输入变化 {len(u.get('changed') or [])} 处"
                      if u.get("built_from") else u.get("reason", ""))
        else:
            detail = {"stale": f"source_digest 记录 {u['recorded_source'][7:19]} ≠ 当前 {u['key'][7:19]}",
                      "current": "源码摘要与记录一致", "unbuilt": "记录为 none，从未构建（不在门禁范围）",
                      "blocked": "登记为阻断，记录为 none"}[u["state"]]
        say(f"  {'重建' if u['state'] == 'stale' else '保持'}  {name:27} {u['kind']:6} {detail}")
        if u["type"] == "self" and u["state"] == "stale":
            for path in (u.get("changed") or [])[:10]:
                say(f"          · {path}")
            if len(u.get("changed") or []) > 10:
                say(f"          · …共 {len(u['changed'])} 处")
    say("\n[2] build → record → pin")
    if not p["rebuild"]:
        say("  无过期单元：不提交构建、不产生 pin 提交；check/deploy 针对源 commit 本身")
    for name in p["rebuild"]:
        u = p["units"][name]
        say(f"  build  {name}" + ("（tools/release.sh；新 digest 取自 CI 产物目录的 provenance）" if u["type"] == "self"
                                  else f"（tools/build-upstream.sh；写回 {u['record']}）"))
    for n, pin in p["pins"].items():
        say(f"  pin    {n}: {str(pin['old'])[:19]} → 新 digest；compose 服务 {', '.join(pin['services']) or '无'}；"
            f"追溯记录 {len(pin['traceability'])} 份")
    say("\n[3] check")
    receipt = p.get("receipt") or {}
    if not p["rebuild"] and receipt.get("commit") == p["head"] and receipt.get("clean"):
        say(f"  {p['head'][:12]} 已有 full 回执（任务 {str(receipt.get('job'))[:8]}），不重复提交")
    else:
        say(f"  full 检查 {'pin 提交' if p['rebuild'] else p['head'][:12]}")
    say("\n[4] backup（CI 节点）")
    say(f"  pg_dump -Fc + pg_restore --list：{', '.join(p['backups']) or '无数据库需要备份'}；另存运行 .env 快照")
    say("\n[5] deploy（CI 节点，固定发布树内代码）")
    env = p["env"]
    changes = {k: v for k, v in env["changes"].items() if v not in ("unchanged", "absent")}
    say(f"  声明式 .env：{', '.join(f'{k}:{v}' for k, v in sorted(changes.items())) or '无变化'}（只列键与动作）")
    if env["missing_required"]:
        say(f"  ！compose 要求而运行 .env 缺少、且未声明的键：{', '.join(env['missing_required'])}（deploy 将拒绝）")
    for name, m in p["migrations"].items():
        say(f"  迁移 {name}：" + (m["error"] if "error" in m else
                                  f"已执行 {m['applied']} 个，待执行 {len(m['pending'])} 个 {m['pending'][:6]}"))
    d = p["deploy"]
    say(f"  替换顺序：{' → '.join(d['order']) or '无（运行镜像均已等于 pin）'}")
    if d["drift"]:
        say(f"    运行 digest 与当前 pin 不一致（pin 后未部署）：{', '.join(d['drift'])}")
    if d["absent"]:
        say(f"    当前未运行、将按 pin 创建：{', '.join(d['absent'])}")
    for t, pre in d["prerequisites"].items():
        say(f"    {t} 之前执行一次性前置：{', '.join(pre)}")
    for t, cmd in d["commands"].items():
        say(f"    {t} 经 {' '.join(cmd)}（KAILO_RUNTIME_DIR=运行目录）")
    if p["active_ci_deploys"]:
        say(f"  ！CI 队列有进行中的 deploy：{p['active_ci_deploys']}；节点 deploy 会拒绝并发")
    say("\n[6] verify（CI 节点）：受管服务镜像 digest/镜像 ID/健康、buzz-web build-info、无关容器；业务验收不在此判定")


def rehearse(plan):
    say("\n—— 预演（--dry-run）：以下动作不会执行 ——")
    src = plan["source"]
    for name in plan["rebuild"]:
        say(f"  build : kailo-ci submit {src} build {name}；kailo-ci wait")
    for name in plan["rebuild"]:
        u = plan["units"][name]
        say(f"  record: {name}：" + ("读 CI 产物目录中的 " + "、".join(f"{i}.<digest>.provenance.json" for i in u["images"])
                                     + "，核对源 commit" if u["type"] == "self" else
                                     f"由 generated_metadata_diff 取 artifact_digest，upstream_manifest.py record 写回 "
                                     f"{u['record']}，核对 source_digest = {u['key'][:19]}"))
    for n, pin in plan["pins"].items():
        files = [os.path.basename(t) for t in pin["traceability"]]
        say(f"  pin   : {n} → compose {pin['services'] or '[]'}；追溯记录 {', '.join(files[:5])}"
            + (f" 等 {len(files)} 份" if len(files) > 5 else ""))
    if plan["rebuild"]:
        say("  pin   : 断言 deploy/、tools/ 无旧 digest；pin 自检；提交 release: pin …；快进 push origin main")
    target = "<pin commit>" if plan["rebuild"] else plan["head"]
    say(f"  check : kailo-ci submit {target} check；kailo-ci wait")
    program = f"{plan['sources']}/{target}/apps/tools/release/node.py"
    say(f"  backup: ssh 节点 python3 -I {program} backup --commit {target}")
    say(f"  deploy: ssh 节点 … deploy：权限规范 → 声明式 .env → 迁移 → {' → '.join(plan['deploy']['order']) or '（无服务）'}")
    say("  verify: ssh 节点 … verify")


# ---- 阶段 ---------------------------------------------------------------------

class Release:
    def __init__(self, args, plan_only=False):
        self.args = args
        caller = Git(model.CODE_ROOT)
        caller("fetch", "--quiet", "origin", "main")
        source = caller("rev-parse", "--verify", (args.commit or "HEAD") + "^{commit}")
        if not caller.ok("merge-base", "--is-ancestor", source, "origin/main"):
            raise ReleaseError(f"{source[:12]} 不在 origin/main 上：CI 只接受 main 可达的 commit")
        self.git = caller
        self.source = source
        self.state = State(caller, source)
        # 分析与改写都在发布 worktree；本进程（root）对它的只读 Git 调用需显式信任该目录
        os.environ.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="safe.directory",
                          GIT_CONFIG_VALUE_0=self.state.worktree)
        self.root = self.state.ensure_worktree()
        model.use_root(self.root)
        self.note = None
        if os.path.isfile(os.path.join(self.root, model.DECLARATIONS)):
            self.decl = model.declarations()
        elif plan_only:
            # 目标 commit 早于本入口：只读规划借用入口自带的声明；run 必须用含声明与节点代码的 commit
            self.decl = model.declarations(model.CODE_ROOT)
            self.note = f"{source[:12]} 不含 {model.DECLARATIONS}，本次规划借用入口自带声明；该 commit 不能 run"
        else:
            raise ReleaseError(f"{source[:12]} 不含 {model.DECLARATIONS} 与节点代码，不能经本入口发布")
        self.node = Node(self.decl)
        self.ci = CI()

    def head(self):
        return self.git("rev-parse", "HEAD", root=self.root)

    # -- plan
    def plan(self):
        plan = compute_plan(self.root, self.node, self.decl, self.source)
        self.state.data["plan"] = plan
        self.state.mark("plan", "done")
        return plan

    # -- build
    def build(self, plan):
        builds = self.state.data.setdefault("builds", {})
        index = self.state.index()
        pending = []
        for name in plan["rebuild"]:
            key = f"{name}@{plan['units'][name]['key']}"
            have = builds.get(name) if (builds.get(name) or {}).get("key") == key else None
            if have and have.get("state") == "SUCCEEDED":
                continue
            reuse = index.get(key)
            if not have and reuse and reuse.get("state") == "SUCCEEDED":
                builds[name] = dict(reuse, reused=True)
                self.state.save()
                say(f"  {name}：复用同一输入摘要的成功构建 {reuse['job'][:8]}（源 {reuse['commit'][:12]}）")
                continue
            if have and have.get("state") == "UNKNOWN":
                raise ReleaseError(f"{name} 的构建 {have['job'][:8]} 为 UNKNOWN：先核查现场，入口不自动重试")
            if have and have.get("state") in ("FAILED", "CANCELLED") and not self.args.retry_failed:
                raise ReleaseError(f"{name} 的构建 {have['job'][:8]} 为 {have['state']}；修复后以 --retry-failed 重新提交")
            if have and have.get("state") in ("QUEUED", "RUNNING"):
                pending.append(name)
                continue
            job = self.ci.submit(self.source, "build", name)
            builds[name] = dict(job=job, key=key, commit=self.source, state="QUEUED")
            self.state.save()
            say(f"  已提交 {name} 构建：{job}")
            pending.append(name)
        for name in pending:
            entry = builds[name]
            status = self.ci.wait(entry["job"], f"{name} 构建")
            entry.update(state=status["state"], exit_code=status.get("exit_code"),
                         artifacts_path=status.get("artifacts_path"),
                         metadata_diff=status.get("generated_metadata_diff"))
            self.state.save()
            if status["state"] != "SUCCEEDED" or status.get("exit_code") != 0:
                lines = self.ci.failure_lines(entry["job"])
                raise ReleaseError(f"{name} 构建 {entry['job']} {status['state']}：{status.get('reason', '')}\n"
                                   + "\n".join("    " + line for line in lines))
            self.state.remember_build(entry["key"], entry)
            say(f"  {name} 构建成功（{entry['job'][:8]}）")

    # -- record
    def record(self, plan):
        outputs = self.state.data.setdefault("outputs", {})
        builds = self.state.data["builds"]
        self_jobs = [builds[n]["job"] for n in plan["rebuild"] if plan["units"][n]["type"] == "self"]
        facts = self.node.inspect(dict(artifacts=self_jobs)) if self_jobs else {}
        for name in plan["rebuild"]:
            unit, build = plan["units"][name], builds[name]
            if unit["type"] == "self":
                listing = (facts.get("artifacts") or {}).get(build["job"])
                if listing is None:
                    raise ReleaseError(f"{name}: 构建产物目录不存在（任务 {build['job'][:8]}）")
                digests = {}
                for image in unit["images"]:
                    found = [f for f in listing if re.fullmatch(rf"{re.escape(image)}\.[0-9a-f]{{64}}\.provenance\.json", f)]
                    if len(found) != 1:
                        raise ReleaseError(f"{name}: {image} 的 provenance 应恰好 1 份，得到 {len(found)}")
                    if listing[found[0]] != build["commit"]:
                        raise ReleaseError(f"{name}: {image} 的 provenance 源 commit 不是构建 commit")
                    digests[image] = "sha256:" + found[0].split(".")[1]
                outputs[name] = dict(digests=digests)
                say(f"  {name}: " + "，".join(f"{i} {d[:19]}" for i, d in digests.items()))
                continue
            diff = build.get("metadata_diff") or ""
            added = re.findall(r"^\+\s+(source_digest|artifact_digest):\s*(sha256:[0-9a-f]{64})\s*$", diff, re.M)
            values = dict(added)
            if len(added) != 2 or set(values) != {"source_digest", "artifact_digest"}:
                raise ReleaseError(f"{name}: generated_metadata_diff 不是单个产物的摘要写回")
            if values["source_digest"] != unit["key"]:
                raise ReleaseError(f"{name}: 构建所用源码摘要 {values['source_digest'][:19]} 不等于当前 {unit['key'][:19]}")
            artifact = model.units(self.decl)[name].artifact
            if str(artifact.get("artifact_digest")) != values["artifact_digest"]:
                self.git.as_owner("python3", os.path.join(self.root, "tools", "upstream_manifest.py"), "record",
                                  name, values["artifact_digest"])
            artifact = model.units(self.decl)[name].artifact
            if (str(artifact.get("source_digest")), str(artifact.get("artifact_digest"))) != \
                    (values["source_digest"], values["artifact_digest"]):
                raise ReleaseError(f"{name}: 写回后的来源记录与构建输出不一致")
            outputs[name] = dict(digests={name: values["artifact_digest"]}, source_digest=values["source_digest"])
            self.state.data["pin_files_pending"] = True
            say(f"  {name}: {unit['record']} ← artifact {values['artifact_digest'][:19]}")
        self.state.save()

    # -- pin
    def pin(self, plan):
        if not plan["rebuild"]:
            self.state.data["pin_commit"] = self.state.data.get("pin_commit") or self.head()
            self.state.save()
            say(f"  无新产物；发布 commit 为 {self.state.data['pin_commit'][:12]}")
            return
        pin_commit = self.state.data.get("pin_commit")
        if pin_commit:
            self.git("fetch", "--quiet", "origin", "main")
            if self.git.ok("merge-base", "--is-ancestor", pin_commit, "origin/main"):
                say(f"  pin 提交 {pin_commit[:12]} 已在 origin/main")
                return
        outputs = self.state.data["outputs"]
        replacements = {n: d for name in plan["rebuild"] for n, d in outputs[name]["digests"].items()}
        changed = set()
        compose = original = model.compose_text()
        for n, new in replacements.items():
            compose, count = model.pin_compose(compose, n, new)
            if count != len(plan["pins"][n]["services"]):
                raise ReleaseError(f"{n}: compose 改写 {count} 行，应为 {len(plan['pins'][n]['services'])}")
        if compose != original:
            write_existing(self.root, model.COMPOSE, compose)
            changed.add(model.COMPOSE)
        for rel in model.traceability_files():
            with open(os.path.join(self.root, rel), encoding="utf-8") as stream:
                text = stream.read()
            new_text = text
            for n, new in replacements.items():
                new_text, _ = model.pin_traceability(new_text, n, new)
            if new_text != text:
                write_existing(self.root, rel, new_text)
                changed.add(rel)
        stale = [plan["pins"][n]["old"] for n, new in replacements.items()
                 if plan["pins"][n]["old"] and plan["pins"][n]["old"] != new]
        residual = model.residual_digests(stale)
        if residual:
            raise ReleaseError("结构化 pin 之后 deploy/、tools/ 仍有旧 digest（登记处之外的引用，需人工核对）：\n"
                               + "\n".join(f"    {d[:19]}: {', '.join(f)}" for d, f in residual.items()))
        new_proofs = [proof_name(i, d) for name in plan["rebuild"] if plan["units"][name]["type"] == "self"
                      for i, d in outputs[name]["digests"].items()]
        proofs = self.node.inspect(dict(proofs=new_proofs))["proofs"] if new_proofs else {}
        if [p for p, v in proofs.items() if not v]:
            raise ReleaseError(f"CI 证明库缺少新产物 provenance：{[p for p, v in proofs.items() if not v]}")
        bad = model.pin_consistency(model.units(self.decl))
        if bad:
            raise ReleaseError("pin 自检失败：\n" + "\n".join("    " + b for b in bad))
        records = {plan["units"][n]["record"] for n in plan["rebuild"] if plan["units"][n]["type"] == "upstream"}
        files = sorted(changed | records)
        dirty = {line[3:] for line in self.git("status", "--porcelain", "--untracked-files=all", root=self.root).splitlines()}
        if dirty - set(files):
            raise ReleaseError(f"发布 worktree 出现 pin 之外的改动：{sorted(dirty - set(files))[:10]}")
        self.git("add", "--", *files, root=self.root)
        short = ", ".join(f"{n} {d.removeprefix('sha256:')[:8]}" for n, d in replacements.items())
        body = [f"Built by tools/release/kailo-release.sh (ADR-20) from {self.source}.", ""]
        for name in plan["rebuild"]:
            b = self.state.data["builds"][name]
            digests = ", ".join(f"{n} {d}" for n, d in outputs[name]["digests"].items())
            body.append(f"- {name}: CI build {b['job']}" + (" (reused)" if b.get("reused") else "") + f"; {digests}")
        body += ["", "Full check, backup, deploy and verify follow in the release journal of the source commit."]
        args = ["commit", "--quiet", "-m", f"release: pin {short} built from {self.source[:9]}\n\n" + "\n".join(body)]
        for trailer in self.args.trailer or []:
            args += ["--trailer", trailer]
        self.git(*args, root=self.root)
        pin_commit = self.head()
        self.state.data.update(pin_commit=pin_commit, pin_files_pending=False)
        self.state.save()
        self.git("fetch", "--quiet", "origin", "main")
        remote = self.git("rev-parse", "origin/main")
        if remote != self.source:
            raise ReleaseError(f"origin/main 已前进到 {remote[:12]}，pin 提交 {pin_commit[:12]} 未推送；以新的 main "
                               "重新执行 run（同一输入摘要的构建会复用）")
        self.git("push", "--quiet", "origin", "HEAD:refs/heads/main", root=self.root)
        if self.git("ls-remote", "origin", "refs/heads/main").split()[0] != pin_commit:
            raise ReleaseError("push 后远端 main 回读不等于 pin 提交")
        say(f"  pin 提交 {pin_commit} 已推送 origin/main（{len(files)} 个文件）")

    # -- check
    def check(self, plan):
        target = self.state.data["pin_commit"]
        facts = self.node.inspect(dict(commit=target))
        self.state.data["sources"] = facts["sources"]
        receipt = facts.get("receipt") or {}
        if receipt.get("commit") == target and receipt.get("clean"):
            say(f"  {target[:12]} 已有 full 回执（任务 {str(receipt.get('job'))[:8]}）")
            return
        job = (self.state.data.get("check") or {}).get("job")
        if job and (self.state.data["check"].get("commit") != target):
            job = None
        if job:
            state = self.ci.status(job)["state"]
            if state == "UNKNOWN":
                raise ReleaseError(f"full 检查 {job[:8]} 为 UNKNOWN：先核查现场")
            if state in ("FAILED", "CANCELLED"):
                if not self.args.retry_failed:
                    raise ReleaseError(f"full 检查 {job} 为 {state}；修复后以新的 commit 发布，或 --retry-failed")
                job = None
        if not job:
            job = self.ci.submit(target, "check")
            self.state.data["check"] = dict(job=job, commit=target)
            self.state.save()
            say(f"  已提交 full 检查：{job}")
        status = self.ci.wait(job, "full 检查")
        if status["state"] != "SUCCEEDED" or status.get("exit_code") != 0:
            lines = self.ci.failure_lines(job, tail=3000)
            raise ReleaseError(f"full 检查 {job} {status['state']}：{status.get('reason', '')}\n"
                               + "\n".join("    " + line for line in lines))

    # -- 节点阶段
    def node_stage(self, stage):
        target = self.state.data["pin_commit"]
        sources = self.state.data.get("sources") or self.node.inspect({})["sources"]
        value = self.node.stage(sources, target, stage)
        self.state.data.setdefault("node", {})[stage] = value
        self.state.save()
        return value

    def backup(self, plan):
        value = self.node_stage("backup")
        for f in value.get("files", []):
            say(f"  {f['file']}: {f['bytes']} 字节" + (f"，{f['entries']} 个对象" if "entries" in f else ""))
        say(f"  manifest：{value.get('path')}" + ("（已存在，复用）" if value.get("reused") else ""))

    def deploy(self, plan):
        value = self.node_stage("deploy")
        for s in value.get("services", []):
            say(f"  {s['service']}: {s['digest'][:19]} {s.get('health') or 'running'}")
        if value.get("unrelated_recreated"):
            say(f"  同名重建（非本次目标，如 start-core.sh 按投递重建）：{value['unrelated_recreated']}")

    def verify(self, plan):
        value = self.node_stage("verify")
        say(f"  回读 {len(value.get('services', []))} 个受管服务与 pin 一致；{value.get('business_acceptance')}")

    def run(self):
        self.state.lock()
        until = self.args.until or STAGES[-1]
        plan = self.plan()
        render_plan(plan, self.note)
        if self.args.dry_run:
            rehearse(plan)
            return
        if plan["env"]["missing_required"]:
            raise ReleaseError(f"运行 .env 缺少 compose 要求的键：{plan['env']['missing_required']}；"
                               f"在 {model.DECLARATIONS} 的 env.set 声明后重新发布")
        for stage in STAGES[1:STAGES.index(until) + 1]:
            if stage != "verify" and self.state.done(stage):
                say(f"\n== {stage}：已完成（日志）")
                continue
            say(f"\n== {stage}")
            try:
                getattr(self, stage)(plan)
            except ReleaseError as error:
                self.state.mark(stage, "failed", error=str(error))
                raise
            self.state.mark(stage, "done")
        if until == "verify":
            self.git("worktree", "remove", self.root)
            say(f"\n发布完成：源 {self.source[:12]}，发布 commit {self.state.data['pin_commit'][:12]}；日志 {self.state.path}")
        else:
            say(f"\n已完成至 {until}；再次执行 run 从下一阶段继续。日志 {self.state.path}")


def write_existing(root, rel, text):
    """改写已存在的文件：保留 inode、属主与权限。"""
    with open(os.path.join(root, rel), "r+", encoding="utf-8") as stream:
        stream.write(text)
        stream.truncate()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "run", "status"):
        p = sub.add_parser(name)
        p.add_argument("--commit")
        if name == "plan":
            p.add_argument("--json", action="store_true")
        if name == "run":
            p.add_argument("--until", choices=STAGES[1:])
            p.add_argument("--dry-run", action="store_true")
            p.add_argument("--retry-failed", action="store_true")
            p.add_argument("--trailer", action="append")
    args = parser.parse_args()
    try:
        if args.command == "status":
            git = Git(model.CODE_ROOT)
            state = State(git, git("rev-parse", "--verify", (args.commit or "HEAD") + "^{commit}"))
            say(json.dumps({k: v for k, v in state.data.items() if k != "plan"}, ensure_ascii=False, indent=2))
            return
        release = Release(args, plan_only=args.command == "plan" or getattr(args, "dry_run", False))
        if args.command == "plan":
            plan = release.plan()
            if args.json:
                say(json.dumps(plan, ensure_ascii=False, indent=2))
            else:
                render_plan(plan, release.note)
            return
        release.run()
    except ReleaseError as error:
        print(f"\n发布停止：{error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
