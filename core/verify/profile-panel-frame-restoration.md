# 原资料面板框架共享恢复

## 本批范围与依据

- 固定官方：Buzz `779af8886caae1317b4de962082429867ab61503`，`desktop/src/features/profile/ui/UserProfilePanelFrame.tsx::UserProfilePanelFrame`；实际原调用在同版本 `desktop/src/features/profile/ui/UserProfilePanel.tsx`。依据 REQ-24 原模块恢复及 Web/Desktop 共源要求。本批不是完整 Profile/Agent 管理交付。
- 写入前影响面：Web `MessageAuthorProfile`、Native `UserProfilePanel`、共享 `MemberProfilePanel` 是三个实际资料面板消费者。均已有原 `AuxiliaryPanel`、资料正文、关闭及宽度控制；此前三处各写一份头部/外壳，Web/成员的窄屏头部分隔边框遗漏原 `!isOverlay` 条件。通用 `AuxiliaryPanel` 不修改。
- 副作用：原作者事件证明、成员作用域、pubkey 一致性、Native Relay 身份读取、DM 准入/结果不明/切身份失效链全部不改。没有新增服务请求、持久状态、契约、注册表或执行权威；窗口尺寸继续由既有断点 hook 读取。
- 边界：宽屏/窄屏、split/standalone、单面板和关闭/重置宽度采用原框架条件。资料无值、请求失败、错 pubkey、跨身份迟到、DM 结果不明继续由原三个消费者处理，原六类错误映射不变。未恢复 Agent 编辑、添加频道、persona 的动作不生成入口；对应原框架槽在当前人类资料消费者传入 null。

## 全量差异台账的本模块四类归属

- 原样保留：原框架的全部布局、sticky surface、动画/减弱动效 class、header 条件、siblings 槽及关闭/resize 传递逻辑。
- 共享迁移：完整原 `UserProfilePanelFrame` 放入 `client-kit/ts/platform/src/react/pulse/UserProfilePanelFrame.tsx`，唯一既有 pulse 导出供两宿主消费；成员资料也直接复用此实现，不维护第三副本。
- 已授权差异：既有中文/英文 `platform.profile.resize` 替代英文 resize aria-label；真实治理读取/DM 回调保持原宿主接缝。`testId` 可选参数仅保留既有成员面板检查定位，不改变呈现/交互。模块导入改为共享路径。
- 缺失需恢复：完整 Agent 资料/编辑/persona，以及其他尚未贯通的原资料模块仍是缺口。此批只恢复人类资料的原框架消费者，不能凭保留槽位认定对应业务可用。

此前 Web 的两条检查要求 split 人类资料头透明，不是用户授权。固定官方 `UserProfilePanelFrame` 明确 `transparent={stickyChromeEnabled}`，人类资料该值为 false；这次原样恢复 header 表面并同步原行为检查，未以现有实现反改原版。原 `transparentChrome` 外壳属性仍传递，不能将它混同为人类 header 的透明授权。

历史完整差异账仍以 `buzz-restoration-checkpoint.md` 所载固定比较点为准，本批只更新上述实际模块的归属，不重算旧统计、不把未证明差异数当功能缺失数、不声称当前 main 全量一致。

## 实际验证与反证

复用原 `kailo-web-thread-tooltip-sdk`：4 CPU、8 GiB 内存及等量 swap 上限，启动前仅 sleep 进程，MemAvailable 36,553,716 KiB。没有新 SDK、镜像、builder 或全局检查。私有输入根 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`，正式输入逐文件复制并 cmp；依赖为该 SDK 已有运行时缓存。

1. `/candidate/apps/web-client/web` 执行 `node node_modules/vitest/vitest.mjs run src/platform/ui/MessageAuthorProfile.test.tsx src/platform/ui/InboxPane.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`：55/55、exit 0，原会话 87768，`profile-frame-positive.log`。保留原资料授权、身份切换、中文/英文、未知 DM、关闭、resize 与真实 Inbox 消费者检查；新增窄屏实际消费者断言。
2. 只在私有实际安装的 `UserProfilePanelFrame.tsx` 删除 `!isOverlay`，同原套件加 `-t "original overlay profile"`：1 项断言失败、26 跳过、exit 1，89782，`profile-frame-negative.log`；实际捕获不该出现的 `after:w-px`，不是导入/worker 启动失败。
3. 私有模块恢复正式字节、cmp 0，原两个完整套件再次 55/55、exit 0，`profile-frame-restored.log`。
4. 已有共享 DOM 输入 `/candidate/delay-timeout-ui.Ih20g1/client-kit/ts/platform` 同步这三项共享生产文件及原成员套件，执行 `node node_modules/vitest/vitest.mjs run test/members.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`：29/29、exit 0，`profile-frame-members.log`。第 3/4 项串行聚合会话 77919 exit 0。日志存在原 React act 警告，不抹去。
5. 本批限定路径 `git diff --check` exit 0；全工作区检查另有其他已有文件 EOF 空行，未修改那些文件。

未执行规范 frozen-lockfile 类型检查、Native DOM/设备验收、四侧检查或新 full；本次真实 DOM 执行不替代这些门禁。此前借用缓存版本与规范类型链不匹配的问题也不据此标为解决。

## 浏览器、提交与部署边界

`playwright-cli -s=kailo-frame open` 从投递入口尝试正常独立浏览器；Data 临时配置/输出目录 `/volumes/data/kailo/tmp/web-profile-frame.QTuuqK`，复用既有 Chromium 1226。实际 exit 1：daemon 12438、browser 12450 因 `No usable sandbox!` / SIGTRAP 退出，页面未打开、未登录、未截图；未关闭 sandbox、未反复重开。不能将旧线上截图用作本批修复后视觉证据。

本批只交源码与检查候选给主线复核。未部署、未制作 Desktop/Mobile 包，未完成新版截图；不声明原版 100% 还原或生产就绪。
