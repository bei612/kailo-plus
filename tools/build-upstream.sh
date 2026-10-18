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
. tools/container-safety.sh
container_safety_init
container_resource_preflight
container_require_limited_builder
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

# 构建事实（来源记录 build_facts）：本次构建自身的事实，不是部署配置，因此由这里从
# 冻结的源码树与构建时刻推出；源码树不干净时拒绝，不以未提交内容冒充某个 commit。
# 循环变量带 fact_ 前缀：$kind 是本产物的类型（image/安装包），不能被覆盖。
for fact in "${build_facts[@]}"; do
  fact_name=${fact%%=*}; fact_kind=${fact#*=}
  case "$fact_kind" in
    source_commit)
      [ -z "$(git status --porcelain --untracked-files=no)" ] || {
        echo "拒绝构建：$artifact 的构建事实 $fact_name 需要干净的源码树" >&2; exit 2; }
      fact_value=$(git rev-parse HEAD) ;;
    build_time_utc) fact_value=$(date -u +%Y-%m-%dT%H:%M:%S) ;;
    *) echo "拒绝构建：$artifact 的构建事实 $fact_name 种类 $fact_kind 未定义" >&2; exit 2 ;;
  esac
  arg_args+=(--build-arg "$fact_name=$fact_value")
done

export DOCKER_BUILDKIT=1

echo "== 源码：$tree（基准 ${base:0:12}） =="
python3 tools/upstream_manifest.py stage "$project" "$src"
[ -d "$src/$ctx" ] || { echo "build_context $ctx 不存在于构建输入" >&2; exit 2; }
dockerfile_args=(-f "$src/$dockerfile")
container_resource_preflight
container_require_limited_builder
build_log=$(mktemp "$TMPDIR/build-$artifact.XXXXXX.log")
echo "构建日志：$build_log"

# 产物有两种形态。镜像：推入 registry，摘要是 registry digest。安装包：记录以
# build_dockerfile 指向本仓库维护的构建文件，其最后一个阶段只含安装包；以
# --output 取出，摘要是安装包字节的 SHA-256。
if [ "$kind" = image ]; then
  registry="${REGISTRY:?需要 REGISTRY，例如 127.0.0.1:55000}"
  remote="$registry/$artifact:${base:0:12}"
  metadata=$(mktemp "$TMPDIR/build-$artifact.XXXXXX.metadata.json")
  echo "== 构建 $remote =="
  # 上游普遍把版本与 revision 作为构建参数注入二进制，并在构建末尾自检——
  # 例如 agentgateway 在 version 为 "unknown" 时直接让构建失败。
  # 取值用基准 commit，产物因此可追溯到它；本仓库改动由写回的 source_digest 追溯。
  # 直接推送原 registry，不经 daemon image store；metadata 与日志留在 Data。
  # 未成功推送时 pipefail 在此退出，不登记任何候选摘要。
  "${CONTAINER_DOCKER[@]}" buildx build --builder "$BUILDX_BUILDER" --push --progress=plain \
    --metadata-file "$metadata" \
    "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" \
    --build-arg "VERSION=${base:0:12}" \
    --build-arg "GIT_REVISION=$base" \
    --build-arg "PLATFORM_BUILD_ID=$source_build_id" \
    -t "$remote" "$src/$ctx" 2>&1 | tee "$build_log"
  # exporter 的顶层 digest：单平台为 manifest，多平台/证明包为 image index；
  # 不取 config digest 或某个平台子 manifest，不依赖本机同名历史镜像。
  digest=$(container_pushed_image_digest "$metadata")
  echo "  $remote@$digest"
else
  echo "== 构建 $artifact 安装包 =="
  staged=$(mktemp -d)
  "${CONTAINER_DOCKER[@]}" buildx build --builder "$BUILDX_BUILDER" --progress=plain \
    "${dockerfile_args[@]}" "${secret_args[@]}" "${arg_args[@]}" --output "type=local,dest=$staged" "$src/$ctx" \
    2>&1 | tee "$build_log"
  mapfile -t bundles < <(find "$staged" -maxdepth 1 -type f)
  [ "${#bundles[@]}" -eq 1 ] || { echo "构建应恰好产出 1 个安装包，得到 ${#bundles[@]} 个" >&2; exit 1; }
  digest="sha256:$(sha256sum "${bundles[0]}" | cut -d' ' -f1)"
  out="dist/$artifact"
  mkdir -p "$out"
  "${CONTAINER_PRIVILEGE[@]}" install -m 0644 -o "$(id -u)" -g "$(id -g)" "${bundles[0]}" "$out/"
  "${CONTAINER_PRIVILEGE[@]}" rm -rf "$staged"
  echo "  $out/$(basename "${bundles[0]}") $digest"
fi

# 源码摘要与产物摘要一起写回：产物与基准 commit、与当时源码的对应关系是可追溯性的落点。
# check.sh seam 按当前源码重算摘要，与记录一致就意味着产物正是由这份源码构建的；
# 改了源码不重建，那一步当场失败。
python3 tools/upstream_manifest.py record "$project" "$digest"
echo "  已写回 $record"
