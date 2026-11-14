#!/usr/bin/env bash
# Kailo 专用的第二套 dockerd（ADR-20 §13）：与节点上其他项目使用的系统默认 dockerd 完全隔离。
#   - 独立 data-root /var/lib/kailo-docker、exec-root、pidfile、unix socket /run/kailo-docker/docker.sock
#   - 独立 bridge kailo0（10.239.0.1/16）与地址池 10.240.0.0/16、10.241.0.0/16（不与默认 dockerd 的 172.16/12 冲突）
#   - 共用宿主 containerd，但用独立 namespace（kailo / kailo-plugins），互不可见
#   - iptables=false：不改默认 dockerd 的 DOCKER 链；出网 NAT 由本脚本装的 nft 表 kailo_nat 负责，端口发布走 userland-proxy
#   - 经 WG 以 mTLS 监听 tcp://<wg 地址>:2376
#   - dockerd 与它的全部容器（daemon.json cgroup-parent）运行在 kailo.slice（硬内存上限，缺省 48G）；
#     其下 kailo-prod.slice（部署）与 kailo-ci.slice（缺省 40G：CI worker、检查容器、镜像构建，dockerd 默认 cgroup-parent）
# 幂等：重复执行结果不变；只写 Kailo 自己的路径，不碰 /etc/docker、docker.service、默认 docker0/网络。
# 用法（CI 节点 root）：install.sh <tls 目录> [wg 地址...]
#   tls 目录需含 ca.pem server-cert.pem server-key.pem（由 tls.sh 生成）
set -euo pipefail
TLS=${1:?tls dir}; shift
ADDRS=("$@"); [ ${#ADDRS[@]} -gt 0 ] || ADDRS=(10.203.194.2)
# 48G（A-03，2026-11-14，主 Agent 批准）：62G 节点上留 14G 给系统、IntelligenceStation（实测峰值约 2.7G）与 slice 外页缓存；
# 36G 时 slice 内 anon 仅约 11G、文件页 21G，memory.events max 达 186 万次，部署容器的文件页反复回收（sync-service 曾因此被 OOM）。
MEM=${KAILO_SLICE_MEMORY_MAX:-48G}
# OPS-03（2026-11-14）：部署与 CI/构建分 slice，IO 与内存按 slice 隔离（手册「IO 隔离（OPS-03）」）。
#   kailo-prod.slice：部署 compose 项目（up.sh 的 KAILO_CGROUP_PARENT），IO/CPU 权重高，MemoryLow 保护；
#   kailo-ci.slice：dockerd 的默认 cgroup-parent，即 CI 检查容器、镜像构建（BuildKit 执行器、kailo-builder）与临时容器，
#   IO 权重低并有写入上限。权重要靠 iocost 生效（tools/ci/host-io/setup.sh）。
CI_MEM=${KAILO_CI_SLICE_MEMORY_MAX:-40G}
PROD_MEM_LOW=${KAILO_PROD_SLICE_MEMORY_LOW:-16G}
PARENT=${KAILO_DOCKERD_CGROUP_PARENT:-kailo-ci.slice}
# CI 写入上限（kailo-ci.slice 合计，作用于 data-root 所在整盘）；空串则不设。按 OPS-03 实测标定（手册）。
CI_WBPS=${KAILO_CI_WRITE_BPS-150M}
CI_WIOPS=${KAILO_CI_WRITE_IOPS-4000}
# default builder 的 GC 策略（A-03，2026-11-14，主 Agent 批准；kailo-builder 同策略见 registry-mirror/buildkitd.toml）。
# 只写 defaultKeepStorage 时 BuildKit 第一条默认规则把构建上下文与缓存挂载合计压到约 8.3GiB，一次构建上下文就挤掉
# apt/bun/cargo 缓存挂载。这里分开限额：上下文 20GB、git 检出 5GB、缓存挂载 80GB，全部记录保留 60GB、上限 120GB
# （NVMe 至少留约 100G 给检查槽位、sccache、data-root 与部署数据库）。retention/policy.json 的 default 上限须一致。
# daemon.json 语法（dockerd 29 实测）：filter 写 "type=<值>"（dockerd 自己补成 ==），一条规则只能有一个值，否则 dockerd
# 启动失败（"filters expect only one value"）；keepDuration 对自定义规则不生效，故不写。`dockerd --validate` 查不出这两点，
# 改动后先在 docker:dind 里用同一 builder 段起一次并看 `docker buildx inspect default`。
GC_CONTEXTS=${KAILO_BUILDER_GC_CONTEXTS:-20GB}
GC_GIT=${KAILO_BUILDER_GC_GIT:-5GB}
GC_CACHEMOUNTS=${KAILO_BUILDER_GC_CACHEMOUNTS:-80GB}
GC_RESERVED=${KAILO_BUILDER_GC_RESERVED:-60GB}
GC_MAX=${KAILO_BUILDER_GC_MAX:-120GB}
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
  "cgroup-parent": "$PARENT",
  "builder": {"gc": {"enabled": true, "policy": [
    {"filter": ["type=source.local"], "maxUsedSpace": "$GC_CONTEXTS"},
    {"filter": ["type=source.git.checkout"], "maxUsedSpace": "$GC_GIT"},
    {"filter": ["type=exec.cachemount"], "maxUsedSpace": "$GC_CACHEMOUNTS"},
    {"reservedSpace": "$GC_RESERVED", "maxUsedSpace": "$GC_MAX"},
    {"all": true, "reservedSpace": "$GC_RESERVED", "maxUsedSpace": "$GC_MAX"}
  ]}}
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
# data-root 所在整盘（io.max 与 io.weight 只作用于整盘设备）
DISK=/dev/$(lsblk -no PKNAME "$(findmnt -no SOURCE -T /var/lib/kailo-docker)" | head -n 1)
[ -b "$DISK" ] || { echo "cannot resolve the disk of /var/lib/kailo-docker" >&2; exit 1; }
ci_io=
[ -z "$CI_WBPS" ] || ci_io="$ci_io
IOWriteBandwidthMax=$DISK $CI_WBPS"
[ -z "$CI_WIOPS" ] || ci_io="$ci_io
IOWriteIOPSMax=$DISK $CI_WIOPS"
cat > /etc/systemd/system/kailo-prod.slice <<UNIT
[Unit]
Description=Kailo deployment (compose project kailo; sub-slice of kailo.slice), weighted above CI and builds
[Slice]
MemoryLow=$PROD_MEM_LOW
MemorySwapMax=0
CPUWeight=400
IOWeight=1000
UNIT
cat > /etc/systemd/system/kailo-ci.slice <<UNIT
[Unit]
Description=Kailo CI checks, image builds and ad-hoc containers (sub-slice of kailo.slice; dockerd's cgroup-parent)
[Slice]
MemoryMax=$CI_MEM
MemorySwapMax=0
CPUWeight=50
IOWeight=25$ci_io
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
