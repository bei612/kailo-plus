#!/usr/bin/env bash
# 从二开项目的源码构建产物（ADR-06、ADR-16、04-上游适配与升级.md）。
#
# 源码就在本仓库：二开项目（collaboration/、web-client/、model-gateway/、agent-runtime/）是上游
# 固定 commit 的完整源码加本仓库的改动，共用代码 client-kit/ 以本地路径依赖直接引用。本脚本
# 不取源、不打补丁、不拷贝；它把产物的 inputs（按仓库忽略规则可见的文件，保持相对 apps/ 的位置）
# 放进临时目录后构建，并把源码摘要与产物摘要写回来源记录。
#
# 记录的解析、校验、放置与摘要算法只在 tools/upstream_manifest.py：本脚本与
# check.sh seam 共用它，不各算一份。
#
# 用法：tools/build-upstream.sh <产物>
# 产物是来源记录 */fork/upstream.yaml 里 artifacts 的 name：collaboration-relay、desktop-client、
# mobile-client、web-client、model-gateway、agent-runtime。
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

project="${1:?用法: tools/build-upstream.sh <产物>}"
plan=$(python3 tools/upstream_manifest.py plan "$project") || exit 2
eval "$plan"

# 登记为阻断的产物（例如缺 release 签名证书的 Mobile）：构建所需的 secret 齐了才放行，
# 否则如实停下，不以降级构建（debug 证书、无签名）顶替发布产物。
secret_args=()
secret_dir=$(mktemp -d); chmod 700 "$secret_dir"
src=$(mktemp -d); trap 'rm -rf "$src" "$secret_dir"' EXIT
for s in "${secrets[@]}"; do
  if [ -z "${!s:-}" ]; then
    echo "阻断：$artifact 需要构建 secret $s，未提供${blocked:+（$blocked）}" >&2
    exit 3
  fi
  # 以 BuildKit secret 文件交出：不进镜像层、不进构建参数与构建日志。值是已存在的文件
  # 路径时交出文件本身（例如 keystore），否则把值写进仅本人可读的临时文件——经 sudo
  # 调用 docker 时环境变量不会传过去。
  if [ -f "${!s}" ]; then secret_args+=(--secret "id=$s,src=${!s}")
  else (umask 077; printf '%s' "${!s}" >"$secret_dir/$s"); secret_args+=(--secret "id=$s,src=$secret_dir/$s"); fi
done

# 发布配置的非密构建参数（例如安装包显示名 PLATFORM_DISPLAY_NAME，DD-111）：按部署取值，
# 由调用方环境给出；缺任一项即拒绝构建，不回退任何默认值。它们进入构建参数与产物，
# 因此只登记非密值，凭据一律走上面的 build_secrets。
arg_args=()
for a in "${build_args[@]}"; do
  if [ -z "${!a:-}" ] || [ -z "$(printf '%s' "${!a}" | tr -d '[:space:]')" ]; then
    echo "拒绝构建：$artifact 需要发布配置 $a，未提供或只含空白" >&2
    exit 2
  fi
  arg_args+=(--build-arg "$a=${!a}")
done

export DOCKER_BUILDKIT=1
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo -n"

echo "== 源码：$tree（基准 ${base:0:12}） =="
python3 tools/upstream_manifest.py stage "$project" "$src"
[ -d "$src/$ctx" ] || { echo "build_context $ctx 不存在于构建输入" >&2; exit 2; }
dockerfile_args=(-f "$src/$dockerfile")

# 产物有两种形态。镜像：推入 registry，摘要是 registry digest。安装包：记录以
# build_dockerfile 指向本仓库维护的构建文件，其最后一个阶段只含安装包；以
# --output 取出，摘要是安装包字节的 SHA-256。
if [ "$kind" = image ]; then
  tag="local/$artifact:$base"
  echo "== 构建 $tag =="
  # 上游普遍把版本与 revision 作为构建参数注入二进制，并在构建末尾自检——
  # 例如 agentgateway 在 version 为 "unknown" 时直接让构建失败。
  # 取值用基准 commit，产物因此可追溯到它；本仓库改动由写回的 source_digest 追溯。
  if [ -n "${BUILDX_BUILDER:-}" ]; then
    # docker-container builder 的缓存不等于本地 Docker image store；后续 tag/push
    # 需要明确 --load。builder 容器本身承担 CPU/内存限额。
    $SUDO docker buildx build --builder "$BUILDX_BUILDER" --load -q \
      "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" \
      --build-arg "VERSION=${base:0:12}" \
      --build-arg "GIT_REVISION=$base" \
      -t "$tag" "$src/$ctx" >/dev/null
  else
    $SUDO docker build -q \
      "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" \
      --build-arg "VERSION=${base:0:12}" \
      --build-arg "GIT_REVISION=$base" \
      -t "$tag" "$src/$ctx" >/dev/null
  fi
  # 推入本地 registry：自建产物只有 image ID，必须先入 registry 才能按 digest
  # 引用（ADR-06）。REGISTRY 由调用方给出，接入托管 registry 后只改这一个值。
  registry="${REGISTRY:?需要 REGISTRY，例如 127.0.0.1:55000}"
  remote="$registry/$artifact:${base:0:12}"
  $SUDO docker tag "$tag" "$remote"
  $SUDO docker push -q "$remote" >/dev/null
  digest=$($SUDO docker inspect --format '{{index .RepoDigests 0}}' "$remote" | sed 's/.*@//')
  echo "  $remote@$digest"
else
  echo "== 构建 $artifact 安装包 =="
  staged=$(mktemp -d)
  if [ -n "${BUILDX_BUILDER:-}" ]; then
    $SUDO docker buildx build --builder "$BUILDX_BUILDER" --progress=plain \
      "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" --output "type=local,dest=$staged" "$src/$ctx"
  else
    $SUDO docker build --progress=plain "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" \
      --output "type=local,dest=$staged" "$src/$ctx"
  fi
  mapfile -t bundles < <(find "$staged" -maxdepth 1 -type f)
  [ "${#bundles[@]}" -eq 1 ] || { echo "构建应恰好产出 1 个安装包，得到 ${#bundles[@]} 个" >&2; exit 1; }
  digest="sha256:$(sha256sum "${bundles[0]}" | cut -d' ' -f1)"
  out="dist/$artifact"
  mkdir -p "$out"
  $SUDO install -m 0644 -o "$(id -u)" -g "$(id -g)" "${bundles[0]}" "$out/"
  $SUDO rm -rf "$staged"
  echo "  $out/$(basename "${bundles[0]}") $digest"
fi

# 源码摘要与产物摘要一起写回：产物与基准 commit、与当时源码的对应关系是可追溯性的落点。
# check.sh seam 按当前源码重算摘要，与记录一致就意味着产物正是由这份源码构建的；
# 改了源码不重建，那一步当场失败。
python3 tools/upstream_manifest.py record "$project" "$digest"
echo "  已写回 $record"
