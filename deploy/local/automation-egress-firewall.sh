#!/usr/bin/env bash
# call_webhook 出站网关的宿主兜底（.design/06 §9.1）。网关的授权规则只放行公网主机名，
# 但主机名可以解析（或换绑）到私网地址；这里按网关固定源地址挡住它新建到私网、
# 宿主自身与保留地址的连接，只放行 jwtAuth 取 JWKS 所需的 OIDC 端点。
# 幂等：每次重建专用链并确保 DOCKER-USER（转发）与 INPUT（发往宿主地址）各挂一次。
# iptables 规则不跨重启保留：宿主重启后、出站网关启动前须重跑本脚本。
set -euo pipefail
cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
ip=${AUTOMATION_EGRESS_GATEWAY_IP:?必须显式提供出站网关地址}
oidc_host=${OIDC_HOST:?必须显式提供 OIDC 主机}
oidc_port=${KEYCLOAK_PORT:?必须显式提供 OIDC 端口}
chain=KAILO-AUTOMATION-EGRESS

iptables -N "$chain" 2>/dev/null || iptables -F "$chain"
# 回包（含 Core → 网关连接的应答）不受限制。
iptables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# JWKS：按 DNAT 前的原始目的地址匹配，经 docker-proxy 或 DNAT 两条路径都成立。
iptables -A "$chain" -p tcp -m conntrack --ctorigdst "$oidc_host" --ctorigdstport "$oidc_port" -j RETURN
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 \
           192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$chain" -d "$net" -j DROP
done
iptables -A "$chain" -j RETURN

iptables -C DOCKER-USER -s "$ip" -j "$chain" 2>/dev/null || iptables -I DOCKER-USER -s "$ip" -j "$chain"
iptables -C INPUT -s "$ip" -j "$chain" 2>/dev/null || iptables -I INPUT -s "$ip" -j "$chain"
echo "automation egress firewall: $ip -> $chain (DOCKER-USER, INPUT)"
