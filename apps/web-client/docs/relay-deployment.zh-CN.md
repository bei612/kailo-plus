# Buzz Relay 私有化部署参考

Buzz Web 只是一层静态客户端，本仓库不包含 Relay 数据库或迁移。本文给出通用的生产部署
检查清单；Compose 字段和环境变量必须以准备部署的
[block/buzz](https://github.com/block/buzz) 固定版本文档为准。

示例使用 `buzz.example.com` 和文档地址 `10.0.0.10`。不要把真实私钥、数据库密码、
对象存储密钥、内部地址或环境文件提交到公开仓库。

## 推荐架构

```text
Web / Desktop / Mobile / Agents
              |
              | HTTPS + WSS
              v
       WAF / ALB / Reverse proxy
              |
              +-- /app/*  -> Buzz Web
              +-- /pair   -> optional pairing relay
              `-- others  -> Buzz Relay
                                |-- PostgreSQL
                                |-- Redis
                                |-- object storage
                                `-- Git storage
```

- TLS 在入口或 Relay 终止，但公网始终只提供 HTTPS/WSS。
- 入口保留原始 `Host`、`Connection` 和 `Upgrade` 语义。
- PostgreSQL、Redis、对象存储和 Git 不直接暴露公网。
- Relay 与 Web 使用独立容器、网络和数据卷；更新 Web 不应重启或迁移 Relay。

## 版本和镜像

生产环境固定发布 tag/commit 和不可变镜像 digest，不使用会漂移的 `main`：

```bash
git clone https://github.com/block/buzz.git /opt/buzz-relay
cd /opt/buzz-relay
git checkout <verified-release-tag>
docker pull ghcr.io/block/buzz@sha256:<verified-digest>
```

在升级记录中保存 tag、commit、digest、迁移版本和回滚条件。不要直接照抄本文中的旧镜像
标识，因为 Relay 配置会随上游版本演进。

## 身份和密钥

Relay owner 使用独立 Nostr 身份：

- 只把 owner 公钥写入 Relay 配置。
- owner `nsec` 离线加密保存，仅在管理客户端或受控管理员命令中使用。
- Relay 自身私钥、数据库密码、Redis 密码、对象存储密钥和 Git hook secret 首次部署时
  随机生成，随后在重启、升级和恢复中保持稳定。
- `.env` 权限至少为 `0600`，且不进入镜像层、Git、工单或聊天记录。

生成随机值时在目标主机受控终端执行，例如：

```bash
openssl rand -hex 32
```

不要把命令输出粘贴到自动化日志。

## Relay 配置基线

实际变量名以固定版本的 `.env.example` 为准。需要确认的语义包括：

```dotenv
BUZZ_DOMAIN=buzz.example.com
RELAY_URL=wss://buzz.example.com
BUZZ_MEDIA_BASE_URL=https://buzz.example.com/media
BUZZ_CORS_ORIGINS=https://buzz.example.com
RELAY_OWNER_PUBKEY=<owner-public-key-hex>

BUZZ_REQUIRE_AUTH_TOKEN=true
BUZZ_REQUIRE_RELAY_MEMBERSHIP=true
BUZZ_ALLOW_NIP_OA_AUTH=true

BUZZ_RELAY_PRIVATE_KEY=<stable-secret>
BUZZ_GIT_HOOK_HMAC_SECRET=<stable-secret>
POSTGRES_PASSWORD=<stable-secret>
REDIS_PASSWORD=<stable-secret>
BUZZ_S3_ACCESS_KEY=<stable-access-key>
BUZZ_S3_SECRET_KEY=<stable-secret>
```

`CORS` 只允许实际 Web origin。Relay 绑定私网地址，例如 `10.0.0.10:3000`，并由安全组只
允许入口层访问；不要把数据库或管理端口纳入同一公网规则。

## 移动端配对

启用成员校验的私有 Relay 可能需要独立的短时 pairing relay，使新移动设备在获得正式身份
前完成加密配对。固定版本支持该能力时：

- 在 NIP-11 中公布 `wss://buzz.example.com/pair`。
- 只把精确 `/pair` 路径转发给 pairing sidecar。
- sidecar 不发布独立主机端口，不保存长期历史，也不代替主 Relay 成员校验。
- 普通 HTTP 请求返回 `400` 不一定是故障；WebSocket Upgrade 应返回 `101`。

示例验证：

```bash
curl --max-time 3 -sS -i --http1.1 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://buzz.example.com/pair
```

是否需要 sidecar、可执行文件名和变量名应以当前上游部署文档为准。

## 部署 Buzz Web

本仓库 Web 容器默认监听宿主机 `127.0.0.1:3001`，页面位于 `/app/`：

```bash
export BUZZ_WEB_BIND_ADDRESS=10.0.0.10
export BUZZ_WEB_PORT=3001
docker compose -f deploy/compose.yml config
docker compose -f deploy/compose.yml build --pull
docker compose -f deploy/compose.yml up -d
```

`deploy/config.json` 是公开资源：

```json
{
  "communityName": "Buzz",
  "relayUrl": "wss://buzz.example.com",
  "features": {
    "projects": false,
    "forum": false
  },
  "agents": []
}
```

其中不得包含任何私钥、token、Provider 配置或只应在内网解析的控制地址。Web 与 Relay
不同源时，还需要在 Relay 侧显式允许 Web origin，并验证 NIP-98 URL 与反向代理后的公开
URL 完全一致。

## 入口路由

| Path | Backend | 要求 |
| --- | --- | --- |
| `/app`、`/app/*` | Buzz Web | SPA fallback，`config.json` 禁止长期缓存 |
| `/pair` | pairing relay（可选） | 仅 WebSocket，精确路径 |
| `/api/*`、`/git/*`、`/upload`、`/media/*` | Buzz Relay | 保留认证 URL、body 和 Host |
| Relay WebSocket path | Buzz Relay | 支持 Upgrade 和长连接超时 |

入口至少配置：

- `https://buzz.example.com/app/healthz` 的 Web 健康检查。
- `https://buzz.example.com/_liveness` 和 `/_readiness` 的 Relay 检查。
- 合理的 WebSocket idle timeout、请求体限制和媒体上传限制。
- 基于身份/IP 的认证失败、邀请和上传速率限制。
- HSTS、`X-Content-Type-Options: nosniff`、合理 CSP 和 frame 策略。

## 上线验收

```bash
curl -fsS https://buzz.example.com/app/healthz
curl -fsS https://buzz.example.com/_liveness
curl -fsS https://buzz.example.com/_readiness
curl -fsS -H 'Accept: application/nostr+json' https://buzz.example.com/ | jq .
```

还需从外部网络验证：

1. TLS 证书链、域名和自动续期。
2. Relay WebSocket `101 Switching Protocols`。
3. 未加入 Relay 的身份被拒绝，成员身份可以连接。
4. Web 的 NIP-07 和加密 `nsec` 登录。
5. 频道、私聊、线程、Reaction、搜索和媒体上传。
6. Agent Presence、提及与线程回复。
7. NIP-34 仓库事件和 Git 读取（启用 Projects 时）。
8. Desktop 到 Mobile 的配对（启用 pairing 时）。

## 备份

在同一维护窗口备份：

- Relay 环境文件和稳定密钥；
- owner 身份的离线加密副本；
- PostgreSQL 一致性备份；
- 对象存储和 Git 数据；
- Redis（仅当固定版本把不可重建状态放入 Redis）；
- 当前镜像 digest、配置版本和恢复步骤。

至少定期执行一次隔离环境恢复演练。只有“备份命令成功”而没有恢复验证，不能视为可靠
灾难恢复。

## 升级与回滚

1. 阅读固定目标版本的 migration 和 breaking change 说明。
2. 完成备份并验证可读取。
3. 在测试 Relay 验证 Desktop、Mobile、Web 和 Agents。
4. 在维护窗口按上游工具执行数据库迁移和容器更新。
5. 重跑上线验收，并观察认证拒绝率、WebSocket 重连和存储错误。
6. 数据迁移不可逆时，不要把“换回旧镜像”当成完整回滚方案。

Web 客户端可独立升级或回滚；只重建 Web 容器，不应触碰 Relay 数据卷。
