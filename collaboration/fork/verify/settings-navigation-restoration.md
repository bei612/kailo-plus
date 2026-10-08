# 原版设置导航快捷键恢复

固定基准：`/volumes/kailo/.references/buzz`，commit `779af8886caae1317b4de962082429867ab61503`。本批仅恢复已具备真实导航消费者的原版交互；不声明设置 16 分区全部恢复。

## 整个设置目录的差异清点

对 `desktop/src/features/settings/` 的全部 56 个 tracked 路径逐个 `git show <commit>:<path>`，与 `apps/collaboration/<path>` 做 `cmp`，结果 0 原路径字节相同、9 原路径不同、47 原路径不存在。路径缺失不直接等同功能缺失，下面区分共享迁移与仍缺内容；此统计不是恢复率。

- 共享迁移：`ui/KeyboardShortcutsCard.tsx` → `client-kit/ts/platform/src/react/settings.tsx::ShortcutSettings`；`ui/NotificationSettingsCard.tsx` 与 `ui/SoundPicker.tsx` → `react/notifications/`；`ui/SettingsOptionGroup.tsx` → `react/settings-option-group.tsx`；`ui/SettingsSectionHeader.tsx`、`ui/SettingsView.tsx` → `react/settings-surface.tsx`。这些原路径均仍有真实宿主调用，不是两份页面权威。
- 共享迁移及已授权治理适配：`ui/ProfileSettingsCard.tsx` → `react/profile-settings.tsx` 与双宿主资料读写/上传；`ui/SettingsPanels.tsx`、`ui/SettingsScreen.tsx` 组装当前实际消费者。私钥导出和旧 Agent 执行器不能原样重开；未开放功能仍是交付差距，不以治理需要笼统判定已完成。
- 原路径缺失但已共享迁移：`ui/AppearanceSettingsControls.tsx` → `react/appearance-settings.tsx`、`conversation-display-settings.tsx`、`thread-layout-settings.tsx`、`theme-settings-controls.tsx` 等实际设置消费者。多 community 外观语义未据此认定已恢复。
- 其余 46 个原路径为本批未恢复/未证明等效项：`EncryptedBackupProvider.tsx`、`SidebarUpdateCard.tsx`、`UpdateChecker.tsx`、`UpdateIndicator.tsx`；`hooks/{UpdaterProvider.tsx,use-updater.ts,useSendFeedback.helpers.test.mjs,useSendFeedback.ts}`；`lib/{appearanceScopeCopy.test.mjs,appearanceScopeCopy.ts,encryptedBackup.test.mjs,encryptedBackup.ts,moderationQueue.test.mjs,moderationQueue.ts}`；`sidebarUpdateCardVisibility.test.mjs`、`sidebarUpdateCardVisibility.ts`；`ui/{AgentDefaultsSettingsCard.tsx,AgentsSettingsPanel.tsx,BackupTestFlow.tsx,ChannelTemplatesSettingsCard.tsx,CustomHarnessForm.tsx,EncryptedBackupCreator.tsx,ExperimentalFeaturesCard.tsx,HarnessCatalogDialog.acpForcedGate.test.mjs,HarnessCatalogDialog.tsx,HarnessRow.tsx,HarnessesSettingsPanel.tsx,HostedCommunitiesSettingsCard.tsx,MobilePairingCard.tsx,ModerationQueueCard.tsx,PreventSleepSettingsCard.tsx,PrivateKeyBackupRow.tsx,SendFeedbackController.tsx,SendFeedbackDialog.tsx,SignOutSection.tsx,VoiceSettingsCard.tsx,harnessCatalogCopy.test.mjs,harnessCatalogCopy.ts,harnessCatalogLogic.test.mjs,harnessCatalogLogic.ts,harnessFormLogic.test.mjs,harnessFormLogic.ts,harnessGalleryLogic.test.mjs,harnessGalleryLogic.ts,voiceSettingsLogic.test.mjs,voiceSettingsLogic.ts}`。本批不为这些模块生成无消费者入口。

## 实现与四步影响结论

1. 权威：用户要求保留原版交互、Web/Desktop 共源；`apps/06` 共用代码约束。原符号为固定 commit 的 `desktop/src/app/useAppShellKeyboardShortcuts.ts::useAppShellKeyboardShortcuts`（Home 分支）、`desktop/src/app/navigation/backForwardChords.ts::matchBackForwardChord`、`desktop/src/app/navigation/useBackForwardControls.ts::useBackForwardControls`、`desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx::KeyboardShortcutsCard`。不是重新设计导航或增加快捷键。
2. 影响：纯按键匹配原样移到 `client-kit/ts/platform/src/backForwardChords.ts`；监听器共享到 `react/use-navigation-shortcuts.ts`，Desktop 原 Home 分支和 history listener 删除重复，native 原历史 index、前进边界和 Tauri mouse-nav 保持；Web 在既有 authenticated PlatformApp 调用，Home 沿 `usePlatformNavigation.openTab("inbox", active)`，Back/Forward 沿同一 TanStack history。Web 既有设置列表补 Home、Back、Forward、Toggle sidebar 四项，侧栏仍用已有 SidebarProvider 处理。无契约/数据库/资源正文/权限/用量状态变化，无新迁移。
3. 副作用：快捷键只导航，不产生第二目录或绕过 BFF/Relay；到达页仍执行既有 scope 和准入。Web `useCanGoBack` 不允许未建立的应用后退；原生 canGoBack/canGoForward 不变。Home 遵守原 `defaultPrevented`、重复按键、平台修饰键及设置打开禁用条件，普通选全文和编辑快捷键不被抢占。
4. 边界：原版历史快捷键明确允许编辑框内使用（macOS Cmd+[ / Cmd+]，Windows/Linux Alt+← / Alt+→），不增加 editable-target 拒绝。窗口卸载移除监听、回调更新不沿用旧作用域。设置打开时 Home 不触发；历史导航仍可离开设置。协议文档独立宿主、生命周期受限宿主不挂载 FULL PlatformApp 的新监听。导航失败/工作流未保存拦截继续属于原路由，不转换成任何业务执行成功；本批没有新增异步业务终态或六类错误类别。

## 可复核验证

复用 `kailo-agent-receipt-xvkujx`，`NanoCpus=4000000000`、`Memory=MemorySwap=8589934592`，原 SDK `/evidence/profile-settings-ortsoo.DRR20F/apps`。先查活动进程和内存；与主线及 Workflow 队友协调，只同步拥有文件和实际 installed package 小文件，不新建整树。

- Shared：`./node_modules/.bin/vitest run test/navigation-shortcuts.test.tsx test/channel-navigation-shortcuts.test.tsx`，19 passed，exit 0。
- Web：`./node_modules/.bin/vitest run src/app/platform-navigation.test.tsx src/platform/ui/SettingsPane.test.tsx`，16 passed，exit 0。真实 router 验证 Windows/macOS Home→Back→Forward 的 URL、workspace 引用及宿主不重挂，设置页展示实际 19 个快捷键。
- 私有 SDK 将 Home 键错改为 Z：3 failed / 2 passed，exit 1。将 Web installed 共享 Back 分支关闭：2 failed / 9 passed，exit 1，实际 URL 停在 Inbox 而非返回原频道。两次均 `apply_patch` 还原，随后 19 + 16 passed；正式源码未破坏。
- 原 native 13 项 chord 检查首条误用裸 `node --experimental-strip-types`，因 node_modules 禁止 strip types 退出 1，后续顺序检查未执行；正确入口是现有 `node --import ./test-loader.mjs --experimental-strip-types --test src/app/navigation/backForwardChords.test.mjs`，不另造 loader 或改掉原检查。
- 纯函数原样迁移后的最终顺序复验：原 native 13 passed、shared 19 passed、Web 16 passed，整条命令 exit 0；原 matcher 与固定上游文件 `cmp` 相等，正式/SDK 拥有文件无变异残留。

日志在 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/profile-settings-ortsoo.DRR20F/`：`navigation-shortcuts-{positive,mutation,restored,final}.log`、`navigation-settings-web-{positive,restored,final}.log`、`navigation-web-mutation.log`、`navigation-original-chords{,-final}.log`。三侧 typecheck 与 docs 由主线最终集中执行，不把先前批次结果冒充本批；本批未构建、发布或新增逐页截图/设备验收。

## 资料与头像：切换设置分类保留同一治理请求

本次沿上述全量设置清点选择已有完整消费者的 Profile 模块，不新增设置分类。固定 `779af8886caae1317b4de962082429867ab61503` 的 `desktop/src/features/settings/ui/SettingsPanels.tsx::renderSettingsSection` 在 profile 分支挂载原 `ProfileSettingsCard`；同版本 `desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard` 的 `saveProfile` 调用原 mutation 后提示保存。Kailo 已将该页面共享迁移至 `client-kit/ts/platform/src/react/profile-settings.tsx::ProfileSettingsCard`，增加当前身份、同一幂等请求、签名事件读回与 UNKNOWN 对账，这是已授权治理差异。本次不重做原页面、修改样式/文案或恢复未经治理的原 mutation。

### 四步影响结论

1. 权威：结果不明不能渲染成功/失败，也不能换请求重发。现有 shared controller 已在 ref 中保存 immutable request；现有 Web/Native 设置宿主切换分类却卸载整个 controller，导致真实资料或头像 UNKNOWN 在返回时消失。修复的是这一生命周期断裂，不是另建资料权威。
2. 影响：Web `SettingsPane` 默认 profile 已访问，保持同一个 `WebProfileSettings` 并只切换可见性；Native `SettingsView` 沿原 custom-emoji 已访问模式保留同一个原 `ProfileSettingsCard`，`SettingsPanels` 不再重复挂载该页。真实上传、BFF update/readback、Native mutation、不可变 idempotency key、签名 pubkey 校验均复用既有消费者。无新契约、数据表、迁移、同步或正文复制。
3. 副作用：Web `PlatformApp` 和 Native `AppShell` 已用 tenant/principal/platformSessionId 为设置宿主 key；本次不跨认证会话保留旧控制器，不增加后台重发，不将未知转换为失败。换分类返回只展示已有状态，只有用户选择原“Check save result”才将同一个 request 交给原治理对账链。旧会话销毁后的结果仍不得向新会话写回；现有晚到上传及晚到保存读回检查继续执行。
4. 边界：pending 时切页再收到网络结果不明仍保留 disabled 原编辑器；UNKNOWN 头像返回后不再上传一份；相同会话可人工对账，已确认保存后显示既有权威读回。认证 scope 销毁只销毁旧 UI，不判定原请求业务失败或自动重放；此修复不承诺跨刷新/进程重启恢复本机 UI 对账状态。没有新六类错误映射，仍消费既有 TransportError→UNKNOWN 与确定失败分类。Mobile 未修改，不将 Web/Native jsdom 检查冒充手机或 Windows 设备验收。

### 实际消费者检查与反向破坏

沿上文同一 4 CPU / 8 GiB SDK，先核正在运行的进程及宿主内存，仅同步本批 5 个实现/检查文件。没有安装依赖或复制新快照。

- Web：`./node_modules/.bin/vitest run src/platform/ui/ProfileSettings.test.tsx src/platform/ui/SettingsPane.test.tsx`，18 passed，exit 0。新增实际编辑资料后提交、实际 PNG 输入上传头像后提交，再切分类/返回/人工对账；第二次 updateProfile 收到同一个 request 对象，avatar upload 仅一次。另一用例验证认证 scope 变化不自动重放旧 UNKNOWN。
- Native：在 `collaboration/desktop` 执行已有 Web 工具入口 `../../web-client/web/node_modules/.bin/vitest run tests/settings/SettingsView.test.tsx`，2 passed，exit 0。测试真实 `SettingsView`、Native `ProfileSettingsCard` 和 shared controller，mock 仅资料查询/保存与无关宿主边界；实际编辑提交后 UNKNOWN、切页返回、同一个 request 对账成功及换会话不重放。检查位于原 `tests/` 范围，复用 Web 已有 Vitest，无 Native 新依赖或工具配置；未单独对该测试执行 TypeScript 检查。
- 私有 SDK 仅撤掉 Web profile 保活：2 failed / 11 passed，exit 1，实际头像 UNKNOWN 返回后丢失。仅撤掉 Native profile 保活：1 failed / 1 passed，exit 1，实际资料 UNKNOWN 返回后消失；不是只检查保活 flag。两处均用 `apply_patch` 还原，正式源码未破坏。
- 最终还原复验：Web 18 passed、Native 2 passed，exit 0。日志同上目录的 `profile-lifecycle-{web,native}-{mutation,restored}.log`。Web jsdom 提示未实现 canvas getContext（原头像组件），未安装 canvas 迁就环境；上述实际头像提交与对账断言仍通过。

本批仅源码写入与消费者检查；三侧产品 typecheck/docs 由主线集中执行。没有新增发布、逐页截图、真实 Windows 包或 Mobile 设备验收；不声明整个设置模块的其他未恢复分区已补齐。

## 2026-10-08：头像与资料按原版仅提交修改字段

沿上述整个设置目录差异清点继续核对 Profile，不以本次 Git diff 代替全量对照。基准仍为 `779af8886caae1317b4de962082429867ab61503`：`desktop/src/features/settings/ui/ProfileSettingsCard.tsx::ProfileSettingsCard` 的 `saveProfile` 将 `updatePayload` 传给原 mutation；`desktop/src/features/profile/ui/ProfileAvatarEditor.tsx::ProfileAvatarEditor` 和 `desktop/src/features/profile/ui/AvatarCustomColorPanel.tsx::AvatarCustomColorPanel` 的布局、模式切换、上传、表情与自定义色控件已共享迁移，本批不另外设计页面。原样保留是这些控件的原结构与样式；共享迁移是双宿主复用同一个编辑器；授权治理差异是身份校验、冻结请求、UNKNOWN 对账、权威读回和中英文；本批恢复的真实缺失是仅提交实际修改字段的保存语义，并补原自定义色提交按钮的中文词条。

### 四步影响结论

1. 权威：原 `saveProfile(updatePayload)` 与既有 `contracts/api/web_profile_update_request.schema.json` 的“省略字段保留、空串显式清空”一致。旧共享实现却在头像保存时强制带上旧 displayName/about，可能覆盖另一会话刚更新的资料。`apps/06` §4 的 UNKNOWN 纪律不变；不恢复原私钥导出、清空本机数据等未经治理的入口。
2. 影响：只改 `client-kit/ts/platform/src/react/profile-settings.tsx::ProfileSettingsCard` 构造首次冻结请求的字段，保留原 idempotencyKey/expectedPubkey。Web `web-client/web/src/platform/ui/SettingsPane.tsx::WebProfileSettings` 原上传、updateProfile、同 eventId 与 pubkey 读回；Native `collaboration/desktop/src/features/profile/hooks.ts::useUpdateProfileMutation` → `collaboration/desktop/src/shared/api/tauriProfiles.ts::updateProfile` → `collaboration/desktop/src-tauri/src/commands/profile.rs::update_profile` 均继续使用已有消费者。Core `core/crates/platform-core/src/web_profile.rs::merged_content` 和 Native `update_profile` 已仅合并提供的字段，无新数据库/合同/迁移或第二份资料权威。Mobile 本批仅沿既有同源词条生成，无手机页面修改。
3. 副作用：不改签名者、Relay、认证 scope 或幂等判定；UNKNOWN 的同一冻结 request 仍供人工对账，绝不重新生成 key、重复上传或把未知当保存成功。未编辑字段不再随请求写入；完整权威读回仍更新昵称、简介与头像，真实确定成功后才清 intent。自定义色按钮只将原 `Use color` 经既有 `useAvatarText` 本地化，不改原提交回调、样式和布局。
4. 边界：无更改不提交；单独头像、单独昵称、单独简介及显式清空简介都保持各自字段语义；并发会话修改的其他字段由原后端最新可信资料合并，不用当前 UI 旧快照覆盖。晚到身份变化、保存不明、切换设置分类的原拒绝/对账分支不变。不是字段级 CAS：两个会话确实同时修改同一字段的冲突仍沿既有发布顺序，本批不另造并发协议。错误继续沿现有确定拒绝及 TransportError→UNKNOWN，不新增六类错误映射。

### 实际页面观察及范围

用既有 `playwright-cli -s=kailo-ui-status`、当前登录的独立 seam-verifier 打开真实 Web 设置，操作资料菜单、头像编辑、图片与表情模式并滚动到原上传区/Emoji Mart 网格；没有提交资料、上传文件或修改线上头像。以下每张截图均已用 `view_image` 打开复核，证明的是本批修改前的现有部署，不是未发布新源码的验收：

- `/volumes/kailo/.playwright-cli/profile-settings-old-deployed-20261008.png`：原资料布局、头像及中文导航。
- `/volumes/kailo/.playwright-cli/profile-avatar-editor-old-deployed-20261008.png`：原头像编辑器、三种模式与预览。
- `/volumes/kailo/.playwright-cli/profile-avatar-upload-old-deployed-20261008.png`：原上传区、URL 输入和完成控件。
- `/volumes/kailo/.playwright-cli/profile-avatar-emoji-old-deployed-20261008.png` 与 `profile-avatar-emoji-panel-old-deployed-20261008.png`：原表情模式、真实 Emoji Mart 搜索/网格。自定义色提交按钮的中文由实际渲染消费者检查，不把隐藏面板文本冒充可见截图验收。

### 检查与负向证据

复用既有 `kailo-agent-receipt-xvkujx` 的 4 CPU / 8 GiB cgroup、`/evidence/profile-settings-ortsoo.DRR20F/apps`，先核进程和内存，只同步拥有文件及两宿主 installed shared package 对应文件；不装依赖、不导出整树、不构建镜像。

- 首轮实际消费者：shared `vitest run test/profile-settings.test.tsx` 15 passed；Web `vitest run src/platform/ui/ProfileSettings.test.tsx` 13 passed；Native `node --import ./test-loader.mjs --test src/shared/api/tauriProfiles.test.mjs` 1 passed，联合 exit 0。Web 包含真实头像上传→UNKNOWN→设置切换→同 request 对账，并断言 avatar 请求不携带旧昵称/简介、最终采用完整权威新资料。
- 实现之后，在私有候选恢复强制 displayName/about 的旧错误并把自定义色提交按钮改回英文常量，运行 shared 两个真实消费者文件，得到 **5 failed / 13 passed，exit 1**。4 项抓到多余资料字段（包含显式清空），1 项抓到中文按钮消失；失败输出保留。随后从正式实现恢复两文件且 `cmp` 相等，正式源码未被破坏。
- `python3 tools/gen-platform-i18n.py` 与 `python3 tools/gen-platform-i18n.py --check`，exit 0，输出 `PASS: Mobile platform and reason catalogs match the shared TypeScript source`。唯一新词条 `platform.profile.avatar.useColor`，Dart 由原工具生成，不另维护翻译权威。
- 最终还原后的集中命令（session 86420）exit 0：shared `./node_modules/.bin/vitest run test/profile-settings.test.tsx test/profile-emoji.test.tsx` **18 passed**；`./node_modules/.bin/tsc --noEmit -p tsconfig.test.json` 通过；Web `./node_modules/.bin/vitest run src/platform/ui/ProfileSettings.test.tsx` **13 passed** 及 `./node_modules/.bin/tsc --noEmit` 通过；Native `../../web-client/web/node_modules/.bin/vitest run tests/settings/SettingsView.test.tsx` **2 passed** 及 `./node_modules/.bin/tsc --noEmit` 通过。Native 检查使用真实原设置宿主与共享 controller，不是 Windows 设备测试。Web 原头像检查仍输出 jsdom `HTMLCanvasElement's getContext()` 未实现提示；未安装额外 canvas 包掩饰该环境限制，实际上传/对账断言通过。

日志位于 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/workflow-native-template.s3JDP1/` 的 `profile-partial-consumers.log`、`profile-partial-mutation.log`、`profile-partial-i18n.log`、`profile-partial-final.log`。`git diff --check` 本批 8 文件通过。未运行全局 `./tools/check.sh --full` 或 docs 门禁，交主线集中执行；本批没有合同改动，不冒用此前四侧合同验证。原全树 3307 差异仍未全量分类，本文件列出的其余设置缺项未因此关闭；无本批发布、Windows 安装包或手机设备验收，不声明完整还原。
