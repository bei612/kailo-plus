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

# root token 与解封分片只经 stdin 进入容器。放进 docker 的 -e 或命令参数，
# 任何能看进程表的人都读得到（07 §2、DD-71：secret 不上命令行）。
# stdin 第一行是令牌，其后的内容（例如 policy 正文）原样交给 bao。
# 第一个参数是 namespace，空串表示 root namespace。
run_bao() {
  local nsv=$1; shift
  local env=(-e BAO_ADDR=http://127.0.0.1:8200)
  [ -n "$nsv" ] && env+=(-e "BAO_NAMESPACE=$nsv")
  compose exec -T "${env[@]}" openbao \
    sh -c 'IFS= read -r BAO_TOKEN; export BAO_TOKEN; exec bao "$@"' bao "$@"
}
root() { printf '%s\n' "$root_token" | run_bao "" "$@"; }

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
  # 分片经 stdin 以 key=- 传入。operator unseal 的「-」不读 stdin，会把它当成
  # 分片本身（实测 400 'key' must be a valid hex or base64 string）。
  printf '%s' "$unseal_key" | bao write sys/unseal key=- >/dev/null
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
if root audit list 2>/dev/null | grep -q 'file'; then
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

ns() { printf '%s\n' "$root_token" | run_bao "$OPENBAO_PLATFORM_NAMESPACE" "$@"; }
# 带正文的调用：令牌之后接调用方的 stdin
ns_stdin() { { printf '%s\n' "$root_token"; cat; } | run_bao "$OPENBAO_PLATFORM_NAMESPACE" "$@"; }

# 每一步都先查后建：这个脚本要能在已初始化的拓扑上重复跑。
root namespace list 2>/dev/null | grep -qx "${OPENBAO_PLATFORM_NAMESPACE}/" \
  || root namespace create "$OPENBAO_PLATFORM_NAMESPACE" >/dev/null
ns secrets list -format=json 2>/dev/null | grep -q "\"${OPENBAO_KV_MOUNT}/\"" \
  || ns secrets enable -path="$OPENBAO_KV_MOUNT" -version=2 kv >/dev/null

# KV v2 默认只保留 10 个版本，超出的**静默**删除。SecretRef 钉的是具体版本
# （.design/03 §9），被裁掉的版本就永远读不回来——而 DD-70 规定 SecretRef 不可读
# 时 binding 不得 active，于是一个还在用的 binding 会因为别处的几次轮换而永久
# 失效。实测过：verify 路径写到第 18 版时，最旧可读版本已是第 9 版。
#
# 因此显式设定保留数，并把它登记为部署前置不变式（07 §1）。
# cas_required 是运行期 mount 开关；写入必须携带当前版本 CAS，不能静默覆盖 head。
: "${OPENBAO_KV_MAX_VERSIONS:?缺少 .env 中的 OPENBAO_KV_MAX_VERSIONS}"
ns write "${OPENBAO_KV_MOUNT}/config" max_versions="$OPENBAO_KV_MAX_VERSIONS" cas_required=true >/dev/null
ns read -field=cas_required "${OPENBAO_KV_MOUNT}/config" | grep -qx true \
  || { printf 'OpenBao KV v2 cas_required 未生效\n' >&2; exit 1; }
ns auth list -format=json 2>/dev/null | grep -q '"approle/"' \
  || ns auth enable approle >/dev/null

# Core 的策略：只读写自己要用的 KV 路径，不给 delete/destroy。
# secret 的撤销是受治理动作，不是运维旁路（.design/03 §9）——真要撤销时
# 显式扩策略，而不是一开始就把能力留在那里等人用。
ns_stdin policy write kailo-core - <<POLICY >/dev/null
path "${OPENBAO_KV_MOUNT}/data/*" {
  capabilities = ["create", "update", "read"]
}
path "${OPENBAO_KV_MOUNT}/metadata/*" {
  capabilities = ["read", "list"]
}
POLICY

# ---- Core 的两个 AppRole：引导凭据以 response wrapping 一次性投递（DD-70）----
#
# 上游 AppRole 的默认值是 secret_id_num_uses=0（不限次）、secret_id_ttl=0（永不
# 过期）——一份泄漏的 secret_id 可以无限换 token。这里改为：
#   - secret_id_num_uses=1：换一次 token 即作废，Core 启动时自检这一点；
#   - secret_id_ttl：只够从投递到启动的那一小段；
#   - secret_id_bound_cidrs / token_bound_cidrs：只接受 Core 所在的 app 网络；
#   - token_period：周期令牌，Core 按 lease 续期，不需要也不能重新登录。
# secret_id 本身不落盘：start-core.sh 在启动 Core 前现取一个 wrapped secret_id。
: "${OPENBAO_SECRET_ID_TTL:?缺少 .env 中的 OPENBAO_SECRET_ID_TTL}"
: "${OPENBAO_TOKEN_PERIOD:?缺少 .env 中的 OPENBAO_TOKEN_PERIOD}"
project=$(python3 -c 'import re,io;print(re.search(r"^name: (\S+)", io.open("compose.yaml",encoding="utf-8").read(), re.M).group(1))')
app_cidr=$(sudo -n docker network inspect "${project}_app" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}')
[ -n "$app_cidr" ] || { echo "取不到 ${project}_app 网络的子网，无法做 CIDR 绑定" >&2; exit 2; }
role_opts=(secret_id_num_uses=1 "secret_id_ttl=$OPENBAO_SECRET_ID_TTL"
           "secret_id_bound_cidrs=$app_cidr" "token_bound_cidrs=$app_cidr"
           "token_period=$OPENBAO_TOKEN_PERIOD" token_ttl=0 token_max_ttl=0)

ns write auth/approle/role/kailo-core token_policies=kailo-core "${role_opts[@]}" >/dev/null

# ---- root namespace：Core 只读 audit 清单的 AppRole ----
#
# DD-70 要求 Core 启动时与任一 binding ACTIVE 之前确认 audit device 清单非空。
# sys/audit 只在 root namespace 可用且要求 sudo（上游 restrictedSysAPIs 与
# PathsSpecial.Root），平台 namespace 的 token 读不到。因此单独一个 root
# namespace 的 role，策略只有这一条路径：read 列清单，sudo 是该路径的门槛；
# 启用/停用走 sys/audit/<path>，不在策略内（而且该版本本就拒绝经 API 启用）。
root auth list -format=json 2>/dev/null | grep -q '"approle/"' \
  || root auth enable approle >/dev/null
root_stdin() { { printf '%s\n' "$root_token"; cat; } | run_bao "" "$@"; }
root_stdin policy write kailo-core-audit - <<'POLICY' >/dev/null
path "sys/audit" {
  capabilities = ["read", "sudo"]
}
POLICY
root write auth/approle/role/kailo-core-audit token_policies=kailo-core-audit "${role_opts[@]}" >/dev/null

# ---- 本地核验用的 role（只在本地拓扑）----
#
# 集成核验要走 SecretStore 真实的 unwrap→登录→单次自检路径，但它跑在宿主上，
# 不在 app 网络里，kailo-core 的 CIDR 绑定会（正确地）拒绝它。因此另设一个同
# 策略、同样单次使用与 wrapping 投递、只是不绑 CIDR 的 role，由
# core/verify/seed-secret-ref.sh 在每次核验前现取。部署描述里没有它。
ns write auth/approle/role/kailo-verify token_policies=kailo-core secret_id_num_uses=1 \
  "secret_id_ttl=$OPENBAO_SECRET_ID_TTL" "token_period=$OPENBAO_TOKEN_PERIOD" token_ttl=0 token_max_ttl=0 >/dev/null

# 旧形态的迁移：此前 secret_id 以明文文件投递且不限次。那些 secret_id 在 role
# 改配置后仍按其创建时的 num_uses 有效，必须显式销毁，文件随之删除。
for pair in "kailo-core:secrets/openbao_core_secret_id:ns" "kailo-core-audit:secrets/openbao_core_audit_secret_id:root"; do
  IFS=: read -r role file where <<<"$pair"
  [ -s "$file" ] || continue
  if [ "$where" = ns ]; then
    { printf '%s\n' "$root_token"; cat "$file"; } | run_bao "$OPENBAO_PLATFORM_NAMESPACE" write "auth/approle/role/$role/secret-id/destroy" secret_id=- >/dev/null
  else
    { printf '%s\n' "$root_token"; cat "$file"; } | run_bao "" write "auth/approle/role/$role/secret-id/destroy" secret_id=- >/dev/null
  fi
  rm -f "$file"
  printf '  已销毁并删除明文投递的 %s secret_id\n' "$role"
done

printf 'OpenBao 就绪。启动 Core 用 ./start-core.sh（现取 wrapped secret_id）。root token 在 secrets/openbao_init.json，不要外传。\n'
