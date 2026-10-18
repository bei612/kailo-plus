#!/usr/bin/env bash
# 按固定发布树部署一个业务能力参考实现（Cells / WeKnora / Wren），与
# ~/kailo-deploy/core-release.sh 同构：固定 GitHub 发布树 + 运行投递 → 备份 →
# 组件自带入口（只取 digest 固定镜像，--no-build）→ 回读镜像/健康/嵌入头 →
# 确认无关容器未变。不创建 release/binding、不写 OpenBao 业务 secret、不改平台 .env。
#
# 用法（CI 节点，ubuntu）：
#   kailo-ci submit <commit> fetch            # 先准备 /volumes/kailo/ci/sources/<commit>/apps
#   component-deploy.sh <file-storage|knowledge|data-query> <commit> [--check] [--adapter]
#     --check    只做配置与镜像校验（各组件原 --check/--validate/config --quiet），不启动
#     --adapter  另起 adapter（Cells: 组件专属 OpenBao Agent + start.sh --platform-adapter；
#                WeKnora: start.sh --platform-adapter）。需要 binding 计划、adapter 配置与
#                adapter-delivery.py reader 已完成；Wren 的治理 overlay 本批不启用。
# 环境：COMPONENT_ENV_FILE 覆盖默认受控 env；COMPONENT_BACKUP_ROOT（默认 /volumes/data/kailo/backups/components）。
set -euo pipefail
component=${1:?component}
commit=${2:?commit}
shift 2
check=false
adapter=false
for option in "$@"; do
  case "$option" in
    --check) check=true ;;
    --adapter) adapter=true ;;
    *) echo "未知参数 $option" >&2; exit 2 ;;
  esac
done
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo '必须是 40 位完整 commit' >&2; exit 2; }
S=/volumes/kailo/ci/sources/$commit/apps
R=/volumes/kailo/apps/deploy/local
[ -d "$S/deploy/local" ] || { echo "缺少固定发布树 $S（先 kailo-ci submit $commit fetch）" >&2; exit 2; }
for n in .env secrets data; do [ -e "$S/deploy/local/$n" ] || ln -s "$R/$n" "$S/deploy/local/$n"; done
D=(sudo -n docker)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_root=${COMPONENT_BACKUP_ROOT:-/volumes/data/kailo/backups/components}
before=$("${D[@]}" ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}' | sort -k2)

private_env() {
  local file=$1
  [ -f "$file" ] && [ "$(stat -c '%a' -- "$file")" = 600 ] || { echo "受控 env 必须存在且为 0600：$file" >&2; exit 2; }
}
# 只取单个非 secret 键；不 source、不回显整份 env。
env_value() {
  python3 -I - "$1" "$2" <<'PY'
import re, sys
name = sys.argv[2]
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"^" + re.escape(name) + r"=(.*)$", line.rstrip("\n"))
    if m:
        v = m.group(1)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        print(v)
        break
PY
}
# 镜像必须 digest 固定；本地缺失时从本机 registry 按 digest 拉取（不按 tag）。
ensure_image() {
  local ref=$1
  [[ $ref =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo "镜像未按 digest 固定或仍是占位：$ref" >&2; exit 2; }
  "${D[@]}" image inspect "$ref" >/dev/null 2>&1 || "${D[@]}" pull --quiet "$ref" >/dev/null
  echo "镜像就绪 $ref"
}
backup_pg() {  # <container> <db> <user>
  local container=$1 db=$2 user=$3 dir
  "${D[@]}" inspect "$container" >/dev/null 2>&1 || { echo "无运行中的 $container，跳过数据库备份"; return 0; }
  dir="$backup_root/$component/$stamp"
  mkdir -p "$dir" && chmod 700 "$backup_root" "$backup_root/$component" "$dir"
  "${D[@]}" exec "$container" pg_dump -Fc -U "$user" -d "$db" > "$dir/$db.dump"
  chmod 600 "$dir/$db.dump"
  [ -s "$dir/$db.dump" ] || { echo "备份为空：$dir/$db.dump" >&2; exit 1; }
  echo "备份 $container/$db → $dir/$db.dump ($(stat -c %s "$dir/$db.dump") bytes)"
}
frame_headers() {  # <url>：只打印嵌入相关响应头
  local url=$1 headers
  headers=$(curl -sS -m 15 -D - -o /dev/null "$url" | tr -d '\r' | grep -iE '^(content-security-policy|x-frame-options|location):' || true)
  echo "$url"; printf '%s\n' "${headers:-（无 CSP/XFO 头）}" | sed 's/^/  /'
  if grep -qi 'frame-ancestors' <<<"$headers" && ! grep -qi "frame-ancestors[^;]*http://192.168.0.193:58090" <<<"$headers"; then
    echo "  注意：frame-ancestors 不含 http://192.168.0.193:58090" >&2
  fi
}

case "$component" in
  file-storage)
    ENV=${COMPONENT_ENV_FILE:-/volumes/data/kailo/components/cells/deploy.env}
    private_env "$ENV"
    here=$S/file-storage/deploy
    project=$(env_value "$ENV" CELLS_COMPOSE_PROJECT)
    ensure_image "$(env_value "$ENV" CELLS_IMAGE)"
    if "$check"; then
      bash "$here/start.sh" --check "$ENV"
      if "$adapter"; then ensure_image "$(env_value "$ENV" CELLS_ADAPTER_IMAGE)"; bash "$here/start.sh" --check --platform-adapter "$ENV"; fi
      exit 0
    fi
    echo "== 1. 备份 Cells 数据库（数据目录原地保留）"
    backup_pg "$project-cells-db-1" "$(env_value "$ENV" CELLS_DB_NAME)" "$(env_value "$ENV" CELLS_DB_USER)"
    echo "== 2. Cells（同一 Compose 项目原地替换）"
    bash "$here/start.sh" "$ENV"
    if "$adapter"; then
      echo "== 3. 组件专属 OpenBao Agent"
      ensure_image "$(env_value "$ENV" ADAPTER_AGENT_IMAGE)"
      ensure_image "$(env_value "$ENV" CELLS_ADAPTER_IMAGE)"
      agent=("${D[@]}" compose --env-file "$ENV" -f "$S/deploy/components/compose.adapter-agent.yaml")
      "${agent[@]}" config --quiet
      "${agent[@]}" up -d --no-build --pull never adapter-agent
      delivery=$(env_value "$ENV" CELLS_ADAPTER_DELIVERY_DIR)
      for _ in $(seq 60); do [ -S "$delivery/bao.sock" ] && break; sleep 2; done
      [ -S "$delivery/bao.sock" ] || { echo 'Agent socket 未出现；查看 Agent 日志（不含 secret）' >&2; exit 1; }
      echo "== 4. Cells adapter"
      bash "$here/start.sh" --platform-adapter "$ENV"
    fi
    readback_project=$project
    frame_headers "$(env_value "$ENV" CELLS_EXTERNAL)/"
    ;;
  knowledge)
    ENV=${COMPONENT_ENV_FILE:-/volumes/data/kailo/components/knowledge/native.env}
    private_env "$ENV"
    here=$S/knowledge/fork/deploy
    for kind in APP UI DOCREADER; do
      ensure_image "$(env_value "$ENV" "KNOWLEDGE_${kind}_REPOSITORY")@sha256:$(env_value "$ENV" "KNOWLEDGE_${kind}_DIGEST")"
    done
    if "$adapter"; then
      ensure_image "$(env_value "$ENV" KNOWLEDGE_ADAPTER_REPOSITORY)@sha256:$(env_value "$ENV" KNOWLEDGE_ADAPTER_DIGEST)"
      ensure_image "$(env_value "$ENV" KNOWLEDGE_ADAPTER_AGENT_REPOSITORY)@sha256:$(env_value "$ENV" KNOWLEDGE_ADAPTER_AGENT_DIGEST)"
    fi
    if "$check"; then
      bash "$here/start.sh" --native-env "$ENV" --platform-model "$R/.env" --validate
      if "$adapter"; then bash "$here/start.sh" --native-env "$ENV" --platform-model "$R/.env" --platform-adapter --validate; fi
      exit 0
    fi
    echo "== 1. 备份 WeKnora 数据库（命名卷原地保留）"
    backup_pg kailo-knowledge-postgres-1 "$(env_value "$ENV" KNOWLEDGE_DB_NAME)" "$(env_value "$ENV" KNOWLEDGE_DB_USER)"
    echo "== 2. 独立原生栈（frontend/app/docreader/postgres/redis，同一 kailo-knowledge 项目原地替换）"
    bash "$here/start.sh" --native-env "$ENV"
    echo "== 3. 平台模型入口（只重建 app）"
    bash "$here/start.sh" --native-env "$ENV" --platform-model "$R/.env"
    if "$adapter"; then
      echo "== 4. adapter + 组件专属 OpenBao Agent（同时重建 app 以消费同一 MCP 投递）"
      bash "$here/start.sh" --native-env "$ENV" --platform-model "$R/.env" --platform-adapter
    fi
    readback_project=kailo-knowledge
    frame_headers "$(env_value "$ENV" KNOWLEDGE_NATIVE_ORIGIN)/"
    ;;
  data-query)
    ENV=${COMPONENT_ENV_FILE:-$R/.env}
    "$adapter" && { echo 'Wren 治理 overlay（query-governance.yaml）本批阻断，不随部署启用' >&2; exit 2; }
    compose=(docker compose --env-file "$ENV" -f "$S/data-query/docker/docker-compose.yaml")
    "${compose[@]}" config --quiet
    while read -r image; do ensure_image "$image"; done < <("${compose[@]}" config --images | sort -u)
    "$check" && exit 0
    readback_project=$("${compose[@]}" config --format json | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["name"])')
    echo "== 1. 备份 Wren 原生 UI 数据卷（若已存在）"
    volume="${readback_project}_native-ui-data"
    if "${D[@]}" volume inspect "$volume" >/dev/null 2>&1; then
      dir="$backup_root/$component/$stamp"; mkdir -p "$dir" && chmod 700 "$backup_root" "$backup_root/$component" "$dir"
      "${D[@]}" run --rm --network none -v "$volume:/v:ro" -v "$dir:/b" --entrypoint tar \
        "$(env_value "$R/.env" WREN_QDRANT_IMAGE)" -C /v -czf /b/native-ui-data.tgz . 2>/dev/null \
        || echo "注意：无法用 qdrant 镜像打包 $volume，请手工备份" >&2
    fi
    echo "== 2. Wren 原生栈（--no-build，按 digest）"
    "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 900
    origin=$(set -a; . "$ENV"; set +a; printf '%s' "${WREN_PUBLIC_ORIGIN:-}")
    [ -n "$origin" ] && frame_headers "$origin/"
    ;;
  *) echo "未知组件 $component" >&2; exit 2 ;;
esac

echo "== 回读 $readback_project"
"${D[@]}" ps -a --filter "label=com.docker.compose.project=$readback_project" \
  --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | sort
for id in $("${D[@]}" ps -aq --filter "label=com.docker.compose.project=$readback_project"); do
  "${D[@]}" inspect --format '{{.Name}} image={{.Image}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}} wd={{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id"
done
after=$("${D[@]}" ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}' | sort -k2)
gone=$(comm -23 <(awk '{print $2}' <<<"$before" | sort) <(awk '{print $2}' <<<"$after" | sort))
[ -z "$gone" ] && echo "其余容器名全部仍在运行" || echo "注意：不再运行：$gone"
echo "组件已部署；release/binding 激活与侧栏入口不由本脚本证明"
