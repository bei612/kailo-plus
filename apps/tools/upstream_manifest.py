"""上游 baseline manifest 的唯一解析、校验与摘要算法（06 §2、ADR-06）。

`tools/build-upstream.sh` 按它取源、裁剪、打补丁、写回摘要；`tools/check.sh seam`
按它复核。两边共用这一份：摘要算法或字段含义只在这里定义，不存在「构建这样算、
门禁那样算」的第二份。设计追溯（SF/SS 引用、证据路径）只有门禁需要，留在门禁。

命令行：
  plan <manifest>                  输出可 eval 的 shell 赋值：构建所需的全部字段
  record <manifest> <artifact>     写回按实际字节算出的 patch_series_digest 与产物摘要
"""

import hashlib
import os
import re
import shlex
import sys

import yaml


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _list(m, key):
    return [str(x) for x in (m.get(key) or [])]


def patch_dir(path):
    return os.path.join(os.path.dirname(path), "patches")


def vendor_pairs(m):
    """vendor_files 的每一项是「本仓库相对源:源树相对目标」。"""
    return [tuple(x.partition(":")[::2]) for x in _list(m, "vendor_files")]


def expected_digest(path, m):
    """补丁字节（按 patch_series 顺序）、删除清单与 vendor_files（目标路径与源字节）
    一起进摘要；全为空记 none。

    改了其中任一项——包括 contracts 重新生成——却没重建，产物就不是清单说的那棵树，
    门禁以此发现。
    """
    series, removed, vendored = _list(m, "patch_series"), _list(m, "remove_paths"), vendor_pairs(m)
    if not series and not removed and not vendored:
        return "none"
    h = hashlib.sha256()
    for x in series:
        with open(os.path.join(patch_dir(path), x), "rb") as f:
            h.update(f.read())
    if removed:
        h.update(b"\0remove_paths\0" + "\n".join(removed).encode())
    for src, dst in vendored:
        with open(src, "rb") as f:
            h.update(b"\0vendor_file\0" + dst.encode() + b"\0" + f.read())
    return "sha256:" + h.hexdigest()


def problems(path, m, check_digest=True):
    """清单自身的结构问题。构建前不核摘要：重建正是让摘要与字节重新一致的那一步。"""
    bad = []
    ev, ib = str(m.get("evidence_commit") or ""), str(m.get("implementation_base_commit") or "")
    for name, v in (("evidence_commit", ev), ("implementation_base_commit", ib)):
        if not re.fullmatch(r"[0-9a-f]{40}", v):
            bad.append(f"{name} 不是 40 位 commit")
    # 06 §2 的硬规则：两者不同而声明 none，设计证据会被更高版本悄悄覆盖
    if ev and ib and ev != ib and str(m.get("base_divergence")) == "none":
        bad.append("evidence_commit 与 implementation_base_commit 不同，但 base_divergence 声明为 none")
    # 目录里的补丁与登记的补丁必须一一对应：多一个会被悄悄打进去，少一个构建会缺
    series = _list(m, "patch_series")
    present = {f for f in os.listdir(patch_dir(path)) if f.endswith(".patch")} if os.path.isdir(patch_dir(path)) else set()
    for x in sorted(present - set(series)):
        bad.append(f"patches/{x} 未登记在 patch_series，构建不会应用它")
    missing = sorted(set(series) - present)
    for x in missing:
        bad.append(f"patch_series 登记的 {x} 不存在")
    removed = _list(m, "remove_paths")
    for x in removed:
        if x.startswith("/") or ".." in x.split("/"):
            bad.append(f"remove_paths 只接受源树内的相对路径：{x}")
    if len(set(removed)) != len(removed):
        bad.append("remove_paths 有重复项")
    # vendor_files：本仓库的生成物放进源树，补丁只引用它、不带副本（ADR-02/03）
    for raw in _list(m, "vendor_files"):
        src, sep, dst = raw.partition(":")
        if not sep or not src or not dst or any(q.startswith("/") or ".." in q.split("/") for q in (src, dst)):
            bad.append(f"vendor_files 只接受「本仓库相对源:源树相对目标」：{raw}")
            missing.append(raw)
        elif not os.path.isfile(src):
            bad.append(f"vendor_files 的源 {src} 不存在")
            missing.append(src)
    # 安装包类产物由 Kailo 维护的构建文件产出；登记了却不存在，构建与摘要都无从复核
    bdf = m.get("build_dockerfile")
    if bdf and not os.path.exists(bdf):
        bad.append(f"build_dockerfile 指向不存在的 {bdf}")
    if check_digest and not missing:
        want, got = expected_digest(path, m), str(m.get("patch_series_digest"))
        if got != want:
            bad.append(f"patch_series_digest 为 {got}，按补丁、删除清单与 vendor_files 应为 {want}——改了就必须重建并写回")
    return bad


def plan(path):
    m = load(path)
    bad = problems(path, m, check_digest=False)
    if bad:
        sys.exit("\n".join(f"{path}: {b}" for b in bad))
    q = shlex.quote
    print(f"url={q(str(m['upstream_url']))}")
    print(f"base={q(str(m['implementation_base_commit']))}")
    print(f"ctx={q(str(m.get('build_context') or '.'))}")
    print(f"dockerfile={q(str(m.get('build_dockerfile') or ''))}")
    print(f"patch_dir={q(patch_dir(path))}")
    print("series=(" + " ".join(q(x) for x in _list(m, "patch_series")) + ")")
    print("removed=(" + " ".join(q(x) for x in _list(m, "remove_paths")) + ")")
    print("vendored=(" + " ".join(q(f"{s}:{d}") for s, d in vendor_pairs(m)) + ")")


def record(path, artifact):
    # 只替换这两行：清单里的注释是给人读的记录，不经 YAML 重写
    m = load(path)
    raw = open(path, encoding="utf-8").read()
    for key, value in (("patch_series_digest", expected_digest(path, m)), ("artifact_digest", artifact)):
        raw, n = re.subn(rf"^{key}:.*$", f"{key}: {value}", raw, count=1, flags=re.M)
        if n != 1:
            sys.exit(f"{path}: 缺少 {key} 行")
    with open(path, "w", encoding="utf-8") as f:
        f.write(raw)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "plan" and len(sys.argv) == 3:
        plan(sys.argv[2])
    elif cmd == "record" and len(sys.argv) == 4:
        record(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
