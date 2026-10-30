# 协作只有 Kailo 一套：共享空间聊天关闭，文件评论保留（DD-163）

设计：`DD-163`、`.design/07` §4.8.8 裁定表、`08` §4（SF-CEL-17）、V-SCN-271/272；design-authority `5db45c5fd`。

## 裁定

| 原生功能 | 裁定 | Kailo 承接 | 现有数据 |
|---|---|---|---|
| 共享空间聊天（`WORKSPACE` 房间） | (a) 关闭 | Kailo 频道 | 房间与消息留在聊天库，不删除、不迁移，任何接口不再读出 |
| 用户间与全局聊天（`USER`、`GLOBAL` 房间；本 fork 前端原本未使用） | (a) 关闭 | Kailo 私聊 | 同上 |
| 文件评论（`NODE` 房间，`meta.comments` 信息面板） | (c) 保留 | 外观 DD-133/157 | 保留 |
| 评论中的提及、对关注者的评论通知 | (b) 投影 | Kailo 收件箱（`frontend/web/service/kailo-notify.go`，DD-138(4)） | — |

不导入聊天记录：Kailo 频道消息由成员自己的密钥签名，导入会伪造作者。非 Kailo 模式（`auth.NativeKailoMode()` 为假）下全部房间类型保持原生行为。

## 服务端关闭（前端隐藏不作为证据）

- `common/auth/native-kailo-chat.go`：`NativeKailoChatRoomAllowed(roomType)` 在 Kailo 模式只放行 `NODE`；`NativeKailoChatRoomRefusal` 返回 `errors.StatusForbidden`。
- `gateway/websocket/chat-handler.go`：`JOIN`、`LEAVE`、`HISTORY` 指向非 `NODE` 房间时在到达聊天服务前丢弃（`chatMessageRoomServed`），因此不建房、不加入、不读历史；`auth()` 对非 `NODE` 房间直接拒绝。`POST`、`DELETE_MSG` 只作用于本会话已加入的房间，随 `JOIN` 的判定。
- `broker/chat/grpc/handler.go`（纵深防御）：`PutRoom`、`DeleteRoom`、`ListRooms` 按请求的房间类型拒绝；`ListMessages`、`PostMessage`、`DeleteMessage` 以聊天库中保存的房间为准（`kailoServedRoom` 按 `NODE` 类型查找房间，查不到即拒绝），调用方传入的 `KnownRooms` 不能改写类型。
- 聊天库数据迁移（`broker/chat/chat.go` 直接走 DAO）不受影响。

## 入口删除

`gui.ajax/res/js/ui/Workspaces/views/kailoChat.js` 的 `workspaceChatShown(pydio)` 在 Kailo 模式返回假：`FSTemplate` 不渲染顶栏聊天按钮（`AppBarRight`）、右侧停靠的聊天卡片（`CellChatInfoCard`）与分离窗口（`CellChatDetached`）；`WorkspaceEntry` 不渲染共享空间的未读聊天图标。文件详情的评论面板（`meta.comments`）不变。

## 测试

- `common/auth/native-kailo-chat_test.go`：Kailo 模式只放行 `NODE`，其余类型返回 `StatusForbidden`；非 Kailo 模式全部放行。
- `gateway/websocket/kailo-chat_test.go`：`JOIN`/`LEAVE`/`HISTORY` 对 `WORKSPACE`/`USER`/`GLOBAL` 与缺房间的消息被拒，`NODE` 放行；`auth()` 在触及会话前拒绝。
- `broker/chat/grpc/kailo-chat_test.go`（bolt 存储）：非 Kailo 模式下建立的 `WORKSPACE` 房间与消息，切到 Kailo 模式后建房、列举、读消息、发言（含伪造 `KnownRooms` 为 `NODE`）、删消息、删房间全部 `StatusForbidden`；`NODE` 房间评论建房、发言、列举、读与删除照常。
- `frontend/web/service/kailo-notify_test.go`：新评论含 `@login` 时进入 Kailo 投递队列；无提及、共享空间聊天、编辑与删除不投递。
- `gui.ajax/res/js/ui/Workspaces/views/kailoChat.test.js`（vitest）：Kailo 模式不提供共享空间聊天；非 Kailo 模式沿用 `GLOBAL_DISABLE_CHATS`。

### CI 节点结果（2026-10-30，分支提交 `88f4c25ee`，源码经 GitHub 取得）

- golang `1.26.8-alpine@sha256:8ac98ca5…`，`CGO_ENABLED=0`：`go test -count=1 ./common/auth ./gateway/websocket ./broker/chat/grpc ./frontend/web/service` 全部 `ok`；`-v -run 'Kailo|ChatMessageRoomServed|KailoNotifyOnChat'` 下新增五项 `PASS`（`TestChatHandler_KailoServesFileCommentsOnly` 25 条断言）。`go vet ./common/auth ./broker/chat/grpc ./frontend/web/service` 只报上游 `broker/chat/dao/mongo/mongo.go` 既有的 `bson.E` 无键字面量（本变更未触及）。
- node `22-alpine@sha256:0a7108bf…`：`pnpm install --frozen-lockfile` 后 `vitest run gui.ajax/res/js/ui/Workspaces/views/kailoChat kailo.embed/kailo-cells`，2 个文件 33 项通过。
