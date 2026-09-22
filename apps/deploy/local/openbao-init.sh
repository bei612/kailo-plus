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

printf 'OpenBao 就绪。root token 在 secrets/openbao_init.json，不要外传。\n'
