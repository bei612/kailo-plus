#!/usr/bin/env bash
# 从固定 commit 构建上游镜像（ADR-06、04-上游适配与升级.md）。
#
# 只在上游没有覆盖 evidence_commit 的发布镜像时使用。构建源是上游仓库本身，
# 不是 .references——那里是只读证据，不在其中开发或构建。
#
# 用法：tools/build-upstream.sh <project>
# project 对应 upstream-patches/<project>/baseline.yaml
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

project="${1:?用法: tools/build-upstream.sh <project>}"
manifest="upstream-patches/$project/baseline.yaml"
[ -f "$manifest" ] || { echo "缺少 $manifest" >&2; exit 2; }

read -r url commit base div ctx <<EOF
$(python3 - "$manifest" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
def v(k):
    m = re.search(rf"^{k}:\s*(\S+)", raw, re.M)
    return m.group(1) if m else ""
print(v("upstream_url"), v("evidence_commit"), v("implementation_base_commit"), v("base_divergence"), v("build_context") or ".")
PY
)
EOF

# 06 §2 的硬规则：两者不同而声明 none 即失败，防止证据被更高版本悄悄覆盖
if [ "$commit" != "$base" ] && [ "$div" = "none" ]; then
  echo "evidence_commit 与 implementation_base_commit 不同但 base_divergence 为 none" >&2
  exit 2
fi

export DOCKER_BUILDKIT=1
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -n"

src=$(mktemp -d); trap 'rm -rf "$src"' EXIT
echo "== 取源：$url @ ${base:0:12} =="
git init -q "$src"
git -C "$src" remote add origin "$url"
git -C "$src" fetch -q --depth 1 origin "$base"
git -C "$src" checkout -q FETCH_HEAD

# 构建上下文可能在子目录下（例如 buzz-web 的 web/）。默认仓库根。
[ -d "$src/$ctx" ] || { echo "build_context $ctx 不存在于源树" >&2; exit 2; }

# patch series 按 manifest 的 patch_series 顺序应用；为空表示不打补丁。
# 不按目录 glob：未登记的 patch 被悄悄打进去、或登记了的 patch 缺失却照常
# 构建，产物都会与 manifest 声称的不一致。两种情况都在这里拒绝。
patch_dir="upstream-patches/$project/patches"
series_out=$(python3 - "$manifest" "$patch_dir" <<'PY'
import glob, os, re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^patch_series:\s*\[(.*?)\]", raw, re.M | re.S)
series = [x.strip() for x in m.group(1).split(",") if x.strip()] if m else []
present = {os.path.basename(x) for x in glob.glob(os.path.join(sys.argv[2], "*.patch"))}
extra, missing = sorted(present - set(series)), sorted(set(series) - present)
if extra or missing:
    sys.exit(f"patch 目录与 patch_series 不一致：未登记 {extra}，缺失 {missing}")
print("\n".join(series))
PY
) || exit 2
mapfile -t series <<<"$series_out"

# remove_paths：整块删除的上游功能只登记路径，不做成删除补丁——删除补丁带着
# 被删文件的全部正文，几百个文件的裁剪会淹没真正需要审阅的改动。先删后打补丁，
# 补丁以裁剪后的树为基准。登记了却不存在即失败：上游挪了目录时，清单与产物不能
# 悄悄不一致。
removed_out=$(python3 - "$manifest" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"^remove_paths:\s*\[(.*?)\]", raw, re.M | re.S)
paths = [x.strip() for x in m.group(1).split(",") if x.strip()] if m else []
for x in paths:
    if x.startswith("/") or ".." in x.split("/"):
        sys.exit(f"remove_paths 只接受源树内的相对路径：{x}")
if len(set(paths)) != len(paths):
    sys.exit("remove_paths 有重复项")
print("\n".join(paths))
PY
) || exit 2
mapfile -t removed <<<"$removed_out"
for r in "${removed[@]}"; do
  [ -n "$r" ] || continue
  [ -e "$src/$r" ] || { echo "remove_paths 登记的 $r 不存在于源树" >&2; exit 2; }
  git -C "$src" rm -r -q -- "$r"
done
[ -n "${removed[0]}" ] && echo "  删除 $(grep -c . <<<"$removed_out") 个登记路径"

for p in "${series[@]}"; do
  [ -n "$p" ] || continue
  echo "  应用 $p"
  git -C "$src" apply "$(realpath "$patch_dir/$p")"
done

tag="kailo/upstream-$project:$base"
echo "== 构建 $tag =="
# 上游普遍把版本与 revision 作为构建参数注入二进制，并在构建末尾自检——
# 例如 agentgateway 在 version 为 "unknown" 时直接让构建失败。
# 取值用 manifest 里的 commit，产物因此天然可追溯到它。
$SUDO docker build -q \
  --build-arg "VERSION=${base:0:12}" \
  --build-arg "GIT_REVISION=$base" \
  -t "$tag" "$src/$ctx" >/dev/null
# 推入本地 registry：自建产物只有 image ID，必须先入 registry 才能按 digest
# 引用（ADR-06）。REGISTRY 由调用方给出，接入托管 registry 后只改这一个值。
registry="${REGISTRY:?需要 REGISTRY，例如 127.0.0.1:55000}"
remote="$registry/upstream-$project:${base:0:12}"
$SUDO docker tag "$tag" "$remote"
$SUDO docker push -q "$remote" >/dev/null
digest=$($SUDO docker inspect --format '{{index .RepoDigests 0}}' "$remote" | sed 's/.*@//')
echo "  $remote@$digest"

# 两个摘要一起写回 manifest：产物与 commit、与所打 patch 字节的对应关系是
# 可追溯性的落点。同时写，所以 check.sh seam 看到 patch 摘要与目录一致，就
# 意味着 artifact 正是由这些字节构建的；只改 patch 不重建，那一步当场失败。
python3 - "$manifest" "$digest" "$patch_dir" "$removed_out" "${series[@]}" <<'PY'
import hashlib, os, re, sys
p, digest, pdir = sys.argv[1], sys.argv[2], sys.argv[3]
removed = [x for x in sys.argv[4].split("\n") if x]
series = [x for x in sys.argv[5:] if x]
# 摘要覆盖补丁字节与删除清单；两者都为空记 none。与 check.sh seam 的算法一致
ps = "none"
if series or removed:
    h = hashlib.sha256()
    for x in series:
        h.update(open(os.path.join(pdir, x), "rb").read())
    if removed:
        h.update(b"\0remove_paths\0" + "\n".join(removed).encode())
    ps = "sha256:" + h.hexdigest()
raw = open(p, encoding="utf-8").read()
raw = re.sub(r"^patch_series_digest:.*$", f"patch_series_digest: {ps}", raw, count=1, flags=re.M)
raw = re.sub(r"^artifact_digest:.*$", f"artifact_digest: {digest}", raw, count=1, flags=re.M)
open(p, "w", encoding="utf-8").write(raw)
PY
echo "  已写回 $manifest"
