#!/usr/bin/env python3
"""Environment guard of the CI node (OPS-05, CI-CD 手册「环境防线」): one implementation of the resource preflight, the
cleanup trigger, the orphan sweep and the environment-failure classification, used by the lane worker (admission,
retry), by kailo-macro's kailo/ci/check.sh (CHECK_PREFLIGHT, before the job and before its test phase) and by
kailo-dev-check. Standard library only; reads config.json (`admission`, `env_retry`), never prints secrets.

  envguard.py preflight [--repo R] [--step S] [--memory SIZE] [--wait SECONDS] [--json]
      exit 0: the node has room for the step; 75: still short after cleanup and --wait (EX_TEMPFAIL);
      78: the configuration itself cannot work (EX_CONFIG: e.g. the PostgreSQL tmpfs does not fit its memory limit)
  envguard.py cleanup [--wait SECONDS]     run the existing cleanup (hourly retention: OPS-04 slot caps, idle roots,
                                           builder prune) now, through kailo-ci-cleanup.path, and wait for it
  envguard.py sweep [--dry-run]            remove CI containers and networks whose job or check.sh process is gone
  envguard.py classify <log file> [--since BYTES]   print the environment-failure signature, exit 1 when none

Thresholds (config.json `admission`, a repository may override keys in repositories.<name>.admission):
  min_free_percent      free space floor of the job scratch disk (TMPDIR, the system NVMe), default 15
  disks                 further floors, {name: {path, min_free_percent}}; defaults: ci-fs 15 %, 4T disk 10 %
  cgroup                cgroup(s) whose memory headroom (memory.max - anon - shmem) counts, as before
  <stage>               memory a job of that stage needs (bytes or 18g), as before
  steps                 memory per check step, {verify: 24g, ...}; overrides <stage> for check-step jobs
  test_phase_memory     headroom check.sh needs before the test phase (tmpfs of the temporary PostgreSQL included)
  postgres_overhead     PostgreSQL memory besides its tmpfs data directory (CHECK_POSTGRES_MEMORY must cover both)
  builder               {container, min_memory}: the image builder's memory limit floor
  cleanup               {request, status, timeout, min_interval}
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

GIB = 1 << 30
UNITS = {"k": 1 << 10, "m": 1 << 20, "g": 1 << 30, "t": 1 << 40}
EX_OK, EX_TEMPFAIL, EX_CONFIG = 0, 75, 78

DEFAULT_DISKS = {
    "ci-fs": {"path": "/var/lib/kailo-ci/ci-fs", "min_free_percent": 15},
    "hdd": {"path": "/volumes/data", "min_free_percent": 10},
}
DEFAULT_CLEANUP = {
    # kailo-ci-cleanup.path (tools/ci/retention) starts kailo-ci-hot-retention.service when the request changes; the
    # retention writes its summary to `status` when it ends.
    "request": "/var/lib/kailo-ci/queue/cleanup/request.json",
    "status": "/var/lib/kailo-ci/queue/cleanup/last-run.json",
    "timeout": 1800,
    "min_interval": 600,
}
DEFAULT_BUILDER = {"container": "buildx_buildkit_kailo-builder0", "min_memory": "28g"}

# Environment failures (OPS-05): what the log of a failed attempt says when the node, not the code, failed it. OOM by
# exit status (137, SIGKILL) counts only together with a new oom_kill in the Kailo cgroups (a test may kill a child).
ENV_PATTERNS = [
    ("no-room", r"^envguard: still short"),
    ("disk-full", r"No space left on device|\bENOSPC\b|could not extend file|Disk quota exceeded"),
    ("oom", r"OOMKilled|[Oo]ut of memory|Memory cgroup out of memory|oom-kill"),
    ("dns", r"failed to lookup address|Temporary failure in name resolution|Could not resolve host|"
            r"dns error|Name or service not known"),
    ("connection-reset", r"[Cc]onnection reset by peer|connection reset|ECONNRESET"),
    ("docker-api", r"Cannot connect to the Docker daemon|error during connect|"
                   r"docker\.sock: (connect: )?(connection refused|broken pipe)|"
                   r"Error response from daemon: .*(EOF|connection reset|context deadline exceeded)"),
]
KILL_PATTERN = r"\b137\b|signal: 9, SIGKILL|Killed\s*$"


def size(value, default=None):
    """'24g' / '1.5G' / 25769803776 -> bytes."""
    if value is None or value == "":
        return default
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().lower().rstrip("ib").rstrip("b")
    if text and text[-1] in UNITS:
        return int(float(text[:-1]) * UNITS[text[-1]])
    return int(float(text))


def human(n):
    if n is None:
        return "?"
    return f"{n / GIB:.1f}G"


# -- configuration -------------------------------------------------------------------------------------------------
def load(path=None):
    path = path or os.environ.get("KAILO_CI_CONFIG", "/volumes/kailo/ci/config.json")
    with open(path, encoding="utf-8") as source:
        return json.load(source)


def repo_spec(cfg, repo):
    return ((cfg.get("repositories") or {}).get(repo) or {}) if repo and repo != "kailo-plus" else {}


def admission(cfg, repo=None):
    return {**(cfg.get("admission") or {}), **(repo_spec(cfg, repo).get("admission") or {})}


def environment(cfg, repo=None):
    env = {k: str(v) for k, v in (cfg.get("environment") or {}).items()}
    env.update({k: str(v) for k, v in (repo_spec(cfg, repo).get("environment") or {}).items()})
    return env


# -- measurements ----------------------------------------------------------------------------------------------------
def cgroup_headroom(path):
    """memory.max - anon - shmem of a cgroup v2 group (swap is off in the Kailo slices; tmpfs pages are shmem; page
    cache is reclaimable and does not count). None without a limit or when unreadable."""
    try:
        with open(os.path.join(path, "memory.max")) as source:
            limit = source.read().strip()
        if limit == "max":
            return None
        with open(os.path.join(path, "memory.stat")) as source:
            stat = dict(line.split() for line in source if line.strip())
        return max(0, int(limit) - int(stat.get("anon", 0)) - int(stat.get("shmem", 0)))
    except (OSError, ValueError):
        return None


def memory_headroom(adm):
    with open("/proc/meminfo") as source:
        info = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in source}
    free = info.get("MemAvailable", 0)
    groups = adm.get("cgroup")
    for group in [groups] if isinstance(groups, str) else (groups or []):
        headroom = cgroup_headroom(group) if isinstance(group, str) else None
        if headroom is not None:
            free = min(free, headroom)
    return free


def oom_kills(groups=("/sys/fs/cgroup/kailo.slice",)):
    """Total oom_kill events of the groups and their descendants (memory.events is hierarchical)."""
    total = 0
    for group in groups:
        try:
            with open(os.path.join(group, "memory.events")) as source:
                total += int(dict(line.split() for line in source).get("oom_kill", 0))
        except (OSError, ValueError):
            pass
    return total


def disk_floors(cfg, repo, scratch):
    """[(name, path, required free bytes, free bytes)] for every disk the job writes to."""
    adm = admission(cfg, repo)
    out = []
    usage = shutil.disk_usage(scratch)
    floor = int(repo_spec(cfg, repo).get("min_job_free_bytes", cfg.get("min_job_free_bytes", 32 * GIB)))
    floor = max(floor, int(usage.total * float(adm.get("min_free_percent", 15)) / 100))
    out.append(("nvme", scratch, floor, usage.free))
    for name, spec in {**DEFAULT_DISKS, **(adm.get("disks") or {})}.items():
        if not spec or not os.path.isdir(spec.get("path", "")):
            continue
        usage = shutil.disk_usage(spec["path"])
        need = max(int(usage.total * float(spec.get("min_free_percent", 0)) / 100), size(spec.get("min_free"), 0))
        out.append((name, spec["path"], need, usage.free))
    return out


def docker(*args, timeout=60):
    env = dict(os.environ)
    env.setdefault("DOCKER_HOST", "unix:///run/kailo-docker/docker.sock")
    return subprocess.run(["docker", *args], capture_output=True, text=True, env=env, timeout=timeout)


def builder_memory(adm):
    spec = {**DEFAULT_BUILDER, **(adm.get("builder") or {})}
    try:
        r = docker("inspect", "-f", "{{.HostConfig.Memory}}", spec["container"])
    except (OSError, subprocess.TimeoutExpired):
        return spec, None
    return spec, (int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else None)


def postgres_args_wal(args):
    m = re.search(r"max_wal_size=(\S+)", args or "")
    return size(m.group(1)) if m else None


# -- preflight -------------------------------------------------------------------------------------------------------
def step_memory(adm, stage, step):
    """Memory a job needs at admission: the step's own figure, else its stage's, else 18 GiB for checks."""
    steps = adm.get("steps") or {}
    name = (step or "").partition(":")[0]
    if stage in ("check-step",) and name in steps:
        return size(steps[name])
    return size(adm.get(stage), 18 * GIB if stage in ("check", "check-step", "build", "gen") else 4 * GIB)


def config_problems(cfg, repo, step, stage="check-step"):
    """Settings that cannot work whatever the node's state: waiting or cleaning would not help (EX_CONFIG). The
    temporary PostgreSQL is checked for the steps (or the gen stage) that start one."""
    env, adm, problems = environment(cfg, repo), admission(cfg, repo), []
    name = "gen" if stage == "gen" else (step or "").partition(":")[0]
    if name in (repo_spec(cfg, repo).get("postgres_steps") or []):
        tmpfs = size(env.get("CHECK_POSTGRES_TMPFS"), GIB)
        memory = size(env.get("CHECK_POSTGRES_MEMORY"), 2 * GIB)
        overhead = size(adm.get("postgres_overhead"), 2 * GIB)
        if memory < tmpfs + overhead:
            problems.append(f"CHECK_POSTGRES_MEMORY {human(memory)} < CHECK_POSTGRES_TMPFS {human(tmpfs)} + "
                            f"PostgreSQL overhead {human(overhead)} (tmpfs pages count against the container memory)")
        wal = postgres_args_wal(env.get("CHECK_POSTGRES_ARGS"))
        if wal is not None and wal * 4 > tmpfs:
            problems.append(f"max_wal_size {human(wal)} is more than a quarter of the PostgreSQL tmpfs {human(tmpfs)}")
        peak = size(adm.get("postgres_tmpfs_peak"))
        if peak and tmpfs < peak * 1.3:
            problems.append(f"CHECK_POSTGRES_TMPFS {human(tmpfs)} < 1.3 x measured peak {human(peak)}")
    check_memory = size(env.get("CHECK_MEMORY"))
    test_phase = size(adm.get("test_phase_memory"))
    limit = cgroup_limit(adm)
    if test_phase and limit and test_phase > limit:
        problems.append(f"test_phase_memory {human(test_phase)} exceeds the CI cgroup limit {human(limit)}")
    if check_memory and limit and check_memory > limit:
        problems.append(f"CHECK_MEMORY {human(check_memory)} exceeds the CI cgroup limit {human(limit)}")
    return problems


def cgroup_limit(adm):
    groups = adm.get("cgroup")
    limits = []
    for group in [groups] if isinstance(groups, str) else (groups or []):
        try:
            with open(os.path.join(group, "memory.max")) as source:
                value = source.read().strip()
            if value != "max":
                limits.append(int(value))
        except OSError:
            pass
    return min(limits) if limits else None


def shortages(cfg, repo, stage, step, memory=None, scratch=None):
    """[(kind, text)] where the node is short right now; kind 'disk' is what the cleanup can fix."""
    adm = admission(cfg, repo)
    scratch = scratch or environment(cfg, repo).get("TMPDIR", "/var/lib/kailo-ci/tmp")
    out = []
    need = memory if memory is not None else step_memory(adm, stage, step)
    free = memory_headroom(adm)
    if free < need:
        out.append(("memory", f"memory headroom {human(free)} < {human(need)}"))
    for name, path, floor, avail in disk_floors(cfg, repo, scratch):
        if avail < floor:
            out.append(("disk", f"{name} ({path}) free {human(avail)} < {human(floor)}"))
    return out, dict(memory_required=need, memory_available=free,
                     disks={n: dict(path=p, required=f, available=a) for n, p, f, a in
                            disk_floors(cfg, repo, scratch)})


def warnings(cfg, repo):
    adm = admission(cfg, repo)
    spec, limit = builder_memory(adm)
    need = size(spec.get("min_memory"))
    if need and limit is not None and limit and limit < need:
        return [f"image builder {spec['container']} memory limit {human(limit)} < {human(need)}"]
    return []


# -- cleanup ---------------------------------------------------------------------------------------------------------
def cleanup_spec(cfg):
    return {**DEFAULT_CLEANUP, **((cfg.get("admission") or {}).get("cleanup") or {})}


def last_cleanup(cfg):
    try:
        with open(cleanup_spec(cfg)["status"], encoding="utf-8") as source:
            return json.load(source)
    except (OSError, ValueError):
        return {}


def request_cleanup(cfg, reason, wait=0, say=print):
    """Ask for a retention run now (the existing mechanism: slot caps, idle roots, builder prune). Requests within
    min_interval of the previous one are coalesced. Returns the retention summary when it finished within `wait`."""
    spec = cleanup_spec(cfg)
    os.makedirs(os.path.dirname(spec["request"]), exist_ok=True)
    try:
        previous = os.path.getmtime(spec["request"])
    except OSError:
        previous = 0
    started = time.time()
    if started - previous >= float(spec["min_interval"]):
        tmp = f"{spec['request']}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as sink:
            json.dump(dict(at=started, reason=reason, pid=os.getpid()), sink)
        os.replace(tmp, spec["request"])
        say(f"envguard: cleanup requested ({reason})")
        since = started
    else:
        say(f"envguard: cleanup already requested {int(started - previous)}s ago; waiting for it")
        since = previous
    deadline = started + wait
    while time.time() < deadline:
        status = last_cleanup(cfg)
        if status.get("finished_at", 0) >= since:
            say(f"envguard: cleanup done, freed {human(status.get('freed_bytes', 0))}")
            return status
        time.sleep(10)
    return None


def job_states(cfg):
    """{job id: state} from the queue's job directories (status.json; the index may lag)."""
    folder = os.path.join(cfg["queue"], "jobs")
    states = {}
    for job in os.listdir(folder) if os.path.isdir(folder) else []:
        try:
            with open(os.path.join(folder, job, "status.json"), encoding="utf-8") as source:
                states[job] = json.load(source).get("state")
        except (OSError, ValueError):
            continue
    return states


def check_process_alive(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as source:
            return b"check.sh" in source.read()
    except OSError:
        return False


def sweep(cfg, dry_run=False, say=print):
    """Containers and networks a CI job left behind (a worker interrupted by a kailo-docker restart, a killed
    check.sh): kci-pg-<job>, network kci-<job> of a job that is not running; kci-macro-<step>-<pid>-... whose
    check.sh process is gone. Running jobs and anything else are never touched."""
    states = job_states(cfg)
    if not states:  # an unreadable queue must never make every CI container look orphaned
        say("envguard: no job states readable; sweep skipped")
        return []
    running = {job[:12] for job, state in states.items() if state in ("RUNNING", "DEPLOYING", "QUEUED")}
    removed = []
    r = docker("ps", "-a", "--format", "{{.Names}}")
    for name in r.stdout.split() if r.returncode == 0 else []:
        m = re.fullmatch(r"kci-pg-([0-9a-f]{12})", name)
        orphan = bool(m) and m.group(1) not in running
        m = re.fullmatch(r"kci-macro-[a-z-]+?-(\d+)-\d+(-.*)?", name)
        orphan = orphan or (bool(m) and not check_process_alive(m.group(1)))
        if orphan:
            removed.append(name)
            if not dry_run:
                docker("rm", "-f", "-v", name)
    r = docker("network", "ls", "--format", "{{.Name}}")
    for name in r.stdout.split() if r.returncode == 0 else []:
        m = re.fullmatch(r"kci-([0-9a-f]{12})", name)
        if m and m.group(1) not in running:
            removed.append(name)
            if not dry_run:
                docker("network", "rm", name)
    if removed:
        say(f"envguard: {'would remove' if dry_run else 'removed'} leftovers of finished jobs: {' '.join(removed)}")
    return removed


# -- classification --------------------------------------------------------------------------------------------------
def classify(text, oom_delta=0, patterns=None):
    """The environment-failure signature of a failed attempt's log, or None for a code failure."""
    for signature, pattern in patterns or ENV_PATTERNS:
        m = re.search(pattern, text, re.M)
        if m:
            return f"{signature}: {m.group(0)[:80]}"
    if oom_delta > 0 and re.search(KILL_PATTERN, text, re.M):
        return f"oom: {oom_delta} oom_kill event(s) in the Kailo cgroups and a killed process"
    return None


def read_tail(path, since=0, limit=4 << 20):
    with open(path, "rb") as source:
        source.seek(0, 2)
        end = source.tell()
        source.seek(max(since, end - limit))
        return source.read().decode("utf-8", "replace")


# -- preflight with waiting (check.sh, dev-check) --------------------------------------------------------------------
def preflight(cfg, repo, stage, step, memory=None, wait=0, say=print):
    problems = config_problems(cfg, repo, step, stage)
    if problems:
        for p in problems:
            say(f"envguard: configuration: {p}")
        return EX_CONFIG
    for w in warnings(cfg, repo):
        say(f"envguard: warning: {w}")
    deadline, cleaned, swept, reported = time.time() + wait, False, False, 0
    while True:
        short, _ = shortages(cfg, repo, stage, step, memory)
        if not short:
            return EX_OK
        if not swept:
            sweep(cfg, say=say)
            swept = True
            continue
        if any(kind == "disk" for kind, _ in short) and not cleaned:
            request_cleanup(cfg, "; ".join(t for _, t in short), wait=max(0, min(deadline - time.time(),
                            float(cleanup_spec(cfg)["timeout"]))), say=say)
            cleaned = True
            continue
        if time.time() >= deadline:
            say("envguard: still short: " + "; ".join(t for _, t in short))
            return EX_TEMPFAIL
        if time.time() - reported >= 300:
            say("envguard: waiting for room: " + "; ".join(t for _, t in short))
            reported = time.time()
        time.sleep(15)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("preflight")
    p.add_argument("--repo", default=None)
    p.add_argument("--stage", default="check-step")
    p.add_argument("--step", default=None)
    p.add_argument("--memory", default=None, help="required headroom instead of the step's admission figure")
    p.add_argument("--phase", choices=["test"], default=None,
                   help="the test phase of a check (admission.test_phase_memory; check.sh asks under the heavy lock)")
    p.add_argument("--wait", type=float, default=0)
    p.add_argument("--json", action="store_true")
    c = sub.add_parser("cleanup")
    c.add_argument("--wait", type=float, default=0)
    s = sub.add_parser("sweep")
    s.add_argument("--dry-run", action="store_true")
    k = sub.add_parser("classify")
    k.add_argument("log")
    k.add_argument("--since", type=int, default=0)
    a = ap.parse_args()
    cfg = load(a.config)
    say = lambda text: print(text, file=sys.stderr, flush=True)  # noqa: E731
    if a.cmd == "preflight":
        memory = size(a.memory) if a.memory else None
        if a.phase == "test" and memory is None:
            memory = size(admission(cfg, a.repo).get("test_phase_memory"))
        if a.json:
            short, facts = shortages(cfg, a.repo, a.stage, a.step, memory)
            print(json.dumps(dict(config=config_problems(cfg, a.repo, a.step, a.stage), short=[t for _, t in short],
                                  warnings=warnings(cfg, a.repo), **facts), indent=1))
            return EX_OK
        return preflight(cfg, a.repo, a.stage, a.step, memory, a.wait, say)
    if a.cmd == "cleanup":
        return EX_OK if request_cleanup(cfg, "manual", a.wait, say) or not a.wait else EX_TEMPFAIL
    if a.cmd == "sweep":
        sweep(cfg, a.dry_run, say)
        return EX_OK
    if a.cmd == "classify":
        found = classify(read_tail(a.log, a.since))
        print(found or "code failure (no environment signature)")
        return EX_OK if found else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
