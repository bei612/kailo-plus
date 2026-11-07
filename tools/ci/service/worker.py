#!/usr/bin/env python3
"""kailo-ci worker (host, systemd oneshot per lane; started by a .path unit when requests appear).

Runs as the CI user against the Kailo dockerd (DOCKER_HOST from config.environment). Source only comes from
GitHub through config.source_repository (a clone whose origin is the GitHub repo). Branch commits are accepted for
feedback-lane stages; build/deploy/fetch/check require reachability from origin/main.
"""
import hashlib
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kci import CIError, Queue, load_config  # noqa: E402

LANE = os.environ.get("KAILO_CI_LANE", "release")
GIB = 1 << 30


def now():
    return time.time()


class Job:
    def __init__(self, worker, job):
        self.w, self.id = worker, job
        self.dir = worker.q.job_dir(job)
        self.log = open(os.path.join(self.dir, "log.txt"), "a", encoding="utf-8", buffering=1)
        self.status = worker.q.read(job)
        self.tmp = os.path.join(worker.tmp_root, job)
        self.cleanup = []

    def say(self, text):
        self.log.write(text.rstrip("\n") + "\n")

    def update(self, **fields):
        self.status = self.w.q.update(self.id, **fields)

    def cancelled(self):
        return os.path.exists(os.path.join(self.dir, "cancel"))

    def run(self, argv, cwd=None, env=None, check=True, label=None):
        """Run a child in its own process group, streaming output to the job log; honour cancel requests."""
        self.say(f"RUN {label or os.path.basename(argv[0])}")
        full_env = dict(os.environ, **self.w.env, TMPDIR=self.tmp_job, **(env or {}))
        proc = subprocess.Popen(argv, cwd=cwd, env=full_env, stdout=self.log, stderr=subprocess.STDOUT,
                                start_new_session=True)
        while proc.poll() is None:
            if self.cancelled():
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(30)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                raise CIError("任务被取消", code=130)
            time.sleep(1)
        self.say(f"EXIT {label or os.path.basename(argv[0])} {proc.returncode}")
        if check and proc.returncode:
            raise CIError(f"command failed: {label or os.path.basename(argv[0])} (exit {proc.returncode})",
                          code=proc.returncode)
        return proc.returncode

    def output(self, argv, cwd=None):
        return subprocess.run(argv, cwd=cwd, env=dict(os.environ, **self.w.env), capture_output=True, text=True,
                              check=True).stdout


class Worker:
    def __init__(self):
        self.cfg = load_config()
        self.q = Queue(self.cfg)
        self.env = {k: str(v) for k, v in (self.cfg.get("environment") or {}).items()}
        os.environ.update(self.env)  # docker CLI calls (incl. cleanup) target the Kailo dockerd
        self.repo = self.cfg["source_repository"]
        self.tmp_root = self.env.get("TMPDIR", "/var/lib/kailo-ci/tmp")
        os.makedirs(self.tmp_root, exist_ok=True)

    # -- lifecycle -------------------------------------------------------------------------------------------
    def recover(self):
        """Jobs left RUNNING by a previous worker of this lane become UNKNOWN; they are never replayed."""
        for job in self.q.all_ids():
            s = self.q.read(job)
            if s.get("lane") == LANE and s.get("state") in ("RUNNING", "DEPLOYING"):
                pid = s.get("worker_pid")
                alive = pid and os.path.exists(f"/proc/{pid}")
                if not alive or pid == os.getpid():
                    self.q.update(job, state="UNKNOWN", reason="worker interrupted; inspect before retry",
                                  finished_at=now())

    def next_request(self):
        lane_dir = self.q.pending[LANE]
        names = sorted((os.path.getmtime(os.path.join(lane_dir, n)), n) for n in os.listdir(lane_dir)
                       if n.endswith(".json"))
        return os.path.join(lane_dir, names[0][1]) if names else None

    def loop(self):
        self.recover()
        while True:
            path = self.next_request()
            if not path:
                return
            with open(path, encoding="utf-8") as source:
                request = json.load(source)
            job = request["job"]
            if not self.admit(job, request["stage"]):
                time.sleep(15)
                continue
            os.remove(path)
            self.execute(job)

    def admit(self, job, stage):
        need = int(self.cfg.get("admission", {}).get(stage, 18 * GIB if stage in ("check", "check-step", "build")
                                                                else 4 * GIB))
        with open("/proc/meminfo") as source:
            info = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in source}
        free = info.get("MemAvailable", 0)
        disk = shutil.disk_usage(self.tmp_root).free
        min_disk = int(self.cfg.get("min_job_free_bytes", 32 * GIB))
        if free < need or disk < min_disk:
            self.q.update(job, waiting_for=dict(memory_required=need, memory_available=free,
                                                disk_required=min_disk, disk_available=disk))
            return False
        return True

    # -- execution -------------------------------------------------------------------------------------------
    def execute(self, job_id):
        job = Job(self, job_id)
        job.tmp_job = os.path.join(job.tmp, "tmp")
        os.makedirs(job.tmp_job, exist_ok=True)
        job.update(state="RUNNING", started_at=now(), worker_pid=os.getpid(), waiting_for=None)
        stage = job.status["stage"]
        try:
            handler = getattr(self, "stage_" + stage.replace("-", "_"))
            handler(job)
            job.update(state="SUCCEEDED", exit_code=0, reason="", finished_at=now())
        except CIError as error:
            state = "CANCELLED" if error.code == 130 else "FAILED"
            job.say(str(error))
            job.update(state=state, exit_code=error.code, reason=str(error), finished_at=now())
        except Exception as error:  # noqa: BLE001 - every failure must land in status
            job.say(f"internal error: {error!r}")
            job.update(state="FAILED", exit_code=2, reason=f"internal error: {error}", finished_at=now())
        finally:
            for fn in reversed(job.cleanup):
                try:
                    fn()
                except Exception as error:  # noqa: BLE001
                    job.say(f"cleanup failed: {error!r}")
            shutil.rmtree(job.tmp, ignore_errors=True)
            job.log.close()

    # -- source ----------------------------------------------------------------------------------------------
    def fetch(self, job):
        with open(os.path.join(self.q.root, "source.lock"), "a+") as lock:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
            job.run(["git", "-C", self.repo, "fetch", "--prune", "origin",
                     "+refs/heads/*:refs/remotes/origin/*"], label="git fetch")

    def require_reachable(self, job, main_only):
        commit = job.status["commit"]
        refs = ["refs/remotes/origin/main"] if main_only else \
            job.output(["git", "-C", self.repo, "for-each-ref", "--format=%(refname)", "refs/remotes/origin"]).split()
        for ref in refs:
            if subprocess.run(["git", "-C", self.repo, "merge-base", "--is-ancestor", commit, ref]).returncode == 0:
                return ref
        raise CIError(f"commit {commit[:12]} 不可从 {'origin/main' if main_only else '任何 origin 分支'} 到达",
                      code=128)

    def checkout(self, job, dest):
        commit = job.status["commit"]
        job.run(["git", "clone", "--quiet", "--shared", "--no-checkout", self.repo, dest], label="git clone")
        job.run(["git", "-C", dest, "-c", "advice.detachedHead=false", "checkout", "--quiet", commit],
                label="git checkout")
        # The copy keeps origin/* refs so check.sh can archive DESIGN_COMMIT (design-authority) and pinned refs.
        job.run(["git", "-C", dest, "fetch", "--quiet", self.repo, "+refs/remotes/origin/*:refs/remotes/origin/*"],
                label="git refs")
        return dest

    # -- temporary PostgreSQL --------------------------------------------------------------------------------
    def postgres(self, job):
        docker = ["docker"]
        image = self.env.get("CHECK_POSTGRES_IMAGE", "")
        try:
            prod = job.output(docker + ["inspect", "-f", "{{.Image}}", f"{self.cfg['compose_project']}-core-db-1"]).strip()
            if prod:
                image = prod
        except subprocess.CalledProcessError:
            pass
        if not image:
            raise CIError("没有可用的临时 PostgreSQL 镜像（生产 core-db 未运行且未配置 CHECK_POSTGRES_IMAGE）")
        net = f"kci-{job.id[:12]}"
        name = f"kci-pg-{job.id[:12]}"
        password = secrets.token_hex(16)
        job.run(docker + ["network", "create", "--internal", net], label="pg network")
        job.cleanup.append(lambda: subprocess.run(docker + ["network", "rm", net], capture_output=True))
        job.run(docker + ["run", "-d", "--name", name, "--network", net, "--cpus", "1", "--memory", "2g",
                          "--tmpfs", "/var/lib/postgresql/data:size=1g", "-e", f"POSTGRES_PASSWORD={password}",
                          image], label="pg start")

        def remove():
            subprocess.run(docker + ["rm", "-f", name], capture_output=True)
            job.update(postgres=dict(job.status.get("postgres") or {}, cleaned_up=True))
        job.cleanup.append(remove)
        for _ in range(60):
            if subprocess.run(docker + ["exec", name, "pg_isready", "-U", "postgres"], capture_output=True).returncode == 0:
                break
            time.sleep(1)
        else:
            raise CIError("临时 PostgreSQL 未就绪")
        version = job.output(docker + ["exec", name, "postgres", "--version"]).strip()
        job.update(postgres=dict(image_id=image, version=version, cleaned_up=False))
        return net, f"postgres://postgres:{password}@{name}:5432/postgres"

    def check_env(self, job, network=None, database_url=None):
        env = dict(CHECK_CPUS=self.env.get("CHECK_CPUS", "4"), CHECK_MEMORY=self.env.get("CHECK_MEMORY", "16g"),
                   CHECK_NETWORK=network or self.env.get("CHECK_NETWORK", "bridge"),
                   CHECK_CACHE_ROOT=self.env.get("CHECK_CACHE_ROOT", "/var/lib/kailo-ci/check-cache"),
                   CHECK_SOURCE_REF=job.status["commit"])
        if database_url:
            env["DATABASE_URL"] = database_url
        return env

    # -- stages ----------------------------------------------------------------------------------------------
    def stage_fetch(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=True)
        self.prepare_tree(job)

    def prepare_tree(self, job):
        commit = job.status["commit"]
        base = os.path.join(self.cfg["sources"], commit)
        apps = os.path.join(base, "apps")
        if not os.path.exists(os.path.join(base, "ready.json")):
            shutil.rmtree(base, ignore_errors=True)
            os.makedirs(base)
            self.checkout(job, apps)
            ready = os.path.join(base, "ready.json")
            with open(ready, "w", encoding="utf-8") as sink:
                json.dump(dict(commit=commit, job=job.id, prepared_at=now()), sink)
        return apps

    def stage_docs(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=False)
        work = self.checkout(job, os.path.join(job.tmp, "apps"))
        job.run(["bash", "tools/check.sh", "--docs-only"], cwd=work, env=self.check_env(job), label="check-docs")

    def stage_check_step(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=False)
        step = job.status["targets"][0]
        work = self.checkout(job, os.path.join(job.tmp, "apps"))
        if step in ("migrate", "verify"):
            net, url = self.postgres(job)
            env = self.check_env(job, net, url)
            if step == "verify":
                job.run(["bash", "tools/check.sh", "migrate"], cwd=work, env=env, label="check migrate")
            job.run(["bash", "tools/check.sh", step], cwd=work, env=env, label=f"check {step}")
        else:
            job.run(["bash", "tools/check.sh", step], cwd=work, env=self.check_env(job), label=f"check {step}")

    def stage_check(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=True)
        apps = self.prepare_tree(job)
        net, url = self.postgres(job)
        work = self.checkout(job, os.path.join(job.tmp, "apps"))
        job.run(["bash", "tools/check.sh", "--full"], cwd=work, env=self.check_env(job, net, url), label="check full")
        diff = job.output(["git", "-C", apps, "status", "--porcelain"])
        with open(os.path.join(self.cfg["sources"], job.status["commit"], "check.json"), "w", encoding="utf-8") as s:
            json.dump(dict(commit=job.status["commit"], job=job.id, diff=diff), s)

    def stage_gen(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=False)
        work = self.checkout(job, os.path.join(job.tmp, "apps"))
        # check.sh `status` builds/loads the check SDK image and prints its immutable ID.
        job.run(["bash", "tools/check.sh", "status"], cwd=work, env=self.check_env(job), label="check sdk")
        recipe = hashlib.sha256(open(os.path.join(work, "tools/check.Dockerfile"), "rb").read()).hexdigest()
        image = job.output(["docker", "image", "inspect", "-f", "{{.Id}}", f"local/kailo-check:{recipe}"]).strip()
        cache = self.check_env(job)["CHECK_CACHE_ROOT"]
        os.makedirs(os.path.join(cache, "home"), exist_ok=True)
        base = ["docker", "run", "--rm", "--network", "bridge", "--cpus", "2", "--memory", "8g",
                "--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{work}:/workspace/apps", "-v", f"{cache}:/cache",
                "-w", "/workspace/apps", "-e", "HOME=/cache/home", "-e", "npm_config_cache=/cache/npm", image]
        job.run(base + ["bash", "tools/gen.sh"], label="gen")
        job.run(base + ["bash", "tools/gen.sh", "--check"], label="gen --check")
        if os.path.exists(os.path.join(work, "tools/gen-platform-i18n.py")):
            job.run(base + ["python3", "tools/gen-platform-i18n.py"], label="gen i18n")
        changed = [line[3:] for line in job.output(["git", "-C", work, "status", "--porcelain"]).splitlines()]
        patch = job.output(["git", "-C", work, "diff"])
        bundle = os.path.join(self.cfg.get("artifacts", "/var/lib/kailo-ci/artifacts"), job.id, "gen.tar.gz")
        os.makedirs(os.path.dirname(bundle), exist_ok=True)
        files = ["core/crates/contracts/src/generated/contracts.rs", "worker/internal/contracts/generated/contracts.go",
                 "client-kit/ts/contracts/src/generated/contracts.ts",
                 "client-kit/dart/lib/shared/contracts/generated/contracts.dart"]
        files += [c for c in changed if c not in files]
        manifest = dict(commit=job.status["commit"], job=job.id, image_id=image, changed=changed, validation="gen.sh --check ok",
                        files={f: hashlib.sha256(open(os.path.join(work, f), "rb").read()).hexdigest()
                               for f in files if os.path.isfile(os.path.join(work, f))})
        with tarfile.open(bundle, "w:gz") as tar:
            for f in manifest["files"]:
                tar.add(os.path.join(work, f), arcname=f"files/{f}")
            for name, data in (("changes.patch", patch), ("manifest.json", json.dumps(manifest, indent=1))):
                path = os.path.join(job.tmp, name)
                with open(path, "w", encoding="utf-8") as sink:
                    sink.write(data)
                tar.add(path, arcname=name)
        digest = hashlib.sha256(open(bundle, "rb").read()).hexdigest()
        job.update(artifact=dict(path=bundle, sha256=digest), artifacts_path=os.path.dirname(bundle))

    def stage_build(self, job):
        self.fetch(job)
        self.require_reachable(job, main_only=True)
        targets = self.cfg.get("build_targets") or {}
        artifacts = os.path.join(self.cfg.get("artifacts", "/var/lib/kailo-ci/artifacts"), job.id)
        os.makedirs(os.path.join(artifacts, "dist"), exist_ok=True)
        diffs = []
        for target in job.status["targets"]:
            spec = targets.get(target, {}) if isinstance(targets, dict) else {}
            work = self.checkout(job, os.path.join(job.tmp, f"apps-{target}"))
            command = spec.get("command") or (["tools/release.sh"] if target == "core-worker"
                                              else ["tools/build-upstream.sh", target])
            job.run(["bash", *command], cwd=work, env=spec.get("environment"), label=f"build {target}")
            job.say("BUILD WORKTREE STATUS")
            status = job.output(["git", "-C", work, "status", "--porcelain"])
            job.say(status or "(clean)")
            diff = job.output(["git", "-C", work, "diff"])
            job.say("GENERATED METADATA DIFF")
            job.say(diff or "(none)")
            diffs.append(diff)
            dist = os.path.join(work, "dist")
            if os.path.isdir(dist):
                for name in os.listdir(dist):
                    src = os.path.join(dist, name)
                    dst = os.path.join(artifacts, "dist", name)
                    (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, dst)
                    if name.endswith(".provenance.json"):
                        proof = os.path.join(self.cfg["release_proofs"], name)
                        os.makedirs(self.cfg["release_proofs"], exist_ok=True)
                        if os.path.exists(proof) and open(proof, "rb").read() != open(src, "rb").read():
                            raise CIError(f"release_proofs 中已有同名而内容不同的证明：{name}")
                        shutil.copy2(src, proof)
        job.update(artifacts_path=artifacts, generated_metadata_diff="".join(diffs))

    def stage_deploy(self, job):
        raise CIError("deploy 由发布入口 tools/release/kailo-release.sh 经 node.py 执行；CI 队列不再承担部署")


def main():
    worker = Worker()
    worker.loop()


if __name__ == "__main__":
    main()
