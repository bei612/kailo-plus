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
