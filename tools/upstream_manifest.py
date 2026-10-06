"""二开项目来源记录的唯一解析、校验、摘要、差异与同步算法（06 §2、ADR-06、ADR-16）。

二开项目是 apps/ 下按功能命名的目录（collaboration/、web-client/、model-gateway/、agent-runtime/），
目录内是上游固定 commit 的完整源码，改动直接在树里。每个二开项目的 fork/ 子目录是本仓库自有的文件：
  fork/upstream.yaml   来源记录：上游仓库、.references 目录、基准 commit、删除路径、产物与摘要
  fork/verify/         接缝证据
  fork/packaging/      上游没有而由本仓库维护的构建文件
只以 Go module 引用、不改也不自行构建的上游（工作流 SDK）只有来源记录：worker/fork/upstream.yaml。
共用代码（client-kit/）以本地路径依赖被二开项目直接引用，没有构建时拷贝。

`tools/build-upstream.sh` 按它备好构建输入、写回摘要；`tools/check.sh` 的 seam/supply/status 按它复核。
两边共用这一份：摘要算法或字段含义只在这里定义。设计追溯（SF/SS 引用、证据路径）只在门禁里。

所有路径相对 apps/。命令行（<项目> 是目录名，例如 collaboration；<产物> 是 artifacts 的 name）：
  diff <项目> [--stat|--name-status|--check]
        以只读方式取上游原样（.references/<reference_tree> 的对象库，没有时从 upstream_url 取），
        与二开树比较，输出本仓库的改动（fork/ 不在其中）。--check 核对 remove_paths 与实际一致。
  added-lines <项目>   本仓库在该树里新增或改写的行（供 check.sh supply 做凭据扫描）
  status [<项目>]      .references 的 HEAD、UPDATE_TASKS.json 与更新记录对比基准 commit：上游新提交、
                       涉及文件、其中本仓库也改过的文件。只提示，恒以 0 退出（ADR-16 第 5 条）
  sync <项目> [--to <commit>] [--into <目录>]
                       以基准 commit 为共同祖先，二开树当前内容为一方、上游新 commit（默认
                       .references 的 HEAD）为另一方三方合并，结果写进二开树（--into 时写进该目录里
                       的一份树副本）；冲突按 git 标准标记留在文件里，不提交、不改来源记录
  plan <产物>          构建所需字段，输出可 eval 的 shell 赋值
  stage <产物> <目录>   把产物的输入（按仓库忽略规则可见的文件）放进空目录，保持 apps/ 相对路径
  record <产物> <artifact_digest>
                       写回该产物的 source_digest（按当前源码算）与 artifact_digest
"""

import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urljoin, urlsplit

import yaml

RECORD_GLOB = "fork/upstream.yaml"
REFERENCES = os.path.join("..", ".references")


def _run(*args, **kw):
    return subprocess.run(list(args), check=True, capture_output=True, **kw).stdout


def _list(m, key):
    return [str(x) for x in (m.get(key) or [])]


def _components(m):
    """可选的原生 gitlink 展开声明；不是另一份上游版本权威。"""
    pins = m.get("source_components")
    if pins is None:
        return None
    if not isinstance(pins, dict) or not pins:
        raise ValueError("source_components 须为非空的路径 -> 40 位 commit 映射")
    for rel, commit in pins.items():
        if (not isinstance(rel, str) or not rel or rel.startswith("/")
                or any(p in ("", ".", "..") for p in rel.split("/"))
                or "\\" in rel or any(ord(c) < 32 for c in rel)
                or rel == "fork" or rel.startswith("fork/")):
            raise ValueError(f"source_components 路径不是树内的规范相对路径：{rel!r}")
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise ValueError(f"source_components {rel}: 不是 40 位 commit")
    return pins


def _not_source(rel):
    """不参与构建、不进源码摘要的本仓库文件：来源记录本身（其中有摘要）与证据文档。"""
    parts = rel.split("/")
    return len(parts) >= 3 and parts[1] == "fork" and (parts[2] == "upstream.yaml" or parts[2] == "verify")


def records():
    """全部来源记录：{项目目录: 记录路径}。"""
    out = {}
    for d in sorted(os.listdir(".")):
        path = os.path.join(d, RECORD_GLOB)
        if os.path.isfile(path):
            out[d] = path
    return out


def load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def tree_of(path):
    return os.path.dirname(os.path.dirname(path))


def resolve(name):
    """产物名或项目目录名 -> (记录路径, 记录, 产物或 None)。"""
    recs = records()
    for path in recs.values():
        m = load(path)
        for a in m.get("artifacts") or []:
            if a.get("name") == name:
                return path, m, a
    path = recs.get(name)
    if not path:
        sys.exit(f"找不到 {name}：既不是登记的产物，也不是带 {RECORD_GLOB} 的项目目录")
    m = load(path)
    arts = m.get("artifacts") or []
    return path, m, (arts[0] if len(arts) == 1 else None)


def source_files(*prefixes):
    """前缀下的源码文件（相对 apps/）：按仓库忽略规则可见、且实际存在的文件。

    与仓库将要提交的集合同一口径：已跟踪的加未跟踪但未被忽略的。构建输出与依赖目录
    （target/、node_modules/ ……）由忽略规则排除，因此不会进构建，也不会进摘要。
    """
    raw = _run("git", "ls-files", "-co", "--exclude-standard", "-z", "--", *prefixes)
    return sorted({rel for rel in raw.decode().split("\0")
                   if rel and os.path.lexists(rel) and not _not_source(rel)})


def _under(rel, prefixes):
    return any(rel == p.rstrip("/") or rel.startswith(p.rstrip("/") + "/") for p in prefixes)


def source_digest(art):
    """该产物的源码摘要：inputs 内、exclude 外每个文件的路径、类型与字节，以及决定构建方式的字段。

    inputs 是产物的输入范围（二开树的相关部分与它以本地路径依赖引用的 client-kit）；exclude
    声明其中对该产物没有输入作用的路径（例如 Relay 镜像的上游 .dockerignore 整个排除 desktop/
    与 mobile/）。范围外的改动不要求重建这个产物。
    """
    incl, excl = _list(art, "inputs"), _list(art, "exclude")
    h = hashlib.sha256()
    for key in ("kind", "build_context", "build_dockerfile", "inputs", "exclude"):
        h.update(f"{key}={art.get(key) or ''}\0".encode())
    for rel in source_files(*incl):
        if _under(rel, excl):
            continue
        if os.path.islink(rel):
            h.update(b"l\0" + rel.encode() + b"\0" + os.readlink(rel).encode() + b"\0")
        else:
            mode = b"x" if os.access(rel, os.X_OK) else b"f"
            with open(rel, "rb") as f:
                data = f.read()
            h.update(mode + b"\0" + rel.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
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
    if not m.get("reference_tree"):
        bad.append("缺少 reference_tree：.references 下对应的上游目录名")
    try:
        components = _components(m)
        if components is not None and m.get("module"):
            bad.append("module 引用不得登记 source_components")
    except ValueError as error:
        bad.append(str(error))
    for gone in ("patch_series", "patch_series_digest", "vendor_files"):
        if gone in m:
            bad.append(f"{gone} 已废弃（ADR-16）：改动直接在树里，共用代码以本地路径依赖引用")
    module = m.get("module")
    if module:
        # 只以 Go module 引用的上游：没有二开树、没有自建产物
        if m.get("artifacts") or m.get("remove_paths"):
            bad.append("登记了 module 却带有产物或删除路径：以 module 引用的上游不在本仓库构建")
        mod, _, ver = str(module).partition("@")
        gomod = os.path.join(tree, "go.mod")
        if not os.path.isfile(gomod) or not re.search(rf"^\s*{re.escape(mod)}\s+{re.escape(ver)}\s*$",
                                                      open(gomod, encoding="utf-8").read(), re.M):
            bad.append(f"module {module} 未出现在 {gomod}")
        return bad
    if not any(not f.startswith(f"{tree}/fork/") for f in source_files(tree)):
        bad.append(f"{tree} 没有上游源码")
    removed = _list(m, "remove_paths")
    for x in removed:
        if x.startswith("/") or ".." in x.split("/"):
            bad.append(f"remove_paths 只接受树内的相对路径：{x}")
        elif os.path.lexists(os.path.join(tree, x)):
            bad.append(f"remove_paths 登记的 {x} 仍在源码树里")
    if len(set(removed)) != len(removed):
        bad.append("remove_paths 有重复项")
    names = set()
    for a in m.get("artifacts") or []:
        name = str(a.get("name") or "")
        if not re.fullmatch(r"[a-z][a-z0-9-]*", name) or name in names:
            bad.append(f"产物名 {name!r} 须为小写短横线命名且不重复")
        names.add(name)
        kind = a.get("kind")
        if kind not in ("image", "bundle"):
            bad.append(f"{name}: kind 为 {kind}，只能是 image 或 bundle")
        ctx = str(a.get("build_context") or "")
        if not ctx or not os.path.isdir(ctx):
            bad.append(f"{name}: build_context {ctx!r} 不存在（相对 apps/）")
        bdf = a.get("build_dockerfile")
        if not bdf:
            bad.append(f"{name}: 必须登记 build_dockerfile（相对 apps/；安装包产物的最后阶段只含安装包）")
        if bdf and not os.path.isfile(str(bdf)):
            bad.append(f"{name}: build_dockerfile 指向不存在的 {bdf}")
        incl = _list(a, "inputs")
        if not incl or not any(_under(p, [tree]) for p in incl):
            bad.append(f"{name}: inputs 必须包含 {tree}/ 下的路径")
        for p in incl:
            if not os.path.exists(p):
                bad.append(f"{name}: inputs 登记的 {p} 不存在")
        if bdf and not _under(str(bdf), incl):
            bad.append(f"{name}: build_dockerfile 不在 inputs 内，改它不会让产物失效")
        build_args = _list(a, "build_args")
        for x in build_args:
            if not re.fullmatch(r"[A-Z][A-Z0-9_]*", str(x)):
                bad.append(f"{name}: build_args 只登记变量名（大写字母、数字、下划线），得到 {x!r}")
        if len(set(build_args)) != len(build_args):
            bad.append(f"{name}: build_args 有重复项")
        if set(build_args) & set(_list(a, "build_secrets")):
            bad.append(f"{name}: 同一变量不能既是 build_args 又是 build_secrets")
        art, src = str(a.get("artifact_digest") or ""), str(a.get("source_digest") or "")
        if art == "none":
            if src != "none":
                bad.append(f"{name}: artifact_digest 为 none 时 source_digest 也必须为 none")
        elif not re.fullmatch(r"sha256:[0-9a-f]{64}", art) or not re.fullmatch(r"sha256:[0-9a-f]{64}", src):
            bad.append(f"{name}: artifact_digest 与 source_digest 须为 sha256:<64 位>，或同为 none")
        elif check_digest:
            want = source_digest(a)
            if src != want:
                bad.append(f"{name}: artifact 不是由当前源码构建——source_digest 记为 {src}，"
                           f"当前源码为 {want}；改了源码就必须用 tools/build-upstream.sh 重建并写回")
    return bad


# ---- 上游原样（只读） -------------------------------------------------------

def _cache_repo(ref_tree):
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "platform", "upstream", f"{ref_tree}.git")


def _reference_dir(m):
    return os.path.join(REFERENCES, str(m.get("reference_tree")))


def upstream_repo(path, m, want=None):
    """一个能解析 want（缺省为基准 commit）的 git 对象库。

    首选 .references/<reference_tree>：只借用它的对象（alternates），不在其中写入、检出或构建。
    没有时从 upstream_url 按 commit 浅取到本机缓存。取不到即失败：基准不可解析，就无从证明
    二开树是在哪个上游版本上改的。
    """
    want = want or str(m.get("implementation_base_commit"))
    repo = _cache_repo(str(m.get("reference_tree")))
    if not os.path.isdir(repo):
        os.makedirs(os.path.dirname(repo), exist_ok=True)
        _run("git", "init", "-q", "--bare", repo)
    has = lambda: subprocess.run(["git", "-C", repo, "cat-file", "-e", want + "^{commit}"],
                                 capture_output=True).returncode == 0
    if has():
        return repo
    ref = _reference_dir(m)
    common = _run("git", "-C", ref, "rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip() \
        if os.path.isdir(ref) else ""
    if common:
        alt = os.path.join(repo, "objects", "info", "alternates")
        with open(alt, "a+", encoding="utf-8") as f:
            f.seek(0)
            objects = os.path.join(common, "objects")
            if objects not in f.read().split("\n"):
                f.write(objects + "\n")
        if has():
            return repo
    subprocess.run(["git", "-C", repo, "fetch", "-q", "--depth", "1", str(m["upstream_url"]), want],
                   capture_output=True)
    if not has():
        sys.exit(f"{path}: commit {want} 既不在 {ref}，也无法从 {m['upstream_url']} 取得")
    return repo


def _gitlinks(repo, commit):
    raw = _run("git", "--git-dir", repo, "ls-tree", "-r", "-z", commit)
    links = {}
    for entry in raw.split(b"\0"):
        if entry:
            fields, rel = entry.split(b"\t", 1)
            mode, kind, obj = fields.decode().split(" ")
            if mode == "160000" and kind == "commit":
                links[rel.decode()] = obj
    return links


def _component_urls(path, m, repo, commit, links):
    """URL 来自同一个固定树的 .gitmodules，只展开真正存在的 gitlink。"""
    raw = _run("git", "--git-dir", repo, "config", "--blob", f"{commit}:.gitmodules",
               "--null", "--get-regexp", r"^submodule\..*\.(path|url)$")
    entries = {}
    for entry in raw.decode().split("\0"):
        if entry:
            key, value = entry.split("\n", 1)
            name, field = key[len("submodule."):].rsplit(".", 1)
            fields = entries.setdefault(name, {})
            if field in fields:
                sys.exit(f"{path}: {commit} .gitmodules 的 {name}.{field} 重复")
            fields[field] = value
    urls = {}
    for fields in entries.values():
        rel = fields.get("path")
        if rel not in links:
            continue
        if rel in urls or not fields.get("url"):
            sys.exit(f"{path}: {commit} 的 gitlink {rel} 缺少唯一 .gitmodules URL")
        url = fields["url"]
        if url.startswith(("./", "../")):
            parent = str(m["upstream_url"])
            if urlsplit(parent).scheme not in ("https", "http"):
                sys.exit(f"{path}: {rel} 相对 URL 的父仓库不是 HTTP(S) URL")
            url = urljoin(parent.rstrip("/") + "/", url)
        urls[rel] = url
    if set(urls) != set(links):
        sys.exit(f"{path}: {commit} 的 gitlink 缺少 .gitmodules URL：{sorted(set(links) - set(urls))}")
    return urls


def upstream_tree(path, m, want=None):
    """真实基准 commit 的源码树；声明展开时以该树自己的 gitlink 固定子仓库。

    只在缓存组合 tree，manifest 的 implementation_base_commit 不换成派生对象。
    未声明展开的旧记录保持原语义；已声明的路径/commit 必须精确等于原基准。
    status/sync 的新树则取新 commit 自己的 gitlink，不把旧 pin 套到新上游。
    """
    repo = upstream_repo(path, m, want)
    commit = want or str(m["implementation_base_commit"])
    try:
        pins = _components(m)
    except ValueError as error:
        sys.exit(f"{path}: {error}")
    if pins is None:
        return repo, commit
    base = str(m["implementation_base_commit"])
    upstream_repo(path, m)
    actual = _gitlinks(repo, base)
    if pins != actual:
        sys.exit(f"{path}: source_components 不等于 {base} 的实际 gitlink：声明 {pins}；实际 {actual}")
    links = actual if commit == base else _gitlinks(repo, commit)
    if not links:
        return repo, commit
    urls = _component_urls(path, m, repo, commit, links)
    child_trees = {}
    for rel, pin in sorted(links.items()):
        child = dict(reference_tree=f"{m['reference_tree']}/{rel}", upstream_url=urls[rel],
                     implementation_base_commit=pin)
        child_repo = upstream_repo(path, child)
        if _gitlinks(child_repo, pin):
            sys.exit(f"{path}: {rel}@{pin} 还有未登记的嵌套 gitlink，不能证明完整展开源码")
        alt = os.path.join(repo, "objects", "info", "alternates")
        with open(alt, "a+", encoding="utf-8") as f:
            f.seek(0)
            objects = os.path.abspath(os.path.join(child_repo, "objects"))
            if objects not in f.read().splitlines():
                f.write(objects + "\n")
        child_trees[rel] = pin
    fd, index = tempfile.mkstemp(prefix="expanded-index-", dir=repo)
    os.close(fd)
    os.remove(index)
    env = dict(os.environ, GIT_DIR=repo, GIT_INDEX_FILE=index,
               GIT_WORK_TREE=os.path.abspath(tree_of(path)))
    try:
        _run("git", "read-tree", commit, env=env)
        for rel, pin in child_trees.items():
            _run("git", "update-index", "--force-remove", "--", rel, env=env)
            _run("git", "read-tree", f"--prefix={rel}/", pin + "^{tree}", env=env)
        return repo, _run("git", "write-tree", env=env).decode().strip()
    finally:
        if os.path.exists(index):
            os.remove(index)


class _Index:
    """二开树当前内容（fork/ 之外）的临时 index，挂在上游对象库上。"""

    def __init__(self, path, m):
        self.tree = tree_of(path)
        self.repo, self.base = upstream_tree(path, m)
        self.file = os.path.join(self.repo, f"upstream-index-{os.getpid()}")
        self.env = dict(os.environ, GIT_DIR=self.repo, GIT_WORK_TREE=os.path.abspath(self.tree),
                        GIT_INDEX_FILE=self.file)
        files = [f[len(self.tree) + 1:] for f in source_files(self.tree)
                 if not f.startswith(f"{self.tree}/fork/")]
        # -f：可见与否以本仓库的规则为准（source_files 已判定），不再套一遍树自己的规则
        subprocess.run(["git", "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
                       input="\0".join(files).encode(), env=self.env, check=True, capture_output=True,
                       cwd=os.path.abspath(self.tree))

    def git(self, *args, **kw):
        return _run("git", "-c", "core.quotepath=off", *args, env=self.env, **kw)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if os.path.exists(self.file):
            os.remove(self.file)


def _removed(ix, base):
    ls = lambda *a: set(ix.git(*a).decode().split("\0")) - {""}
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


def _source_record(name):
    path, m, _ = resolve(name)
    if m.get("module"):
        sys.exit(f"{path}: 以 module {m['module']} 引用，本仓库没有它的二开树")
    return path, m


def diff(name, mode=""):
    path, m = _source_record(name)
    base = str(m["implementation_base_commit"])
    with _Index(path, m) as ix:
        if ix.git("ls-tree", "--name-only", ix.base, "fork").strip():
            sys.exit(f"上游在 {base[:12]} 有自己的 fork/，与本仓库自有目录冲突")
        if mode == "--check":
            got, want = _removed(ix, ix.base), sorted(_list(m, "remove_paths"))
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
        subprocess.run(["git", "-c", "core.quotepath=off", "diff", "--cached", "-M", *extra, ix.base],
                       env=ix.env, check=True)


def added_lines(name):
    """本仓库在树里新增或改写的行，逐行输出为「路径:内容」。删除的上游原文不算交付内容。"""
    path, m, _ = resolve(name)
    if m.get("module"):
        return
    with _Index(path, m) as ix:
        out = ix.git("diff", "--cached", "-U0", "--no-renames", "--text", ix.base).decode(errors="replace")
    cur = ""
    for line in out.split("\n"):
        if line.startswith("+++ "):
            cur = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and cur:
            print(f"{tree_of(path)}/{cur}:{line[1:]}")


# ---- 上游变化：status 与 sync（ADR-16 第 5、6 条） ------------------------------

def _reference_head(m):
    ref = _reference_dir(m)
    if not os.path.isdir(ref):
        return None
    return _run("git", "-C", ref, "rev-parse", "HEAD").decode().strip()


def _update_task(m):
    """.references/UPDATE_TASKS.json 里该上游的待办更新（参考仓库管理器生成，只读）。"""
    p = os.path.join(REFERENCES, "UPDATE_TASKS.json")
    if not os.path.isfile(p):
        return None
    try:
        tasks = json.load(open(p, encoding="utf-8")).get("tasks") or []
    except ValueError:
        return None
    name = str(m.get("reference_tree"))
    for t in tasks:
        if (t.get("project") or {}).get("name") == name:
            return t
    return None


def _last_update_entry(m):
    p = os.path.join(REFERENCES, f"{m.get('reference_tree')}更新记录.md")
    if not os.path.isfile(p):
        return None
    heads = re.findall(r"^## (.+)$", open(p, encoding="utf-8").read(), re.M)
    return heads[-1] if heads else None


def status(only=None):
    """每个来源记录：.references 的 HEAD 相对基准 commit 的新提交与涉及文件，以及其中本仓库改过的文件。"""
    for tree, path in records().items():
        if only and only not in (tree, os.path.basename(tree)):
            continue
        m = load(path)
        base = str(m.get("implementation_base_commit"))
        head = _reference_head(m)
        task = _update_task(m)
        entry = _last_update_entry(m)
        label = f"{tree}（.references/{m.get('reference_tree')}）"
        if head is None:
            print(f"  {label}: .references 中没有该上游，无法比较")
            continue
        notes = []
        if task:
            rng = (task.get("git") or {}).get("range")
            notes.append(f"UPDATE_TASKS 待办 {rng}")
        if entry:
            notes.append(f"最近更新记录：{entry[:80]}")
        suffix = ("；" + "；".join(notes)) if notes else ""
        if head == base:
            print(f"  {label}: 无新提交（HEAD 即基准 {base[:12]}）{suffix}")
            continue
        repo, head_tree = upstream_tree(path, m, head)
        _, base_tree = upstream_tree(path, m)
        env = dict(os.environ, GIT_DIR=repo)
        is_desc = subprocess.run(["git", "merge-base", "--is-ancestor", base, head], env=env).returncode == 0
        commits = _run("git", "rev-list", "--count", f"{base}..{head}", env=env).decode().strip()
        files = [f for f in _run("git", "-c", "core.quotepath=off", "diff", "--name-only", base_tree, head_tree,
                                 env=env).decode().split("\n") if f]
        print(f"  {label}: 上游 HEAD {head[:12]} 相对基准 {base[:12]} "
              f"{'领先' if is_desc else '分叉'} {commits} 个提交，涉及 {len(files)} 个文件{suffix}")
        if m.get("module"):
            continue
        with _Index(path, m) as ix:
            ours = set(f for f in ix.git("diff", "--cached", "--name-only", "--no-renames", ix.base)
                       .decode().split("\n") if f)
        both = sorted(set(files) & ours)
        print(f"    其中本仓库也改过 {len(both)} 个（合并时可能冲突）：" + ("、".join(both[:20]) or "无")
              + ("……" if len(both) > 20 else ""))


def sync(name, to=None, into=None):
    """三方合并：共同祖先 = 基准 commit，一方 = 二开树当前内容，另一方 = 上游新 commit。

    用 git 自己的合并算法（merge-tree）：结果与 git merge 一致，冲突以标准标记留在文件里。
    只写工作文件，不提交、不改来源记录——合并后按 04 §4.2–§4.4 重验，再同步 .design/02 §1 与
    来源记录的两个 commit（设计先行，分开提交）。
    """
    path, m = _source_record(name)
    base = str(m["implementation_base_commit"])
    target = to or _reference_head(m)
    if not target:
        sys.exit(f"{path}: 没有 --to，且 .references/{m.get('reference_tree')} 不存在")
    repo, target_tree = upstream_tree(path, m, target)
    target = _run("git", "--git-dir", repo, "rev-parse", target + "^{commit}").decode().strip()
    if target == base:
        print(f"  {name}: 目标即基准 {base[:12]}，无需合并")
        return
    with _Index(path, m) as ix:
        ours_tree = ix.git("write-tree").decode().strip()
        # 当前树做成一个以基准为父的临时 commit（只进缓存对象库），供 merge-tree 做三方合并
        ours = _run("git", "commit-tree", ours_tree, "-p", base, "-m", "current tree",
                    env=dict(ix.env, GIT_AUTHOR_NAME="sync", GIT_AUTHOR_EMAIL="sync@localhost",
                             GIT_COMMITTER_NAME="sync", GIT_COMMITTER_EMAIL="sync@localhost")).decode().strip()
        if target_tree != target:
            # merge-tree 的两侧须为 commit；这里只建缓存视图，真实 target 仍作为父与输出来源。
            target_view = _run("git", "commit-tree", target_tree, "-p", target, "-m", "expanded upstream tree",
                               env=dict(ix.env, GIT_AUTHOR_NAME="sync", GIT_AUTHOR_EMAIL="sync@localhost",
                                        GIT_COMMITTER_NAME="sync", GIT_COMMITTER_EMAIL="sync@localhost")).decode().strip()
        else:
            target_view = target
        r = subprocess.run(["git", "-c", "core.quotepath=off", "merge-tree", "--write-tree", "--name-only",
                            "--merge-base", ix.base, ours, target_view], env=ix.env, capture_output=True, text=True)
        if r.returncode not in (0, 1):
            sys.exit(r.stderr)
        lines = r.stdout.split("\n")
        merged = lines[0].strip()
        conflicted, i = [], 1
        while i < len(lines) and lines[i]:
            conflicted.append(lines[i])
            i += 1
        messages = [l for l in lines[i + 1:] if l]
        out_dir = into or ix.tree
        changes = [l.split("\t") for l in ix.git("diff", "--name-status", "--no-renames", ours_tree, merged)
                   .decode().split("\n") if l]
        for status_, rel in changes:
            dst = os.path.join(out_dir, rel)
            if status_ == "D":
                if os.path.lexists(dst):
                    os.remove(dst)
                continue
            mode, _, obj = ix.git("ls-tree", merged, "--", rel).decode().split("\t")[0].split(" ")
            os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
            if os.path.lexists(dst):
                os.remove(dst)
            data = ix.git("cat-file", "blob", obj)
            if mode == "120000":
                os.symlink(data.decode(), dst)
            else:
                with open(dst, "wb") as f:
                    f.write(data)
                os.chmod(dst, 0o755 if mode == "100755" else 0o644)
    print(f"  {name}: 基准 {base[:12]} → {target[:12]}，写入 {out_dir}：{len(changes)} 个文件变化，"
          f"{len(conflicted)} 个冲突")
    for c in conflicted:
        print(f"    冲突：{c}")
    for msg in messages:
        print(f"    {msg}")
    if conflicted:
        print("  冲突以 <<<<<<< / ======= / >>>>>>> 标记留在文件里；解决后按 04 §4.2–§4.4 重验，"
              "再更新 .design/02 §1 与来源记录的两个 commit")


# ---- 构建 --------------------------------------------------------------------

def plan(name):
    path, m, art = resolve(name)
    if art is None:
        sys.exit(f"{name} 不是登记的产物；可用：" + ", ".join(
            a["name"] for p in records().values() for a in load(p).get("artifacts") or []))
    bad = problems(path, m, check_digest=False)
    if bad:
        sys.exit("\n".join(f"{path}: {b}" for b in bad))
    q = shlex.quote
    print(f"record={q(path)}")
    print(f"tree={q(tree_of(path))}")
    print(f"artifact={q(art['name'])}")
    print(f"kind={q(str(art['kind']))}")
    print(f"base={q(str(m['implementation_base_commit']))}")
    print(f"source_build_id={q(source_digest(art))}")
    print(f"ctx={q(str(art['build_context']))}")
    print(f"dockerfile={q(str(art.get('build_dockerfile') or ''))}")
    print("secrets=(" + " ".join(q(x) for x in _list(art, "build_secrets")) + ")")
    print("build_args=(" + " ".join(q(x) for x in _list(art, "build_args")) + ")")
    print(f"blocked={q(str(art.get('blocked') or ''))}")


def stage(name, dest):
    """构建输入 = inputs 下按仓库忽略规则可见的文件，保持相对 apps/ 的位置——本地路径依赖
    （file:/link:/path:）在构建里与仓库里指向同一处。"""
    _, _, art = resolve(name)
    if os.path.exists(dest) and os.listdir(dest):
        sys.exit(f"{dest} 不是空目录")
    for rel in source_files(*_list(art, "inputs")):
        dst = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.islink(rel):
            os.symlink(os.readlink(rel), dst)
        else:
            shutil.copy2(rel, dst)


def record(name, artifact):
    """只替换该产物块里的两行：记录里的注释是给人读的，不经 YAML 重写。"""
    path, m, art = resolve(name)
    digest = source_digest(art) if artifact != "none" else "none"
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
    # 目录参数按调用处解析，其余路径一律相对 apps/
    a = [os.path.abspath(x) if i > 0 and a[i - 1] in ("--into",) or (a[:1] == ["stage"] and i == 2) else x
         for i, x in enumerate(a)]
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    cmd = a[0] if a else ""
    if cmd == "diff" and len(a) in (2, 3):
        diff(a[1], a[2] if len(a) == 3 else "")
    elif cmd == "added-lines" and len(a) == 2:
        added_lines(a[1])
    elif cmd == "status" and len(a) in (1, 2):
        status(a[1] if len(a) == 2 else None)
    elif cmd == "sync" and len(a) >= 2:
        opts = dict(zip(a[2::2], a[3::2]))
        if set(opts) - {"--to", "--into"} or len(a[2:]) % 2:
            sys.exit(__doc__)
        sync(a[1], opts.get("--to"), opts.get("--into"))
    elif cmd == "plan" and len(a) == 2:
        plan(a[1])
    elif cmd == "stage" and len(a) == 3:
        stage(a[1], a[2])
    elif cmd == "record" and len(a) == 3:
        record(a[1], a[2])
    else:
        sys.exit(__doc__)
