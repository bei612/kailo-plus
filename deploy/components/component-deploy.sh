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
#                WeKnora: start.sh --platform-adapter；Wren: tenants/<tenantId> 组件专属
#                OpenBao Agent（compose.adapter-agent.yaml）+ query-governance.yaml overlay，
#                平台 namespace 的 ActionToken/Gateway 公钥取平台 Agent 已渲染的只读文件）。
#                需要 binding 计划、adapter 配置（Wren: config --kind data-query）与
#                adapter-delivery.py reader 已完成。
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
      # Cells native action callback credential: same Agent, second owner-only directory.
      [ -z "$(env_value "$ENV" ADAPTER_AGENT_EXTRA_DIR)" ] || agent+=(-f "$S/deploy/components/compose.adapter-agent.native.yaml")
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
    # 唯一 Wren env 权威含 ${...} 派生值：子 shell 求值单个键，不回显整份 env。
    wren_value() { (set -a; . "$ENV" >/dev/null 2>&1; set +a; printf '%s' "${!1:-}"); }
    compose=(docker compose --env-file "$ENV" -f "$S/data-query/docker/docker-compose.yaml")
    if "$adapter"; then
      # 07 §2.5 / DD-94：两份 OpenBao Agent 投递、各自 namespace 与最小 AppRole。
      # 平台 namespace 的公钥文件由平台 Agent 渲染（只读挂载）；tenants/<tenantId>
      # 的 binding SecretRef 与 api_proxy socket 由本组件专属 Agent 渲染。
      compose+=(-f "$S/data-query/docker/query-governance.yaml")
      delivery=$(wren_value WREN_QUERY_DELIVERY_DIR)
      agent=(env "ADAPTER_AGENT_PROJECT=$(wren_value WREN_QUERY_AGENT_PROJECT)"
        "ADAPTER_AGENT_IMAGE=$(wren_value WREN_QUERY_OPENBAO_IMAGE)"
        "ADAPTER_AGENT_UID=$(wren_value WREN_QUERY_AGENT_UID)" "ADAPTER_AGENT_GID=$(wren_value WREN_QUERY_AGENT_GID)"
        "ADAPTER_AGENT_BOOTSTRAP_DIR=$(wren_value WREN_QUERY_AGENT_BOOTSTRAP_DIR)" "ADAPTER_AGENT_DELIVERY_DIR=$delivery"
        "ADAPTER_AGENT_PLATFORM_NETWORK=$(wren_value WREN_QUERY_PLATFORM_NETWORK)"
        docker compose -f "$S/deploy/components/compose.adapter-agent.yaml")
      "${agent[@]}" config --quiet
      ensure_image "$(wren_value WREN_QUERY_OPENBAO_IMAGE)"
      # 只核对受控投递的路径/身份/引用一致，不读取 secret 值、不打印内容。
      names=(WREN_QUERY_DELIVERY_DIR WREN_QUERY_AGENT_BOOTSTRAP_DIR WREN_QUERY_AGENT_UID WREN_QUERY_AGENT_GID
        WREN_QUERY_AGENT_PROJECT WREN_COMPOSE_PROJECT_NAME WREN_QUERY_ACTION_JWKS_FILE GATEWAY_SERVICE_JWKS_FILE
        ACTION_TOKEN_SIGNING_FILE)
      values=()
      for name in "${names[@]}"; do values+=("$name=$(wren_value "$name")"); done
      env "${values[@]}" python3 -I - <<'PYWREN'
import json, os, re, stat, sys
from pathlib import Path

def refuse(reason):
    print("Wren 治理投递无效：" + reason + "；未启动任何服务", file=sys.stderr)
    sys.exit(2)

def need(condition, reason):
    if not condition:
        refuse(reason)

env = os.environ
def canonical(name):
    raw = env.get(name, "")
    path = Path(raw)
    need(raw.startswith("/") and ".." not in path.parts and path.resolve() == path, name + " 必须是规范绝对路径")
    return path

def private_dir(name):
    path = canonical(name)
    need(path.is_dir() and not path.is_symlink(), name + " 必须是已存在目录")
    info = path.stat()
    need(not info.st_mode & 0o077 and str(info.st_uid) == env["WREN_QUERY_AGENT_UID"], name + " 必须为 0700 且属 WREN_QUERY_AGENT_UID")
    return path

def regular(path, label, private=True):
    need(path.is_file() and not path.is_symlink(), label + " 必须是普通文件")
    need(not private or not path.stat().st_mode & 0o077, label + " 必须 owner-only")
    return path

def public_jwks(path, label):
    regular(path, label, private=False)
    document = json.loads(path.read_text(encoding="utf-8"))
    need(isinstance(document, dict) and set(document) == {"keys"} and isinstance(document["keys"], list) and document["keys"]
         and all(isinstance(k, dict) and not set(k) & {"d", "p", "q", "dp", "dq", "qi", "k", "oth"} for k in document["keys"]),
         label + " 必须是 public-only JWKS")

try:
    need(re.fullmatch(r"[0-9]+", env.get("WREN_QUERY_AGENT_UID", "")) and re.fullmatch(r"[0-9]+", env.get("WREN_QUERY_AGENT_GID", "")),
         "WREN_QUERY_AGENT_UID/GID 必须是数字")
    need(env.get("WREN_QUERY_AGENT_PROJECT") and env["WREN_QUERY_AGENT_PROJECT"] != env.get("WREN_COMPOSE_PROJECT_NAME"),
         "WREN_QUERY_AGENT_PROJECT 必须是独立 Compose 项目")
    delivery = private_dir("WREN_QUERY_DELIVERY_DIR")
    bootstrap = private_dir("WREN_QUERY_AGENT_BOOTSTRAP_DIR")
    need(delivery != bootstrap and delivery not in bootstrap.parents and bootstrap not in delivery.parents,
         "bootstrap 与 delivery 目录必须分离")
    # 平台 namespace 公钥：平台 Agent 已渲染的原文件，不是组件目录内副本。
    action, gateway = canonical("WREN_QUERY_ACTION_JWKS_FILE"), canonical("GATEWAY_SERVICE_JWKS_FILE")
    signing = json.loads(canonical("ACTION_TOKEN_SIGNING_FILE").read_text(encoding="utf-8"))
    need(signing.get("jwksFile") == str(action), "WREN_QUERY_ACTION_JWKS_FILE 必须是 ACTION_TOKEN_SIGNING_FILE 的 jwksFile")
    for path, label in ((action, "ActionToken JWKS"), (gateway, "Gateway service JWKS")):
        need(delivery not in path.parents and bootstrap not in path.parents, label + " 不得复制进组件目录")
        public_jwks(path, label)
    hcl = regular(bootstrap / "adapter-agent.hcl", "adapter-agent.hcl").read_text(encoding="utf-8")
    for name in ("adapter-role-id", "adapter-wrapped-secret-id"):
        regular(bootstrap / name, name)
    query = json.loads(regular(delivery / "query.json", "query.json").read_text(encoding="utf-8"))
    binding = json.loads(regular(delivery / "binding.json", "binding.json").read_text(encoding="utf-8"))
    socket = str(delivery / "bao.sock")
    namespace = "tenants/" + query["tenantId"]
    need(query["actionTokenJwksFile"] == str(action) and query["gatewayJwksFile"] == str(gateway),
         "query.json 的公钥引用必须是两份平台 Agent 渲染文件")
    need(binding["secretSocket"] == socket and binding["secretNamespace"] == namespace, "binding.json socket/namespace 与投递目录不符")
    document = binding["binding"]
    need(all(document[k] == query[k] for k in ("bindingId", "tenantId", "workspaceId", "nativeInstanceRef", "nativeScopeRef")),
         "binding.json 与 query.json 不是同一 binding")
    need(not re.search(r'\bsink\s+"', hcl) and not re.search(r"^\s*cache\s*\{", hcl, re.M), "Agent 不得有 token sink 或 cache")
    need(re.findall(r'^\s*namespace\s*=\s*"([^"]*)"', hcl, re.M) == [namespace], "Agent 必须只在 " + namespace + " 认证")
    need(re.findall(r'^\s*address\s*=\s*"([^"]*)"', hcl, re.M) == [socket], "Agent api_proxy socket 必须是 " + socket)
    destinations = re.findall(r'^\s*destination\s*=\s*"([^"]*)"', hcl, re.M)
    need(destinations and all(Path(d).parent == delivery for d in destinations), "Agent 模板必须只渲染进投递目录")
    need(query["serviceClientSecretFile"] in destinations, "serviceClientSecretFile 必须由 Tenant Agent 渲染")
    versions = {r["secretKey"]: r["version"] for r in document["secretRefs"]}
    for path_key, secret_key in (("connectionSecretPath", "connectionSecretKey"), ("serviceSecretPath", "serviceSecretKey")):
        need(binding[path_key] + "?version=" + str(versions[binding[secret_key]]) in hcl, binding[secret_key] + " 未由 Tenant Agent 版本固定读取")
except (OSError, ValueError, KeyError, TypeError, IndexError):
    refuse("受控文件缺失或格式不符")
print(f"Wren 治理投递校验通过：平台公钥 2 份只读文件 + {namespace} Agent（{len(destinations)} 个模板、api_proxy socket）；不声明 binding 已激活")
PYWREN
    fi
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
    if "$adapter"; then
      echo "== 2. tenants/<tenantId> 组件专属 OpenBao Agent（binding SecretRef + api_proxy socket）"
      # 已在运行且配置未变时不重建；重建或重启前须先重跑 adapter-delivery.py reader
      # 取得新的一次性 wrapped secret_id。
      "${agent[@]}" up -d --no-build --pull never adapter-agent
      for _ in $(seq 60); do [ -S "$delivery/bao.sock" ] && break; sleep 2; done
      [ -S "$delivery/bao.sock" ] || { echo 'Agent socket 未出现；查看 Agent 日志（不含 secret）' >&2; exit 1; }
    fi
    echo "== 3. Wren 原生栈（--no-build，按 digest）"
    "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 900
    origin=$(set -a; . "$ENV"; set +a; printf '%s' "${WREN_PUBLIC_ORIGIN:-}")
    [ -n "$origin" ] && frame_headers "$origin/"
    if "$adapter"; then
      echo "== 回读 Wren 治理投递（只列名称与挂载，不读内容）"
      "${agent[@]}" ps -a --format '{{.Name}}\t{{.Image}}\t{{.Status}}'
      echo "投递目录文件：$(ls -1A "$delivery" | tr '\n' ' ')"
      ui=$("${compose[@]}" ps -q wren-ui)
      "${D[@]}" inspect --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Destination}} rw={{.RW}}{{"\n"}}{{end}}{{end}}' "$ui" \
        | grep -E "^($delivery|$(wren_value WREN_QUERY_ACTION_JWKS_FILE)|$(wren_value GATEWAY_SERVICE_JWKS_FILE)) " \
        || { echo 'wren-ui 缺少治理投递挂载' >&2; exit 1; }
      "${D[@]}" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$ui" | grep -E '^WREN_PLATFORM_(QUERY|BINDING)_CONFIG_FILE=' \
        || { echo 'wren-ui 缺少治理投递环境' >&2; exit 1; }
    fi
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
