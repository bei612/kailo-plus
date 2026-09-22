#!/usr/bin/env bash
# 初始化并解封 OpenBao，然后启用 audit device。
#
# 07-运行与运维基线.md §1 的三条：不用 server -dev；配置中不出现 disable_mlock
# （SF-OBA-10）；至少一个 audit device——零 device 时 audit broker 的 fail-closed
# 分支被短路、取用不留痕（SF-OBA-06）。
#
# 解封分片与 root token 写入 gitignore 的 secrets/，不进版本库、不进 .env。
# 部署拓扑用外部密钥源做 auto-unseal，本脚本只服务本地开发拓扑。
set -euo pipefail
cd "$(dirname "$0")"
. ./.env

compose() { sudo -n docker compose --env-file .env -f compose.yaml "$@"; }
bao() { compose exec -T -e BAO_ADDR=http://127.0.0.1:8200 openbao bao "$@"; }

umask 077
mkdir -p secrets

status_json=$(bao status -format=json 2>/dev/null || true)
initialized=$(printf '%s' "$status_json" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("initialized",False))' 2>/dev/null || echo False)

if [ "$initialized" != "True" ]; then
  echo "初始化 OpenBao"
  # 先写临时文件，成功且非空才落位：> 会在命令失败前就建好文件，
  # 留下 0 字节产物冒充有效结果——这里丢的是解封分片，raft 数据会永久不可解。
  tmp=$(mktemp)
  if bao operator init -key-shares=1 -key-threshold=1 -format=json > "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" secrets/openbao_init.json
    chmod 600 secrets/openbao_init.json
  else
    rm -f "$tmp"
    echo "初始化失败，未写入分片文件" >&2
    exit 2
  fi
fi

[ -s secrets/openbao_init.json ] || { echo "缺少 secrets/openbao_init.json，无法解封" >&2; exit 2; }

unseal_key=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["unseal_keys_b64"][0])')
root_token=$(python3 -c 'import json;print(json.load(open("secrets/openbao_init.json"))["root_token"])')

# bao status 在封存时以非零码退出，管道加 pipefail 会让判定结果依赖退出码
# 而不是实际状态。这里只看 JSON 内容，取不到就当作封存——宁可多解封一次
# （幂等）也不要漏解封后在后续步骤才发现。
state() {
  bao status -format=json 2>/dev/null | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("unknown"); raise SystemExit
print("unsealed" if not d.get("sealed", True) else "sealed")' 2>/dev/null || echo unknown
}

if [ "$(state)" != "unsealed" ]; then
  echo "解封"
  bao operator unseal "$unseal_key" >/dev/null
fi

# 解封后 raft 节点需要一段时间成为 leader；对 standby 节点写 sys/audit 会得到
# 503 sealed。等到状态既非 sealed 又不是 standby 再继续，不用固定 sleep。
for _ in $(seq 1 30); do
  s=$(bao status -format=json 2>/dev/null || true)
  ok=$(printf '%s' "$s" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("no"); raise SystemExit
print("yes" if not d.get("sealed", True) and d.get("ha_mode") != "standby" else "no")' 2>/dev/null || echo no)
  [ "$ok" = "yes" ] && break
  sleep 2
done
[ "${ok:-no}" = "yes" ] || { echo "OpenBao 在超时内未进入可写状态" >&2; exit 2; }

# audit device 由 openbao-config.hcl 声明式配置，不经 API 启用——该版本
# 直接拒绝 API 创建（SF-OBA-11）。此处只核验它确实生效：零 device 时
# audit broker 的 fail-closed 分支被短路，取用不留痕（SF-OBA-06）。
if compose exec -T -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$root_token" \
     openbao bao audit list 2>/dev/null | grep -q 'file'; then
  echo "audit device 已生效（声明式）"
else
  echo "audit device 未生效：检查 openbao-config.hcl 的 audit 块" >&2
  exit 2
fi


# ---- 平台 namespace、KV v2 与 Core 的 AppRole ----
#
# SecretRef 的 locator 形如 <namespace>/<mount>/<path>（.design/03 §9），
# 这三段在此建立。namespace 是真实隔离边界：mount entry、policy store 与
# token store 都按 namespace 分区（SF-OBA-02），因此按 Tenant 分区的 secret
# 以后加新 namespace 即可，不改这里的形状。
#
# 名字取自 .env，不写死：mount 名是 locator 的一段，属于配置而非常量。
: "${OPENBAO_PLATFORM_NAMESPACE:?缺少 .env 中的 OPENBAO_PLATFORM_NAMESPACE}"
: "${OPENBAO_KV_MOUNT:?缺少 .env 中的 OPENBAO_KV_MOUNT}"

ns() {
  compose exec -T -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$root_token" \
    -e BAO_NAMESPACE="$OPENBAO_PLATFORM_NAMESPACE" openbao bao "$@"
}
root() {
  compose exec -T -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN="$root_token" openbao bao "$@"
}

# 每一步都先查后建：这个脚本要能在已初始化的拓扑上重复跑。
root namespace list 2>/dev/null | grep -qx "${OPENBAO_PLATFORM_NAMESPACE}/" \
  || root namespace create "$OPENBAO_PLATFORM_NAMESPACE" >/dev/null
ns secrets list -format=json 2>/dev/null | grep -q "\"${OPENBAO_KV_MOUNT}/\"" \
  || ns secrets enable -path="$OPENBAO_KV_MOUNT" -version=2 kv >/dev/null
ns auth list -format=json 2>/dev/null | grep -q '"approle/"' \
  || ns auth enable approle >/dev/null

# Core 的策略：只读写自己要用的 KV 路径，不给 delete/destroy。
# secret 的撤销是受治理动作，不是运维旁路（.design/03 §9）——真要撤销时
# 显式扩策略，而不是一开始就把能力留在那里等人用。
ns policy write kailo-core - <<POLICY >/dev/null
path "${OPENBAO_KV_MOUNT}/data/*" {
  capabilities = ["create", "update", "read"]
}
path "${OPENBAO_KV_MOUNT}/metadata/*" {
  capabilities = ["read", "list"]
}
POLICY

# token 生存期短：Core 以 AppRole 换取短 TTL service token（DD-70），
# 到期重新登录，不持有长期凭据。
ns write auth/approle/role/kailo-core \
  token_policies=kailo-core token_ttl=20m token_max_ttl=1h \
  secret_id_num_uses=0 secret_id_ttl=0 >/dev/null

role_id=$(ns read -field=role_id auth/approle/role/kailo-core/role-id)
# secret_id 每次生成都是新的，因此只在文件缺失时生成——重复跑不会让
# 正在运行的 Core 手里那个失效。
if [ ! -s secrets/openbao_core_secret_id ]; then
  tmp=$(mktemp)
  if ns write -f -field=secret_id auth/approle/role/kailo-core/secret-id > "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" secrets/openbao_core_secret_id
    chmod 600 secrets/openbao_core_secret_id
  else
    rm -f "$tmp"; echo "生成 secret_id 失败" >&2; exit 2
  fi
fi

{ printf 'OPENBAO_ROLE_ID=%s\n' "$role_id"
  printf 'OPENBAO_SECRET_ID='; cat secrets/openbao_core_secret_id; printf '\n'; } > secrets/openbao-core.env
chmod 600 secrets/openbao-core.env
printf '  已生成：secrets/openbao-core.env（namespace=%s mount=%s）\n' \
  "$OPENBAO_PLATFORM_NAMESPACE" "$OPENBAO_KV_MOUNT"

printf 'OpenBao 就绪。root token 在 secrets/openbao_init.json，不要外传。\n'
