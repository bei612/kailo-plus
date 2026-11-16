#!/usr/bin/env python3
"""Passive resource observer for budget calibration (OPS-05, CI-CD 手册「资源预算」). Read-only: samples cgroup v2 files
of the Kailo dockerd's CI and build containers and the host, never starts or changes anything.

  observe.py --out <dir> [--hours N] [--interval 5]

Every --interval seconds: memory.current / memory.peak / shmem / anon of every container named kci-* or buildx_buildkit_*
(found under /sys/fs/cgroup/kailo.slice), the slices kailo, kailo-ci, kailo-prod, host MemAvailable, free space of the
NVMe root, the CI cache filesystem (ci-fs) and the 4T disk. Every 10 minutes the size of each cargo target slot (du at
idle IO priority). Writes <out>/samples.jsonl (one line per minute: maxima over the minute) and <out>/containers.jsonl
(one line per container when it disappears: its peaks). Used to calibrate CHECK_MEMORY, CHECK_POSTGRES_TMPFS/MEMORY,
the slot cap and the builder memory with >= 30% headroom; check.sh and up.sh record the same peaks per job afterwards.
"""
import argparse
import json
import os
import subprocess
import time

DOCKER = ["docker", "-H", "unix:///run/kailo-docker/docker.sock"]
SLICES = {"kailo": "/sys/fs/cgroup/kailo.slice", "ci": "/sys/fs/cgroup/kailo.slice/kailo-ci.slice",
          "prod": "/sys/fs/cgroup/kailo.slice/kailo-prod.slice"}
DISKS = {"nvme": "/", "cifs": "/var/lib/kailo-ci/ci-fs", "hdd": "/volumes/data"}
SLOTS = "/var/lib/kailo-ci/check-target/kailo-macro"


def read_int(path):
    try:
        with open(path) as f:
            return int(f.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def stat(path):
    try:
        with open(os.path.join(path, "memory.stat")) as f:
            return {k: int(v) for k, v in (line.split() for line in f)}
    except (OSError, ValueError):
        return {}


def find_scope(cid):
    for root, dirs, _ in os.walk("/sys/fs/cgroup/kailo.slice"):
        name = f"docker-{cid}.scope"
        if name in dirs:
            return os.path.join(root, name)
        if root.count("/") > 6:
            dirs[:] = []
    return None


def containers():
    r = subprocess.run(DOCKER + ["ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"], capture_output=True, text=True)
    out = {}
    for line in r.stdout.splitlines():
        cid, name = line.split(" ", 1)
        if name.startswith(("kci-", "kailo-dev-check", "buildx_buildkit_")):
            out[cid] = name
    return out


def du(path):
    r = subprocess.run(["ionice", "-c3", "nice", "-n19", "du", "-sx", "--block-size=1", path], capture_output=True, text=True)
    try:
        return int(r.stdout.split()[0])
    except (IndexError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--hours", type=float, default=48)
    ap.add_argument("--interval", type=float, default=5)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    end = time.time() + a.hours * 3600
    tracked = {}   # cid -> dict(name, scope, first, peak_current, peak_shmem, peak_anon, kernel_peak)
    minute, last_ps, last_du, slot_sizes = {}, 0, 0, {}
    while time.time() < end:
        now = time.time()
        if now - last_ps >= 20:
            live = containers()
            for cid, name in live.items():
                if cid not in tracked:
                    scope = find_scope(cid)
                    if scope:
                        tracked[cid] = dict(name=name, scope=scope, first=now, peak_current=0, peak_shmem=0,
                                            peak_anon=0, kernel_peak=None, start_kernel_peak=read_int(scope + "/memory.peak"))
            for cid in [c for c in tracked if c not in live]:
                t = tracked.pop(cid)
                t.update(last=now, scope=None)
                with open(os.path.join(a.out, "containers.jsonl"), "a") as f:
                    f.write(json.dumps(t) + "\n")
            last_ps = now
        for cid, t in tracked.items():
            cur = read_int(t["scope"] + "/memory.current")
            if cur is None:
                continue
            s = stat(t["scope"])
            t["peak_current"] = max(t["peak_current"], cur)
            t["peak_shmem"] = max(t["peak_shmem"], s.get("shmem", 0))
            t["peak_anon"] = max(t["peak_anon"], s.get("anon", 0))
            t["kernel_peak"] = read_int(t["scope"] + "/memory.peak")
            t["limit"] = read_int(t["scope"] + "/memory.max")
        sample = {"t": int(now)}
        with open("/proc/meminfo") as f:
            info = {l.split(":")[0]: int(l.split()[1]) * 1024 for l in f}
        sample["mem_available"] = info["MemAvailable"]
        for k, p in SLICES.items():
            s = stat(p)
            sample[f"{k}_current"] = read_int(p + "/memory.current")
            sample[f"{k}_anon"] = s.get("anon")
            sample[f"{k}_shmem"] = s.get("shmem")
        for k, p in DISKS.items():
            try:
                st = os.statvfs(p)
                sample[f"{k}_used"] = (st.f_blocks - st.f_bfree) * st.f_frsize
                sample[f"{k}_total"] = st.f_blocks * st.f_frsize
            except OSError:
                pass
        if now - last_du >= 600:
            for slot in sorted(os.listdir(SLOTS)) if os.path.isdir(SLOTS) else []:
                if os.path.isdir(os.path.join(SLOTS, slot)):
                    slot_sizes[slot] = du(os.path.join(SLOTS, slot))
            last_du = now
        for k, v in slot_sizes.items():
            sample[f"target_{k}"] = v
        for cid, t in tracked.items():
            sample[f"c:{t['name']}"] = [t.get("peak_current"), t.get("peak_shmem")]
        key = int(now // 60)
        if minute and minute.get("_key") != key:
            minute.pop("_key", None)
            with open(os.path.join(a.out, "samples.jsonl"), "a") as f:
                f.write(json.dumps(minute) + "\n")
            minute = {}
        for k, v in sample.items():
            if k in ("mem_available",):
                minute[k] = v if k not in minute else min(minute[k], v)
            elif isinstance(v, (int, float)) and k != "t":
                minute[k] = v if k not in minute or minute[k] is None else max(minute[k], v)
            else:
                minute[k] = v
        minute["_key"] = key
        time.sleep(a.interval)
    for cid, t in tracked.items():
        with open(os.path.join(a.out, "containers.jsonl"), "a") as f:
            f.write(json.dumps(dict(t, last=time.time(), scope=None, still_running=True)) + "\n")


if __name__ == "__main__":
    main()
