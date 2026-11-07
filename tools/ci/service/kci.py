"""Kailo CI service: shared model for the client (inside kailo-ci-control) and the host worker.

Contract (ADR-20 §13, CI-CD 手册 §kailo-ci): job IDs are 32 hex chars; each job lives in <queue>/jobs/<id>/ with
status.json (state, stage, commit, targets, exit_code, reason, ...) and log.txt. Pending requests are
<queue>/pending/<id>.json (release lane: build, deploy) or <queue>/pending/feedback/<id>.json (feedback lane:
fetch, docs, check, check-step, gen). Archived jobs move to <queue>/archive/<id>/ and stay readable.
Only the standard library is used so the client runs in a plain python image.
"""
import fcntl
import json
import os
import re
import time
import uuid

TERMINAL = ("SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN")
ACTIVE = ("QUEUED", "RUNNING", "DEPLOYING")
FEEDBACK_STAGES = ("fetch", "docs", "check", "check-step", "gen")
RELEASE_STAGES = ("build", "deploy")
CHECK_STEPS = ("lint", "contract", "migrate", "verify", "trace", "docs", "supply")


class CIError(Exception):
    def __init__(self, message, code=2):
        super().__init__(message)
        self.code = code


def load_config(path=None):
    path = path or os.environ.get("KAILO_CI_CONFIG", "/volumes/kailo/ci/config.json")
    with open(path, encoding="utf-8") as source:
        cfg = json.load(source)
    for key in ("runtime", "sources", "release_proofs", "compose_project", "queue"):
        if not cfg.get(key):
            raise CIError(f"config 缺少必需键 {key}")
    return cfg


def lane_of(stage):
    if stage in RELEASE_STAGES:
        return "release"
    if stage in FEEDBACK_STAGES:
        return "feedback"
    raise CIError(f"未知 stage：{stage}")


class Queue:
    def __init__(self, cfg):
        self.cfg = cfg
        self.root = cfg["queue"]
        self.jobs = os.path.join(self.root, "jobs")
        self.archive = os.path.join(self.root, "archive")
        self.pending = {"release": os.path.join(self.root, "pending"),
                        "feedback": os.path.join(self.root, "pending", "feedback")}
        for path in (self.jobs, self.archive, *self.pending.values()):
            os.makedirs(path, exist_ok=True)

    # -- locking ---------------------------------------------------------------------------------------------
    def lock(self):
        handle = open(os.path.join(self.root, "queue.lock"), "a+")
        fcntl.flock(handle, fcntl.LOCK_EX)
        return handle

    # -- job files -------------------------------------------------------------------------------------------
    def job_dir(self, job):
        for base in (self.jobs, self.archive):
            path = os.path.join(base, job)
            if os.path.isdir(path):
                return path
        raise CIError(f"任务不存在：{job}")

    def read(self, job):
        with open(os.path.join(self.job_dir(job), "status.json"), encoding="utf-8") as source:
            return json.load(source)

    def write(self, job, status):
        path = os.path.join(self.job_dir(job), "status.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as sink:
            json.dump(status, sink, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, path)

    def update(self, job, **fields):
        status = self.read(job)
        status.update(fields)
        self.write(job, status)
        return status

    def all_ids(self, archived=False):
        ids = sorted(os.listdir(self.jobs))
        if archived:
            ids += sorted(os.listdir(self.archive))
        return [i for i in ids if re.fullmatch(r"[0-9a-f]{32}", i)]

    def resolve(self, prefix):
        if not re.fullmatch(r"[0-9a-f]{8,32}", prefix or ""):
            raise CIError("任务 ID 需为 8–32 位十六进制前缀")
        hits = [i for i in self.all_ids(archived=True) if i.startswith(prefix)]
        if not hits:
            raise CIError(f"任务不存在：{prefix}")
        if len(hits) > 1:
            raise CIError(f"任务前缀有歧义：{prefix}（{len(hits)} 个匹配）")
        return hits[0]

    # -- submission ------------------------------------------------------------------------------------------
    def submit(self, commit, stage, targets=(), extra=None):
        if not re.fullmatch(r"[0-9a-f]{40}", commit or ""):
            raise CIError("commit 必须是 40 位完整 SHA")
        lane = lane_of(stage)
        targets = list(targets)
        if stage == "build":
            if not targets:
                raise CIError("build 需要至少一个 target")
            known = set((self.cfg.get("build_targets") or {}).keys()) if isinstance(self.cfg.get("build_targets"), dict) \
                else set(self.cfg.get("build_targets") or [])
            unknown = [t for t in targets if t not in known]
            if unknown:
                raise CIError(f"未登记的构建目标：{', '.join(unknown)}")
        if stage == "check-step":
            if len(targets) != 1 or targets[0] not in CHECK_STEPS:
                raise CIError(f"check-step 需要且只能有一个步骤：{', '.join(CHECK_STEPS)}")
        with self.lock():
            for job in self.all_ids():
                status = self.read(job)
                if (status.get("state") in ACTIVE and status.get("commit") == commit
                        and status.get("stage") == stage and status.get("targets") == targets):
                    return job
            job = uuid.uuid4().hex
            os.makedirs(os.path.join(self.jobs, job))
            status = dict(job=job, commit=commit, stage=stage, targets=targets, lane=lane, state="QUEUED",
                          exit_code=None, reason="", submitted_at=time.time(), started_at=None,
                          finished_at=None, archived=False)
            if extra:
                status.update(extra)
            self.write(job, status)
            open(os.path.join(self.job_dir(job), "log.txt"), "a").close()
            request = os.path.join(self.pending[lane], f"{job}.json")
            with open(request + ".tmp", "w", encoding="utf-8") as sink:
                json.dump(dict(job=job, commit=commit, stage=stage, targets=targets), sink)
            os.replace(request + ".tmp", request)
            return job
