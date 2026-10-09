# 2026-10-09 c309 工作流双层关闭实拍复验

## 实际版本

- 固定线上 Web 源码：`c309a2606c2f4f688a8fe5f50fbe6742b1ca0d74`。
- 正常刷新实际浏览器后，GET `/app/platform-build-info.json` 为 200，buildId `sha256:8fad767a9bbf7aad320025c6a0ab7a8e83e4580aad4617b13c4c54521f0c3fb4`，reportedAt `2026-10-09T02:30:34.588Z`；结束时再次读取一致。
- Root 发布回执对应镜像 `sha256:f229799241e2703bd159b92aa5cb6958ec750d81d33b13048efa3bbd5f79b502`，容器 `b1be1cceff725184f26f6e3dce05399d2e711ebe8f00c899483afb1d0f939798`，StartedAt `2026-10-09T02:35:21.051443065Z`，原 Compose Healthy。本回执的浏览器结果不代替容器来源证明。
- 实拍 2026-10-09 02:35–02:41 UTC，既有 `/usr/local/bin/playwright-cli -s=header-restoration`、普通 seam-verifier 正常 SSO、1920×1080。没有注入 Cookie、force click、DOM pointer reset、浏览器安全 flag、mock API。
- 8 张中英关键状态及 2 张偏好恢复截图，全部逐张打开原件视觉复核。不是旧 a8c 图，也不是 Windows/Mobile 验收。

## 真实消费者复验

只临时启用本机 Workflows 原实验开关，在本人现有工作区打开创建 Dialog、填写本地条件草稿。没有保存、创建、启停或运行工作流，没有触发 Agent turn、发送消息或新增工作区数据。

| 消费者 | 中文 | English |
| --- | --- | --- |
| 脏草稿 Close→Discard 确认 | 实际填入 `KAILO_DISCARD_ZH_20261009`，出现“放弃更改？”原 AlertDialog | 实际填入 `KAILO_DISCARD_EN_20261009`，出现 `Discard changes?` 原 AlertDialog |
| Discard→正常个人菜单点击 | 两层均 detached，inline pointerEvents 空、computed auto、dialogs 0；正常点头像打开个人菜单 | 相同结果，正常点头像打开 Settings/Sign out 菜单，无 30 秒指针阻拦 |
| 脏草稿 Close→Keep editing | AlertDialog detached、父 Dialog 仍为 1，原 `KAILO_KEEP_ZH_20261009` 未丢失；modal 存在时 body pointerEvents none 是正常遮罩 | 父 Dialog 仍为 1、保留 `KAILO_KEEP_EN_20261009`，body none，非页面遗留锁 |
| Keep editing 后真实继续输入 | 正常 textarea 改为 `KAILO_KEEP_ZH_CONTINUED_20261009`，截图可见 | 正常 textarea 改为 `KAILO_KEEP_EN_CONTINUED_20261009`，截图可见 |
| 再次正常关闭 | Close→Discard 后可正常点击个人菜单并进入设置 | Close→Discard 后两层 detached、pointer auto，再正常进入设置 |

上述真实操作闭合了 a8c 回执中的 pointer 锁失败。源修复依据是固定 Buzz `779af8886caae1317b4de962082429867ab61503:pnpm-workspace.yaml::overrides` 原 `@radix-ui/react-dismissable-layer: 1.1.19` 单副本约束及原 #1482 注释；本轮没有修改 `WorkflowDialog` discard 生命周期或另加全局重置。对应原组件：`desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowDialog`、`desktop/src/shared/ui/dialog.tsx`、`desktop/src/shared/ui/alert-dialog.tsx`。只对这个已复现的真实关闭缺陷做复验，不声明工作流页面全量/像素一致。

## 失败与未验边界

- 英文第一轮 Discard→菜单关闭后再点新建，下一组 3 条 CLI selector 命令报告元素不存在；后续真实 snapshot 显示列表页、无 Dialog、body auto。未猜测根因、未算成功。随后按新 snapshot 正常再次点击卡片，等待实际 Dialog visible，再完成同一英文 Keep editing/继续输入/Discard 消费者。没有强制点击、固定 sleep 或改 timeout 掩盖失败。
- 当前真实工作区提示“本页没有有效执行器／No active executor on this page”，因此本轮没有原 FormBuilder 步骤画布/Inspector、保存、审批、执行、运行历史验收。没有把空执行器伪造为可用，也没有以本次条件草稿通过声称上述功能完整。
- Root 同期发布 Core/Worker。额外正常只读 GET `/api/v1/platform-info` 为 200，JSON 只有 `displayName`，没有 `buildId`，响应中也没有 build/source/version provenance header。浏览器不据此宣称 Core 新源码；Core 版本由 Root 容器镜像及 provenance 证据确认，不找影子路由。
- 本轮最终 CLI console error 为 0；不抹除上述真实 selector 失败。没有全局构建、SDK/Node 目标或全树 diff；只新增本回执，原已提交回执未改。
- 未验：完整原 Workflows、原其余 Settings/Profile/频道消费者、三组件页面、Windows/Mobile、全量源码差异逐项功能验收。不声明 100% 还原或生产就绪。

## 偏好恢复

临时将语言切英文、只启用 Workflows；结束恢复简体中文，Workflows/Projects/Pulse/Forum 全 false。正常刷新后设置页默认回个人资料（`restored-preferences` 图只证明该页与头像，不证明开关）；再次正常打开实验功能，读取 4 个 switch 的 aria-checked 均 false，并拍 `restored-feature-switches`。lang=zh-CN、computed pointerEvents auto、dialogs/alertdialogs 0。未改其他偏好。

## 原件与 SHA256

全部原件目录 `/volumes/kailo/.playwright-cli/`；8 张关键状态和 2 张恢复图均已打开复核。

| 文件 | SHA256 |
| --- | --- |
| `kailo-ui-20261009-mainc309-workflowzh-dirty-discard-confirm.png` | `f6f53123d93e7fc032f188d066aeef45bb3f3040e55edc686f0112842d7df37b` |
| `kailo-ui-20261009-mainc309-workflowzh-discard-personal-menu.png` | `a18be2fa21f57556b8894866acb34c51625fd7fac7b2ec7baf9a64b7b47b4a13` |
| `kailo-ui-20261009-mainc309-workflowzh-keep-editing.png` | `b1d9c2f6ee0831c13847b43fbdceeb7592ea49ffdffe3149f3b7ff025261a060` |
| `kailo-ui-20261009-mainc309-workflowzh-continued-edit.png` | `f54fa7224a7703c3523fbb35607a2f417fa4b91326df2c6f310e7b0ad70c77e3` |
| `kailo-ui-20261009-mainc309-workflowen-dirty-discard-confirm.png` | `98aa03db109fac7b15245f314ea4bd6750d7c1325d71480653ec1acfc34743d9` |
| `kailo-ui-20261009-mainc309-workflowen-discard-personal-menu.png` | `472ca79be68bbbc719f03ec41c52e92d6b1c4d10297aea4f566e0a73fe6c9a7b` |
| `kailo-ui-20261009-mainc309-workflowen-keep-editing.png` | `e4a1420a89948027f2d8ac304055cbe842638acb67bc130d904f82dce8c33a84` |
| `kailo-ui-20261009-mainc309-workflowen-continued-edit.png` | `366cc51d39cb89c41023039ec719c06ca6353619fea26a1208425f01e7258260` |
| `kailo-ui-20261009-mainc309-restored-preferences.png` | `7e8974d69d52798bc624f9f2ef5a4fb1a385e107b877c82335c148ba2f507177` |
| `kailo-ui-20261009-mainc309-restored-feature-switches.png` | `333ab3eee6e303e3c5fede71e08bf661f4a346fdd18c8720260546402a89cc61` |
