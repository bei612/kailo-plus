#!/usr/bin/env python3
"""CI 节点热目录的定时保留（07 §2.1）。由 systemd timer（kailo-ci-hot-retention.timer，每小时）以 root 执行：

  hot-retention.py --policy policy.json [--dry-run] [--json]

对 policy.json 声明的每个根（~/scratch、~/branch-core、/var/lib/kailo-ci/tmp、/var/lib/kailo-ci/branch、检查缓存），逐个判定其
直接子项：
  保留  任一文件 grace_seconds（2 小时）内有变化；或有进程以其为工作目录/根/可执行文件、打开或映射其中文件；
        或有容器（含已停止的）以其中路径为挂载来源；或名字是 CI 队列中未结束任务的 ID；或闲置未超过该根的 max_idle_seconds
  删除  其余（目录整体删除，软链接只删链接本身，不跟随）
活动时间：目录与软链接取 mtime，普通文件取 mtime 与 atime 的较新者（relatime 下读取每天至多更新一次 atime，
缓存只被读取也算活动；本程序只做 lstat 与列目录，不读文件内容）。

安全：进程或容器事实读不全（非 root 运行、docker 不可用）即整轮不删除；根必须是规范绝对路径且不是软链接；每个子项
在删除前重新判定。同一时刻只运行一份（flock）。输出不含文件内容，只有路径、大小与原因。
"""

import argparse
import fcntl
import json
import os
import shutil
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
DOCKER = ["docker"]
LOCK = "/run/lock/kailo-ci-hot-retention.lock"
ACTIVE_JOB_STATES = ("QUEUED", "RUNNING", "DEPLOYING")


class RetentionError(Exception):
    pass


def load_policy(path):
    with open(path, encoding="utf-8") as stream:
        policy = json.load(stream)
    grace = policy.get("grace_seconds")
    roots = policy.get("roots")
    if not isinstance(grace, int) or grace < 3600 or not isinstance(roots, list) or not roots:
        raise RetentionError("policy：grace_seconds 必须是不少于 3600 的整数，roots 必须非空")
    seen = set()
    for root in roots:
        p, idle = root.get("path"), root.get("max_idle_seconds")
        if not isinstance(p, str) or not p.startswith("/") or os.path.normpath(p) != p or p in seen:
            raise RetentionError(f"policy：根 {p!r} 必须是唯一的规范绝对路径")
        if not isinstance(idle, int) or idle < grace:
            raise RetentionError(f"policy：{p} 的 max_idle_seconds 不得小于 grace_seconds")
        seen.add(p)
    if any(a != b and b.startswith(a + "/") for a in seen for b in seen):
        raise RetentionError("policy：根之间不得相互包含")
    return policy


def entry_activity(path, stop_at=None):
    """子项内最新的活动时间与占用字节（lstat，不跟随软链接）。stop_at 给定时，一旦发现不早于它的活动即提前返回。"""
    newest, size = 0.0, 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            continue
        size += getattr(info, "st_blocks", 0) * 512
        when = max(info.st_mtime, info.st_atime) if stat.S_ISREG(info.st_mode) else info.st_mtime
        newest = max(newest, when)
        if stop_at is not None and newest >= stop_at:
            return newest, size, True
        if stat.S_ISDIR(info.st_mode):
            try:
                with os.scandir(current) as it:
                    stack.extend(e.path for e in it)
            except (FileNotFoundError, NotADirectoryError):
                continue
    return newest, size, False


def _under(path, base):
    return path == base or path.startswith(base.rstrip("/") + "/")


def process_paths(proc="/proc"):
    """全部进程的工作目录、根、可执行文件、打开的文件与映射文件（宿主路径）。读不到其他用户的进程即报告不完整。"""
    paths, incomplete = set(), 0
    for pid in os.listdir(proc):
        if not pid.isdigit():
            continue
        base = os.path.join(proc, pid)
        for name in ("cwd", "root", "exe"):
            try:
                paths.add(os.readlink(os.path.join(base, name)))
            except (FileNotFoundError, ProcessLookupError):
                pass
            except PermissionError:
                incomplete += 1
        try:
            for fd in os.listdir(os.path.join(base, "fd")):
                try:
                    paths.add(os.readlink(os.path.join(base, "fd", fd)))
                except (FileNotFoundError, ProcessLookupError):
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError:
            incomplete += 1
        try:
            with open(os.path.join(base, "maps"), encoding="utf-8", errors="replace") as stream:
                for line in stream:
                    parts = line.split(None, 5)
                    if len(parts) == 6 and parts[5].startswith("/"):
                        paths.add(parts[5].strip())
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError:
            incomplete += 1
    return {p.removesuffix(" (deleted)") for p in paths if p.startswith("/")}, incomplete


def container_paths():
    """全部容器（含已停止的）的 bind 挂载来源。docker 不可用即抛出：不完整的事实不能用于删除。"""
    r = subprocess.run(DOCKER + ["ps", "-a", "-q", "--no-trunc"], capture_output=True, text=True)
    if r.returncode:
        raise RetentionError("docker ps 失败，无法确认容器挂载")
    ids = r.stdout.split()
    if not ids:
        return set()
    r = subprocess.run(DOCKER + ["inspect", *ids], capture_output=True, text=True)
    if r.returncode:
        # 列表与 inspect 之间有容器被删除：逐个重试，删除的跳过
        found = []
        for cid in ids:
            one = subprocess.run(DOCKER + ["inspect", cid], capture_output=True, text=True)
            if one.returncode == 0:
                found += json.loads(one.stdout)
    else:
        found = json.loads(r.stdout)
    return {m["Source"] for c in found for m in c.get("Mounts") or [] if m.get("Source")}


def active_jobs(ci_config):
    """CI 队列中未结束任务的 ID（其 TMPDIR 子目录以任务 ID 命名）。"""
    if not ci_config or not os.path.isfile(ci_config):
        return set()
    with open(ci_config, encoding="utf-8") as stream:
        queue = json.load(stream).get("queue")
    folder = os.path.join(str(queue or ""), "jobs")
    jobs = set()
    for job in os.listdir(folder) if os.path.isdir(folder) else []:
        try:
            with open(os.path.join(folder, job, "status.json"), encoding="utf-8") as stream:
                if json.load(stream).get("state") in ACTIVE_JOB_STATES:
                    jobs.add(job)
        except (OSError, ValueError):
            continue
    return jobs


def decide(entry, *, now, grace, max_idle, in_use, jobs, activity=entry_activity):
    """一个直接子项的判定 → (动作, 原因, 字节)。动作为 keep 或 delete。纯函数（活动时间由 activity 提供）。"""
    real = os.path.realpath(entry) if not os.path.islink(entry) else entry
    name = os.path.basename(entry)
    if name in jobs:
        return "keep", "CI 队列中未结束的任务", 0
    holders = [p for p in in_use if _under(p, real) or _under(p, entry)]
    if holders:
        return "keep", f"被进程或容器使用（{len(holders)} 处）", 0
    newest, size, stopped = activity(entry, now - max(grace, max_idle))
    if stopped or newest >= now - grace:
        return "keep", "2 小时内有活动" if newest >= now - grace else "未超过闲置期限", 0
    return "delete", f"{int((now - newest) // 3600)} 小时无活动", size


def remove(path):
    """删除一个子项：软链接只删链接；目录整体删除，只读子目录（如 go module cache）先补写权限。"""
    if os.path.islink(path) or not os.path.isdir(path):
        os.unlink(path)
        return

    def fix(func, target, _exc):
        parent = os.path.dirname(target)
        os.chmod(parent, os.lstat(parent).st_mode | stat.S_IWUSR | stat.S_IXUSR)
        if os.path.isdir(target) and not os.path.islink(target):
            os.chmod(target, os.lstat(target).st_mode | stat.S_IWUSR | stat.S_IXUSR)
        func(target)
    shutil.rmtree(path, onerror=fix)


def run(policy, *, dry_run, now=None, facts=None):
    now = time.time() if now is None else now
    grace = policy["grace_seconds"]
    if facts is None:
        procs, incomplete = process_paths()
        try:
            mounts = container_paths()
        except (RetentionError, OSError, ValueError) as error:
            mounts, incomplete = set(), incomplete + 1
            say(f"容器挂载读不全：{error}")
        facts = dict(in_use=procs | mounts, incomplete=incomplete, jobs=active_jobs(policy.get("ci_config")))
    report = dict(at=now, dry_run=dry_run, roots=[], deleted=[], kept=[], freed_bytes=0,
                  incomplete=facts["incomplete"])
    if facts["incomplete"] and not dry_run:
        report["aborted"] = f"进程或容器事实读不全（{facts['incomplete']} 处），本轮不删除"
        return report
    for root in policy["roots"]:
        path = root["path"]
        if not os.path.isdir(path) or os.path.islink(path) or os.path.realpath(path) != path:
            report["roots"].append(dict(path=path, state="缺失或不是规范目录，跳过"))
            continue
        report["roots"].append(dict(path=path, state="已检查"))
        for name in sorted(os.listdir(path)):
            entry = os.path.join(path, name)
            action, reason, size = decide(entry, now=now, grace=grace, max_idle=root["max_idle_seconds"],
                                          in_use=facts["in_use"], jobs=facts["jobs"])
            if action == "keep":
                report["kept"].append(dict(path=entry, reason=reason))
                continue
            if not dry_run:
                try:
                    remove(entry)
                except OSError as error:
                    report["kept"].append(dict(path=entry, reason=f"删除失败：{error.strerror}"))
                    continue
            report["deleted"].append(dict(path=entry, bytes=size, reason=reason))
            report["freed_bytes"] += size
    return report


def say(message):
    print(message, file=sys.stderr, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--policy", default=os.path.join(os.path.dirname(os.path.realpath(__file__)), "policy.json"))
    parser.add_argument("--dry-run", action="store_true", help="只列出将删除的子项，不删除")
    parser.add_argument("--json", action="store_true", help="输出完整 JSON 报告")
    args = parser.parse_args()
    try:
        policy = load_policy(args.policy)
        os.makedirs(os.path.dirname(LOCK), exist_ok=True)
        with open(LOCK if os.access(os.path.dirname(LOCK), os.W_OK) else os.devnull, "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                say("另一轮保留正在执行，跳过")
                return
            report = run(policy, dry_run=args.dry_run)
    except (RetentionError, OSError, ValueError) as error:
        say(f"保留失败：{error}")
        sys.exit(1)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    verb = "将删除" if args.dry_run else "已删除"
    if report.get("aborted"):
        say(report["aborted"])
    elif report["incomplete"]:
        say(f"注意：进程或容器事实读不全（{report['incomplete']} 处）；正式运行将整轮不删除（以 root 运行）")
    for item in report["deleted"]:
        say(f"{verb} {item['path']}（{item['bytes'] / 2**30:.2f} GiB，{item['reason']}）")
    say(f"{verb} {len(report['deleted'])} 项，约 {report['freed_bytes'] / 2**30:.1f} GiB；保留 {len(report['kept'])} 项")


if __name__ == "__main__":
    main()
