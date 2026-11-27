#!/usr/bin/env python3
"""OPS-05 tests of the environment guard and the worker's environment retry. Run on the CI node (real cgroups, disks
and Kailo dockerd; a scratch queue and config, no CI job):  python3 -I -B tools/ci/service/test_envguard.py"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import envguard  # noqa: E402

# Never the real Kailo dockerd: the sweep of a scratch queue would see every CI container as orphaned.
os.environ["DOCKER_HOST"] = "unix:///nonexistent/docker.sock"
# The worker points TMPDIR at each scratch config's directory; scratch roots come from the original one.
BASE = os.environ.get("TMPDIR", "/tmp")


def scratch_config(root, **admission):
    cfg = dict(runtime=root, sources=os.path.join(root, "sources"), release_proofs=os.path.join(root, "proofs"),
               compose_project="none", queue=os.path.join(root, "queue"), min_job_free_bytes=1 << 20,
               environment={"TMPDIR": os.path.join(root, "tmp")},
               admission=dict(dict(cgroup=["/sys/fs/cgroup/kailo.slice"], min_free_percent=1,
                                   cleanup=dict(request=os.path.join(root, "cleanup", "request.json"),
                                                status=os.path.join(root, "cleanup", "last.json"),
                                                timeout=1, min_interval=0)), **admission),
               env_retry=dict(max=1, wait=5),
               repositories={"kailo-macro": dict(origin="x", source_repository=root, sources=root, lane="lane",
                                                 stages=["fetch", "check-step", "gen"], postgres_steps=["test", "verify"],
                                                 environment={"CHECK_POSTGRES_TMPFS": "12g",
                                                              "CHECK_POSTGRES_MEMORY": "15g",
                                                              "CHECK_POSTGRES_ARGS": "-c max_wal_size=1GB"})})
    os.makedirs(cfg["environment"]["TMPDIR"])
    path = os.path.join(root, "config.json")
    with open(path, "w") as sink:
        json.dump(cfg, sink)
    return cfg, path


class Classify(unittest.TestCase):
    def test_environment_signatures(self):
        for text, sig in [("error: could not write: No space left on device (os error 28)", "disk-full"),
                          ('could not extend file "base/1/2": No space left on device', "disk-full"),
                          ("Error: failed to lookup address information: Temporary failure", "dns"),
                          ("Connection reset by peer (os error 104)", "connection-reset"),
                          ("Cannot connect to the Docker daemon at unix:///run/kailo-docker/docker.sock", "docker-api"),
                          ("container OOMKilled=true", "oom"),
                          ("envguard: still short: memory headroom 3.0G < 24.0G", "no-room")]:
            self.assertTrue((envguard.classify(text) or "").startswith(sig), text)

    def test_kill_needs_oom_event(self):
        text = "process didn't exit successfully: rustc (signal: 9, SIGKILL: kill)"
        self.assertIsNone(envguard.classify(text, oom_delta=0))
        self.assertTrue(envguard.classify(text, oom_delta=1).startswith("oom"))

    def test_lookup_error_after_a_compile_error_is_the_code(self):
        text = ("error[E0061]: this function takes 5 arguments but 4 arguments were supplied\n"
                "error: error communicating with database: failed to lookup address information: Temporary failure")
        self.assertIsNone(envguard.classify(text))
        self.assertTrue(envguard.classify("src/a.tsx(1,2): error TS2322: x\nNo space left on device")
                        .startswith("disk-full"))

    def test_code_failures(self):
        for text in ["error[E0308]: mismatched types", "test result: FAILED. 3 passed; 1 failed",
                     "assertion `left == right` failed", "FAIL(1)"]:
            self.assertIsNone(envguard.classify(text), text)


class Config(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(dir=BASE)

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_postgres_sizing(self):
        cfg, _ = scratch_config(self.root)
        self.assertEqual(envguard.config_problems(cfg, "kailo-macro", "test"), [])
        cfg["repositories"]["kailo-macro"]["environment"]["CHECK_POSTGRES_MEMORY"] = "13g"
        self.assertTrue(any("CHECK_POSTGRES_MEMORY" in p for p in envguard.config_problems(cfg, "kailo-macro", "test")))
        self.assertEqual(envguard.config_problems(cfg, "kailo-macro", "lint"), [])  # no PostgreSQL in lint
        cfg["repositories"]["kailo-macro"]["environment"]["CHECK_POSTGRES_MEMORY"] = "15g"
        cfg["repositories"]["kailo-macro"]["environment"]["CHECK_POSTGRES_ARGS"] = "-c max_wal_size=4GB"
        self.assertTrue(any("max_wal_size" in p for p in envguard.config_problems(cfg, "kailo-macro", "test")))

    def test_measured_tmpfs_peak(self):
        cfg, _ = scratch_config(self.root)
        log = os.path.join(self.root, "peaks.jsonl")
        cfg["repositories"]["kailo-macro"]["environment"]["CHECK_PEAKS_LOG"] = log
        import time
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(log, "w") as sink:
            sink.write(json.dumps(dict(at=now, step="verify", part="test", pg_shmem_peak=13 << 30)) + "\n")
            sink.write(json.dumps(dict(at="2020-01-01T00:00:00Z", step="verify", part="test", pg_shmem_peak=99 << 30)) + "\n")
        self.assertEqual(envguard.measured_peak(log, "pg_shmem_peak", step="test"), 13 << 30)
        self.assertTrue(any("measured peak" in p for p in envguard.config_problems(cfg, "kailo-macro", "verify")))
        with open(log, "w") as sink:
            sink.write(json.dumps(dict(at=now, step="verify", part="test", pg_shmem_peak=10 << 30)) + "\n")
        self.assertEqual(envguard.config_problems(cfg, "kailo-macro", "verify"), [])
        self.assertTrue(any("headroom" in w for w in envguard.warnings(cfg, "kailo-macro", "test")))

    def test_shortage_and_step_memory(self):
        cfg, _ = scratch_config(self.root, steps={"verify": "1t"})
        short, facts = envguard.shortages(cfg, "kailo-macro", "check-step", "verify")
        self.assertEqual([k for k, _ in short], ["memory"])
        short, _ = envguard.shortages(cfg, "kailo-macro", "check-step", "lint", memory=1 << 20)
        self.assertEqual(short, [])


class WorkerRetry(unittest.TestCase):
    """The worker's execute loop with a stage whose first attempt fails like the node, the second passes."""

    def setUp(self):
        self.root = tempfile.mkdtemp(dir=BASE)
        self.cfg, path = scratch_config(self.root)
        os.environ["KAILO_CI_CONFIG"] = path
        os.environ["KAILO_CI_LANE"] = "lane"
        import worker  # noqa: E402 (reads the lane at import)
        self.worker_mod = worker

    def tearDown(self):
        shutil.rmtree(self.root)

    def run_job(self, outputs):
        w = self.worker_mod.Worker()
        job = w.q.submit("a" * 40, "check-step", ["lint"], repo="kailo-macro")
        attempts = []

        def stage(job_obj):
            text, code = outputs[len(attempts)]
            attempts.append(text)
            job_obj.say(text)
            if code:
                raise self.worker_mod.CIError(f"command failed: check lint (exit {code})", code=code)
        w.stage_check_step = stage
        w.execute(job)
        return w.q.read(job), attempts

    def test_environment_failure_retried_once(self):
        status, attempts = self.run_job([("ld: final link failed: No space left on device", 1), ("ok", 0)])
        self.assertEqual(len(attempts), 2)
        self.assertEqual(status["state"], "SUCCEEDED")
        self.assertIn("环境重试", status["reason"])
        self.assertEqual(status["env_retry"][0]["signature"].split(":")[0], "disk-full")

    def test_second_environment_failure_fails(self):
        status, attempts = self.run_job([("No space left on device", 1), ("No space left on device", 1)])
        self.assertEqual(len(attempts), 2)
        self.assertEqual(status["state"], "FAILED")
        self.assertIn("已环境重试 1 次", status["reason"])

    def test_code_failure_not_retried(self):
        status, attempts = self.run_job([("error[E0308]: mismatched types", 1)])
        self.assertEqual(len(attempts), 1)
        self.assertEqual(status["state"], "FAILED")
        self.assertNotIn("env_retry", status)


if __name__ == "__main__":
    unittest.main(verbosity=2)
