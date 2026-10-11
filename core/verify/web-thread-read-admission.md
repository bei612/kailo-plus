# Web 线程订阅读取放大：源码增量与未验收边界

2026-10-11；实现比较基准为
`8ec54d517c17157e8f5a3e14a6eb9ed37d795309`。关联 `DD-39`、`DD-40`、
`SS-WEB-RELAY`、`V-SCN-01`、`V-SCN-28`，归属既有
`tools/traceability/collab.channel.message.yaml`。本记录不是发布通过证明。

## 权威、影响面与副作用

固定 Buzz 来源为 `779af8886caae1317b4de962082429867ab61503`：
`desktop/src/features/messages/hooks.ts::useChannelSubscription` 区分历史追平与
实时正文/辅助事件；`desktop/src/features/messages/useChannelTyping.ts` 独立消费
typing。已通过该 commit 的 `git show`/`git grep` 查证，不在证据树执行代码。

本次差异属于已授权的 Web BFF 宿主适配修正，不改变页面、布局、文字或交互设计。
`web-client/web/src/platform/ui/useWorkspaceThread.ts::useWorkspaceThread`
由 Inbox、频道线程及频道路由上下文消费；原实现收到 snapshot、每条 event 和
live 都重新读取整个线程，包括历史重放和 typing。现按订阅 epoch，在首次 live
补查一次，之后仅共享的正文/辅助事件集合触发查询；不自行复制事件种类定义。

查询仍经过现有 BFF、Core 准入与 Relay，不提高读取预算、不缓存授权结果、不绕过
会话或 scope 检查。没有增加契约、数据库字段、持久状态或第二份正文权威；旧数据
迁移无适用对象。Desktop/Mobile 传输未修改；本次不构成两端安装包验收。

## 边界行为

- 空历史也在 live 后补查一次，覆盖 HTTP 查询与订阅之间的时间窗口。
- snapshot 与历史 event 不反复查询；同 epoch 重复 live 不反复查询。
- 正文、编辑、反应与删除沿共享 kind 集合重新读取；typing 和线程摘要不触发
  正文读取，其原有消费者未删除。未知 kind 不被推断为正文变化。
- interrupted、ended、closed 结束当前 live epoch；重连追平后再补查一次。
  原确定撤权仍取消查询、清除投影并禁止显示正文。
- 既有 HTTP 错误、准入拒绝和查询分页校验不变；没有将超时、结果不明或未知错误
  转成成功。工程基线 §4 的六类错误仍由原 BFF/transport 分类，本次不新增错误码。
- 多个消费者仍可能分别建立 SSE；本改动不声称消除所有重复订阅或预算耗尽根因。

## 实际观察与验证边界

对已部署的 `032b9c304c84336a52c699244992c9bc73ff55da` Web，使用独立
`kailo-core-refresh` Playwright 会话正常 SSO，未伪造登录或业务数据。
2026-10-11 08:25:33.779–08:25:33.805 UTC，一次 user-state HTTP 读取为
200，对应时间窗内 Relay 有三次 query。另一次搜索选中与刷新观察均有三条私聊
SSE、六次私聊正文 HTTP 读取。该次较稀疏的复现全部为 200，未复现旧发布回执的
预算耗尽，不能据此证明该故障已修复。

实现后在既有 `InboxThreadPane.test.tsx` 加入真实 hook 消费者的频道/私聊检查，
覆盖历史、live、typing、正文种类、断流、重连和撤权。实际使用原
`kailo-web-thread-tooltip-sdk`（4 CPU、8 GiB、network none，全部输入及缓存在
`/volumes/data`），固定镜像为
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`。
候选源码逐文件与正式树比对一致，没有运行宿主 Node 或新建检查脚本。

实际命令与结果：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/main.test.tsx src/platform/ui/InboxThreadPane.test.tsx src/platform/ui/ChannelThreadPane.test.tsx --no-file-parallelism
```

首次类型检查退出 0，三个套件 46 项通过、退出 0。随后仅在私有副本把实时正文
过滤条件主动破坏为每个 event/snapshot 都查询，运行原 Inbox 检查的
`-t "refreshes the actual"`，退出 1：频道期望 1 次实际 5 次，私聊期望 2 次
实际 10 次，两项均捕获读取放大；22 项因定向选择未执行。正式源码从未注入故障。
还原后逐字节比对退出 0；再次运行上述三个套件，两个线程套件 45 项全部通过，
但提示框套件的 fork worker 启动超时，整条命令退出 1，不记为整轮成功。

日志均在 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/`：

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `final-thread-tooltip.log` | `9af78f00b46f8623939652ad1f9ad131454a631911e7901e1b2d8eac5b5ac222` | 类型 0；46 项通过，退出 0 |
| `thread-negative.log` | `d18cf9f7a9903e71561774917fab0ecb3fc5999ae2b17f4e0e89aa72971dcc57` | 主动破坏被两项断言捕获，退出 1 |
| `thread-restored.log` | `eb5abd86d4dea24d98713c0768a0238836f0fa0820e1ffebf920c257da23d545` | 线程 45 项通过；提示框 worker 启动超时，退出 1 |

本次实际运行 `git diff --check -- web-client/web/src/platform/ui/useWorkspaceThread.ts
web-client/web/src/platform/ui/InboxThreadPane.test.tsx`，退出 0。此项只检查 diff
空白，不证明运行正确。`tools/check.sh --full` 本批未运行，既有全量 exit 1
未被本记录解除。

此前验证暂停原因是宿主异常而非业务检查通过：实测 load 从 818.60 升至 979.62，
可用内存约 40 GiB；抽查三个容器执行进程的 `/proc/<pid>/stack` 均停在
`cgroup_writeback_umount → __flush_workqueue` 的卸载收尾。内核日志还记录
dockerd/buildkitd 长时间阻塞。当时未追加 exec、编译或清理缓存；宿主自行恢复后
才继续上述原 SDK 验证，未重启主机。没有根据这些观察宣称磁盘损坏或某一构建
是唯一根因。

本回执不包含新镜像部署或新增截图验收；旧部署的浏览器观察不能当作此源码的
部署后复验。全量门禁和三人双 Agent 稳定协作仍未通过。
