#!/usr/bin/env python3
"""从追溯记录生成能力注册表（06-工程基线规范.md §3）。

注册表是生成物，不手工编辑。它是路由、菜单、Action、Tool、Workflow kind
与 manifest 的唯一准入来源——运行时只认注册表，不认代码里的分支。

本脚本同时执行 §3 的四个构建期拒绝条件；任一命中即以非零码退出，
不产出注册表。封闭 kind 列表从 .design/06 直接读取，不在此处再抄一份。
"""
import glob
import os
import re
import sys

import yaml

DESIGN = os.environ.get("DESIGN", "../.design")
OUT = "tools/registry/capabilities.yaml"


def closed_workflow_kinds() -> set[str]:
    """从 .design/06 提取封闭 ComponentTaskWorkflow kind 集合。"""
    text = open(glob.glob(f"{DESIGN}/06-*.md")[0], encoding="utf-8").read()
    kinds: set[str] = set()
    for group in re.findall(r"kind=([A-Z_|\\\\]+)", text):
        for k in group.replace("\\", "").split("|"):
            if k:
                kinds.add(k)
    return kinds


def excluded_ids() -> set[str]:
    """`.design/02` 中判为 EXCLUDED 的能力标识。"""
    text = open(glob.glob(f"{DESIGN}/02-*.md")[0], encoding="utf-8").read()
    return set(re.findall(r"`([a-z][a-z0-9.]*\.[a-z0-9.]+)`[^|]*EXCLUDED", text))


def assigned_ids() -> set[str]:
    """`05-设计覆盖矩阵.md` 中已归属 Stage 的能力标识。"""
    text = open(glob.glob("05-*.md")[0], encoding="utf-8").read()
    return set(re.findall(r"`([a-z][a-z0-9]*(?:\.[a-z0-9_]+)+)`", text))


def main() -> int:
    kinds, excluded, assigned = closed_workflow_kinds(), excluded_ids(), assigned_ids()
    records = sorted(glob.glob("tools/traceability/*.yaml"))
    caps, bad = [], []

    for f in records:
        r = yaml.safe_load(open(f, encoding="utf-8")) or {}
        cid = r.get("capability_id") or os.path.basename(f)
        design = r.get("design") or {}
        runtime = r.get("runtime") or {}

        # 条件 1：blockers 非空的能力不得进入注册表
        if design.get("blockers"):
            bad.append(f"{cid}: blockers 非空，不得进入注册表")
            continue
        # 条件 2：.design 判为 EXCLUDED 的能力不得进入
        if cid in excluded:
            bad.append(f"{cid}: .design 判为 EXCLUDED，不得进入注册表")
            continue
        # 条件 3：workflow_kinds 必须全在 .design/06 的封闭列表中
        for k in runtime.get("workflow_kinds") or []:
            if k not in kinds:
                bad.append(f"{cid}: workflow_kind {k} 不在 .design/06 的封闭列表中")
        # 条件 4：id 必须已在覆盖矩阵中归属
        if assigned and cid not in assigned:
            bad.append(f"{cid}: 未在 05-设计覆盖矩阵.md 中归属")

        caps.append({
            "id": cid,
            "exposure": r.get("exposure"),
            "routes": runtime.get("routes") or [],
            "actions": runtime.get("actions") or [],
            "tools": runtime.get("tools") or [],
            "workflow_kinds": runtime.get("workflow_kinds") or [],
        })

    if bad:
        for b in bad:
            print(f"    {b}", file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("# 生成物，不手工编辑。由 tools/gen-registry.py 从 tools/traceability/ 生成。\n")
        yaml.safe_dump({"capabilities": caps}, fh, allow_unicode=True, sort_keys=False)
    print(f"    {len(caps)} 条能力，{len(kinds)} 个封闭 workflow kind 参与校验")
    return 0


if __name__ == "__main__":
    sys.exit(main())
