#!/usr/bin/env bash
# Kailo CI 节点宿主机 IO 基线（OPS-03，2026-11-14）。幂等，root 执行：tools/ci/host-io/setup.sh [apply|status]
#
# 背景：系统盘是无 DRAM 的消费级 NVMe（RS512GSSD510，不可更换）。CI 的大量增删让它在每周一次 TRIM 之间耗尽空闲块：
# 11-14 实测写入 31 MB/s、单次写 328 ms、fsync p50 3.1 s；fstrim（160.9 GiB，75 s）后 18 ms、fsync p50 8.9 ms。
#   1. fstrim.timer 改为每 6 小时（drop-in），不用 discard 挂载选项（在线 discard 会把延迟摊到每次删除上）。
#   2. iocost（blk-iocost）在 data-root 所在整盘上启用，kailo-prod.slice / kailo-ci.slice 的 IOWeight 才生效
#      （mq-deadline/none 调度器本身不认 io.weight）。ctrl=auto 使用内核按 SSD 给出的延迟目标与模型。开机由
#      kailo-iocost.service 写入；回退：systemctl disable --now kailo-iocost.service 并写 "<maj:min> enable=0"。
#   3. 根文件系统 noatime（在线 remount，并写入 fstab；回退：去掉 noatime 再 remount）。
set -euo pipefail
cmd=${1:-apply}
root_src=$(findmnt -no SOURCE /)
disk=/dev/$(lsblk -no PKNAME "$(findmnt -no SOURCE -T /var/lib/kailo-docker)" | head -n 1)
[ -b "$disk" ] || { echo "cannot resolve the disk of /var/lib/kailo-docker" >&2; exit 1; }
majmin=$(lsblk -dno MAJ:MIN "$disk" | tr -d ' ')

status() {
  echo "disk $disk ($majmin), scheduler: $(cat /sys/block/$(basename "$disk")/queue/scheduler)"
  echo "io.cost.qos: $(grep "^$majmin " /sys/fs/cgroup/io.cost.qos || echo 'not configured')"
  systemctl list-timers fstrim.timer --no-legend
  echo "root mount: $(findmnt -no OPTIONS /)"
  for s in kailo-prod.slice kailo-ci.slice; do
    p=/sys/fs/cgroup/kailo.slice/$s
    [ -d "$p" ] && echo "$s io.weight=$(tr '\n' ' ' <"$p/io.weight") io.max=$(tr '\n' ' ' <"$p/io.max")"
  done
}

if [ "$cmd" = status ]; then status; exit 0; fi
[ "$cmd" = apply ] || { echo "usage: $0 [apply|status]" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

install -d /etc/systemd/system/fstrim.timer.d
cat > /etc/systemd/system/fstrim.timer.d/kailo.conf <<'UNIT'
# OPS-03: the DRAM-less system NVMe collapses without TRIM under CI churn; trim every 6 hours (tools/ci/host-io).
[Timer]
OnCalendar=
OnCalendar=*-*-* 00/6:00:00
RandomizedDelaySec=10min
AccuracySec=1min
UNIT

cat > /etc/systemd/system/kailo-iocost.service <<UNIT
[Unit]
Description=Enable blk-iocost on the Kailo data disk so slice IOWeight applies (OPS-03, tools/ci/host-io)
DefaultDependencies=no
After=local-fs.target
Before=kailo-docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'echo "$majmin enable=1 ctrl=auto" > /sys/fs/cgroup/io.cost.qos'
ExecStop=/bin/sh -c 'echo "$majmin enable=0" > /sys/fs/cgroup/io.cost.qos'
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now kailo-iocost.service
systemctl restart fstrim.timer

# noatime on the root file system: online remount plus fstab (the entry for / keeps its other options).
if ! findmnt -no OPTIONS / | tr ',' '\n' | grep -qx noatime; then
  cp -p /etc/fstab "/etc/fstab.bak-$(date +%Y%m%d%H%M%S)-host-io"
  awk '$2 == "/" && $1 !~ /^#/ && $4 !~ /(^|,)noatime(,|$)/ { $4 = $4 ",noatime" } { print }' /etc/fstab >/etc/fstab.new
  mv /etc/fstab.new /etc/fstab
  mount -o remount,noatime /
fi
status
