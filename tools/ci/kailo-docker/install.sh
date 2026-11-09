#!/usr/bin/env bash
# Kailo 专用的第二套 dockerd（ADR-20 §13）：与节点上其他项目使用的系统默认 dockerd 完全隔离。
#   - 独立 data-root /var/lib/kailo-docker、exec-root、pidfile、unix socket /run/kailo-docker/docker.sock
#   - 独立 bridge kailo0（10.239.0.1/16）与地址池 10.240.0.0/16、10.241.0.0/16（不与默认 dockerd 的 172.16/12 冲突）
#   - 共用宿主 containerd，但用独立 namespace（kailo / kailo-plugins），互不可见
#   - iptables=false：不改默认 dockerd 的 DOCKER 链；出网 NAT 由本脚本装的 nft 表 kailo_nat 负责，端口发布走 userland-proxy
#   - 经 WG 以 mTLS 监听 tcp://<wg 地址>:2376
#   - dockerd 与它的全部容器（daemon.json cgroup-parent）运行在 kailo.slice（硬内存上限，缺省 36G）；
#     kailo-ci.slice（缺省 24G）是其子 slice，装 CI worker 进程，检查容器显式 CHECK_CGROUP_PARENT 时也可进入
# 幂等：重复执行结果不变；只写 Kailo 自己的路径，不碰 /etc/docker、docker.service、默认 docker0/网络。
# 用法（CI 节点 root）：install.sh <tls 目录> [wg 地址...]
#   tls 目录需含 ca.pem server-cert.pem server-key.pem（由 tls.sh 生成）
set -euo pipefail
TLS=${1:?tls dir}; shift
ADDRS=("$@"); [ ${#ADDRS[@]} -gt 0 ] || ADDRS=(10.203.194.2)
MEM=${KAILO_SLICE_MEMORY_MAX:-36G}
CI_MEM=${KAILO_CI_SLICE_MEMORY_MAX:-24G}
# default builder 的构建缓存上限（与 tools/ci/retention/policy.json 的 default 一致）；镜像层与该缓存在共用 containerd 的 NVMe 上
KEEP=${KAILO_BUILDER_KEEP_STORAGE:-60GB}
# 出网：节点不设任何代理，dockerd 直连（路由器 OpenWrt 透明代理负责，OPS-02）。
# Docker Hub 拉取先经本机拉取缓存（tools/ci/registry-mirror，数据在 4T 容量盘）；缓存不可用时 dockerd 自动回退原站。
# 设为空串则不写 registry-mirrors。
MIRROR=${KAILO_DOCKERD_REGISTRY_MIRROR-http://127.0.0.1:55001}
mirrors=
[ -z "$MIRROR" ] || mirrors="
  \"registry-mirrors\": [\"$MIRROR\"],"
ETC=/etc/kailo-docker
install -d -m 0755 $ETC /var/lib/kailo-docker /run/kailo-docker
install -d -m 0700 $ETC/tls
for f in ca.pem server-cert.pem server-key.pem; do install -m 0600 "$TLS/$f" $ETC/tls/$f; done
hosts='"unix:///run/kailo-docker/docker.sock"'
for a in "${ADDRS[@]}"; do hosts="$hosts, \"tcp://$a:2376\""; done
cat > $ETC/daemon.json.new <<JSON
{
  "hosts": [$hosts],
  "tlsverify": true,
  "tlscacert": "$ETC/tls/ca.pem",
  "tlscert": "$ETC/tls/server-cert.pem",
  "tlskey": "$ETC/tls/server-key.pem",
  "data-root": "/var/lib/kailo-docker",
  "exec-root": "/run/kailo-docker-exec",
  "pidfile": "/run/kailo-docker.pid",
  "containerd-namespace": "kailo",
  "containerd-plugins-namespace": "kailo-plugins",
  "bridge": "kailo0",
  "iptables": false,
  "ip6tables": false,
  "ip-masq": false,
  "userland-proxy": true,
  "live-restore": true,
  "default-address-pools": [
    {"base": "10.240.0.0/16", "size": 24},
    {"base": "10.241.0.0/16", "size": 24}
  ],
  "log-driver": "json-file",
  "log-opts": {"max-size": "50m", "max-file": "5"},$mirrors
  "cgroup-parent": "kailo.slice",
  "builder": {"gc": {"enabled": true, "defaultKeepStorage": "$KEEP"}}
}
JSON
mv $ETC/daemon.json.new $ETC/daemon.json
cat > /etc/systemd/system/kailo.slice <<UNIT
[Unit]
Description=Kailo workloads (production, components, CI) isolated from other projects on this node
[Slice]
MemoryAccounting=yes
MemoryMax=$MEM
MemorySwapMax=0
CPUWeight=80
UNIT
cat > /etc/systemd/system/kailo-ci.slice <<UNIT
[Unit]
Description=Kailo CI checks and builds (sub-slice of kailo.slice)
[Slice]
MemoryMax=$CI_MEM
MemorySwapMax=0
CPUWeight=50
UNIT
cat > /usr/local/sbin/kailo-docker-net <<'NET'
#!/bin/sh
# kailo0 bridge + outbound NAT for the Kailo dockerd (which runs with iptables=false).
set -e
ip link show kailo0 >/dev/null 2>&1 || ip link add kailo0 type bridge
ip addr show kailo0 | grep -q 10.239.0.1/16 || ip addr add 10.239.0.1/16 dev kailo0
ip link set kailo0 up
sysctl -qw net.ipv4.ip_forward=1
nft -f - <<'NFT'
table ip kailo_nat
delete table ip kailo_nat
table ip kailo_nat {
  chain kailo_postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    ip saddr { 10.239.0.0/16, 10.240.0.0/15 } ip daddr != { 10.239.0.0/16, 10.240.0.0/15 } masquerade
  }
}
NFT
# Forwarding: when the system dockerd is present its FORWARD policy is DROP and an accept in another nft base chain
# cannot override it, so Kailo subnets are allowed in DOCKER-USER (Docker's chain reserved for user rules; it never
# flushes it). Only Kailo source/destination subnets match, so other projects' traffic is untouched.
CHAIN=DOCKER-USER; iptables -n -L DOCKER-USER >/dev/null 2>&1 || CHAIN=FORWARD
for net in 10.239.0.0/16 10.240.0.0/15; do
  iptables -C $CHAIN -s $net -j ACCEPT 2>/dev/null || iptables -I $CHAIN -s $net -j ACCEPT
  iptables -C $CHAIN -d $net -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I $CHAIN -d $net -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
done
NET
chmod 755 /usr/local/sbin/kailo-docker-net
deps=""; for a in "${ADDRS[@]}"; do case $a in 10.203.193.*) deps="$deps wg-quick@wg-game.service";; 10.203.194.*) deps="$deps wg-quick@wg-game2.service";; esac; done
cat > /etc/systemd/system/kailo-docker.service <<UNIT
[Unit]
Description=Kailo dockerd (isolated second instance; system dockerd untouched)
After=network-online.target containerd.service$deps
Wants=network-online.target$deps
Requires=containerd.service
[Service]
Slice=kailo.slice
Type=notify
ExecStartPre=/usr/local/sbin/kailo-docker-net
ExecStart=/usr/bin/dockerd --config-file $ETC/daemon.json --containerd=/run/containerd/containerd.sock
ExecReload=/bin/kill -s HUP \$MAINPID
TimeoutStartSec=120
Restart=always
RestartSec=5
LimitNOFILE=1048576
Delegate=yes
KillMode=process
OOMScoreAdjust=-300
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now kailo-docker.service
for i in $(seq 1 30); do [ -S /run/kailo-docker/docker.sock ] && break; sleep 1; done
DOCKER_HOST=unix:///run/kailo-docker/docker.sock docker info --format 'kailo dockerd {{.ServerVersion}} root={{.DockerRootDir}} cgroup={{.CgroupDriver}}'
