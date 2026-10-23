#!/usr/bin/env bash
# Kailo CI 节点：Docker Hub 拉取缓存与 kailo-core-data builder 初始化。
# 用途、数据位置与回退方式见 07-运行与运维基线.md §2.1。
#
# 用法（在 CI 节点以 ubuntu 身份，从仓库检出目录执行）：
#   tools/ci/registry-mirror/setup.sh mirror            启动/更新拉取缓存并等待 healthy
#   tools/ci/registry-mirror/setup.sh warm [apps 目录|镜像引用...]
#                                                         经缓存预取 digest 固定的 Docker Hub 基础镜像（linux/amd64）
#   tools/ci/registry-mirror/setup.sh builder           以 buildkitd.toml 重建 builder，保留限额与持久状态
#   tools/ci/registry-mirror/setup.sh status            读回缓存与 builder 实际状态
#
# 可覆盖的环境变量：
#   DOCKER_CONFIG          构建用 Docker 客户端配置（默认 /volumes/data/kailo/ci/docker）
#   BUILDER                builder 名称（默认 kailo-core-data）
#   BUILDKIT_IMAGE         digest 固定的 BuildKit 镜像
#   MIRROR_PORT            本机监听端口（默认 55001，须与 buildkitd.toml 一致）
#   MIRROR_DATA            缓存数据目录（默认 /volumes/data/kailo/registry-mirror）
#   MIRROR_RUNTIME         运行副本目录：compose.yaml、config.yml、.env（默认 /volumes/kailo/ci/registry-mirror）
#   BUILDKITD_CONFIG       builder 配置（默认本目录 buildkitd.toml；设为空串则不带 mirror 重建，即回退）
#   MIRROR_UPSTREAM_PROXY  上游出口代理；未设置时取 DOCKER_CONFIG 中的 httpsProxy，设为空串则直连
#   BACKUP_ROOT            重建前备份目录（默认 /volumes/data/kailo/ci/backup）
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
apps=$(cd "$here/../../.." && pwd)

export DOCKER_CONFIG=${DOCKER_CONFIG:-/volumes/data/kailo/ci/docker}
BUILDER=${BUILDER:-kailo-core-data}
NODE=${BUILDER}0
CONTAINER=buildx_buildkit_${NODE}
BUILDKIT_IMAGE=${BUILDKIT_IMAGE:-127.0.0.1:55000/moby/buildkit@sha256:040d34121c27906c4ff9ac152a30d52bf2c5d328d3bb748916bb3d2743c02528}
MIRROR_PORT=${MIRROR_PORT:-55001}
MIRROR_DATA=${MIRROR_DATA:-/volumes/data/kailo/registry-mirror}
MIRROR_RUNTIME=${MIRROR_RUNTIME:-/volumes/kailo/ci/registry-mirror}
BUILDKITD_CONFIG=${BUILDKITD_CONFIG-$here/buildkitd.toml}
BACKUP_ROOT=${BACKUP_ROOT:-/volumes/data/kailo/ci/backup}
export MIRROR_PORT MIRROR_DATA

die() { printf 'registry-mirror: %s\n' "$*" >&2; exit 2; }

upstream_proxy() {
  if [ "${MIRROR_UPSTREAM_PROXY+set}" = set ]; then
    printf '%s' "$MIRROR_UPSTREAM_PROXY"; return
  fi
  python3 - "$DOCKER_CONFIG/config.json" <<'PY'
import json, sys
try:
    proxies = json.load(open(sys.argv[1], encoding="utf-8")).get("proxies", {}).get("default", {})
except FileNotFoundError:
    proxies = {}
print(proxies.get("httpsProxy", ""), end="")
PY
}

# 运行副本独立于仓库检出目录，检出删除或切换后容器重启仍读到同一配置；.env 让手工
# docker compose 命令与本脚本得到相同参数。
compose() {
  docker compose --project-directory "$MIRROR_RUNTIME" -f "$MIRROR_RUNTIME/compose.yaml" "$@"
}

install_runtime() {
  local stamp file
  mkdir -p "$MIRROR_RUNTIME"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  for file in compose.yaml config.yml .env; do
    [ -f "$MIRROR_RUNTIME/$file" ] && cp -a "$MIRROR_RUNTIME/$file" "$MIRROR_RUNTIME/$file.bak-$stamp"
  done
  install -m 0644 "$here/compose.yaml" "$here/config.yml" "$MIRROR_RUNTIME/"
  printf 'MIRROR_PORT=%s\nMIRROR_DATA=%s\nMIRROR_USER=%s\nMIRROR_UPSTREAM_PROXY=%s\n' \
    "$MIRROR_PORT" "$MIRROR_DATA" "$(stat -c %u:%g "$MIRROR_DATA")" "$(upstream_proxy)" > "$MIRROR_RUNTIME/.env.tmp"
  mv "$MIRROR_RUNTIME/.env.tmp" "$MIRROR_RUNTIME/.env"
}

cmd_mirror() {
  grep -q "\"127.0.0.1:$MIRROR_PORT\"" "$here/buildkitd.toml" \
    || die "buildkitd.toml 中的 mirror 端口与 MIRROR_PORT=$MIRROR_PORT 不一致"
  case "$(realpath -m -- "$MIRROR_DATA")" in
    /volumes/data/*) ;;
    *) die "缓存数据必须位于 /volumes/data：$MIRROR_DATA" ;;
  esac
  mkdir -p "$MIRROR_DATA"
  install_runtime
  compose up -d --wait --wait-timeout 90
  curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$MIRROR_PORT/v2/" \
    || die "缓存未在 127.0.0.1:$MIRROR_PORT 响应"
  printf '拉取缓存就绪：127.0.0.1:%s，数据 %s，运行副本 %s\n' "$MIRROR_PORT" "$MIRROR_DATA" "$MIRROR_RUNTIME"
}

# 只读 manifest 与 blob 并丢弃内容，由缓存把内容落到自己的存储；不占用 Docker 镜像存储。
cmd_warm() {
  [ "$#" -gt 0 ] || set -- "$apps"
  python3 -I - "$MIRROR_PORT" "$@" <<'PY'
import json, os, re, sys, urllib.request

port, *targets = sys.argv[1:]
base = f"http://127.0.0.1:{port}/v2/"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
FROM = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", re.I | re.M)

def hub_repo(ref):
    """digest 固定的 Docker Hub 引用 -> (repo, digest)；其他 registry 或未固定返回 None。"""
    if "${" in ref or "@sha256:" not in ref:
        return None
    name, digest = ref.split("@", 1)
    first = name.split("/", 1)[0]
    if "/" in name and ("." in first or ":" in first or first == "localhost"):
        if first not in ("docker.io", "registry-1.docker.io", "index.docker.io"):
            return None
        name = name.split("/", 1)[1]
    name = name.rsplit(":", 1)[0] if ":" in name.rsplit("/", 1)[-1] else name
    if "/" not in name:
        name = "library/" + name
    return name, digest

refs = set()
for target in targets:
    if os.path.isdir(target):
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "target", "dist")]
            for f in files:
                if f == "Dockerfile" or f.startswith("Dockerfile.") or f.endswith(".Dockerfile"):
                    try:
                        text = open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
                    except OSError:
                        continue
                    refs.update(m.group(1) for m in FROM.finditer(text))
    else:
        refs.add(target)

def get(path, accept=None):
    req = urllib.request.Request(base + path, headers={"Accept": accept} if accept else {})
    with opener.open(req, timeout=600) as resp:
        if accept:
            return resp.headers.get("Content-Type", ""), resp.read()
        size = 0
        while chunk := resp.read(1 << 20):
            size += len(chunk)
        return size

failed = 0
for repo, digest in sorted({r for r in map(hub_repo, refs) if r}):
    try:
        ctype, body = get(f"{repo}/manifests/{digest}", ACCEPT)
        doc = json.loads(body)
        if "manifests" in doc:
            amd64 = [m for m in doc["manifests"]
                     if m.get("platform", {}).get("os") == "linux"
                     and m.get("platform", {}).get("architecture") == "amd64"]
            if not amd64:
                raise RuntimeError("索引中没有 linux/amd64")
            _, body = get(f"{repo}/manifests/{amd64[0]['digest']}", ACCEPT)
            doc = json.loads(body)
        blobs = [doc["config"]["digest"]] + [layer["digest"] for layer in doc["layers"]]
        total = sum(get(f"{repo}/blobs/{blob}") for blob in blobs)
        print(f"OK   {repo}@{digest}  {len(blobs)} blobs  {total / 1048576:.1f} MiB")
    except Exception as error:  # noqa: BLE001 - 汇总后以非零退出
        failed += 1
        print(f"FAIL {repo}@{digest}: {error}", file=sys.stderr)
sys.exit(1 if failed else 0)
PY
}

# 重建前确认 builder 空闲：容器内只能有 docker-init 与 buildkitd，宿主没有指向它的 buildx 客户端。
builder_idle() {
  local inside clients
  inside=$(docker exec "$CONTAINER" ps -o comm= | grep -vxE 'docker-init|buildkitd|ps' || true)
  clients=$(pgrep -af 'docker-buildx' | grep -E -- "--builder[ =]$BUILDER( |$)" || true)
  if [ -n "$inside" ] || [ -n "$clients" ]; then
    printf '%s\n' "builder $BUILDER 仍有活动会话，拒绝重建：" "$inside" "$clients" >&2
    return 1
  fi
}

cmd_builder() {
  local limits backup memory swap quota period
  local config_args=()
  if [ -n "$BUILDKITD_CONFIG" ]; then
    [ -f "$BUILDKITD_CONFIG" ] || die "缺少 $BUILDKITD_CONFIG"
    config_args=(--buildkitd-config "$BUILDKITD_CONFIG")
  fi
  docker inspect "$CONTAINER" >/dev/null 2>&1 || die "找不到现有 builder 容器 $CONTAINER；首次创建请先按 07 §2.1 确认限额"
  builder_idle || exit 3

  # 限额取自现有实际容器（历史上经 docker update 设置，buildx 实例文件中没有记录），
  # 重建时作为 driver-opt 写入实例，之后的重建不再依赖 docker update。
  limits=$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuQuota}} {{.HostConfig.CpuPeriod}}' "$CONTAINER")
  read -r memory swap quota period <<< "$limits"
  [ "$memory" -gt 0 ] && [ "$swap" -ge "$memory" ] && [ "$quota" -gt 0 ] && [ "$period" -gt 0 ] \
    || die "现有 builder 限额不完整（memory=$memory swap=$swap quota=$quota period=$period），拒绝在无限额状态下重建"

  docker pull -q "$BUILDKIT_IMAGE" >/dev/null || die "无法取得 BuildKit 镜像 $BUILDKIT_IMAGE，未改动现有 builder"

  backup="$BACKUP_ROOT/buildx-$BUILDER-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup"
  cp -a "$DOCKER_CONFIG/buildx/instances/$BUILDER" "$backup/instance.json"
  docker inspect "$CONTAINER" > "$backup/container-inspect.json"
  docker buildx inspect "$BUILDER" > "$backup/buildx-inspect.txt"
  printf '已备份旧 builder 到 %s\n' "$backup"

  create() {
    docker buildx create --name "$BUILDER" --node "$NODE" --driver docker-container \
      --driver-opt "image=$BUILDKIT_IMAGE" \
      --driver-opt network=host \
      --driver-opt "memory=$memory" --driver-opt "memory-swap=$swap" \
      --driver-opt "cpu-quota=$quota" --driver-opt "cpu-period=$period" \
      --buildkitd-flags '--allow-insecure-entitlement=network.host' \
      "$@" --bootstrap
  }
  # --keep-state 保留 buildx_buildkit_<node>_state 卷（bind 到 Data 盘），新容器沿用同名卷。
  docker buildx rm --keep-state "$BUILDER"
  if ! create "${config_args[@]}"; then
    printf '带新配置创建失败，按原参数（不带 buildkitd.toml）恢复 builder\n' >&2
    docker buildx rm --keep-state "$BUILDER" 2>/dev/null || true
    create || die "恢复失败；旧实例与容器参数见 $backup"
    die "已恢复为不带 mirror 的 builder；新配置未生效"
  fi

  # 用发布入口同一套校验读回实际容器：限额、本地 endpoint、Data 盘持久状态。
  (
    export BUILDX_BUILDER=$BUILDER TMPDIR=${TMPDIR:-/volumes/data/kailo/ci/tmp}
    # shellcheck source=../../container-safety.sh
    . "$apps/tools/container-safety.sh"
    container_safety_init
    container_require_limited_builder
  )
  if [ -n "$BUILDKITD_CONFIG" ]; then
    docker exec "$CONTAINER" cat /etc/buildkit/buildkitd.toml | cmp -s - "$BUILDKITD_CONFIG" \
      || die "新 builder 内的 buildkitd.toml 与 $BUILDKITD_CONFIG 不一致"
  fi
  printf '已重建 %s；旧实例备份 %s\n' "$BUILDER" "$backup"
}

cmd_status() {
  compose ps
  curl -fsS --noproxy '*' -o /dev/null -w "mirror /v2/ HTTP %{http_code}\n" "http://127.0.0.1:$MIRROR_PORT/v2/" || true
  du -sh "$MIRROR_DATA" 2>/dev/null || true
  docker buildx inspect "$BUILDER" | sed -n '1,12p'
  docker inspect --format 'limits memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpuQuota={{.HostConfig.CpuQuota}} cpuPeriod={{.HostConfig.CpuPeriod}} network={{.HostConfig.NetworkMode}}' "$CONTAINER"
  docker exec "$CONTAINER" cat /etc/buildkit/buildkitd.toml 2>/dev/null | grep -v '^#' || echo 'builder 内没有 buildkitd.toml'
}

case "${1:-}" in
  mirror) shift; cmd_mirror "$@" ;;
  warm) shift; cmd_warm "$@" ;;
  builder) shift; cmd_builder "$@" ;;
  status) shift; cmd_status "$@" ;;
  *) sed -n '2,23p' "$0" >&2; exit 2 ;;
esac
