# SS-BUZ-GOVERNANCE 接缝证据

对应 `SF-BUZ-37`、`SF-BUZ-38`、`DD-80`。补丁：`patches/0001-owner-governed-communities.patch`，
基于 `779af8886caae1317b4de962082429867ab61503`，由 `tools/build-upstream.sh buzz` 构建。

## 为什么必须改上游

原生端本机持钥直连 Relay（`DD-75`），Core 不在它的发布路径上。上游的 NIP-29 权限比
Kailo 宽，且 `RelayConfig` 没有收紧它的开关（`SF-BUZ-37`）。对一个已在 relay roster 上的
成员，上游允许：

- 自建 Channel，并成为其 owner；
- 把自己加进 open Channel，或申请加入；
- 读写任何非 private Channel；
- 开 DM，定义由 Relay 执行的 workflow，建 huddle、git 仓库、forum、canvas。

另外有两条旁路：一是 kind 9007 缺 `visibility` 时 Channel 按 `open` 建立（`SF-BUZ-38`）；
二是 huddle 音频 WebSocket 不经过事件 ingest，最后一人离开时会归档所在 Channel。

补丁前实测：新的核验用例在上游镜像上第一项就失败，一个 roster 成员自建 Channel 得到
`accepted: true`。

## 补丁做了什么

一个运行期开关 `BUZZ_MEMBER_EVENT_KINDS`：成员可发布的 kind 列表。设定之后：

| 面 | 行为 |
|---|---|
| 事件 ingest（WebSocket EVENT 与 HTTP `/events` 共用） | 列表外的 kind 只接受 Community owner 签发；owner 按**已认证的调用方**判定，不按事件签名者——gift wrap 由一次性密钥签名 |
| WebSocket 的 ephemeral 与 observer 分支 | 同一道检查。这两类事件不进 ingest，不在这里拦就是旁路 |
| Channel 准入 | 只看 roster；`open` 不再放行非成员 |
| kind 9007 / 9002 | Channel 必须 private：创建缺 `visibility` 或非 `private` 被拒，改元数据改成 `open` 被拒，owner 也一样 |
| huddle 音频 WebSocket | 不提供（404） |

未设定时补丁不改变任何行为。空值合法，表示成员什么都不能发。

Kailo 的取值是已交付能力所需的 kind。一期只有 `9`：Channel 消息，附件以 `imeta` 随消息发出。
列表每多一个 kind，就多开放一种成员可发布的协作能力，因此它随 `apps/05` §7 的能力分配一起变更。

## 实测

`core/crates/kailo-buzz/tests/bridge.rs::members_cannot_govern_the_community`：先让一个成员
进入 relay roster 与其中一个 Channel 的 roster，再逐项尝试。每项都必须被拒，而且理由必须
指向治理规则——被别的原因拒掉证明不了治理生效。

| 尝试 | 结果 |
|---|---|
| 在自己的 Channel 发消息（kind 9） | 接受 |
| 自建 Channel（9007，private） | 拒绝：`reserved to the community owner` |
| 把自己加进别的 Channel（9000） | 拒绝：同上 |
| 申请加入别的 Channel（9021） | 拒绝：同上 |
| 改自己 Channel 的元数据（9002） | 拒绝：同上 |
| 加 relay 成员（9030） | 拒绝：同上 |
| 发全局事件（kind 1） | 拒绝：同上 |
| 向不在其 roster 上的 Channel 发消息 | 拒绝：`not a channel member` |
| 读自己的 Channel | 读到 |
| 读别的 Channel | 空 |
| owner 建 `visibility=open` 的 Channel | 拒绝：`channels in this community are private` |
| owner 建不带 `visibility` 的 Channel | 拒绝：同上 |

`core/crates/kailo-core/tests/native_client.rs` 在真实拓扑上补一项：已登记的原生设备能直连
Relay 发消息，但自建 Channel 被拒。

## Core 侧的配合

- Channel 以 private 建立，id 取 Workspace id（kind 9007 带 `h`）。Channel 在 Community 内
  按 id 唯一，重试时重发同一个 id 由 Relay 判为「已存在」而不另建；Core 再回读该 Channel
  的 roster，确认 CONTROL 在上面才绑定。此前的做法是比对创建前后 CONTROL 的所属列表，
  「事件被接受、回应丢失」之后的重试会造出第二个 Channel。那个列表还被分页上限截断，
  Workspace 一多就会漏掉。
- 测试夹具退役时经 operator 面归档自己建的 Community。operator 面只能按 owner 列举，
  CONTROL 身份一删那个 Community 就再也找不回来，此前本地 Relay 因此攒下 269 个
  测试 Community、200 个 open Channel。本地 Relay 状态在换补丁镜像时重建；那些
  Community 都没有被 Core 的任何 binding 引用。

## 门禁

`tools/check.sh security` 要求两件事：Relay 显式设定 `BUZZ_MEMBER_EVENT_KINDS`；每个跑 Buzz
二进制的服务都用 `upstream-buzz@` 的补丁构建，包括以 `buzz-admin` 建 schema 的一次性服务。
分别破坏了三处——删掉开关、Relay 换回上游镜像、buzz-schema 换回上游镜像——每次都报出
对应服务，还原后逐字节一致。

## 仍按 Tenant 而不是 Workspace 隔离的

以下读面在 Community 内对所有 relay 成员可见。Community 与 Tenant 一一对应（`DD-01`），
因此它们的隔离边界是 Tenant：

- 不属于任何 Channel 的事件，包括 kind 13534 relay 成员列表。成员不能再发布这类事件，
  所以其中只有 Relay 与 owner 写入的内容；
- 媒体按内容 hash 读取，不校验 Channel。拿得到 hash 就等于看过引用它的消息。
