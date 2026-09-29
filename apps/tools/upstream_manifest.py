"""上游源码树与来源记录的唯一解析、校验与摘要算法（06 §2、ADR-06、04-上游适配与升级.md）。

Kailo 要改或自行构建的上游，把固定 commit 的完整源码放在 upstream/<树>/，直接在里面改、
随仓库提交（不带上游 .git 历史）。每棵树的 kailo/ 目录是 Kailo 自有的文件：
  kailo/upstream.yaml   来源记录：上游仓库、基准 commit、删除路径、vendor_files、产物与摘要
  kailo/verify/         接缝证据
  kailo/packaging/      上游没有而由 Kailo 维护的构建文件
只以 Go module 引用、不改也不自行构建的上游（temporal-sdk-go）只有来源记录，没有源码。

`tools/build-upstream.sh` 按它备好构建输入、写回摘要；`tools/check.sh seam`/`supply` 按它复核。
两边共用这一份：摘要算法或字段含义只在这里定义。设计追溯（SF/SS 引用、证据路径）只有门禁需要，
留在门禁。

命令行（<项目> 是产物短名，例如 buzz-desktop，或树名，例如 buzz）：
  diff <项目> [--stat|--name-status|--check]
        以只读方式取上游原样（.references/<树> 的对象库，没有时从 upstream_url 取），
        与 upstream/<树> 比较，输出 Kailo 改动（kailo/ 目录不在其中）。--check 只核对
        记录里的 remove_paths 与实际整块删除的路径一致。
  added-lines <项目>   Kailo 在该树里新增或改写的行（供 check.sh supply 做凭据扫描）
  plan <产物>          构建所需字段，输出可 eval 的 shell 赋值
  stage <产物> <目录>   把参与构建的源码（按仓库的忽略规则）与 vendor_files 放进空目录
  record <产物> <artifact_digest>
                       写回该产物的 source_digest（按当前源码算）与 artifact_digest
  vendor <项目>        把 vendor_files 放进 upstream/<树> 本身，供在树里直接开发、测试；
                       只覆盖该树 .gitignore 已忽略的目标——被忽略才说明树里不携带副本
"""

import hashlib
import os
import re
import shlex
import shutil
import subprocess
import sys

import yaml

ROOT = "upstream"
RECORD = "kailo/upstream.yaml"
# 不参与构建、不进源码摘要的 Kailo 自有文件：记录本身（其中有摘要）与证据文档
NOT_SOURCE = (RECORD, "kailo/verify/")
REFERENCES = os.path.join("..", ".references")


def _run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, **kw).stdout


def _list(m, key):
    return [str(x) for x in (m.get(key) or [])]


def records():
    """全部来源记录：{树名: 记录路径}。"""
    out = {}
    if os.path.isdir(ROOT):
        for tree in sorted(os.listdir(ROOT)):
            path = os.path.join(ROOT, tree, RECORD)
            if os.path.isfile(path):
                out[tree] = path
    return out


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def tree_of(path):
    return os.path.dirname(os.path.dirname(path))


def resolve(name):
    """产物短名或树名 -> (记录路径, 记录, 产物或 None)。"""
    for tree, path in records().items():
        m = load(path)
        for a in m.get("artifacts") or []:
            if a.get("name") == f"upstream-{name}":
                return path, m, a
    path = records().get(name)
    if not path:
        sys.exit(f"找不到 {name}：既不是 {ROOT}/*/{RECORD} 登记的产物 upstream-{name}，也不是树名")
    m = load(path)
    arts = m.get("artifacts") or []
    return path, m, (arts[0] if len(arts) == 1 else None)


def vendor_pairs(m):
    """vendor_files 的每一项是「本仓库相对源:树内相对目标」。"""
    return [tuple(x.partition(":")[::2]) for x in _list(m, "vendor_files")]


def source_files(tree):
    """树内的源码文件（相对树根）：按 Kailo 仓库的忽略规则可见、且实际存在的文件。

    与仓库将要提交的集合同一口径：已跟踪的加未跟踪但未被忽略的。构建输出与依赖目录
    （target/、node_modules/ ……）由忽略规则排除，因此不会进构建，也不会进摘要。
    """
    raw = _run("git", "-C", tree, "ls-files", "-co", "--exclude-standard", "-z", "--", ".")
    out = set()
    for rel in raw.decode().split("\0"):
        if rel and os.path.lexists(os.path.join(tree, rel)) and not any(
                rel == x or rel.startswith(x) for x in NOT_SOURCE):
            out.add(rel)
    return sorted(out)


def _excluded(rel, prefixes):
    return any(rel == p.rstrip("/") or rel.startswith(p.rstrip("/") + "/") for p in prefixes)


def source_digest(path, m, art):
    """该产物的源码摘要：范围内每个文件的路径、类型与字节，加上落在范围内的 vendor_files
    （目标路径与本仓库源字节），以及决定构建方式的字段。

    source_include/source_exclude 声明该产物的输入范围（例如 Relay 镜像的上游 .dockerignore
    整个排除 desktop/ 与 mobile/，Mobile 安装包只取 mobile/）；范围外的改动不要求重建它。
    """
    tree = tree_of(path)
    incl, excl = _list(art, "source_include"), _list(art, "source_exclude")
    out = lambda rel: (incl and not _excluded(rel, incl)) or _excluded(rel, excl)
    h = hashlib.sha256()
    for key in ("kind", "build_context", "build_dockerfile", "source_include", "source_exclude"):
        h.update(f"{key}={art.get(key) or ''}\0".encode())
    for rel in source_files(tree):
        if out(rel):
            continue
        full = os.path.join(tree, rel)
        if os.path.islink(full):
            h.update(b"l\0" + rel.encode() + b"\0" + os.readlink(full).encode() + b"\0")
        else:
            mode = b"x" if os.access(full, os.X_OK) else b"f"
            with open(full, "rb") as f:
                data = f.read()
            h.update(mode + b"\0" + rel.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
    for src, dst in vendor_pairs(m):
        if not out(dst) and os.path.isfile(src):
            with open(src, "rb") as f:
                h.update(b"\0vendor_file\0" + dst.encode() + b"\0" + f.read())
    return "sha256:" + h.hexdigest()


def problems(path, m, check_digest=True):
    """记录与源码树的结构问题。构建前不核摘要：重建正是让摘要与源码重新一致的那一步。"""
    bad = []
    tree = tree_of(path)
    ev, ib = str(m.get("evidence_commit") or ""), str(m.get("implementation_base_commit") or "")
    for name, v in (("evidence_commit", ev), ("implementation_base_commit", ib)):
        if not re.fullmatch(r"[0-9a-f]{40}", v):
            bad.append(f"{name} 不是 40 位 commit")
    # 06 §2 的硬规则：两者不同而声明 none，设计证据会被更高版本悄悄覆盖
    if ev and ib and ev != ib and str(m.get("base_divergence")) == "none":
        bad.append("evidence_commit 与 implementation_base_commit 不同，但 base_divergence 声明为 none")
    if m.get("project") != os.path.basename(tree):
        bad.append(f"project 为 {m.get('project')}，应与目录名 {os.path.basename(tree)} 一致")
    for gone in ("patch_series", "patch_series_digest"):
        if gone in m:
            bad.append(f"{gone} 已废弃：改动直接在源码树里，审查与升级用 upstream_manifest.py diff")
    module = m.get("module")
    has_source = any(not f.startswith("kailo/") for f in source_files(tree))
    if module:
        # 只以 Go module 引用的上游：没有源码树、没有自建产物
        if has_source or m.get("artifacts"):
            bad.append("登记了 module 却带有源码或产物：以 module 引用的上游不在本仓库构建")
        mod, _, ver = str(module).partition("@")
        gomod = os.path.join("worker", "go.mod")
        if not os.path.isfile(gomod) or not re.search(rf"^\s*{re.escape(mod)}\s+{re.escape(ver)}\s*$",
                                                      open(gomod, encoding="utf-8").read(), re.M):
            bad.append(f"module {module} 未出现在 {gomod}")
        return bad
    if not has_source:
        bad.append(f"{tree} 没有上游源码")
    removed = _list(m, "remove_paths")
    for x in removed:
        if x.startswith("/") or ".." in x.split("/"):
            bad.append(f"remove_paths 只接受树内的相对路径：{x}")
        elif os.path.lexists(os.path.join(tree, x)):
            bad.append(f"remove_paths 登记的 {x} 仍在源码树里")
    if len(set(removed)) != len(removed):
        bad.append("remove_paths 有重复项")
    # vendor_files：本仓库的权威源在构建时放进树，树里不携带副本（ADR-02/03、ADR-09）
    missing = False
    for raw in _list(m, "vendor_files"):
        src, sep, dst = raw.partition(":")
        if not sep or not src or not dst or any(q.startswith("/") or ".." in q.split("/") for q in (src, dst)):
            bad.append(f"vendor_files 只接受「本仓库相对源:树内相对目标」：{raw}")
            missing = True
        elif not os.path.isfile(src):
            bad.append(f"vendor_files 的源 {src} 不存在")
            missing = True
        elif subprocess.run(["git", "-C", tree, "check-ignore", "-q", "--", dst]).returncode != 0:
            bad.append(f"vendor_files 的目标 {dst} 未被忽略：树里会提交一份副本")
    names = set()
    for a in m.get("artifacts") or []:
        name = str(a.get("name") or "")
        if not name.startswith("upstream-") or name in names:
            bad.append(f"产物名 {name!r} 必须以 upstream- 开头且不重复")
        names.add(name)
        kind = a.get("kind")
        if kind not in ("image", "bundle"):
            bad.append(f"{name}: kind 为 {kind}，只能是 image 或 bundle")
        ctx = str(a.get("build_context") or ".")
        if not os.path.isdir(os.path.join(tree, ctx)):
            bad.append(f"{name}: build_context {ctx} 不存在于源码树")
        bdf = a.get("build_dockerfile")
        if kind == "bundle" and not bdf:
            bad.append(f"{name}: 安装包产物必须登记 build_dockerfile（其最后阶段只含安装包）")
        if bdf and not os.path.isfile(os.path.join(tree, str(bdf))):
            bad.append(f"{name}: build_dockerfile 指向不存在的 {bdf}")
        art, src = str(a.get("artifact_digest") or ""), str(a.get("source_digest") or "")
        if art == "none":
            if src != "none":
                bad.append(f"{name}: artifact_digest 为 none 时 source_digest 也必须为 none")
        elif not re.fullmatch(r"sha256:[0-9a-f]{64}", art) or not re.fullmatch(r"sha256:[0-9a-f]{64}", src):
            bad.append(f"{name}: artifact_digest 与 source_digest 须为 sha256:<64 位>，或同为 none")
        elif check_digest and not missing:
            want = source_digest(path, m, a)
            if src != want:
                bad.append(f"{name}: artifact 不是由当前源码构建——source_digest 记为 {src}，"
                           f"当前源码为 {want}；改了源码就必须用 tools/build-upstream.sh 重建并写回")
    return bad


# ---- 上游原样（只读） -------------------------------------------------------

def _cache_repo(tree_name):
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "kailo", "upstream", f"{tree_name}.git")


def upstream_repo(path, m):
    """一个能解析基准 commit 的 git 对象库。

    首选 .references/<树>：只借用它的对象（alternates），不在其中写入或构建。没有时从
    upstream_url 按 commit 浅取到本机缓存。取不到即失败：基准不可解析，就无从证明
    源码树是在哪个上游版本上改的。
    """
    tree_name = os.path.basename(tree_of(path))
    base = str(m.get("implementation_base_commit"))
    repo = _cache_repo(tree_name)
    if not os.path.isdir(repo):
        os.makedirs(os.path.dirname(repo), exist_ok=True)
        _run("git", "init", "-q", "--bare", repo)
    has = lambda: subprocess.run(["git", "-C", repo, "cat-file", "-e", base + "^{commit}"],
                                 capture_output=True).returncode == 0
    if has():
        return repo
    ref = os.path.join(REFERENCES, tree_name)
    objects = _run("git", "-C", ref, "rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip() \
        if os.path.isdir(ref) else ""
    if objects:
        alt = os.path.join(repo, "objects", "info", "alternates")
        with open(alt, "a+", encoding="utf-8") as f:
            f.seek(0)
            want = os.path.join(objects, "objects")
            if want not in f.read().split("\n"):
                f.write(want + "\n")
        if has():
            return repo
    subprocess.run(["git", "-C", repo, "fetch", "-q", "--depth", "1", str(m["upstream_url"]), base],
                   capture_output=True)
    if not has():
        sys.exit(f"{path}: 基准 commit {base} 既不在 {ref}，也无法从 {m['upstream_url']} 取得")
    return repo


def _kailo_index(path, m):
    """把当前源码（kailo/ 之外）写进一个临时 index，返回 (repo, 环境)。"""
    tree = tree_of(path)
    repo = upstream_repo(path, m)
    index = os.path.join(repo, f"kailo-index-{os.getpid()}")
    env = dict(os.environ, GIT_DIR=repo, GIT_WORK_TREE=os.path.abspath(tree), GIT_INDEX_FILE=index)
    files = [f for f in source_files(tree) if not f.startswith("kailo/")]
    # -f：可见与否以 Kailo 仓库的规则为准（source_files 已判定），不再套一遍树自己的规则
    subprocess.run(["git", "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
                   input="\0".join(files).encode(), env=env, check=True, capture_output=True,
                   cwd=os.path.abspath(tree))
    return repo, env, index


def _removed(repo, env, base):
    ls = lambda *a: set(_run("git", *a, env=env).decode().split("\0")) - {""}
    before = ls("ls-tree", "-r", "-z", "--name-only", base)
    after = ls("ls-files", "-z")
    kept_dirs = {"/".join(p.split("/")[:i]) for p in after for i in range(1, p.count("/") + 1)}
    out = set()
    for p in before - after:
        parts = p.split("/")
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            if prefix not in kept_dirs and prefix not in after:
                out.add(prefix)
                break
    return sorted(out)


def diff(name, mode=""):
    path, m, _ = resolve(name)
    if m.get("module"):
        sys.exit(f"{path}: 以 module {m['module']} 引用，本仓库没有它的源码树")
    base = str(m["implementation_base_commit"])
    repo, env, index = _kailo_index(path, m)
    try:
        if _run("git", "ls-tree", "--name-only", base, "kailo", env=env).strip():
            sys.exit(f"上游在 {base[:12]} 有自己的 kailo/，与 Kailo 自有目录冲突")
        if mode == "--check":
            got, want = _removed(repo, env, base), sorted(_list(m, "remove_paths"))
            if got != want:
                for x in sorted(set(got) - set(want)):
                    print(f"  整块删除但未登记：{x}")
                for x in sorted(set(want) - set(got)):
                    print(f"  登记了但没有整块删除：{x}")
                sys.exit(1)
            print(f"  {path}: remove_paths 与实际一致（{len(got)} 项）")
            return
        extra = {"--stat": ["--stat"], "--name-status": ["--name-status"], "": ["--binary"]}.get(mode)
        if extra is None:
            sys.exit(__doc__)
        sys.stdout.flush()
        subprocess.run(["git", "-c", "core.quotepath=off", "diff", "--cached", "-M", *extra, base],
                       env=env, check=True)
    finally:
        os.remove(index) if os.path.exists(index) else None


def added_lines(name):
    """Kailo 在树里新增或改写的行，逐行输出为「路径:内容」。删除的上游原文不算交付内容。"""
    path, m, _ = resolve(name)
    if m.get("module"):
        return
    base = str(m["implementation_base_commit"])
    _, env, index = _kailo_index(path, m)
    try:
        out = _run("git", "-c", "core.quotepath=off", "diff", "--cached", "-U0", "--no-renames",
                   "--text", base, env=env).decode(errors="replace")
    finally:
        os.remove(index) if os.path.exists(index) else None
    cur = ""
    for line in out.split("\n"):
        if line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and cur:
            print(f"{tree_of(path)}/{cur}:{line[1:]}")


# ---- 构建 --------------------------------------------------------------------

def plan(name):
    path, m, art = resolve(name)
    if art is None:
        sys.exit(f"{name} 不是登记的产物；可用：" + ", ".join(
            a["name"][len("upstream-"):] for p in records().values() for a in load(p).get("artifacts") or []))
    bad = problems(path, m, check_digest=False)
    if bad:
        sys.exit("\n".join(f"{path}: {b}" for b in bad))
    q = shlex.quote
    print(f"record={q(path)}")
    print(f"tree={q(tree_of(path))}")
    print(f"artifact={q(art['name'])}")
    print(f"kind={q(str(art['kind']))}")
    print(f"base={q(str(m['implementation_base_commit']))}")
    print(f"ctx={q(str(art.get('build_context') or '.'))}")
    print(f"dockerfile={q(str(art.get('build_dockerfile') or ''))}")
    print("secrets=(" + " ".join(q(x) for x in _list(art, "build_secrets")) + ")")
    print(f"blocked={q(str(art.get('blocked') or ''))}")


def _place(m, tree, refresh):
    for src, dst in vendor_pairs(m):
        target = os.path.join(tree, dst)
        if os.path.lexists(target) and not refresh:
            sys.exit(f"vendor_files 的目标 {dst} 已存在于源码里")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(src, target)


def stage(name, dest):
    """构建输入 = 源码树里可见的文件 + vendor_files，与 source_digest 的口径一致。"""
    path, m, _ = resolve(name)
    if os.path.exists(dest) and os.listdir(dest):
        sys.exit(f"{dest} 不是空目录")
    tree = tree_of(path)
    for rel in source_files(tree):
        src, dst = os.path.join(tree, rel), os.path.join(dest, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.islink(src):
            os.symlink(os.readlink(src), dst)
        else:
            shutil.copy2(src, dst)
    _place(m, dest, refresh=False)


def vendor(name):
    """vendor_files 放进 upstream/<树> 本身，供在树里直接开发与测试。

    目标必须被树的 .gitignore 忽略：vendor 源是唯一权威（ADR-02、ADR-09），树里只在工作
    目录里有一份不入库的拷贝。
    """
    path, m, _ = resolve(name)
    tree = tree_of(path)
    bad = [b for b in problems(path, m, check_digest=False) if "vendor_files" in b]
    if bad:
        sys.exit("\n".join(f"{path}: {b}" for b in bad))
    _place(m, tree, refresh=True)
    for src, dst in vendor_pairs(m):
        print(f"  放入 {src} -> {tree}/{dst}")


def record(name, artifact):
    """只替换该产物块里的两行：记录里的注释是给人读的，不经 YAML 重写。"""
    path, m, art = resolve(name)
    digest = source_digest(path, m, art) if artifact != "none" else "none"
    lines = open(path, encoding="utf-8").read().split("\n")
    start = next((i for i, l in enumerate(lines) if re.fullmatch(rf"  - name: {re.escape(art['name'])}\s*", l)), None)
    if start is None:
        sys.exit(f"{path}: 缺少 `  - name: {art['name']}` 块")
    done = set()
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("  - ") or (lines[i] and not lines[i].startswith(" ")):
            break
        for key, value in (("source_digest", digest), ("artifact_digest", artifact)):
            if re.match(rf"    {key}:", lines[i]):
                lines[i] = f"    {key}: {value}"
                done.add(key)
    if done != {"source_digest", "artifact_digest"}:
        sys.exit(f"{path}: {art['name']} 块缺少 source_digest 或 artifact_digest 行")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "diff" and len(a) in (2, 3):
        diff(a[1], a[2] if len(a) == 3 else "")
    elif cmd == "added-lines" and len(a) == 2:
        added_lines(a[1])
    elif cmd == "plan" and len(a) == 2:
        plan(a[1])
    elif cmd == "stage" and len(a) == 3:
        stage(a[1], a[2])
    elif cmd == "record" and len(a) == 3:
        record(a[1], a[2])
    elif cmd == "vendor" and len(a) == 2:
        vendor(a[1])
    else:
        sys.exit(__doc__)
