#!/usr/bin/env python3
"""kailo-ci client (runs inside kailo-ci-control; /usr/local/bin/kailo-ci execs it via `docker exec`).

Exit codes: 0 ok; wait: 0 SUCCEEDED, 1 FAILED/CANCELLED/UNKNOWN, 124 timeout (job keeps running); 2 usage/refusal.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kci import ACTIVE, CHECK_STEPS, DEFAULT_REPO, TERMINAL, CIError, Queue, load_config  # noqa: E402


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True))


def cmd_submit(q, a):
    print(q.submit(a.commit, a.stage, a.targets, repo=a.repo))


def cmd_check_step(q, a):
    print(q.submit(a.commit, "check-step", [a.step], repo=a.repo))


def cmd_gen(q, a):
    print(q.submit(a.commit, "gen", repo=a.repo))


def cmd_status(q, a):
    out(q.read(q.resolve(a.job)))


def cmd_wait(q, a):
    job = q.resolve(a.job)
    deadline = time.monotonic() + a.timeout
    while True:
        status = q.read(job)
        if status.get("state") in TERMINAL:
            out(status)
            return 0 if status["state"] == "SUCCEEDED" else 1
        if time.monotonic() >= deadline:
            out(status)
            return 124
        time.sleep(3)


def cmd_logs(q, a):
    path = os.path.join(q.job_dir(q.resolve(a.job)), "log.txt")
    with open(path, encoding="utf-8", errors="replace") as source:
        lines = source.readlines()
    sys.stdout.write("".join(lines[-a.tail:] if a.tail else lines))


def cmd_list(q, a):
    rows = []
    for job in q.all_ids(archived=a.all):
        s = q.read(job)
        s.setdefault("repo", DEFAULT_REPO)
        if a.repo and s["repo"] != a.repo:
            continue
        if a.all or s.get("state") in ACTIVE or s.get("state") == "UNKNOWN":
            rows.append({k: s.get(k) for k in ("job", "repo", "commit", "stage", "targets", "state", "started_at",
                                               "reason", "archived")})
    out(rows)


def cmd_cancel(q, a):
    job = q.resolve(a.job)
    status = q.read(job)
    if status.get("state") in TERMINAL:
        out(status)
        return
    if status.get("state") == "DEPLOYING":
        raise CIError("部署中的任务不能取消")
    with q.lock():
        removed = False
        for lane_dir in q.pending.values():
            request = os.path.join(lane_dir, f"{job}.json")
            if os.path.exists(request):
                os.remove(request)
                removed = True
        if removed:
            status = q.update(job, state="CANCELLED", reason="排队中取消", finished_at=time.time())
        else:
            open(os.path.join(q.job_dir(job), "cancel"), "w").close()
            status = q.update(job, cancel_requested=True)
    out(status)


def cmd_retry(q, a):
    job = q.resolve(a.job)
    s = q.read(job)
    if s.get("state") not in ("FAILED", "CANCELLED") or s.get("stage") == "deploy":
        raise CIError("只能重试 FAILED/CANCELLED 的非部署任务")
    print(q.submit(s["commit"], s["stage"], s.get("targets") or [], extra=dict(retry_of=job),
                   repo=s.get("repo", DEFAULT_REPO)))


def cmd_artifact(q, a):
    job = q.resolve(a.job)
    s = q.read(job)
    if s.get("stage") != "gen" or s.get("state") != "SUCCEEDED" or not s.get("artifact"):
        raise CIError("只有成功的 gen 任务有可下载产物")
    path = s["artifact"]["path"]
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    if digest.hexdigest() != s["artifact"]["sha256"]:
        raise CIError("产物 SHA-256 与登记值不符，拒绝输出")
    with open(path, "rb") as source:
        shutil.copyfileobj(source, sys.stdout.buffer)


def cmd_clean(q, a):
    cutoff = time.time() - a.older_than_days * 86400
    victims = []
    for job in q.all_ids():
        s = q.read(job)
        if s.get("state") in TERMINAL and s.get("state") != "UNKNOWN" and (s.get("finished_at") or 0) < cutoff:
            victims.append(job)
    if a.apply:
        with q.lock():
            for job in victims:
                q.update(job, archived=True)
                os.replace(os.path.join(q.jobs, job), os.path.join(q.archive, job))
    out(dict(apply=a.apply, archived=victims))


def cmd_handoff(q, a):
    path = os.path.join(os.path.dirname(q.cfg.get("config_path", "/volumes/kailo/ci/config.json")), "handoff.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as source:
            items = json.load(source)
        if a.repo and isinstance(items, list):
            items = [i for i in items if not isinstance(i, dict) or i.get("repo", DEFAULT_REPO) == a.repo]
        out(items)
    else:
        out([])


def parser():
    p = argparse.ArgumentParser(prog="kailo-ci")
    p.add_argument("--repo", default=None,
                   help=f"仓库名（默认 {DEFAULT_REPO}；list/handoff 不带时显示全部）")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("submit"); s.add_argument("commit"); s.add_argument("stage"); s.add_argument("targets", nargs="*")
    s.set_defaults(fn=cmd_submit)
    s = sub.add_parser("check-step"); s.add_argument("commit"); s.add_argument("step", help=f"{DEFAULT_REPO}: {', '.join(CHECK_STEPS)}；其他仓库见其 check_steps")
    s.set_defaults(fn=cmd_check_step)
    s = sub.add_parser("gen"); s.add_argument("commit"); s.set_defaults(fn=cmd_gen)
    s = sub.add_parser("artifact"); s.add_argument("job"); s.set_defaults(fn=cmd_artifact)
    s = sub.add_parser("status"); s.add_argument("job"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("logs"); s.add_argument("job"); s.add_argument("--tail", type=int, default=0)
    s.set_defaults(fn=cmd_logs)
    s = sub.add_parser("wait"); s.add_argument("job"); s.add_argument("--timeout", type=int, required=True)
    s.set_defaults(fn=cmd_wait)
    s = sub.add_parser("list"); s.add_argument("--all", action="store_true"); s.set_defaults(fn=cmd_list)
    s = sub.add_parser("cancel"); s.add_argument("job"); s.set_defaults(fn=cmd_cancel)
    s = sub.add_parser("retry"); s.add_argument("job"); s.set_defaults(fn=cmd_retry)
    s = sub.add_parser("clean"); s.add_argument("--apply", action="store_true")
    s.add_argument("--older-than-days", type=int, default=7); s.set_defaults(fn=cmd_clean)
    s = sub.add_parser("handoff"); s.set_defaults(fn=cmd_handoff)
    for name in ("submit", "check-step", "gen", "list", "handoff"):  # `--repo` also accepted after the subcommand
        sub.choices[name].add_argument("--repo", default=argparse.SUPPRESS)
    return p


def main(argv=None):
    a = parser().parse_args(argv)
    if a.cmd == "submit" and a.stage == "check-step":
        if len(a.targets) != 1:
            print("kailo-ci: check-step 需要且只能有一个步骤", file=sys.stderr)
            return 2
        a.cmd, a.step = "check-step", a.targets[0]
        a.fn = cmd_check_step
    if a.cmd == "submit" and a.stage == "gen":
        a.fn = cmd_gen
    try:
        q = Queue(load_config())
        rc = a.fn(q, a)
        return rc or 0
    except CIError as error:
        print(f"kailo-ci: {error}", file=sys.stderr)
        return error.code


if __name__ == "__main__":
    sys.exit(main())
