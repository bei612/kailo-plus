#!/usr/bin/env bash
# 发布与检查入口共用实际容器校验；不创建 builder，不修改限额或 Cargo 并行度。

container_safety_error() {
  printf '容器执行拒绝：%s\n' "$*" >&2
  return 2
}

container_require_data_path() {
  local path
  path=$(realpath -e -- "$1") || {
    container_safety_error "数据路径不存在：$1"; return 2;
  }
  case "$path" in
    /volumes/data/*) printf '%s\n' "$path" ;;
    *) container_safety_error "缓存、临时目录与日志必须位于 /volumes/data：$path" ;;
  esac
}

container_safety_init() {
  CONTAINER_DOCKER=(docker)
  CONTAINER_PRIVILEGE=()
  if ! docker info >/dev/null 2>&1; then
    CONTAINER_DOCKER=(sudo -n -H docker)
    CONTAINER_PRIVILEGE=(sudo -n -H)
    "${CONTAINER_DOCKER[@]}" info >/dev/null 2>&1 || {
      container_safety_error '当前身份与 sudo 均不能读取 Docker daemon'; return 2;
    }
  fi
  [ -n "${TMPDIR:-}" ] || {
    container_safety_error '必须由执行配置提供 TMPDIR'; return 2;
  }
  TMPDIR=$(container_require_data_path "$TMPDIR") || return 2
  [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ] || {
    container_safety_error "TMPDIR 不是可写目录：$TMPDIR"; return 2;
  }
  export TMPDIR
}

container_resource_preflight() {
  printf '现有构建进程（只列身份与用量，不回显参数或凭据）：\n'
  ps -eo pid=,comm=,pcpu=,pmem= | awk \
    '$2 ~ /^(cargo|rustc|go|compile|link|node|docker-buildx|buildctl|buildkitd)$/ { print; found=1 } END { if (!found) print "无适用对象" }'
  printf '构建前 CPU 与内存压力：\n'
  uptime
  awk '/^(MemTotal|MemAvailable):/ {print}' /proc/meminfo
  awk 'FNR == 1 { print FILENAME, $0 }' /proc/pressure/cpu /proc/pressure/memory
}

container_verify_limits() {
  local actual
  actual=$("${CONTAINER_DOCKER[@]}" inspect --format \
    '{"status":{{json .State.Status}},"running":{{json .State.Running}},"memory":{{json .HostConfig.Memory}},"swap":{{json .HostConfig.MemorySwap}},"nanoCpus":{{json .HostConfig.NanoCpus}},"cpuQuota":{{json .HostConfig.CpuQuota}},"cpuPeriod":{{json .HostConfig.CpuPeriod}}}' "$1") || {
    container_safety_error "无法检查实际执行容器：$1"; return 2;
  }
  python3 - "$1" "$actual" <<'PY'
import json, sys
name, raw = sys.argv[1:]
try:
    limits = json.loads(raw)
    integer = lambda key: type(limits[key]) is int
    valid = (limits["status"] in ("created", "running")
             and all(integer(key) for key in ("memory", "swap", "nanoCpus", "cpuQuota", "cpuPeriod"))
             and limits["memory"] > 0 and limits["swap"] >= limits["memory"]
             and (limits["nanoCpus"] > 0
                  or (limits["cpuQuota"] > 0 and limits["cpuPeriod"] > 0)))
    if not valid:
        raise ValueError("容器状态不是 created/running 或缺少有限 CPU、memory、memory+swap 限额")
except (KeyError, TypeError, ValueError) as error:
    print(f"容器执行拒绝：{name}: {error}", file=sys.stderr)
    sys.exit(2)
print(f"容器限额 {name}: " + json.dumps(limits, sort_keys=True))
PY
}

container_require_limited_builder() {
  local description driver node container mounts storage kind source volume endpoint docker_endpoint
  [ -n "${BUILDX_BUILDER:-}" ] || {
    container_safety_error '必须明确选择已有受限 BUILDX_BUILDER，禁止默认 builder 回退'; return 2;
  }
  description=$("${CONTAINER_DOCKER[@]}" buildx inspect "$BUILDX_BUILDER") || {
    container_safety_error "无法读取已有 builder：$BUILDX_BUILDER"; return 2;
  }
  driver=$(awk '$1 == "Driver:" {print $2; exit}' <<< "$description")
  [ "$driver" = docker-container ] || {
    container_safety_error "builder driver 不是可核验本地容器的 docker-container：$driver"; return 2;
  }
  docker_endpoint=$("${CONTAINER_DOCKER[@]}" context inspect --format '{{.Endpoints.docker.Host}}') || return 2
  if [ "${#CONTAINER_PRIVILEGE[@]}" -eq 0 ] && [ -n "${DOCKER_HOST:-}" ] && [ -z "${DOCKER_CONTEXT:-}" ]; then
    docker_endpoint=$DOCKER_HOST
  fi
  [[ "$docker_endpoint" == unix://* ]] || {
    container_safety_error '仅本地 Docker endpoint 能核实实际容器与缓存目录'; return 2;
  }
  local nodes=()
  mapfile -t nodes < <(awk '$1 == "Nodes:" {nodes=1; next} nodes && $1 == "Name:" {print $2}' <<< "$description")
  [ "${#nodes[@]}" -gt 0 ] || {
    container_safety_error 'builder 没有可解析的执行节点'; return 2;
  }
  for node in "${nodes[@]}"; do
    endpoint=$(awk -v node="$node" '$1 == "Name:" {selected=($2 == node)} selected && $1 == "Endpoint:" {print $2; exit}' <<< "$description")
    if [[ "$endpoint" != *://* ]]; then
      endpoint=$("${CONTAINER_DOCKER[@]}" context inspect "$endpoint" --format '{{.Endpoints.docker.Host}}') || return 2
    fi
    [ "$endpoint" = "$docker_endpoint" ] || {
      container_safety_error "builder 节点 $node 不属于已核验的本地 daemon"; return 2;
    }
    container="buildx_buildkit_$node"
    [ "$("${CONTAINER_DOCKER[@]}" inspect --format '{{.State.Running}}' "$container")" = true ] || {
      container_safety_error "BuildKit 执行节点未运行：$container"; return 2;
    }
    container_verify_limits "$container" || return 2
    mounts=$("${CONTAINER_DOCKER[@]}" inspect --format '{{json .Mounts}}' "$container") || return 2
    storage=$(python3 - "$mounts" <<'PY'
import json, sys
mounts = [mount for mount in json.loads(sys.argv[1]) if mount["Destination"] == "/var/lib/buildkit"]
if len(mounts) != 1 or mounts[0]["Type"] not in ("bind", "volume") or mounts[0]["RW"] is not True:
    print("容器执行拒绝：BuildKit 缓存没有唯一可写持久 mount", file=sys.stderr)
    sys.exit(2)
mount = mounts[0]
print(mount["Type"])
print(mount.get("Name", "") if mount["Type"] == "volume" else mount["Source"])
PY
    ) || return 2
    kind=${storage%%$'\n'*}
    source=${storage#*$'\n'}
    if [ "$kind" = volume ]; then
      volume=$("${CONTAINER_DOCKER[@]}" volume inspect "$source") || return 2
      source=$(python3 - "$volume" <<'PY'
import json, sys
volume, = json.loads(sys.argv[1])
options = volume.get("Options") or {}
if (volume["Driver"] != "local" or options.get("type") != "none"
        or "bind" not in options.get("o", "").split(",") or not options.get("device")):
    print("容器执行拒绝：无法证明 BuildKit volume 的实际数据目录", file=sys.stderr)
    sys.exit(2)
print(options["device"])
PY
      ) || return 2
    fi
    source=$(container_require_data_path "$source") || return 2
    printf 'BuildKit 缓存 %s: %s\n' "$container" "$source"
  done
}
