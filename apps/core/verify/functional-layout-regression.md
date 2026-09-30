# 功能目录重构后的全量回归（2026-09-29）

对应 ADR-16 的目录与包名重构（提交 `076681d`，`apps/` 树与其后的 `dae9abd` 相同，
`git diff --quiet 076681d dae9abd -- apps` 退出 0）。本记录只证明重构没有改变已验证的行为，
不代替任何 Stage 的验收，也不证明 Desktop/Mobile 安装包。

## 执行与结果（本地拓扑）

- `core/verify/run-integration.sh`：退出 0，31 批 `test result: ok`。重构后的第一次运行失败于测试夹具中
  仍写着 Core 的旧二进制名；把夹具改为 `platform-core` 后重跑得到上述结果（提交 `076681d` 说明：
  「A stale binary name in the integration harness was fixed」）。
- `core/verify/web-walkthrough.sh`：20/20 通过。
- `tools/check.sh --full`：在隔离数据库上退出 0（含实际迁移前进/回退演练）。

## 破坏核验：派发结果记录

`ccb0a36` 把派发结果统一由 `governance.rs::record_dispatch` 记录（直接启动的路径经
`record_direct_launch`），迁移 `20260929110000_dispatch_state_backfill` 回填存量行；
`core/crates/platform-core/tests/native_client.rs` 断言设备公钥登记后 ActionExecution 的
`dispatchState` 为 `DISPATCHED`。

重构后把 `record_direct_launch` 的判断反转并重建 Core，该用例在
「登记完成后派发状态仍未推进」处失败（`left: NOT_DISPATCHED`，`right: DISPATCHED`）；
源码还原、重建后全套集成 31 批通过。原生端设备登记任务此前显示的
「Allowed, not started yet」由此闭合（`collaboration/fork/verify/desktop-client.md`、
`mobile-client.md` 中的观察早于该修复）。

## 门禁拦截

批量替换产品名字符串时误改了 `model-gateway` 上游 UI 的两个文件（`ui/src/pages/RawConfig.tsx`、`ui/src/configMonaco.ts`：其中上游原有的 `agentgateway-config.yaml` 字样被替换）；`tools/check.sh seam` 因
`model-gateway` 产物的 `source_digest` 与当前源码不符而失败。两个文件从 `ccb0a36` 原样恢复后
`seam` 通过，产物摘要与登记一致。

## 运行时数据迁移

运行时数据目录改名为 `deploy/local/data/secret-store`（原 `openbao`）与
`deploy/local/data/collab-objects`（原 `buzz-objects`）之前，停服并备份到
`/volumes/data/kailo/backup-rename-202609290706/`（`openbao.tar`、`buzz-objects.tar`、
`keycloak-import`）。迁移后 OpenBao 解封，Compose 服务全部恢复，随后执行上述回归。

## 未被本记录证明的边界

- 未在重构后重跑 Desktop `.deb` 与 Mobile APK 的端到端；
- 未对新 Core/Worker digest 做回滚演练；
- ADR-17 的内部标识迁移不在本次范围内。

## 共享主题与协作界面呈现增量

2026-09-30，本增量只收口 `REQ-08`、`DD-53` 与 `V-SCN-45` 已定的呈现合同：
Web ThemeProvider 使用 kit 已有的三种主题模式；Desktop 搜索与草稿时间调用现有
共享日期函数；侧栏 Relay 连接提示的九条文案进入 TypeScript 单一目录，Dart 由
既有生成器投影。没有新增设置、locale、实体、路由、业务上限或测试夹具。
主题存储键、系统配色订阅、查询与排序、draft 行为、连接状态及按钮回调均保留。
本批无 schema/API/Workflow 或数据库兼容变更，亦无外部副作用与业务终态变更；
六类业务错误保持原合同，非法日期仍由共享呈现的不可用文案处理，不另立错误码。

编辑前图谱的共享 i18n File 为 HIGH（21 个直接导入、105 个上游节点），草稿时间
函数亦为 HIGH，影响详情/列表至 HomeView；已明确提示风险并读出直接消费者。
Const 的 UNKNOWN 以生成器、类型与实际读取补核，不把零边视作未使用。
日志为 `/volumes/data/kailo/tmp/codex-theme-preedit-gates-20260930.log`。

实际验证：Web typecheck、单文件格式与现有 14 项测试退出 0；Desktop 两文件格式、
整体 typecheck 与现有日期相关 37 项测试退出 0。Desktop 首次 typecheck 退出 2，
九条错误均来自已安装 kit 副本不含新 key；按 ADR-18 原命令刷新后通过，五份
package/lock 摘要不变。Web 的原 `npm ci` 刷新也未改变 package/lock/config。
没有改 alias、版本或类型约束来消除错误。完整日志分别为
`/volumes/data/kailo/tmp/codex-ui-web-check-20260930.log`、
`/volumes/data/kailo/tmp/codex-desktop-date-typecheck-current-20260930.log`、
`/volumes/data/kailo/tmp/codex-desktop-date-unit-current-20260930.log`。
首次失败仍保留于 `codex-desktop-date-typecheck-20260930.log`，不覆盖原输出。

实现后临时删除新目录的一项中文文案，原生成同步检查实际退出 1，报缺少条目；
立即还原后退出 0，源码摘要与破坏前相同。日志为
`/volumes/data/kailo/tmp/codex-ui-i18n-discrimination-20260930.log` 与
`/volumes/data/kailo/tmp/codex-ui-i18n-restored-20260930.log`。选定暂存源的生成物
初次同步检查亦拦下不一致，按其真实源重新生成候选后通过，没有手写第二套字典。
限定独立复核未发现本批缺陷；不覆盖其他未提交源码、三端整体呈现或 Stage 关闭。

真实 Web 构建与登记退出 0，22.858 秒，source 为
`sha256:446595d00f25c90bff044ae2b806a70189806960e57c167478847ce6e2710745`，
artifact 为 `sha256:a830bba58ce86f8a0129348c32b816cf2eaf168688f18dac9e6188226b9bd9af`。
仅 `buzz-web` 以现有 Compose 命令替换，退出 0、running/healthy，未重启 Core 或数据库。
日志为 `codex-ui-web-artifact-user-20260930.log` 与 `codex-ui-web-deploy-20260930.log`。
此前两个包装失败没有进入实际构建，仍保留原日志；成功构建未修改 builder 限额。
同一真实 Web、现有核验用户的浏览器走查退出 0，5/5：系统深色、无需刷新跟随浅色、
设备浅色覆盖、设备深色覆盖、非法偏好回退系统。日志为
`/volumes/data/kailo/tmp/codex-ui-theme-runtime-20260930.log`；浏览器 finally 关闭。
没有创建业务测试对象、保存浏览器凭据或生成新测试脚本，不扩充为完整业务链验收。

Desktop 以现有构建入口单次实建并登记，退出 0，5 分 31.886 秒，source 为
`sha256:d7cd027254577c9ace4d4942400e36a21576e33fae601b27c81d1fcc04c6f4c0`，
`dist/desktop-client/Kailo_0.5.23_amd64.deb` 的实存摘要与登记同为
`sha256:b90bd3722482f9fe8bf557dbba9588d6dc966806ff8d934e3fbece88a02e1bab`。
日志为 `/volumes/data/kailo/tmp/codex-desktop-ui-current-artifact-20260930.log`。
构建使用既有受限 builder，未安装或启动该包；13 份 Web 与两处 Desktop 追溯仅同步
实际 artifact，能力状态与历史 Core/Worker 发布登记不变。

上述产物来自完整当前工作树，包括其他未提交改动，不是本批选定源码提交的发布证明。
选定暂存的七个源码文件仅包含共享主题定义、对应生成器及 Dart 投影、Web 主题、
Desktop 两处日期与侧栏文案；候选字典经原生成器同步检查通过，未混入其他 ReasonCode
或 native 状态修改。本批源码提交不登记新的发布版本，也不关闭 Stage 1/2。
