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

read -r url commit base div <<EOF
$(python3 - "$manifest" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
def v(k):
    m = re.search(rf"^{k}:\s*(\S+)", raw, re.M)
    return m.group(1) if m else ""
print(v("upstream_url"), v("evidence_commit"), v("implementation_base_commit"), v("base_divergence"))
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

# patch series 按 manifest 顺序应用；为空表示不打补丁
patch_dir="upstream-patches/$project/patches"
if [ -d "$patch_dir" ]; then
  for p in "$patch_dir"/*.patch; do
    [ -e "$p" ] || continue
    echo "  应用 $(basename "$p")"
    git -C "$src" apply "$(realpath "$p")"
  done
fi

tag="kailo/upstream-$project:$base"
echo "== 构建 $tag =="
# 上游普遍把版本与 revision 作为构建参数注入二进制，并在构建末尾自检——
# 例如 agentgateway 在 version 为 "unknown" 时直接让构建失败。
# 取值用 manifest 里的 commit，产物因此天然可追溯到它。
$SUDO docker build -q \
  --build-arg "VERSION=${base:0:12}" \
  --build-arg "GIT_REVISION=$base" \
  -t "$tag" "$src" >/dev/null
# 推入本地 registry：自建产物只有 image ID，必须先入 registry 才能按 digest
# 引用（ADR-06）。REGISTRY 由调用方给出，接入托管 registry 后只改这一个值。
registry="${REGISTRY:?需要 REGISTRY，例如 127.0.0.1:55000}"
remote="$registry/upstream-$project:${base:0:12}"
$SUDO docker tag "$tag" "$remote"
$SUDO docker push -q "$remote" >/dev/null
digest=$($SUDO docker inspect --format '{{index .RepoDigests 0}}' "$remote" | sed 's/.*@//')
echo "  $remote@$digest"

# 把 digest 写回 manifest：产物与 commit 的对应关系是可追溯性的落点
python3 - "$manifest" "$digest" <<'PY'
import re, sys
p, digest = sys.argv[1], sys.argv[2]
raw = open(p, encoding="utf-8").read()
raw = re.sub(r"^artifact_digest:.*$", f"artifact_digest: {digest}", raw, count=1, flags=re.M)
open(p, "w", encoding="utf-8").write(raw)
PY
echo "  已写回 $manifest"
