# CI 机器重装与恢复手册（2026-10-31）

对象机器：`ubuntu-server`，局域网 `192.168.0.193`，WG 地址 `10.203.193.2`。
这台机器**同时运行 Kailo 生产环境和 CI**，另外还跑着 volcengine 数字人、ASR/TTS、agent-platform 等其他项目。
本文所有信息都是 2026-10-31 重启后，从机器上只读核对得到的。文中不含任何私钥、口令或 .env 值；这些内容只存在于数据盘上的备份包里。

> **用户 2026-10-31 裁定：重装后从 0 开始**
> - 系统、Docker、Kailo 生产和 CI 一律全新安装、全新部署，数据重新生成，不恢复旧的容器、数据卷、数据库或 home 目录。
> - 只需从备份中取回 **WireGuard 配置**（`etc.tar.zst` 中的 `etc/wireguard/`）。这样两条隧道的私钥保持不变，开发机侧和 primedata 侧都不用改。
> - 是否保留原 SSH 主机密钥（`etc/ssh/ssh_host_*`）由你决定；不保留的话，开发机需要清掉旧的 known_hosts 记录（见 1.6）。
> - 冷备份已在 06:17Z 跑完主体部分：`/etc`、`/root`、`/usr/local`、`/home/ubuntu`、Docker 卷、`/volumes/*`、`/opt`、宿主 PG 都已打包；k8s 状态和 `/var/lib/kailo-ci` 没有打。这份备份现在只作为额外保险，放在 sda 的 `/volumes/data/reinstall-backup-20261031/`，约 210G，不需要时可以整目录删除。
> - **重装时只格式化 NVMe（nvme0n1）**，不要动 sda、sdb、sdc。

---

## 0. 重装前必须确认（按顺序执行）

1. **等冷备份完成。** 备份目录是 `/volumes/data/reinstall-backup-20261031/`，位于 sda1 数据盘。日志 `backup.log` 最后一行出现 `EXTRA DONE` 才算完成，并且要有 `SHA256SUMS`。
   查看进度：`ssh ubuntu@10.203.193.2 'tail -5 /volumes/data/reinstall-backup-20261031/backup.log'`
2. **重装时只格式化 NVMe 系统盘 `nvme0n1`。** 以下四块盘都**不要碰**：

   | 盘 | 容量 | 型号 | 现状 |
   |---|---|---|---|
   | `sda` | 1.8T | ST2000DM008（SMR 机械盘） | 分区 `sda1`，xfs，UUID `dc6065d9-b3de-42fb-bf03-e4c422eb2419`，挂在 `/volumes/data`。上面有生产镜像仓库、组件数据、全部备份 |
   | `sdb` | 931G | WD10SPZX | xfs，未挂载，用途不明（可能是你的其他数据） |
   | `sdc` | 931G | WD10SPZX | 同 `sdb` |
   | `sdd` | 7.5G | USB | U 盘 |

3. **把备份再复制一份到机器外面。** 备份目录预计 300–400G。如果条件允许，复制到外部盘或另一台机器；只放在 sda 上是单点。
4. 备份开始时，已经停掉全部容器和宿主机上的 PostgreSQL 16（为了让数据库文件一致）。所以从备份开始那一刻起，生产已经停了。

---

## 1. 原系统的关键事实

### 1.1 系统与硬件
- Ubuntu 24.04.4 LTS，内核 6.8.0-147-generic，主机名 `ubuntu-server`
- 20 核，62G 内存，GPU 为 NVIDIA RTX 3090（需要装驱动和 `nvidia-persistenced`）
- 网卡 `enp3s0` 走 DHCP（netplan `50-cloud-init.yaml`），局域网 `192.168.0.193/16`，网关 `192.168.0.1`
- 原分区：`nvme0n1p1` 1G vfat `/boot/efi`，`nvme0n1p2` 1G xfs `/boot`，`nvme0n1p3` 951.8G xfs `/`

### 1.2 `/etc/fstab`（原内容，UUID 是旧系统盘的，重装后系统盘那几行会变）
```
/dev/disk/by-uuid/<新系统盘 UUID> / xfs defaults 0 1
/dev/disk/by-uuid/<新 boot UUID> /boot xfs defaults 0 1
/dev/disk/by-uuid/<新 EFI UUID> /boot/efi vfat defaults 0 1
UUID=dc6065d9-b3de-42fb-bf03-e4c422eb2419 /volumes/data xfs defaults,noatime 0 2
# NVMe 热数据经 bind mount 挂到 /volumes/data 下的历史路径（Docker drop-in 依赖这些挂载）
/var/lib/kailo-ci-nvme/ci /volumes/data/kailo/ci none bind 0 0
/var/lib/kailo-ci-nvme/ci-private /volumes/data/kailo/ci-private none bind 0 0
/var/lib/kailo-ci-nvme/ci-artifacts /volumes/data/kailo/ci-artifacts none bind 0 0
/var/lib/kailo-ci-nvme/check-cache /volumes/data/kailo/check-cache none bind 0 0
/var/lib/kailo-ci-nvme/buildkit-core-state /volumes/data/kailo/buildkit-core-state none bind 0 0
/var/lib/kailo-runtime-nvme/cells /volumes/data/kailo/components/cells none bind 0 0
/var/lib/kailo-runtime-nvme/agent-runtime /volumes/data/kailo/agent-runtime none bind 0 0
/var/lib/kailo-runtime-nvme/wren /volumes/data/kailo/tmp/wren-native-conformance-runtime.pawCOZ none bind 0 0
/var/lib/kailo-runtime-nvme/knowledge-deploy /volumes/data/kailo/tmp/codex-knowledge-runtime-20261005.o07j5k/apps/knowledge/fork/deploy none bind 0 0
/var/lib/kailo-runtime-nvme/knowledge-frontend /volumes/data/kailo/tmp/codex-knowledge-runtime-20261005.o07j5k/apps/knowledge/frontend none bind 0 0
/var/lib/kailo-runtime-nvme/knowledge-native-entry /volumes/data/kailo/tmp/codex-knowledge-edge-20261006.hk1xfO/runtime/knowledge/fork/deploy none bind 0 0
/var/lib/kailo-runtime-nvme/installation-db /volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/pgdata none bind 0 0
```
注意：生产里的知识库和问数实例，至今还挂在 `/volumes/data/kailo/tmp/...` 这类历史临时路径上，属于技术债。恢复时先按原路径挂回，之后再迁到规范路径。

### 1.3 WireGuard（两条隧道，都是开机自启 `wg-quick@<名>`）

**wg-game：开发机 ↔ CI，Kailo 开发与 CI 专用**
```ini
# /etc/wireguard/wg-game.conf（CI 侧）
[Interface]
PrivateKey = <见备份 etc.tar.zst 中的 etc/wireguard/wg-game.conf>
Address = 10.203.193.2/30
MTU = 1380

[Peer]
# game.lichking.online（开发机，公网 104.243.23.3）
PublicKey = uWHu7ReBgeLHjr8O/zDkjNnTKfvJdY7smD6IebzTGBQ=
Endpoint = game.lichking.online:51821
AllowedIPs = 10.203.193.1/32
PersistentKeepalive = 25
```
- CI 侧公钥：`ZAw/0m1JfvqoHq8fw1ZJA3xP/RUOBZ27uZ4ISVPI6y8=`
- 开发机侧（`/etc/wireguard/wg-game.conf`，不随 CI 重装变化）：`Address = 10.203.193.1/30`，`ListenPort = 51821`，`MTU = 1380`，Peer 公钥是上面的 CI 公钥，`AllowedIPs = 10.203.193.2/32`。
- **恢复方式（推荐）**：从备份里取回原 `wg-game.conf`，私钥不变，开发机侧就不用改。
- 如果要换新密钥：在 CI 上 `wg genkey | tee priv | wg pubkey`，再把开发机 `wg-game.conf` 中 Peer 的 `PublicKey` 改成新公钥，然后 `systemctl restart wg-quick@wg-game`。

**wg0：CI ↔ primedata，你自己的另一张网，供 HTTPS 入口使用**
```ini
# /etc/wireguard/wg0.conf
# ubuntu-server 192.168.0.193 -> primedata
[Interface]
Address = 10.111.1.4/24
PrivateKey = <见备份 etc.tar.zst 中的 etc/wireguard/wg0.conf>

[Peer]
PublicKey = i4iZbbb2COJqL13Z8/WpB4ctj19yPTJs7NQolJN+LRo=
Endpoint = www.primedata.com.cn:53333
AllowedIPs = 10.111.1.0/24
PersistentKeepalive = 25
```
- CI 侧公钥：`5Tg5jcD+LXeVqLO+pKCKceINypj7jrQQHik6Nmc6/yM=`
- `/etc/wireguard/` 下还有 `kailo-local.key`/`kailo-local.pub`（5 月生成，用途待查）和 `wg0.conf.bak-20260911T080621Z`，都在 etc 备份里。
- 恢复方式：同上，取回原文件私钥就不变。换密钥的话，需要在 primedata 端（`www.primedata.com.cn`）更新这台机器的公钥。

### 1.4 Docker
- 版本 29.1.3，另装了 buildkit（`buildkit.service`、`/usr/local/bin/buildkitd`、`buildctl`），以及 nerdctl、kata、cilium、hubble、helm、syft、sccache。
- `/etc/docker/daemon.json`：
```json
{
  "live-restore": true,
  "tlsverify": true,
  "tlscacert": "/etc/docker/tls/ca.pem",
  "tlscert": "/etc/docker/tls/server-cert.pem",
  "tlskey": "/etc/docker/tls/server-key.pem",
  "default-address-pools": [
    {"base": "172.17.0.0/12", "size": 16},
    {"base": "192.168.0.0/16", "size": 20},
    {"base": "10.240.0.0/16", "size": 24}
  ]
}
```
- systemd drop-in，位于 `/etc/systemd/system/docker.service.d/`：
  - `95-wg-remote.conf`：Docker 依赖 `wg-quick@wg-game`，并额外监听 `tcp://10.203.193.2:2376`（开发机的 `kailo-ci` 命令通过 WG 用 mTLS 连这里）。
    ```ini
    [Unit]
    Requires=wg-quick@wg-game.service
    After=wg-quick@wg-game.service
    [Service]
    ExecStart=
    ExecStart=/usr/bin/dockerd -H fd:// -H tcp://10.203.193.2:2376 --containerd=/run/containerd/containerd.sock
    ```
  - `90-data-mount.conf`：`RequiresMountsFor=/volumes/data`，并要求 `ConditionPathIsMountPoint=/volumes/data`。
  - `80-kailo-runtime-mounts.conf`：`RequiresMountsFor=` 列出 1.2 节中所有 bind mount 的目标路径。
- mTLS 证书在 `/etc/docker/tls/`（ca.pem、server-cert.pem、server-key.pem、ca-private），已含在 etc 备份里。**恢复原证书后，开发机上的 docker context `kailo-ci`（`tcp://10.203.193.2:2376`）不用改**；如果重新签发，要同步更新开发机 `/home/kailo-dev/.docker/contexts/tls/*/docker/` 下的 ca/cert/key。
- `/etc/docker/certs.d/192.168.0.193:30500`：私有仓库的信任证书。
- 宿主机 registry 服务 `docker-registry.service`：监听 :5000，数据目录 `/var/lib/docker-registry`（当前是空的），配置 `/etc/docker/registry/config.yml`，用 htpasswd 认证。
- **Kailo 生产镜像仓库**是容器 `platform-local-registry-1`，地址 `127.0.0.1:55000`，数据在 sda 上的 `/volumes/data/kailo/registry`（40G），重装后不会丢。
- Docker Hub 拉取镜像（pull-through mirror）是容器 `kailo-registry-mirror`，地址 `127.0.0.1:55001`，compose 文件 `/volumes/kailo/ci/registry-mirror/compose.yaml`。

### 1.5 自定义 systemd 单元（单元文件都在 etc 备份里）

| 单元 | 作用 |
|---|---|
| `wg-quick@wg-game`、`wg-quick@wg0` | 两条 WG 隧道，enabled |
| `kailo-ci-worker.service` + `.path` | CI 主队列。用户 ubuntu，`/usr/bin/python3 /volumes/kailo/ci/worker.py`，`KAILO_CI_CONFIG=/volumes/kailo/ci/config.json`，`MemoryMax=4G`，`CPUQuota=200%`。`.path` 监听 `/volumes/data/kailo/ci/pending/*.json` |
| `kailo-ci-feedback.service` + `.path` | 快速反馈通道（`KAILO_CI_LANE=feedback`），其余同上 |
| `kailo-https-cert-sync.service` + `.timer`（每小时） | `/usr/local/sbin/kailo-https-cert-sync`：把 Kailo Gateway 的 TLS 证书同步到 primedata HTTPS 代理 |
| `kailo-wg-gateway-sync.service` + `.timer`（每 15 秒） | `/usr/local/sbin/kailo-wg-gateway-sync`：把 primedata 经 WG 进来的 HTTPS 流量导入 Kailo 的 Cilium Gateway |
| `docker-registry.service` | 见 1.4 |
| `buildkit.service` | BuildKit |
| `postgresql@16-main` | 宿主机 PostgreSQL 16，库名带 `kailo_collab_*`、`kailo_agent_channel_*`、`kailo_doccompare_*`、`kailo_orchestrator_*` 前缀（早期 Kailo 用的库）。已做 `pg_dumpall` |
| `nvidia-persistenced` | GPU |
| `kubelet.service` | **masked**（停用状态）。`/etc/kubernetes`（含 pki、admin.conf）和 `/var/lib/etcd` 还在，都已备份 |

`/volumes/kailo/ci/` 下还有若干单元模板和配置：`kailo-ci-*.service/.path`、`kailo-dependency-proxy.service`、`dependency-proxy.conf`、`docker-runtime-mounts.conf`、`storage-nvme.fstab`、`knowledge-wg.compose.yaml`/`.env`。整个目录在 `volumes-kailo` 备份里。

### 1.6 账户与 SSH
- 只有一个普通用户 `ubuntu`（uid 1000），所属组：`adm cdrom sudo dip plugdev kvm lxd docker`。sudoers.d 下有 `ubuntu` 文件，免密 sudo。
- `~ubuntu/.ssh/authorized_keys` 中共 9 把公钥（不含私钥，全文在 home-ubuntu 备份里）：
  - `lkdtc@Lichking-PC`：ed25519、rsa 各一把
  - `Lichking@windows`
  - `ubuntu@DESKTOP-T76JRLF`（rsa）
  - `ubuntu@Lichking-PC`
  - `ubuntu@ubuntu-server`
  - `fuzho@volcengine`
  - `ubuntu@volcengine`
  - `kailo-development-to-ci`：限定 `from="10.203.193.1",no-agent-forwarding,no-X11-forwarding`，开发机 root 用 `~/.ssh/id_ed25519_kailo_ci` 登录
- 开发机的 `known_hosts_kailo_ci` 记录的是旧主机密钥。重装后主机密钥会变，需要二选一：
  - 恢复备份里的 `/etc/ssh/ssh_host_*`；
  - 在开发机执行 `ssh-keygen -f /root/.ssh/known_hosts_kailo_ci -R 10.203.193.2`，再重新接受新主机密钥。
- `/etc/hosts` 里的自定义解析：
```
198.18.0.1 claude.local
192.168.0.193 digitalhuman.aiagent
192.168.0.242 kailo.lichking.online docs.lichking.online sso.lichking.online
192.168.0.242 jira.demo.aiagent confluence.demo.aiagent gitlab.demo.aiagent
192.168.0.241 demo.lichking.online
127.0.0.1 buzz-relay.kailo.local keycloak.kailo.local
```

### 1.7 开发机侧依赖（开发机不重装，只需核对）
- `wg-quick@wg-game`（开发机 `10.203.193.1`，监听 UDP 51821）
- `kailo-dependency-proxy.service`：tinyproxy，只监听 `10.203.193.1:3128`，只允许 `10.203.193.2`，CONNECT 只放行 443。配置文件 `/etc/kailo-ci/dependency-proxy.conf`。CI 构建通过它下载依赖。
- nftables 和 ufw：放行 UDP 51821；只允许从 `wg-game` 进来、源地址 `10.203.193.2` 访问 3128。
- `/root/.ssh/config` 中的 `Host kailo-ci-ssh 10.203.193.2`（User ubuntu，key `id_ed25519_kailo_ci`）
- `/usr/local/bin/kailo-ci` 的实现：`docker --context kailo-ci exec kailo-ci-control python3 /ci/client.py`。依赖 CI 上的 `kailo-ci-control` 容器，以及 1.4 节的 mTLS。

---

## 2. 备份内容（`/volumes/data/reinstall-backup-20261031/`）

脚本是 `~ubuntu/handoff/backup.sh` 和 `backup-extra.sh`；同一份备份目录里也会放一份本文。备份前已停掉全部容器和宿主机上的 PG16，以保证数据一致。

| 文件 | 内容 |
|---|---|
| `running-containers.tsv` / `compose-projects.txt` / `docker-volumes.txt` / `docker-images.txt` | 停机前的运行清单，恢复时照此核对 |
| `host-postgres16-dumpall.sql.zst` | 宿主机 PG16 的 `pg_dumpall` |
| `etc.tar.zst` | 整个 `/etc`：WG 私钥、Docker TLS、systemd 单元、sudoers、ssh 主机密钥、kubernetes pki |
| `root.tar.zst` | `/root` |
| `usr-local.tar.zst` | `/usr/local`，含 kailo 同步脚本、buildkit、node 等工具 |
| `home-ubuntu.tar.zst` | `/home/ubuntu`，不含工具链缓存和 scratch |
| `var-lib-kailo-runtime-nvme.tar.zst` | 生产组件热数据：Cells、agent-runtime、Wren、知识库部署/前端、installation-db |
| `var-lib-kailo-ci-nvme.tar.zst` | CI 队列、私有输出、产物，不含 check-cache 和 buildkit 缓存 |
| `var-lib-postgresql.tar.zst` | PG16 原始数据目录（冷备） |
| `docker-volumes.tar.zst` | 全部 Docker 命名卷，不含 buildx 缓存和 receiver-conformance。包括 core-db、buzz-db、spicedb、temporal、keycloak、openmeter 全套、agentgateway-db、知识库 PG 和 redis、问数 qdrant 和样例库等 |
| `volumes-kailo.tar.zst` | `/volumes/kailo`：生产部署树 `apps/deploy/local`（含 secrets、.env、data 软链）、CI 服务 `ci/`（worker.py、config.json、发布源树 `ci/sources/`）、交接与手册文档 |
| `volumes-agent-platform`、`volumes-volcengine`、`volumes-volcengine-backups`、`volumes-treasure-hub`、`volumes-parsing`、`volumes-zeiss*`、`volumes-A1*`、`volumes-kailo-handoff` 等 | 你的其他项目，在 `/volumes` 下逐目录打包 |
| `opt.tar.zst` | `/opt`：models、kata、cni、containerd 插件、flutter/android SDK、local-path-provisioner |
| `var-lib-k8s.tar.zst` | `/var/lib/etcd`、`kubelet`（不含 pods）、`cni` |
| `var-lib-kailo-ci.tar.zst` | `/var/lib/kailo-ci`，不含 slots、branch、tmp |
| `SHA256SUMS`、`INDEX.txt`、`backup.log`、`*.tar.err` | 校验值、目录清单、日志；`*.tar.err` 是各包的 tar 告警 |

**sda 上原本就有、不在备份目录里的数据（重装后原样保留）**：
- `/volumes/data/kailo/registry`：生产镜像仓库，40G；
- `/volumes/data/kailo/components/*`：除 cells 外的组件实例目录和各组件的 `deploy.env`；
- `/volumes/data/kailo/backups`：发布前的数据库和组件备份；
- `/volumes/data/kailo/conformance`：69G；
- 其余 `/volumes/data/*`。

**没有备份的内容（可以重建）**：
- containerd 和 Docker 镜像层（约 174G），可从 registry 重新拉取，或从 GitHub 重新构建；
- buildx 和 check-cache 缓存；
- `~/.cargo`、`.rustup`、`.npm`、`.gradle`、`.cache`；
- 已结束任务的 scratch。

---

## 3. 重装后的步骤（从 0 开始）
从 0 开始的做法：
1. 装 Ubuntu 24.04，只格式化 nvme0n1；建用户 `ubuntu`（uid 1000，免密 sudo）；装 NVIDIA 驱动。
2. 在 fstab 中挂 sda1，然后建 `/volumes/data`。旧数据盘上的 `/volumes/data/kailo/*` 是历史残留，新部署不要沿用，等确认无用后再清理。
3. 恢复 WG：从 `etc.tar.zst` 中解出 `etc/wireguard/`，放回 `/etc/wireguard/`，权限设为 0600，然后 `systemctl enable --now wg-quick@wg-game wg-quick@wg0`；在开发机上 `ping 10.203.193.2` 验证。
4. 恢复开发机的 SSH 登录：在 `~ubuntu/.ssh/authorized_keys` 中加入开发机公钥（`/root/.ssh/id_ed25519_kailo_ci.pub`，限定 `from="10.203.193.1",no-agent-forwarding,no-X11-forwarding`），其他公钥按需添加。
5. 从 0 安装 Docker（官方 docker-ce），daemon.json 先只配 `default-address-pools`。如果开发机还要用 `kailo-ci` 远程 Docker，就重新签发 mTLS 证书，并更新开发机 docker context `kailo-ci`。
6. Kailo 生产和 CI 都从 GitHub `bei612/kailo-plus` 的 main 全新部署：
   - 按 `CI-CD部署测试手册.md`、`apps/deploy/local/init-local.sh`、`start-core.sh` 和发布入口 `tools/release/kailo-release.sh` 执行；
   - 热数据一律放在 NVMe 的 `/var/lib/kailo-ci`，这是新设计（07 §2.1、ADR-20 §12）；
   - 生产与 CI 尽量分机。做不到的话，给 CI 设硬内存上限，比如 systemd slice ≤24G。
   - 装好后启用 `tools/ci/ci-slot.sh`、`tools/ci/retention`、`tools/ci/dep-cache`。

下文是"整机恢复"的旧顺序，仅供参考；按用户裁定，**这次不执行**。

## 3A. 整机恢复顺序（参考，不执行）
1. 装 Ubuntu 24.04，只格式化 `nvme0n1`。创建用户 `ubuntu`（uid 1000），装好 NVIDIA 驱动。
2. 挂载 sda1：把 `UUID=dc6065d9-b3de-42fb-bf03-e4c422eb2419 /volumes/data xfs defaults,noatime 0 2` 写进 fstab，然后 `mount -a`。
3. 安装软件包：docker-ce 29.x、docker-compose-plugin、wireguard、zstd、pigz、postgresql-16、python3、git、tinyproxy（可选）。
4. 恢复 `/etc` 中的关键部分（**不要整包覆盖 /etc**，按需取文件）：
   ```bash
   B=/volumes/data/reinstall-backup-20261031
   mkdir -p /tmp/etc-restore && zstd -dc $B/etc.tar.zst | tar -xpf - -C /tmp/etc-restore
   # 需要复制回去的：
   #   etc/wireguard/
   #   etc/docker/{daemon.json,tls,certs.d,registry}
   #   etc/systemd/system/{docker.service.d,kailo-*,docker-registry.service,buildkit.service}
   #   etc/sudoers.d/ubuntu
   #   etc/ssh/ssh_host_*（这样主机密钥不变）
   #   etc/hosts 中的自定义行
   #   etc/kubernetes/（如果还要用 k8s）
   ```
5. 恢复 `/usr/local`、`/home/ubuntu`、`/root` 中需要的部分。
6. 按 1.2 节建好 NVMe 目录：
   - `mkdir -p /var/lib/kailo-runtime-nvme /var/lib/kailo-ci-nvme`
   - 解包：`var-lib-kailo-runtime-nvme`、`var-lib-kailo-ci-nvme`、`var-lib-kailo-ci`
   - 把 bind mount 各行写进 fstab，执行 `mount -a`。
7. 解包 `volumes-kailo.tar.zst` 到 `/`，得到 `/volumes/kailo`。其他 `/volumes/*` 项目按你的需要解包。
8. `systemctl enable --now wg-quick@wg-game wg-quick@wg0`。在开发机上执行 `ping 10.203.193.2`，确认握手成功。
9. 启动 Docker：执行 `systemctl daemon-reload`，再启动 docker。Docker 起来之前，确认 drop-in 里引用的挂载点都已存在。
10. 恢复 Docker 卷：`zstd -dc $B/docker-volumes.tar.zst | tar -xpf - -C /`，要在启动容器之前做。
11. 恢复宿主机 PG16：`zstd -dc $B/host-postgres16-dumpall.sql.zst | sudo -u postgres psql`。也可以直接解包 `var-lib-postgresql`。
12. 起生产，按 `running-containers.tsv` 和 `compose-projects.txt` 核对：
    - 镜像仓库：`platform-local-registry-1`，数据在 sda，最先起；
    - registry-mirror；
    - Kailo 平台：项目 `platform-local`，正式入口在 `/volumes/kailo/apps/deploy/local`（`start-core.sh`、`compose.yaml`）。生产对应的发布树是 `/volumes/kailo/ci/sources/<commit>/apps`，当前生产发布是 5c77e736；
    - 组件：`kailo-cells-native`、`kailo-knowledge`、`platform-local-wren-native`、`kailo-document-editor`。
    推荐用发布入口统一收敛：在开发机执行 `tools/release/kailo-release.sh run`。它会按声明重新部署平台和组件实例，并回读校验。
13. 恢复 CI 服务：`systemctl enable --now kailo-ci-worker.path kailo-ci-feedback.path`，确认 `kailo-ci-control` 容器在运行。在开发机执行 `kailo-ci handoff` 和 `kailo-ci list`，能正常返回即可。
14. 恢复定时同步：`systemctl enable --now kailo-https-cert-sync.timer kailo-wg-gateway-sync.timer`（依赖 wg0 和 Cilium Gateway，按需启用）。
15. 安装新的 CI 保护措施（已在 main 上，`tools/ci/`）：
    - 并发槽位 `ci-slot.sh`（复制到 `~/kailo-acceptance/ops/`）；
    - `tools/ci/retention/setup.sh install`；
    - `tools/ci/dep-cache/setup.sh up`；
    - 建议同时给 CI 任务设硬内存上限，比如用 systemd slice 把 CI 和临时检查限制在 24G 以内，避免再次把生产压垮。

## 4. 这次宕机的教训（重装时一并解决）
- 生产和 CI 同机，开发检查把内存耗尽后，生产随之不可用：负载约 600，journald 重启 33 次，SSH 失联 3 小时以上。**建议生产与 CI 分机**；做不到的话，CI 必须放进有硬内存上限的 cgroup slice。
- 热数据放到 NVMe，sda（SMR 盘）只放冷数据；生产镜像仓库目前仍在 sda 上，建议迁到 NVMe 或独立 SSD。
- `kailo-ci` 应该接受分支 commit，让所有检查统一排队，而不是由各个代理在节点上自己跑。补丁在 `~ubuntu/scratch/release-components/patch-worker-branch-commits.py`，已含在 home-ubuntu 备份里，**待你批准**。
