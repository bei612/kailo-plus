#!/usr/bin/env bash
# Kailo CI 节点：镜像拉取缓存（Docker Hub、ghcr.io、quay.io、gcr.io）与 kailo-builder 初始化。
# 用途、数据位置与回退方式见 07-运行与运维基线.md §2.1。
#
# 用法（在 CI 节点以 ubuntu 身份，从仓库检出目录执行）：
#   tools/ci/registry-mirror/setup.sh mirror            启动/更新拉取缓存并等待 healthy
#   tools/ci/registry-mirror/setup.sh warm [源码目录|镜像引用...]
#                                                         经缓存预取 digest 固定的基础镜像（linux/amd64；FROM 与 ARG 缺省值）
#   tools/ci/registry-mirror/setup.sh builder           以 buildkitd.toml 重建 builder，保留限额与持久状态
#   tools/ci/registry-mirror/setup.sh status            读回缓存与 builder 实际状态
#
# 可覆盖的环境变量：
#   DOCKER_CONFIG          构建用 Docker 客户端配置（默认 /var/lib/kailo-ci/docker-config）
#   BUILDER                builder 名称（默认 kailo-builder）
#   BUILDKIT_IMAGE         BuildKit 镜像（默认沿用现有 builder 容器的镜像 digest）
#   MIRROR_DATA            缓存数据根，每个上游一个子目录（默认 /volumes/data/kailo/capacity/registry-mirror，4T 容量盘）
#   MIRROR_RUNTIME         运行副本目录：compose.yaml、config.yml、.env（默认 /volumes/kailo/ci/registry-mirror）
#   BUILDKITD_CONFIG       builder 配置（默认本目录 buildkitd.toml；设为空串则不带 mirror 重建，即回退）
#   BACKUP_ROOT            重建前备份目录（默认 /volumes/data/kailo/capacity/ci/backup）
# 出网：缓存直连上游（路由器 OpenWrt 透明代理负责）；本脚本不读取、不写入任何代理设置（OPS-02）。
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
apps=$(cd "$here/../../.." && pwd)

export DOCKER_CONFIG=${DOCKER_CONFIG:-/var/lib/kailo-ci/docker-config}
BUILDER=${BUILDER:-kailo-builder}
NODE=${BUILDER}0
CONTAINER=buildx_buildkit_${NODE}
BUILDKIT_IMAGE=${BUILDKIT_IMAGE:-}
MIRROR_DATA=${MIRROR_DATA:-/volumes/data/kailo/capacity/registry-mirror}
MIRROR_RUNTIME=${MIRROR_RUNTIME:-/volumes/kailo/ci/registry-mirror}
BUILDKITD_CONFIG=${BUILDKITD_CONFIG-$here/buildkitd.toml}
BACKUP_ROOT=${BACKUP_ROOT:-/volumes/data/kailo/capacity/ci/backup}
# 上游 registry -> 本机缓存端口（compose.yaml 的 MIRROR_PORT_* 缺省、buildkitd.toml 的 mirrors 必须一致）
declare -A MIRROR_PORTS=([docker.io]=55001 [ghcr.io]=55004 [quay.io]=55005 [gcr.io]=55006)
export MIRROR_DATA

die() { printf 'registry-mirror: %s\n' "$*" >&2; exit 2; }

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
  printf 'MIRROR_DATA=%s\nMIRROR_USER=%s\n' "$MIRROR_DATA" "$(stat -c %u:%g "$MIRROR_DATA")" > "$MIRROR_RUNTIME/.env.tmp"
  mv "$MIRROR_RUNTIME/.env.tmp" "$MIRROR_RUNTIME/.env"
}

cmd_mirror() {
  local registry port
  for registry in "${!MIRROR_PORTS[@]}"; do
    port=${MIRROR_PORTS[$registry]}
    python3 -I -c '
import sys, tomllib
cfg = tomllib.load(open(sys.argv[1], "rb"))
reg, port = sys.argv[2], sys.argv[3]
ok = cfg.get("registry", {}).get(reg, {}).get("mirrors") == [f"127.0.0.1:{port}"] \
     and cfg["registry"].get(f"127.0.0.1:{port}", {}).get("http") is True
sys.exit(0 if ok else 1)' "$here/buildkitd.toml" "$registry" "$port" \
      || die "buildkitd.toml 中 $registry 的 mirror 不是 127.0.0.1:$port"
    grep -q "{MIRROR_PORT_[A-Z]*:-$port}" "$here/compose.yaml" || die "compose.yaml 缺少端口 $port"
  done
  case "$(realpath -m -- "$MIRROR_DATA")" in
    /volumes/data/*) ;;
    *) die "缓存数据必须位于 /volumes/data（4T 容量盘）：$MIRROR_DATA" ;;
  esac
  mkdir -p "$MIRROR_DATA"
  for registry in "${!MIRROR_PORTS[@]}"; do mkdir -p "$MIRROR_DATA/$registry"; done
  install_runtime
  compose up -d --wait --wait-timeout 90
  for registry in "${!MIRROR_PORTS[@]}"; do
    port=${MIRROR_PORTS[$registry]}
    curl -fsS -o /dev/null "http://127.0.0.1:$port/v2/" || die "$registry 缓存未在 127.0.0.1:$port 响应"
    printf '拉取缓存就绪：%s -> 127.0.0.1:%s，数据 %s/%s\n' "$registry" "$port" "$MIRROR_DATA" "$registry"
  done
  printf '运行副本 %s\n' "$MIRROR_RUNTIME"
}

# 只读 manifest 与 blob 并丢弃内容，由缓存把内容落到自己的存储；不占用 Docker 镜像存储。
cmd_warm() {
  [ "$#" -gt 0 ] || set -- "$apps"
  local ports
  ports=$(for r in "${!MIRROR_PORTS[@]}"; do printf '%s=%s,' "$r" "${MIRROR_PORTS[$r]}"; done)
  python3 -I - "$ports" "$@" <<'PY'
import json, os, re, sys, urllib.request

ports_arg, *targets = sys.argv[1:]
PORTS = dict(item.split("=", 1) for item in ports_arg.split(",") if item)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
FROM = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", re.I | re.M)
# 基础镜像也常写成 ARG 缺省值（ARG RUST_IMAGE=rust:1.94.0@sha256:...，FROM ${RUST_IMAGE}）
ARG = re.compile(r"^\s*ARG\s+\w+=(\S+@sha256:[0-9a-f]{64})\s*$", re.I | re.M)

def mirror_repo(ref):
    """digest 固定的引用 -> (registry, repo, digest)；无对应缓存的 registry 或未固定返回 None。"""
    if "${" in ref or "@sha256:" not in ref:
        return None
    name, digest = ref.split("@", 1)
    first = name.split("/", 1)[0]
    registry = "docker.io"
    if "/" in name and ("." in first or ":" in first or first == "localhost"):
        registry = {"registry-1.docker.io": "docker.io", "index.docker.io": "docker.io"}.get(first, first)
        name = name.split("/", 1)[1]
    if registry not in PORTS:
        return None
    name = name.rsplit(":", 1)[0] if ":" in name.rsplit("/", 1)[-1] else name
    if registry == "docker.io" and "/" not in name:
        name = "library/" + name
    return registry, name, digest

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
                    refs.update(m.group(1) for m in ARG.finditer(text))
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
for registry, repo, digest in sorted({r for r in map(mirror_repo, refs) if r}):
    base = f"http://127.0.0.1:{PORTS[registry]}/v2/"
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
        print(f"OK   {registry}/{repo}@{digest}  {len(blobs)} blobs  {total / 1048576:.1f} MiB")
    except Exception as error:  # noqa: BLE001 - 汇总后以非零退出
        failed += 1
        print(f"FAIL {registry}/{repo}@{digest}: {error}", file=sys.stderr)
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

  # 缺省沿用现有容器的镜像（按 digest），重建只改配置不换 BuildKit 版本。新实例不带任何 env.* driver-opt（不设代理）。
  [ -n "$BUILDKIT_IMAGE" ] || BUILDKIT_IMAGE=$(docker inspect --format '{{.Image}}' "$CONTAINER")
  docker image inspect "$BUILDKIT_IMAGE" >/dev/null 2>&1 || docker pull -q "$BUILDKIT_IMAGE" >/dev/null \
    || die "无法取得 BuildKit 镜像 $BUILDKIT_IMAGE，未改动现有 builder"

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
    export BUILDX_BUILDER=$BUILDER TMPDIR=${TMPDIR:-/var/lib/kailo-ci/tmp}
    # shellcheck source=../../container-safety.sh
    . "$apps/tools/container-safety.sh"
    container_safety_init
    container_require_limited_builder
  )
  if [ -n "$BUILDKITD_CONFIG" ]; then
    # buildx 写入容器时会重新序列化 TOML（去掉注释），按解析结果比较。
    docker exec "$CONTAINER" cat /etc/buildkit/buildkitd.toml | python3 -c '
import sys, tomllib
if tomllib.loads(sys.stdin.read()) != tomllib.load(open(sys.argv[1], "rb")):
    sys.exit(1)' "$BUILDKITD_CONFIG" || die "新 builder 内的 buildkitd.toml 与 $BUILDKITD_CONFIG 不一致"
  fi
  printf '已重建 %s；旧实例备份 %s\n' "$BUILDER" "$backup"
}

cmd_status() {
  compose ps
  local registry
  for registry in "${!MIRROR_PORTS[@]}"; do
    curl -sS -o /dev/null -w "$registry 127.0.0.1:${MIRROR_PORTS[$registry]} /v2/ HTTP %{http_code}\n" \
      "http://127.0.0.1:${MIRROR_PORTS[$registry]}/v2/" || true
    du -sh "$MIRROR_DATA/$registry" 2>/dev/null || true
  done
  docker buildx inspect "$BUILDER" | sed -n '1,12p'
  docker inspect --format 'limits memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpuQuota={{.HostConfig.CpuQuota}} cpuPeriod={{.HostConfig.CpuPeriod}} network={{.HostConfig.NetworkMode}}' "$CONTAINER"
  docker exec "$CONTAINER" cat /etc/buildkit/buildkitd.toml 2>/dev/null | grep -v '^#' || echo 'builder 内没有 buildkitd.toml'
}

case "${1:-}" in
  mirror) shift; cmd_mirror "$@" ;;
  warm) shift; cmd_warm "$@" ;;
  builder) shift; cmd_builder "$@" ;;
  status) shift; cmd_status "$@" ;;
  *) sed -n '2,22p' "$0" >&2; exit 2 ;;
esac
