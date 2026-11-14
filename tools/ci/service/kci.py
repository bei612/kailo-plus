"""Kailo CI service: shared model for the client (inside kailo-ci-control) and the host worker.

Contract (ADR-20 §13, CI-CD 手册 §kailo-ci): job IDs are 32 hex chars; each job lives in <queue>/jobs/<id>/ with
status.json (state, stage, commit, targets, exit_code, reason, ...) and log.txt. Pending requests are
<queue>/pending/<id>.json (release lane: build, deploy) or <queue>/pending/feedback/<id>.json (feedback lane:
fetch, docs, check, check-step, gen). Archived jobs move to <queue>/archive/<id>/ and stay readable.
Only the standard library is used so the client runs in a plain python image.

Multiple repositories: the top-level config keys describe the default repository (kailo-plus). Others are listed in
config.repositories.<name> (origin, source_repository, sources, check_entry, lane, environment, check_steps,
postgres_steps, stages, concurrency = workers on its lane). Each job's status carries `repo`; a repository with its own `lane` gets its own pending
directory (<queue>/pending/<lane>) and worker unit, so it never queues behind the default repository.
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


DEFAULT_REPO = "kailo-plus"


def repo_config(cfg, name=None):
    """Per-repository view. The default repository keeps reading the top-level keys (node.py compatibility)."""
    name = name or DEFAULT_REPO
    if name == DEFAULT_REPO:
        return dict(name=name, source_repository=cfg.get("source_repository"), sources=cfg["sources"],
                    check_entry="tools/check.sh", lane="feedback", environment={},
                    build_targets=cfg.get("build_targets") or {}, check_steps=list(CHECK_STEPS),
                    stages=list(FEEDBACK_STAGES + RELEASE_STAGES), default=True)
    spec = (cfg.get("repositories") or {}).get(name)
    if not spec:
        raise CIError(f"未登记的仓库：{name}（已登记：{', '.join([DEFAULT_REPO, *(cfg.get('repositories') or {})])}）")
    rc = dict(check_entry="tools/check.sh", lane="feedback", environment={}, build_targets={},
              check_steps=list(CHECK_STEPS), postgres_steps=[], stages=["fetch", "check-step"])
    rc.update(spec)
    rc.update(name=name, default=False)
    return rc


def lanes(cfg):
    names = {"release", "feedback"}
    names.update(spec.get("lane", "feedback") for spec in (cfg.get("repositories") or {}).values())
    return sorted(names)


def lane_of(stage, rc=None):
    if stage in RELEASE_STAGES:
        return "release"
    if stage in FEEDBACK_STAGES:
        return (rc or {}).get("lane", "feedback")
    raise CIError(f"未知 stage：{stage}")


class Queue:
    def __init__(self, cfg):
        self.cfg = cfg
        self.root = cfg["queue"]
        self.jobs = os.path.join(self.root, "jobs")
        self.archive = os.path.join(self.root, "archive")
        self.pending = {lane: os.path.join(self.root, "pending", *([] if lane == "release" else [lane]))
                        for lane in lanes(cfg)}
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
        with self._status_lock():
            self._write_locked(job, status)

    def update(self, job, **fields):
        # Read, change and write under one lock: the worker and the client (cancel) update the same job.
        with self._status_lock():
            status = self.read(job)
            status.update(fields)
            self._write_locked(job, status)
        return status

    def _status_lock(self):
        handle = open(os.path.join(self.root, "index.lock"), "a+")
        fcntl.flock(handle, fcntl.LOCK_EX)
        return handle

    def _write_locked(self, job, status):
        path = os.path.join(self.job_dir(job), "status.json")
        # A private temporary name: concurrent writers once interleaved a shared "status.json.tmp" (a status.json with
        # a trailing "}", 2026-11-14). The lock keeps status.json and the index in the same order of writes.
        tmp = f"{path}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
        with open(tmp, "w", encoding="utf-8") as sink:
            json.dump(status, sink, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, path)
        try:
            index = self._index_load()
            if index is None:
                index = self._index_rebuild()
            index[job] = self._index_entry(status)
            self._index_store(index)
        except OSError:
            pass  # the index is a cache; readers fall back to the job directories

    # -- status index ----------------------------------------------------------------------------------------
    # <queue>/index.json holds a summary of every job's latest status (the fields list, resolve and duplicate detection
    # use), updated under the status lock by every write. `list`, `resolve` and `submit` read this one file instead of
    # every jobs/<id>/status.json (hundreds of files per call, OPS-03); entries they act on as active are re-read from
    # status.json, so an index left behind by a writer that predates it cannot mislead them. A missing or unreadable
    # index is rebuilt from the job directories.
    INDEX_FIELDS = ("job", "repo", "commit", "stage", "targets", "lane", "state", "started_at", "reason", "archived")

    @classmethod
    def _index_entry(cls, status):
        return {k: status.get(k) for k in cls.INDEX_FIELDS}

    def _index_path(self):
        return os.path.join(self.root, "index.json")

    def _index_load(self):
        try:
            with open(self._index_path(), encoding="utf-8") as source:
                index = json.load(source)
            return index if isinstance(index, dict) else None
        except (OSError, ValueError):
            return None

    def _index_store(self, index):
        tmp = f"{self._index_path()}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
        with open(tmp, "w", encoding="utf-8") as sink:
            json.dump(index, sink, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, self._index_path())

    def _index_rebuild(self):
        index = {}
        for base in (self.jobs, self.archive):
            for job in os.listdir(base):
                if not re.fullmatch(r"[0-9a-f]{32}", job):
                    continue
                try:
                    with open(os.path.join(base, job, "status.json"), encoding="utf-8") as source:
                        index[job] = self._index_entry(json.load(source))
                except (OSError, ValueError):
                    continue
        return index

    def index(self):
        """{job: status summary} for every job (active and archived)."""
        index = self._index_load()
        if index is None:
            try:
                with self._status_lock():
                    index = self._index_load() or self._index_rebuild()
                    self._index_store(index)
            except OSError:
                index = self._index_rebuild()
        return index

    def fresh(self, job, entry):
        """The index entry, re-read from status.json when the index calls the job active or unknown."""
        if entry.get("state") in ACTIVE or entry.get("state") == "UNKNOWN":
            try:
                return self._index_entry(self.read(job))
            except (OSError, ValueError, CIError):
                return entry
        return entry

    def all_ids(self, archived=False):
        ids = sorted(os.listdir(self.jobs))
        if archived:
            ids += sorted(os.listdir(self.archive))
        return [i for i in ids if re.fullmatch(r"[0-9a-f]{32}", i)]

    def resolve(self, prefix):
        if not re.fullmatch(r"[0-9a-f]{8,32}", prefix or ""):
            raise CIError("任务 ID 需为 8–32 位十六进制前缀")
        hits = [i for i in self.index() if i.startswith(prefix)]
        if len(hits) != 1:  # the index may lag a job created by an older writer: ask the directories
            hits = [i for i in self.all_ids(archived=True) if i.startswith(prefix)]
        if not hits:
            raise CIError(f"任务不存在：{prefix}")
        if len(hits) > 1:
            raise CIError(f"任务前缀有歧义：{prefix}（{len(hits)} 个匹配）")
        return hits[0]

    # -- submission ------------------------------------------------------------------------------------------
    def submit(self, commit, stage, targets=(), extra=None, repo=None):
        if not re.fullmatch(r"[0-9a-f]{40}", commit or ""):
            raise CIError("commit 必须是 40 位完整 SHA")
        rc = repo_config(self.cfg, repo)
        repo = rc["name"]
        if stage not in rc["stages"]:
            raise CIError(f"仓库 {repo} 未开放 stage {stage}（已开放：{', '.join(rc['stages'])}）")
        lane = lane_of(stage, rc)
        targets = list(targets)
        if stage == "build":
            if not targets:
                raise CIError("build 需要至少一个 target")
            known = set(rc["build_targets"].keys()) if isinstance(rc["build_targets"], dict) \
                else set(rc["build_targets"])
            unknown = [t for t in targets if t not in known]
            if unknown:
                raise CIError(f"未登记的构建目标：{', '.join(unknown)}")
        if stage == "gen" and targets:
            # Non-default repositories may name one generator: `gen <sha> <name>` runs `<check_entry> gen <name>`.
            if rc["default"] or len(targets) != 1 or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", targets[0]):
                raise CIError("gen 只接受一个生成器名（小写字母、数字、- 或 _），且仅限非默认仓库")
        if stage == "check-step":
            # Non-default repositories may pass one argument to their step: `cargo:<crate>`.
            step, _, arg = (targets or [""])[0].partition(":")
            if (len(targets) != 1 or step not in rc["check_steps"] or (arg and rc["default"])
                    or not re.fullmatch(r"[A-Za-z0-9_.-]*", arg)):
                raise CIError(f"check-step 需要且只能有一个步骤：{', '.join(rc['check_steps'])}")
        with self.lock():
            for job, status in self.index().items():
                if status.get("state") in ACTIVE:
                    status = self.fresh(job, status)
                if (status.get("state") in ACTIVE and status.get("commit") == commit
                        and status.get("repo", DEFAULT_REPO) == repo
                        and status.get("stage") == stage and status.get("targets") == targets):
                    return job
            job = uuid.uuid4().hex
            os.makedirs(os.path.join(self.jobs, job))
            status = dict(job=job, repo=repo, commit=commit, stage=stage, targets=targets, lane=lane, state="QUEUED",
                          exit_code=None, reason="", submitted_at=time.time(), started_at=None,
                          finished_at=None, archived=False)
            if extra:
                status.update(extra)
            self.write(job, status)
            open(os.path.join(self.job_dir(job), "log.txt"), "a").close()
            request = os.path.join(self.pending[lane], f"{job}.json")
            with open(request + ".tmp", "w", encoding="utf-8") as sink:
                json.dump(dict(job=job, repo=repo, commit=commit, stage=stage, targets=targets), sink)
            os.replace(request + ".tmp", request)
            return job
