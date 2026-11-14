#!/usr/bin/env python3
"""Monthly storage tier report (OPS-03, CI-CD 手册「存储分层」): usage per tier against the caps in policy.json "tiers".

NVMe holds only latency-critical random-IO data, the 4T HDD capacity/sequential data, tmpfs only ephemeral data.
The report lists each declared path with its size and cap, the free space of each tier, the BuildKit cache against its
cap, the shmem (tmpfs) held in the Kailo slice, and flags: a path over its cap, a tier under its free-space floor,
and any directory under the NVMe watch roots that is not declared and exceeds `undeclared_bytes` (an uncapped cache).
Writes <report_dir>/<YYYY-MM>.json and prints a summary; exit status 1 when anything is flagged. Read-only.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

UNITS = {"K": 2**10, "M": 2**20, "G": 2**30, "T": 2**40}


def size_of(text):
    if text is None:
        return None
    text = str(text).strip().upper().rstrip("B")
    return int(float(text[:-1]) * UNITS[text[-1]]) if text[-1:] in UNITS else int(text)


def du(path):
    r = subprocess.run(["du", "-sx", "--block-size=1", path], capture_output=True, text=True)
    try:
        return int(r.stdout.split()[0])
    except (IndexError, ValueError):
        return None


def human(n):
    if n is None:
        return "?"
    for unit in ("T", "G", "M", "K"):
        if n >= UNITS[unit]:
            return f"{n / UNITS[unit]:.1f}{unit}"
    return str(n)


def build_cache_bytes():
    r = subprocess.run(["docker", "system", "df", "--format", "{{json .}}"], capture_output=True, text=True)
    for line in r.stdout.splitlines():
        row = json.loads(line)
        if row.get("Type") == "Build Cache":
            return size_of(row.get("Size", "0B").replace("B", "") or "0")
    return None


def shmem(group):
    try:
        with open(os.path.join(group, "memory.stat")) as source:
            return int(dict(line.split() for line in source).get("shmem", 0))
    except (OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--policy", default=os.path.join(os.path.dirname(os.path.realpath(__file__)), "policy.json"))
    args = parser.parse_args()
    tiers = json.load(open(args.policy))["tiers"]
    flags, report = [], {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "tiers": {}}
    for name, tier in tiers["disks"].items():
        st = os.statvfs(tier["mount"])
        total, free = st.f_blocks * st.f_frsize, st.f_bavail * st.f_frsize
        entry = {"mount": tier["mount"], "total": total, "free": free, "paths": []}
        if free * 100 < total * tier.get("min_free_pct", 0):
            flags.append(f"{name}: free {human(free)} under {tier['min_free_pct']}% of {human(total)}")
        declared = set()
        for item in tier.get("paths", []):
            declared.add(os.path.realpath(item["path"]))
            used = du(item["path"]) if os.path.exists(item["path"]) else None
            cap = size_of(item.get("cap"))
            entry["paths"].append({"path": item["path"], "bytes": used, "cap": cap, "role": item.get("role", "")})
            if cap is not None and used is not None and used > cap:
                flags.append(f"{name}: {item['path']} {human(used)} over cap {human(cap)}")
        for root in tier.get("watch_roots", []):
            for child in sorted(os.listdir(root)) if os.path.isdir(root) else []:
                path = os.path.join(root, child)
                real = os.path.realpath(path)
                if real in declared or any(real.startswith(d + os.sep) or d.startswith(real + os.sep) for d in declared):
                    continue
                if os.path.ismount(path) or not os.path.isdir(path):
                    continue
                used = du(path)
                if used is not None and used > size_of(tiers.get("undeclared_bytes", "5G")):
                    flags.append(f"{name}: undeclared {path} {human(used)} (uncapped)")
                    entry["paths"].append({"path": path, "bytes": used, "cap": None, "role": "undeclared"})
        report["tiers"][name] = entry
    cache, cache_cap = build_cache_bytes(), size_of(tiers.get("build_cache_cap"))
    report["build_cache"] = {"bytes": cache, "cap": cache_cap}
    if cache is not None and cache_cap is not None and cache > cache_cap:
        flags.append(f"BuildKit cache {human(cache)} over cap {human(cache_cap)}")
    report["tmpfs_shmem"] = {g: shmem(g) for g in tiers.get("tmpfs_groups", [])}
    report["flags"] = flags
    os.makedirs(tiers["report_dir"], exist_ok=True)
    out = os.path.join(tiers["report_dir"], f"{report['at'][:7]}.json")
    with open(out + ".tmp", "w") as sink:
        json.dump(report, sink, indent=1)
    os.replace(out + ".tmp", out)
    for name, entry in report["tiers"].items():
        print(f"{name} ({entry['mount']}): free {human(entry['free'])} of {human(entry['total'])}")
        for p in entry["paths"]:
            print(f"  {human(p['bytes']):>7} / {human(p['cap']) if p['cap'] else '-':>7}  {p['path']}  {p['role']}")
    print(f"BuildKit cache {human(cache)} / {human(cache_cap)}; tmpfs (shmem) " +
          ", ".join(f"{g}: {human(v)}" for g, v in report["tmpfs_shmem"].items()))
    print("flags: " + ("; ".join(flags) if flags else "none") + f"\nreport: {out}")
    return 1 if flags else 0


if __name__ == "__main__":
    sys.exit(main())
