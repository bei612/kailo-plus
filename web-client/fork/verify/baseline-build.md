# buzz-web 基线可构建性

改造上游之前先证明未改的基线在本机构建得出来——否则第一个 patch 失败时分不清
是 patch 的问题还是基线本来就不通。

## 实测（2026-09-23）

从 `https://github.com/hardy4yooz/buzz-web.git` 取
`a6766c482533d028582d0efcfd3740769f86217c`（`.design/02` §1 固定的那个），
在仓库之外的工作目录里：

| 步骤 | 结果 |
|---|---|
| `npm ci` | 338 个包，成功 |
| `npm run typecheck`（`tsc --noEmit`） | 通过 |
| `npm run build` | 通过，产出 `dist/assets/*` |

取源用上游仓库本身，不用 `.references`——那里是只读证据，不在其中开发或构建。

## 九个改造点在该 commit 上仍可解析

`SS-WEB-RELAY` 点名的源码点逐个核对（`git cat-file -e`），九个全部存在：

```text
web/src/features/chat/ui/BuzzWebApp.tsx
web/src/shared/api/relay-client.ts
web/src/features/chat/lib/use-buzz-session.ts
web/src/features/chat/lib/use-session-mutations.ts
web/src/features/chat/lib/use-relay-user-state.ts
web/src/features/agents/use-relay-agents.ts
web/src/features/inbox/use-inbox.ts
web/src/features/community/invite-api.ts
web/src/shared/api/media-client.ts
```

## 为什么用 patch series 而不是把源码搬进来

上游仍在演进。130 个源文件搬进本仓库之后，每次升级都变成手工比对；而 patch 能在
新 commit 上直接重放，冲突会当场暴露在 `git apply` 上，而不是变成一次沉默的
「看起来还能编译」。

`build_context: web` 是新增的 manifest 字段：这个上游的 Dockerfile 与构建上下文
都在 `web/` 子目录下，不在仓库根。

## 基线产物先不进运行拓扑

镜像已按 ADR-06 入本地 registry 并按 digest 记回 manifest，但**不加进 compose**。

未改的 buzz-web 会让 Browser 直连 Relay 并在本地持有 signer——那正是 `DD-39` 要
移除的东西。把它放进运行拓扑等于先引入一条设计禁止的路径，再指望后续 patch 把它
去掉；中间那段时间里，拓扑与设计是矛盾的。

因此顺序固定为：先落 `SS-WEB-RELAY` 的 transport patch，再让 Web 面进拓扑。

## 2026-10-09 已提交共享 Profile 修复的实际发布

本节是当前共享页面的发布证据，不把前述 2026-09 基线记录中的 patch-series
做法作为现行开发方式。当前沿 ADR-15/16 在 apps 原工程维护源码；Web/Desktop
共源页面沿 SS-WEB-PRESENTATION，Browser 凭据和协作调用仍沿 SS-WEB-RELAY。

冻结输入为 apps `4c099a5f9b508f7df47b9fc923fe37ab7375aa70`，实际工作树
`/volumes/data/kailo/tmp/web-shared-9edf-20261009.cyN2cz/apps`。
使用原 `tools/build-upstream.sh web-client`、已有限额 BuildKit 和 Data 缓存，
没有在 `.references` 中构建，也没有重启同一构建。原构建句柄 86766 退出 0；
日志 `/volumes/data/kailo/tmp/build-web-client.JqeAqq.log` 记录 TypeScript 与
Vite 构建成功（3943 modules）、OCI 导出及实际 registry 产物。
构建包含依赖下载，不声称完全离线；缓存命中也不等于零网络。

- source/build ID：`sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`。
- artifact：`sha256:7ea0c5fa4cf0897ae1c762fa7b42bcc5b087b26950106bc0de2604be5137e07f`。
- 原 Compose 仅执行 `up -d --no-deps --pull never --wait buzz-web`，句柄 18913
  退出 0。实际容器 `6ffe6fe762d1f632d07ab20f6e61b96da4627f48a7f434a49d22fe9838a54830`
  于 `2026-10-09T15:43:39.764556373Z` 启动，状态 healthy；容器内
  `/srv/app/platform-build-info.json` 的 build ID 与上述值一致。
- 前后逐项核对 platform-local 容器 ID，除 buzz-web 外均未改变；未重启 Core、
  Worker、Relay、Gateway、数据库或身份服务，未迁移数据或更改认证凭据。

本次只发布已提交的 Profile 可访问性、默认头像及中英文等修复；当前工作树中的
成员目录字段、成员卡及邀请交互改动不在该镜像中。页面实际截图与操作验收另由
`web-surface.md` 记录，healthy 和构建成功不证明页面全量还原。
对应冻结输入的原 `tools/check.sh --full` 句柄 22988 退出 2，日志
`/volumes/data/kailo/tmp/tmp.1FOvLFPjbi.check.log`：
`Got socket error trying to find package test at https://pub.dev.`
依赖准备阶段失败，产品门禁没有执行，不能声明全量检查通过或生产就绪。
