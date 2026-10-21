#!/usr/bin/env bash
# Mobile（Flutter）可重复检查入口。在固定 digest 的 Flutter SDK 镜像里，对一个固定 commit 的
# collaboration/mobile 及其 path: 依赖 client-kit/dart 执行 pub get、format、analyze、test，
# 可选编 debug APK。宿主只做启动器，不运行 Flutter、Dart 或 Gradle（AGENTS.md 规则 22）。
#
# 工具链与发布同源：镜像取自被检查 commit 中 collaboration/fork/packaging/mobile.Dockerfile
# 的 FROM 行（Flutter 3.41.7，对应 collaboration/bin/.flutter-3.41.7.pkg 的上游 Hermit 固定版本），
# 必须带 @sha256 digest；本脚本不另立第二个版本号。release 签名阻断（fork/upstream.yaml）
# 不在本入口范围：debug APK 只是编译证据，不是发布产物。
#
# 用法（在 apps 仓库根或任意子目录）：
#   tools/mobile-check.sh [--ref <commit>] [step...]
#   step 取 pub format analyze test apk，缺省为 pub format analyze test；pub 总是先执行。
#   缺省 --ref 为 HEAD，此时要求已跟踪文件干净：检查对象永远是一个 commit，不是未提交改动。
#
# 执行配置（均须显式给出，不回退默认值；目录必须实际位于 /volumes/data）：
#   TMPDIR                   本次源码导出、日志与产出（结束后保留 out/，删除源码副本）
#   MOBILE_CHECK_CACHE_ROOT  SDK 可写副本（按镜像 ID 区分）、pub 与 Gradle 缓存
#   MOBILE_CHECK_CPUS        容器 CPU 上限，例如 6
#   MOBILE_CHECK_MEMORY      容器内存上限（memory=memory+swap），例如 12g；apk 步骤建议 16g
#                            （android/gradle.properties 的 Gradle 堆为 8G）
#   MOBILE_CHECK_PROXY       依赖下载代理，例如 http://10.203.193.1:3128；
#                            取 none 时以 --network none 执行，pub 走 --offline，须缓存已就绪
#
# 结果：每步打印 `RESULT step=<名> exit=<码> seconds=<秒>`，任一步失败整体退出 1；
# 配置或启动错误退出 2。out/ 下有完整日志、测试 JSON 报告与（若有）APK 及其 SHA-256。
set -euo pipefail

STEPS_ALL=(pub format analyze test apk)
STEPS_DEFAULT=(pub format analyze test)

valid_step() {
  local s
  for s in "${STEPS_ALL[@]}"; do [ "$s" = "$1" ] && return 0; done
  return 1
}

# ---------------------------------------------------------------------------
# 容器内：只在镜像里执行，宿主不会走到这里。
# ---------------------------------------------------------------------------
inner() {
  local image_id=${MOBILE_CHECK_IMAGE_ID:?} jobs=${MOBILE_CHECK_JOBS:?}
  local sdk="/cache/sdk/${image_id#sha256:}"
  # 镜像内 SDK 属 root 且只读；Flutter 工具需要写自身 cache/lockfile、Gradle 需要写 Android SDK
  # （例如按 flutter.ndkVersion 安装 NDK）。因此按镜像 ID 建一份属当前 UID 的副本，完成标记
  # 之后复用；镜像 digest 变化即换一份副本，旧副本不被改写。
  if [ ! -f "$sdk/.complete" ]; then
    echo "== 准备 SDK 可写副本：$sdk =="
    rm -rf -- "$sdk.partial"
    mkdir -p -- "$sdk.partial"
    cp -a /sdks/flutter "$sdk.partial/flutter"
    cp -a "$ANDROID_HOME" "$sdk.partial/android-sdk"
    rm -rf -- "$sdk"
    mv -- "$sdk.partial" "$sdk"
    touch -- "$sdk/.complete"
  fi
  export FLUTTER_ROOT="$sdk/flutter" ANDROID_HOME="$sdk/android-sdk" ANDROID_SDK_ROOT="$sdk/android-sdk"
  export PATH="$FLUTTER_ROOT/bin:$FLUTTER_ROOT/bin/cache/dart-sdk/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  mkdir -p "$HOME" "$PUB_CACHE" "$GRADLE_USER_HOME"
  # Gradle 不读 HTTPS_PROXY；按本次代理生成 Gradle 用户级系统属性（wrapper 与 daemon 都读取）。
  if [ -n "${HTTPS_PROXY:-}" ]; then
    local hostport=${HTTPS_PROXY#*://}; hostport=${hostport%%/*}
    printf 'systemProp.%s.proxyHost=%s\nsystemProp.%s.proxyPort=%s\n' \
      http "${hostport%:*}" http "${hostport##*:}" https "${hostport%:*}" https "${hostport##*:}" \
      >"$GRADLE_USER_HOME/gradle.properties"
    printf 'systemProp.http.nonProxyHosts=localhost|127.0.0.1\n' >>"$GRADLE_USER_HOME/gradle.properties"
  else
    rm -f -- "$GRADLE_USER_HOME/gradle.properties"
  fi
  flutter config --no-analytics >/dev/null
  dart --disable-analytics >/dev/null
  echo "== 工具链 =="
  flutter --version
  java -version 2>&1 | head -1

  local failed=0 step rc start
  run_step() {
    step=$1; shift
    echo; echo "== $step: $* =="
    start=$(date +%s); rc=0
    "$@" || rc=$?
    echo "RESULT step=$step exit=$rc seconds=$(( $(date +%s) - start ))"
    [ "$rc" -eq 0 ] || failed=1
    return "$rc"
  }
  # 格式不符时给出逐文件 diff，修正只在源码仓库里做，不回传容器内的改写。
  format_diff() {
    local file
    dart format --output=none --show=changed . 2>/dev/null |
      sed -n 's/^Changed //p' | while IFS= read -r file; do
        dart format --output=show "$file" | diff -u "$file" - || true
      done
  }
  local offline=()
  [ -n "${HTTPS_PROXY:-}" ] || offline=(--offline)
  # pub 失败时后续步骤没有意义，直接结束。
  run_step pub flutter pub get --enforce-lockfile "${offline[@]}" || exit 1
  for step in "$@"; do
    case "$step" in
      pub) ;;
      format) run_step format dart format --output=none --set-exit-if-changed . || format_diff ;;
      analyze) run_step analyze flutter analyze --no-pub || true ;;
      test) run_step test flutter test --no-pub -j "$jobs" --reporter expanded \
              --file-reporter "json:/out/flutter-test.json" || true ;;
      apk) if run_step apk flutter build apk --debug --no-pub; then
             cp build/app/outputs/flutter-apk/app-debug.apk /out/buzz-mobile_debug.apk
             (cd /out && sha256sum buzz-mobile_debug.apk | tee buzz-mobile_debug.apk.sha256)
           fi ;;
    esac
  done
  exit "$failed"
}

if [ "${1:-}" = --inner ]; then shift; inner "$@"; fi

# ---------------------------------------------------------------------------
# 宿主：启动器。
# ---------------------------------------------------------------------------
self=$(realpath -e -- "$0")
cd "$(dirname "$self")/.." || exit 2
source tools/container-safety.sh
container_safety_init
container_resource_preflight

ref=
steps=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref=${2:?--ref 需要 commit}; shift 2 ;;
    --ref=*) ref=${1#--ref=}; shift ;;
    *) valid_step "$1" || { echo "未知步骤：$1（可选 ${STEPS_ALL[*]}）" >&2; exit 2; }
       steps+=("$1"); shift ;;
  esac
done
[ "${#steps[@]}" -gt 0 ] || steps=("${STEPS_DEFAULT[@]}")

: "${MOBILE_CHECK_CACHE_ROOT:?执行配置必须提供 MOBILE_CHECK_CACHE_ROOT}"
: "${MOBILE_CHECK_CPUS:?执行配置必须提供 MOBILE_CHECK_CPUS}"
: "${MOBILE_CHECK_MEMORY:?执行配置必须提供 MOBILE_CHECK_MEMORY}"
: "${MOBILE_CHECK_PROXY:?执行配置必须提供 MOBILE_CHECK_PROXY（代理 URL 或 none）}"
mkdir -p -- "$MOBILE_CHECK_CACHE_ROOT"
cache=$(container_require_data_path "$MOBILE_CHECK_CACHE_ROOT")

if [ -z "$ref" ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || {
    echo '拒绝检查：工作树有未提交改动；提交后再查，或以 --ref 指定 commit' >&2; exit 2; }
  ref=HEAD
fi
commit=$(git rev-parse --verify "${ref}^{commit}")
image=$(git show "$commit:collaboration/fork/packaging/mobile.Dockerfile" | awk '$1 == "FROM" {print $2; exit}')
[[ "$image" =~ ^[^@[:space:]]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "拒绝检查：mobile.Dockerfile 的 Flutter 镜像未固定 digest：$image" >&2; exit 2; }

if ! "${CONTAINER_DOCKER[@]}" image inspect "$image" >/dev/null 2>&1; then
  echo "== 按 digest 拉取 $image =="
  "${CONTAINER_DOCKER[@]}" pull "$image"
fi
image_id=$("${CONTAINER_DOCKER[@]}" image inspect --format '{{.Id}}' "$image")

if [ "$MOBILE_CHECK_PROXY" = none ]; then
  net=(--network none)
else
  [[ "$MOBILE_CHECK_PROXY" =~ ^https?://[^/[:space:]]+:[0-9]+/?$ ]] || {
    echo "拒绝检查：MOBILE_CHECK_PROXY 须为 http(s)://host:port 或 none" >&2; exit 2; }
  net=(--env "HTTPS_PROXY=$MOBILE_CHECK_PROXY" --env "HTTP_PROXY=$MOBILE_CHECK_PROXY"
       --env "https_proxy=$MOBILE_CHECK_PROXY" --env "http_proxy=$MOBILE_CHECK_PROXY"
       --env "NO_PROXY=localhost,127.0.0.1" --env "no_proxy=localhost,127.0.0.1")
fi
jobs=${MOBILE_CHECK_CPUS%%.*}; [ "${jobs:-0}" -ge 1 ] 2>/dev/null || jobs=1

work=$(mktemp -d "$TMPDIR/mobile-check.XXXXXX")
container_id=
trap 'if [ -n "$container_id" ]; then "${CONTAINER_DOCKER[@]}" rm -f "$container_id" >/dev/null 2>&1 || true; fi; rm -rf -- "$work/src" "$work/tmp"' EXIT
mkdir -p "$work/src" "$work/tmp" "$work/out"
git archive "$commit" -- collaboration/mobile client-kit/dart | tar -xf - -C "$work/src"

printf '检查对象：commit %s（tree %s）\n' "$commit" "$(git rev-parse "$commit^{tree}")"
printf 'Flutter 镜像：%s（image ID %s）\n' "$image" "$image_id"
printf '步骤：%s；产出目录：%s\n' "${steps[*]}" "$work/out"

container_id=$("${CONTAINER_DOCKER[@]}" create --pull=never \
  --cpus "$MOBILE_CHECK_CPUS" --memory "$MOBILE_CHECK_MEMORY" --memory-swap "$MOBILE_CHECK_MEMORY" \
  --user "$(id -u):$(id -g)" "${net[@]}" \
  --mount "type=bind,src=$work/src,dst=/workspace" \
  --mount "type=bind,src=$work/tmp,dst=/tmp" \
  --mount "type=bind,src=$work/out,dst=/out" \
  --mount "type=bind,src=$cache,dst=/cache" \
  --mount "type=bind,src=$self,dst=/mobile-check.sh,readonly" \
  --workdir /workspace/collaboration/mobile \
  --env HOME=/cache/home --env TMPDIR=/tmp --env PUB_CACHE=/cache/pub \
  --env GRADLE_USER_HOME=/cache/gradle --env "MOBILE_CHECK_IMAGE_ID=$image_id" \
  --env "MOBILE_CHECK_JOBS=$jobs" \
  "$image" bash /mobile-check.sh --inner "${steps[@]}")
container_verify_limits "$container_id"
log="$work/out/mobile-check.log"
printf '本次检查日志：%s\n' "$log"
"${CONTAINER_DOCKER[@]}" start -a "$container_id" 2>&1 | tee "$log" || true
rc=$("${CONTAINER_DOCKER[@]}" wait "$container_id")
printf '\n检查 commit %s 退出 %s；日志 %s\n' "$commit" "$rc" "$log"
exit "$rc"
