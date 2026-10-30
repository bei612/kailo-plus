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
                                 "/volumes/data/kailo/check-cache"])
        self.assertEqual(policy["grace_seconds"], 2 * HOUR)

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


if __name__ == "__main__":
    unittest.main()
