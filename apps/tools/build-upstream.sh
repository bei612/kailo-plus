#!/usr/bin/env bash
# 从固定 commit 构建上游产物（ADR-06、04-上游适配与升级.md）。
#
# 只在上游没有覆盖 evidence_commit 的发布产物时使用。构建源是上游仓库本身，
# 不是 .references——那里是只读证据，不在其中开发或构建。
#
# 清单的解析、校验与摘要算法只在 tools/upstream_manifest.py：本脚本与
# check.sh seam 共用它，不各算一份。
#
# 用法：tools/build-upstream.sh [--source-only <目录>] <project>
# project 对应 upstream-patches/<project>/baseline.yaml
#
# --source-only：按清单备好源树（取源、裁剪、打补丁、放入 vendor_files）后放到
# <目录> 并停下，不构建。用于把清单重建出的源树与开发中的上游工作树逐文件比对。
#
# UPSTREAM_MIRROR：取源的替代地址（例如本机已有的上游克隆）。取的仍是清单里那个
# commit——git 按对象哈希校验，换地址换不了内容，只省掉一次慢速的远端拉取。
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

source_only=""
if [ "${1:-}" = "--source-only" ]; then
  source_only="$(realpath -m "${2:?--source-only 需要目录}")"
  shift 2
  [ ! -e "$source_only" ] || { echo "$source_only 已存在" >&2; exit 2; }
fi
project="${1:?用法: tools/build-upstream.sh [--source-only <目录>] <project>}"
manifest="upstream-patches/$project/baseline.yaml"
[ -f "$manifest" ] || { echo "缺少 $manifest" >&2; exit 2; }
plan=$(python3 tools/upstream_manifest.py plan "$manifest") || exit 2
eval "$plan"

export DOCKER_BUILDKIT=1
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -n"

src=$(mktemp -d); trap 'rm -rf "$src"' EXIT
echo "== 取源：${UPSTREAM_MIRROR:-$url} @ ${base:0:12} =="
git init -q "$src"
git -C "$src" remote add origin "${UPSTREAM_MIRROR:-$url}"
git -C "$src" fetch -q --depth 1 origin "$base"
git -C "$src" checkout -q FETCH_HEAD
[ "$(git -C "$src" rev-parse HEAD)" = "$base" ] || { echo "取到的不是 $base" >&2; exit 2; }

# 构建上下文可能在子目录下（例如 buzz-web 的 web/）。默认仓库根。
[ -d "$src/$ctx" ] || { echo "build_context $ctx 不存在于源树" >&2; exit 2; }

# remove_paths：整块删除的上游功能只登记路径，不做成删除补丁——删除补丁带着
# 被删文件的全部正文，几百个文件的裁剪会淹没真正需要审阅的改动。先删后打补丁，
# 补丁以裁剪后的树为基准。登记了却不存在即失败：上游挪了目录时，清单与产物不能
# 悄悄不一致。
for r in "${removed[@]}"; do
  [ -e "$src/$r" ] || { echo "remove_paths 登记的 $r 不存在于源树" >&2; exit 2; }
  git -C "$src" rm -r -q -- "$r"
done
[ "${#removed[@]}" -eq 0 ] || echo "  删除 ${#removed[@]} 个登记路径"

# 按 patch_series 的顺序应用；登记与目录的一致性已由 plan 校验
for p in "${series[@]}"; do
  echo "  应用 $p"
  git -C "$src" apply "$(realpath "$patch_dir/$p")"
done

# vendor_files：本仓库的生成物（contracts 的 TypeScript 绑定、Kailo 共用的平台包）
# 在打完补丁后放进源树。放置规则只在 upstream_manifest.py 的 vendor 里（开发中的
# 上游工作树用同一个命令），目标已存在即失败。
python3 tools/upstream_manifest.py vendor "$manifest" "$src"

if [ -n "$source_only" ]; then
  rm -rf "$src/.git"
  mv "$src" "$source_only"
  echo "  源树：$source_only"
  exit 0
fi

# 产物有两种形态。镜像：用上游自带的 Dockerfile 构建，推入 registry，摘要是
# registry digest。安装包：上游没有打包用的 Dockerfile，清单以 build_dockerfile
# 指向 Kailo 维护的构建文件（相对 apps/），其最后一个阶段只含安装包；以
# --output 取出，摘要是安装包字节的 SHA-256。
if [ -z "$dockerfile" ]; then
  tag="kailo/upstream-$project:$base"
  echo "== 构建 $tag =="
  # 上游普遍把版本与 revision 作为构建参数注入二进制，并在构建末尾自检——
  # 例如 agentgateway 在 version 为 "unknown" 时直接让构建失败。
  # 取值用 manifest 里的 commit，产物因此天然可追溯到它。
  if [ -n "${BUILDX_BUILDER:-}" ]; then
    # docker-container builder 的缓存不等于本地 Docker image store；后续 tag/push
    # 需要明确 --load。builder 容器本身承担 CPU/内存限额。
    $SUDO docker buildx build --builder "$BUILDX_BUILDER" --load -q \
      --build-arg "VERSION=${base:0:12}" \
      --build-arg "GIT_REVISION=$base" \
      -t "$tag" "$src/$ctx" >/dev/null
  else
    $SUDO docker build -q \
      --build-arg "VERSION=${base:0:12}" \
      --build-arg "GIT_REVISION=$base" \
      -t "$tag" "$src/$ctx" >/dev/null
  fi
  # 推入本地 registry：自建产物只有 image ID，必须先入 registry 才能按 digest
  # 引用（ADR-06）。REGISTRY 由调用方给出，接入托管 registry 后只改这一个值。
  registry="${REGISTRY:?需要 REGISTRY，例如 127.0.0.1:55000}"
  remote="$registry/upstream-$project:${base:0:12}"
  $SUDO docker tag "$tag" "$remote"
  $SUDO docker push -q "$remote" >/dev/null
  digest=$($SUDO docker inspect --format '{{index .RepoDigests 0}}' "$remote" | sed 's/.*@//')
  echo "  $remote@$digest"
else
  echo "== 构建 $project 安装包 =="
  staged=$(mktemp -d)
  if [ -n "${BUILDX_BUILDER:-}" ]; then
    $SUDO docker buildx build --builder "$BUILDX_BUILDER" --progress=plain \
      -f "$(realpath "$dockerfile")" --output "type=local,dest=$staged" "$src/$ctx"
  else
    $SUDO docker build --progress=plain -f "$(realpath "$dockerfile")" \
      --output "type=local,dest=$staged" "$src/$ctx"
  fi
  mapfile -t bundles < <(find "$staged" -maxdepth 1 -type f)
  [ "${#bundles[@]}" -eq 1 ] || { echo "构建应恰好产出 1 个安装包，得到 ${#bundles[@]} 个" >&2; exit 1; }
  digest="sha256:$(sha256sum "${bundles[0]}" | cut -d' ' -f1)"
  mkdir -p "dist/$project"
  $SUDO install -m 0644 -o "$(id -u)" -g "$(id -g)" "${bundles[0]}" "dist/$project/"
  $SUDO rm -rf "$staged"
  echo "  dist/$project/$(basename "${bundles[0]}") $digest"
fi

# 补丁摘要与产物摘要一起写回：产物与 commit、与所打补丁和删除清单的对应关系是
# 可追溯性的落点。check.sh seam 看到摘要与字节一致，就意味着产物正是由这些输入
# 构建的；只改补丁不重建，那一步当场失败。
python3 tools/upstream_manifest.py record "$manifest" "$digest"
echo "  已写回 $manifest"
