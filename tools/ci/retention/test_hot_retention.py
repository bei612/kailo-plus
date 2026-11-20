"""CI 热目录定时保留（07 §2.1）：python3 -I -B -m unittest discover -s tools/ci/retention"""
import importlib.util
import json
import os
import stat
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("hot_retention", os.path.join(os.path.dirname(__file__), "hot-retention.py"))
hr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hr)

HOUR, DAY = 3600, 86400


def touch(path, age, now, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as stream:
        stream.write(text)
    os.utime(path, (now - age, now - age))


def age_dir(path, age, now):
    os.utime(path, (now - age, now - age))


class Policy(unittest.TestCase):
    def write(self, value):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(value, handle)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_repository_policy_is_valid(self):
        policy = hr.load_policy(os.path.join(os.path.dirname(__file__), "policy.json"))
        paths = [r["path"] for r in policy["roots"]]
        self.assertEqual(paths, ["/home/ubuntu/scratch", "/home/ubuntu/branch-core", "/home/ubuntu/branch-nvme",
                                 "/var/lib/kailo-ci/tmp", "/var/lib/kailo-ci/branch", "/var/lib/kailo-ci/slots/work",
                                 "/volumes/data/kailo/check-cache",
                                 "/var/lib/kailo-ci/check-target/kailo-macro/slot1",
                                 "/var/lib/kailo-ci/check-target/kailo-macro/slot2",
                                 "/var/lib/kailo-ci/check-target/kailo-macro/slot3",
                                 "/var/lib/kailo-ci/check-cache/kailo-macro",
                                 "/volumes/data/kailo/capacity/ci/check-cache/kailo-macro",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-1/target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-2/target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-3/target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/test-target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-1/test-target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-2/test-target",
                                 "/var/lib/kailo-ci/ci-fs/dev-check/slot-3/test-target"])
        self.assertEqual(policy["grace_seconds"], 2 * HOUR)
        # cargo targets: three slots of at most 30 GiB (90 GiB) and kailo-dev-check's up to four slots of 25 GiB
        # (OPS-05, dev_check.slots; the real per-slot cap is dev_check.target_cap_gb) plus their --test targets of
        # 20 GiB (dev_check.test_target_cap_gb, 18 GiB, applies first), all on ci-fs
        self.assertEqual(sum(r.get("max_bytes", 0) for r in policy["roots"]), 270 * 2**30)
        # default builder: same limit as daemon.json builder.gc; kailo-builder state lives on the 4T disk (OPS-01)
        self.assertEqual(policy["docker_build_cache"]["keep_storage"], "10GB")
        self.assertEqual(policy["docker_build_cache"]["builders"],
                         ["default", dict(name="kailo-builder", keep_storage="160GB")])

    def test_invalid_policies_are_refused(self):
        for bad in (dict(grace_seconds=60, roots=[dict(path="/a", max_idle_seconds=DAY)]),
                    dict(grace_seconds=7200, roots=[]),
                    dict(grace_seconds=7200, roots=[dict(path="a", max_idle_seconds=DAY)]),
                    dict(grace_seconds=7200, roots=[dict(path="/a", max_idle_seconds=60)]),
                    dict(grace_seconds=7200, roots=[dict(path="/a", max_idle_seconds=DAY),
                                                    dict(path="/a/b", max_idle_seconds=DAY)])):
            with self.assertRaises(hr.RetentionError):
                hr.load_policy(self.write(bad))


class Decide(unittest.TestCase):
    def test_rules(self):
        now = 1_000_000.0
        kw = dict(now=now, grace=2 * HOUR, max_idle=DAY, jobs=set())
        idle = lambda path, stop: (now - 3 * DAY, 4096, False)
        self.assertEqual(hr.decide("/r/old", in_use=set(), activity=idle, **kw), ("delete", "72 小时无活动", 4096))
        recent = lambda path, stop: (now - HOUR, 0, True)
        self.assertEqual(hr.decide("/r/hot", in_use=set(), activity=recent, **kw)[1], "2 小时内有活动")
        young = lambda path, stop: (now - 5 * HOUR, 0, True)
        self.assertEqual(hr.decide("/r/young", in_use=set(), activity=young, **kw)[1], "未超过闲置期限")
        self.assertEqual(hr.decide("/r/old", in_use={"/r/old/sub/file"}, activity=idle, **kw)[0], "keep")
        self.assertEqual(hr.decide("/r/old", in_use={"/r/older"}, activity=idle, **kw)[0], "delete")  # 只按路径段匹配
        self.assertEqual(hr.decide("/r/abc123", in_use=set(), activity=idle, now=now, grace=2 * HOUR, max_idle=DAY,
                                   jobs={"abc123"})[1], "CI 队列中未结束的任务")


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(lambda: hr.remove(self.tmp))
        self.now = time.time()
        self.root = os.path.join(self.tmp, "scratch")
        self.policy = dict(grace_seconds=2 * HOUR, roots=[dict(path=self.root, max_idle_seconds=DAY),
                                                         dict(path=os.path.join(self.tmp, "absent"), max_idle_seconds=DAY)])

    def facts(self, in_use=(), incomplete=0, jobs=()):
        return dict(in_use=set(in_use), incomplete=incomplete, jobs=set(jobs))

    def build(self):
        n = self.now
        touch(os.path.join(self.root, "old", "a", "f"), 3 * DAY, n)
        age_dir(os.path.join(self.root, "old", "a"), 3 * DAY, n)
        age_dir(os.path.join(self.root, "old"), 3 * DAY, n)
        # 深层文件 1 小时前写过：整个子项保留
        touch(os.path.join(self.root, "deep", "x", "y", "f"), HOUR, n)
        for d in ("deep/x/y", "deep/x", "deep"):
            age_dir(os.path.join(self.root, d), 3 * DAY, n)
        touch(os.path.join(self.root, "held", "f"), 3 * DAY, n)
        age_dir(os.path.join(self.root, "held"), 3 * DAY, n)
        touch(os.path.join(self.root, "old.log"), 3 * DAY, n)
        # 只读的 go module cache 形态
        ro = os.path.join(self.root, "gomod", "pkg")
        touch(os.path.join(ro, "f"), 3 * DAY, n)
        os.chmod(os.path.join(ro, "f"), 0o444)
        os.chmod(ro, 0o555)
        age_dir(ro, 3 * DAY, n)
        age_dir(os.path.join(self.root, "gomod"), 3 * DAY, n)
        # 指向根外的软链接：只删链接，目标保留
        outside = os.path.join(self.tmp, "outside")
        touch(os.path.join(outside, "keep"), 3 * DAY, n)
        os.symlink(outside, os.path.join(self.root, "link"))
        os.utime(os.path.join(self.root, "link"), (n - 3 * DAY, n - 3 * DAY), follow_symlinks=False)
        return outside

    def test_deletes_only_idle_unused_entries(self):
        outside = self.build()
        report = hr.run(self.policy, dry_run=False, now=self.now,
                        facts=self.facts(in_use=[os.path.join(self.root, "held", "f")]))
        self.assertEqual(sorted(os.path.basename(d["path"]) for d in report["deleted"]),
                         ["gomod", "link", "old", "old.log"])
        self.assertEqual(sorted(os.listdir(self.root)), ["deep", "held"])
        self.assertTrue(os.path.isfile(os.path.join(outside, "keep")))
        self.assertEqual(report["roots"][1]["state"], "缺失或不是规范目录，跳过")
        self.assertGreater(report["freed_bytes"], 0)

    def test_dry_run_deletes_nothing(self):
        self.build()
        before = sorted(os.listdir(self.root))
        report = hr.run(self.policy, dry_run=True, now=self.now, facts=self.facts())
        self.assertEqual(sorted(os.listdir(self.root)), before)
        self.assertIn(os.path.join(self.root, "held"), [d["path"] for d in report["deleted"]])

    def test_incomplete_facts_abort_the_round(self):
        self.build()
        before = sorted(os.listdir(self.root))
        report = hr.run(self.policy, dry_run=False, now=self.now, facts=self.facts(incomplete=1))
        self.assertIn("本轮不删除", report["aborted"])
        self.assertEqual(sorted(os.listdir(self.root)), before)

    def test_a_symlinked_root_is_skipped(self):
        self.build()
        os.symlink(self.root, os.path.join(self.tmp, "alias"))
        policy = dict(self.policy, roots=[dict(path=os.path.join(self.tmp, "alias"), max_idle_seconds=DAY)])
        report = hr.run(policy, dry_run=False, now=self.now, facts=self.facts())
        self.assertEqual(report["deleted"], [])
        self.assertIn("old", os.listdir(self.root))


class Cap(unittest.TestCase):
    def test_over_the_cap_deletes_least_recently_used_unheld_entries(self):
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "slot1")
            for name, age in (("clippy", 3 * HOUR), ("test", 30 * 60), ("check", 5 * HOUR), ("held", 9 * HOUR)):
                touch(os.path.join(root, name, "blob"), age, now, text="x" * (2 << 20))
                age_dir(os.path.join(root, name), age, now)
            policy = dict(grace_seconds=2 * HOUR,
                          roots=[dict(path=root, max_idle_seconds=3 * DAY, max_bytes=1 << 30)])
            facts = dict(in_use={os.path.join(root, "held", "blob")}, incomplete=0, jobs=set())
            # The cap is 1 GiB, far above these 2 MiB entries: nothing goes.
            self.assertEqual(hr.run(policy, dry_run=False, now=now, facts=facts)["deleted"], [])
            # Pretend the cap is 5 MiB (below load_policy's floor, so call cap_root directly): the oldest unheld go
            # first until the rest fit; the held entry stays although it is the oldest.
            report = dict(deleted=[], kept=[], freed_bytes=0)
            hr.cap_root(root, 5 << 20, report, facts, dry_run=False)
            self.assertEqual([os.path.basename(d["path"]) for d in report["deleted"]], ["check", "clippy"])
            self.assertEqual(sorted(os.listdir(root)), ["held", "test"])

    def test_a_root_whose_lock_is_held_is_skipped(self):
        import fcntl
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "slot1")
            touch(os.path.join(root, "old", "blob"), 5 * DAY, now)
            age_dir(os.path.join(root, "old"), 5 * DAY, now)
            lock = os.path.join(tmp, "slot1.lock")
            policy = dict(grace_seconds=2 * HOUR, roots=[dict(path=root, max_idle_seconds=3 * DAY, lock=lock)])
            facts = dict(in_use=set(), incomplete=0, jobs=set())
            with open(lock, "a") as held:  # a running check job
                fcntl.flock(held, fcntl.LOCK_EX)
                report = hr.run(policy, dry_run=False, now=now, facts=facts)
                self.assertEqual(report["deleted"], [])
                self.assertIn("锁被占用", report["roots"][0]["state"])
            report = hr.run(policy, dry_run=False, now=now, facts=facts)  # job finished
            self.assertEqual([os.path.basename(d["path"]) for d in report["deleted"]], ["old"])

    def test_a_cap_below_one_gib_is_refused(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(dict(grace_seconds=7200, roots=[dict(path="/a", max_idle_seconds=DAY, max_bytes=1024)]), handle)
        self.addCleanup(os.unlink, handle.name)
        with self.assertRaises(hr.RetentionError):
            hr.load_policy(handle.name)


class Activity(unittest.TestCase):
    def test_file_atime_counts_directory_atime_does_not(self):
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            f = os.path.join(tmp, "e", "f")
            touch(f, 3 * DAY, now)
            os.utime(f, (now - 10, now - 3 * DAY))  # 只被读取过
            age_dir(os.path.join(tmp, "e"), 3 * DAY, now)
            newest, _, _ = hr.entry_activity(os.path.join(tmp, "e"))
            self.assertGreater(newest, now - 60)
            os.utime(f, (now - 3 * DAY, now - 3 * DAY))
            os.utime(os.path.join(tmp, "e"), (now - 10, now - 3 * DAY))  # 目录被列出过
            newest, _, _ = hr.entry_activity(os.path.join(tmp, "e"))
            self.assertLess(newest, now - 2 * DAY)


class BuildCache(unittest.TestCase):
    def test_per_builder_keep_storage(self):
        policy = dict(docker_build_cache=dict(keep_storage="60GB",
                                              builders=["default", dict(name="kailo-builder", keep_storage="160GB")]))
        report = {}
        hr.prune_build_cache(policy, report, dry_run=True)
        self.assertEqual([(i["builder"], i["keep_storage"]) for i in report["build_cache"]],
                         [("default", "60GB"), ("kailo-builder", "160GB")])

    def test_prune_caps_used_space(self):
        # buildx 0.38: --keep-storage is the old name of --reserved-space and on its own deletes nothing, so the cap
        # must be passed as --max-used-space. A stand-in docker executable records the arguments it is run with.
        with tempfile.TemporaryDirectory() as tmp:
            log, exe = os.path.join(tmp, "argv"), os.path.join(tmp, "docker")
            with open(exe, "w") as script:
                script.write(f'#!/bin/sh\necho "$*" >> {log}\n')
            os.chmod(exe, 0o755)
            saved, hr.DOCKER = hr.DOCKER, [exe]
            try:
                report = {}
                hr.prune_build_cache(dict(docker_build_cache=dict(keep_storage="10GB", builders=["default"])),
                                     report, dry_run=False)
            finally:
                hr.DOCKER = saved
            with open(log) as recorded:
                self.assertEqual(recorded.read().split(), "buildx prune --force --builder default --max-used-space 10GB".split())
            self.assertEqual(report["build_cache"][0]["state"], "ok")


class SupersededImages(unittest.TestCase):
    def test_keeps_used_recent_and_newest_tags(self):
        now = 1_000 * DAY
        img = lambda ref, age, iid=None: dict(ref=ref, id=iid or ref, created=now - age)
        images = [img("kailo/backend:a", 1 * HOUR), img("kailo/backend:b", 2 * DAY), img("kailo/backend:c", 3 * DAY),
                  img("kailo/backend:d", 4 * DAY), img("kailo/backend:e", 5 * DAY, "sha256:e"),
                  img("local/kailo-macro-check:x", 9 * DAY), img("redis:7", 99 * DAY), img("golang:1", 99 * DAY)]
        used = {"kailo/backend:d", "sha256:e"}
        self.assertEqual(hr.superseded_images(images, used, prefixes=["kailo/", "local/kailo-macro-"], keep_newest=2,
                                              min_age=DAY, now=now),
                         ["kailo/backend:c"])

    def test_only_the_newest_is_kept_with_keep_newest_one(self):
        now = 1_000 * DAY
        images = [dict(ref="kailo/x:1", id="1", created=now - 2 * DAY), dict(ref="kailo/x:2", id="2", created=now - 3 * DAY)]
        self.assertEqual(hr.superseded_images(images, set(), prefixes=["kailo/"], keep_newest=1, min_age=DAY, now=now),
                         ["kailo/x:2"])


if __name__ == "__main__":
    unittest.main()
