# 原线程并排 / 展开切换恢复

## 权威与实际差异

- 固定 Buzz `779af8886caae1317b4de962082429867ab61503`：`desktop/src/features/channels/ui/ThreadViewModeToggle.tsx::ThreadViewModeToggle/shouldRestoreThreadToggleFocus`、`desktop/src/features/channels/ui/useThreadViewModeSwitch.ts::useThreadViewModeSwitch/getResolvedThreadTargets/getScopedLayoutScrollTargetId`、`desktop/src/features/channels/ui/ChannelPane.tsx::ChannelPane`。恢复前 Native 两个模块与该版本逐字 `cmp` 均为 0；Web 已有共享偏好和 FocusThreadDrawer，但没有原线程头切换按钮及布局阅读锚点消费者。
- 用户明确要求固定原版完整交互及 Web/Desktop 共源；`.design/07` §4 要求共享原版 TypeScript 页面和交互主体，宿主仅适配传输。此批不改变任何执行、资源或授权合同。
- 分类：两个原模块为“共享迁移”；图标、按钮、Tooltip、焦点判据、双 animation-frame、阅读锚点和目标消除算法为“原样保留”；英文原文与中文同源词条、Web 既有 BFF 线程消费为“已授权治理/宿主适配”；此前 Web 头控件与锚点接线为“缺失需恢复”，目前仅源码实现，不标验收完成。

## 影响面、写入与副作用

- 新 shared `ThreadViewModeToggle` 和 `useThreadViewModeSwitch` 由 Native 原位置 re-export，并由 Web `ChannelThreadPane` 实际消费；package 两个精确导出保留 Native 原单模块检查导入边界，不加载整个线程 barrel。未新增 npm 依赖或锁变更。
- Web `ChannelPane` 以既有 overlay 判据投递双栏可用性、以原 `markExitComplete` 结束覆盖；线程使用已有 `RightAuxiliaryPane/getThreadPanelLayout`，正常、加载和读取错误均保留原头控件。切换时先记当前可见消息，再改变原 device-local preference；收到真实 settled message 才清除该布局锚点，不吞独立外部深链目标。焦点编辑路由使用实际 focus 状态。
- 读取仍由 `useWorkspaceThread`、已授权资料/反应/媒体查询完成；发送、编辑、删除、撤权和 UNKNOWN 不变，不新增发布或 HTTP 调用。仅 UI 偏好使用既有 localStorage 权威，无数据库、迁移或四语言业务契约变化。

## 边界与异常

- 空线程仍为原 skeleton/error；无可见行时不构造锚点。线程根变化按原 hook 清除旧锚点；关闭与 principal/workspace/root 宿主 key 重建一起丢弃组件态，不跨 scope 搬运消息。
- 窄屏没有双栏控件；设备偏好可保留但不强行展开窄屏。键盘激活恢复按钮焦点，指针激活恢复正文焦点。外部目标和布局目标不同只消除布局目标，保留原搜索定位意图。
- 重复布局点击沿原同一偏好和锚点状态，不增加异步业务状态。原 BFF 准入失败/中断仍禁动作，不因布局改变恢复权限；业务六类错误映射及未知终态保持既有消费者，UI 偏好不生成业务成功状态。

## 实际证据与尚未验收

- 独立私有输入 `/volumes/data/kailo/tmp/ui-thread-view-mode.fwzEEb/{base,apps}` 以主线程已合入 DM/头像增量后的正式字节保存前像；不修改已冻结候选、正式源码或公共 index。
- 12 源文件差异 `+351/-234`；最终 `owned-source-final.patch` SHA-256 `a5493c3d6294109ec0c1046b5302869e7c5d6b0e5e672ac34064e052cd69f060`。正式 `git apply --check --whitespace=error` 退出 0，仅证明可应用和空白检查，不证明类型或功能通过。最初 `owned-source.patch` 的 `19c5af03d396c6fa0fd89697889207120104652575a7aa0591580c6d1488647a` 保留失败输入，不用于最终集成。
- 原 SDK `kailo-agent-receipt-xvkujx` 预检仅 sleep，4 CPU / 8 GiB、swap 同额，宿主 available 26 GiB。原 `python3 tools/gen-platform-i18n.py` 作业 86264 退出 0；日志 `/volumes/data/kailo/tmp/ui-thread-view-mode.fwzEEb/i18n-generation.log`。Dart 仅两个新词条投影，没有手写重复翻译权威。
- 实现后扩展既有 `thread-panel.test.tsx` 与 `ChannelThreadPane.test.tsx`：两语原控件、阅读锚点、keyboard/pointer 焦点、线程更换、真实 channel/conversation 线程切换、不发布、单栏不显示控件。Native 两个原 Node 检查继续消费原位置的共享 re-export。
- 原集中作业 78026 中共享生产类型、检查类型与 Web 类型均退出 2：实际 TS2307 是迁移 Button 时误写不存在的 `../../sidebar/button`，并连带 TS7006。修正为其他原线程组件已用的 `../../profile/buzz/shared/ui/button`，不改控件/断言。原作业保持旧输入；主线程同意后核实自有 SDK 中 bash 530356 与子 Node 541677，同组 530356，仅结束该组，作业实际退出 143。Native 类型未完成，后续 Node/DOM 未执行，不能计失败用例或通过；日志 `validation.log` 保留。
- 旧作业消失、SDK 仅 sleep 后，正确 import 同步到原共享输入及两宿主原 `file:` 包。集中作业 45431 使用两份此前完整私有输入加本批增量，逐项 cmp 0，合同生成物与正式均 cmp 0。`validation-final.log` 取得共享生产类型、检查类型、Web 和 Native 类型全部退出 0。原 Native `node --import ./test-loader.mjs --experimental-strip-types --test src/features/channels/ui/ThreadViewModeToggle.test.mjs src/features/channels/ui/useThreadViewModeSwitch.test.mjs` 为 6/6、退出 0；原 shared `node node_modules/vitest/vitest.mjs run test/thread-panel.test.tsx` 为 10/10、退出 0。
- 同作业后接 Web `node node_modules/vitest/vitest.mjs run src/platform/ui/ChannelThreadPane.test.tsx` 在 fork worker 启动阶段超时：60.06s、0 tests、退出 1。作业 45431 最终退出 1；这不是业务断言失败或两宿主交互通过，没有重复启动该 Web 检查。原配置、pool、timeout 未改；shared 的 React act 警告保留在日志，不宣称零警告。
- 实现后真实反证仅修改共享验证副本的 `useThreadViewModeSwitch`，删除实际 `setThreadViewMode(mode)`；既有同一个 `thread-panel.test.tsx` 作业 80783 实际 2 failed / 8 passed、退出 1，中英文均在原偏好应为 focus 而仍为 split 处失败。随后 apply_patch 恢复原字节，cmp 候选为 0，作业 8823 复验 10/10、退出 0。正式源码和本批冻结候选从未被变异；原件为同目录 `production-negative.log` 与 `production-restored.log`。
- 候选实际页面截图尚未验收。按 playwright-cli 原入口核查现存会话后，两个 build-info fetch 均失败，未用这些请求推断产品故障或重复注入会话；只读核对实际线上容器 `/srv/app/platform-build-info.json` 仍为 `sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`、镜像 `sha256:7ea0c5fa4cf0897ae1c762fa7b42bcc5b087b26950106bc0de2604be5137e07f`，不是本候选。现存 Docker 无候选 preview，原 Vite 没有 BFF proxy，Compose 只允许 Gateway 对外；未新建绕过 SSO 的裸预览、改线上路由或用 DOM 注入模拟新版。主线程已明确将本批纳入下一次集中原 Web 产物窗口，再正常 SSO 实拍两布局及阅读锚点/焦点。
- 没有新镜像、部署、候选截图或 Windows 设备验收。旧部署截图与此前批次通过结果不覆盖此私有新输入。本批不表示完整 ChannelHome/RightPanel、Projects Detail 或 Agent Session/Transcript 已恢复。

## 主线整合边界

- 2026-10-10 主线程复核后以 apply_patch 合入上述最终 12 源文件及本回执；正式目录 `git apply --reverse --check` 退出 0，证明已应用的增量与交付补丁一致。专用提交 index 收入该增量，未整体暂存同文件中的用户改动。
- 同批合入 Wren `describe` 的 typed ContentReference 四源增量及其失败如实记录；此时专用候选为 120 文件、`+6576/-709`，tree `9e72880c2602b4d964ad9f54447ccefdd52051cb`（本整合说明写入前）。`git diff --cached --check` 退出 0；这不是全量检查通过。
- 用户原公共 index 五文件的 binary diff SHA-256 保持 `78b0a81feb58b3a0549ff72398c01fe446aed7a53ef16357f7e75ed372894e71`。没有提交、推送或部署这批源码。
- 原全量作业 69733 继续只使用冻结 tree `433c8b90adf7bc3ed3fa22b13376170f58ddc55f`，不热替换其输入；已见 Rust/Go/TypeScript/Dart 静态检查、四侧生成同步与兼容检查通过，数据库实际迁移因未提供 DATABASE_URL 跳过。该作业不覆盖本次新增线程布局与 Wren 引用增量，余下门禁仍须看真实终态。

## 2026-10-10 全量作业终态与后续源码整合

原作业 69733 已实际退出 1，没有重启。原命令为 `CHECK_SOURCE_REF=433c8b90adf7bc3ed3fa22b13376170f58ddc55f CHECK_CPUS=4 CHECK_MEMORY=8g CHECK_NETWORK=bridge CHECK_CACHE_ROOT=/volumes/data/kailo/check-cache CARGO_BUILD_JOBS=16 BUILDX_BUILDER=kailo-core-data ./tools/check.sh --full`，TMPDIR 为 `/volumes/data/kailo/tmp`。

- 共享前端实际 705 passed / 2 failed / 6 worker errors；英文主题用例超时、schedule summary 用例失败，另外六个 worker 启动超时。没有把这些失败或未启动用例填为通过。
- 四侧生成、静态检查、原 Rust/Go/Dart 检查及 Workflow replay 通过；数据库迁移实际演练与要求专用数据库的 ignored 用例没有运行，不能作为 SQL 或运行验收。
- seam 失败包括误列为 remove_paths 的原 typing 接收 hook，以及 12 个候选源码与已登记产物摘要不一致。修正登记而非删除 hook；未伪造产物摘要。文档与安全不变式检查通过不抵消以上失败。
- 终态日志 `/volumes/data/kailo/tmp/component-delivery-commit.CVKZK5/full-component-433c8b90.log` 的 SHA-256 为 `ba98892023a4572c8cde3a2e703d336ac7c3b59b5e7c59e1e893aea0f7be36a6`。

随后已合入原历史/草稿消费者、稳定 split/focus 编辑器宿主、可信 DM native channel 解析及缓存键修正。Cells 原 PutCell 成员治理与 Wren 原部署准备/观察候选也已按各自回执合入正式源码和专用提交 index；不是已提交或已部署。写入本段前专用 tree 为 `b37317118fc43ab2bc05ff8e5f6a9b60500c0ce4`，163 文件、`+10546/-1026`。这些后续改动不在 433c8b90 的验证范围内。用户公共 index 五文件的摘要保持不变；没有据旧检查关闭最终 full、三组件准入、全页面截图、Windows/Mobile 或三人双 Agent 稳定协作门禁。
