# 原版全局 CSS 的两宿主共享恢复

关联 REQ-24、DD-74/75、ADR-09。固定上游 Buzz `779af8886caae1317b4de962082429867ab61503`；本批不更改认证、scope、Relay、BFF、权限或 terminal 能力。

## 完整模块差异及迁移

固定 `desktop/src/shared/styles/globals.css` 全部 import 与对应模块逐个核对。以下完整模块字节不变迁入 `client-kit/ts/platform/src/styles/`，旧 Desktop 副本删除，`collaboration/fork/upstream.yaml::remove_paths` 明确记录共享迁移，不归为功能裁减。

| 原 `desktop/src/shared/styles/globals/` 文件 | 共享行数 | 迁移前差异 |
|---|---:|---|
| scrollbars.css | 99 | 缺主内容区稳定 gutter 与透明 thumb 等 44 行 |
| motion.css | 119 | 缺 kickoff/reduced-motion/view-transition 等 62 行 |
| animations.css | 932 | 缺 emoji picker、avatar、animated count 等 389 行 |
| skeleton.css | 114 | 原样保留并共享迁移 |
| components.css | 827 | 缺原 component/onboarding/project surface 等 452 行 |
| utilities.css | 126 | 缺 content-visibility/huddle token 等 87 行 |
| media-controls.css | 54 | 原样保留并共享迁移 |
| avatar-framing.css | 156 | 缺 slider tip 与 reduced-motion 等 30 行 |
| image-lightbox.css | 65 | 原样保留并共享迁移 |
| video-review.css | 48 | 原样保留并共享迁移 |
| progress.css | 9 | 原样保留并共享迁移 |

以上 11 文件共 2,549 行，相较既有 Desktop 规则补回 1,064 行。共享 `styles.css` 按原顺序装配全部 11 模块、已有 composer/markdown/spoilers、theme/typography；保留已有 ProseMirror 授权适配。两端 `globals.css` 同样只导 Tailwind、tw-animate 与共享入口，并保留各自正确的 Tailwind config/source 路径。hover 采用原版实际 pointer variant；dark variant 已由共享 theme 定义，不重复定义。

完整依赖对照同时覆盖原 `desktop/tailwind.config.js::default.theme.extend`：Desktop 原配置字节等于固定上游，Web 少了 15 项（fontSize 的 3xs、badge、status-indicator、title、nsec-key、nsec-key-card；lineHeight 的 3–8；panel-left shadow；spacing 的 4.5、status-indicator）。原配置完整、字节不变迁入 `client-kit/ts/platform/src/tailwind.config.js`，两宿主配置均转发同一包导出。两端均没有额外插件需保留，固定原版 `plugins: []` 不变；不是为绕过编译而删原 CSS。

旧 11 份副本及 4 个单行别名（composer/markdown/spoilers/prosemirror）已无调用者，故删除。前三别名对应原文件加入 remove_paths；prosemirror 别名是 Kailo 增补，非原文件。终端 CSS 不导入，既有 terminal 差距仍保留。恢复原模块中的 huddle/onboarding 选择器不等于开放相应产品能力或宣称其执行链成立。

Web 原 `buzz-message-markdown` 对代码、链接、图片的覆盖与原 `MESSAGE_BODY_CLASS_NAME`、`MESSAGE_BODY_COMPONENTS` 已有规则重复，本批去掉覆盖和冗余类。原 `buzz-message-mention` 确有消费者，先将其迁为现有共享 `InlineChip` 与原 `inlineChipIconClasses/inlineChipLeadingEnd/WRAPPING_INLINE_CHIP_CLASSES`，再删除覆盖；保留 pubkey、agent 身份属性并补回原 label/kind 属性。原参考是 `desktop/src/shared/ui/markdown/MarkdownMention.tsx::createMarkdownMention`、`desktop/src/shared/ui/InlineChip.tsx::InlineChip` 和 `desktop/src/shared/ui/mentionChip.ts`。不增加假 profile 点击；原 Web 绑定/媒体 BFF 解析未改变。资料交互缺口不在本批宣称补齐。

普通表情选择器固定原版 `desktop/src/features/custom-emoji/ui/EmojiPicker.tsx::EmojiPicker` 的容器就是无 class 的 div；没有自行添加 `buzz-emoji-mart`。该 class 的真实原消费者是已复用的 ProfileAvatarEditor/AgentCreationPreview 有界面板，当前两者已有对应 class。DOM 出现 em-emoji-picker 而普通 picker 没有该 class 并不是丢样式的充分证据。

## 动手前四步结论

1. 权威：REQ-24 要求按固定原版完整保留布局/样式，DD-74 要求 Web/Desktop 同源。当前 CSS 大幅删减不是治理所必需；按完整原模块恢复，不自行重新设计。颜色、时长、尺寸均来自固定官方 CSS，不另立业务配置。
2. 影响：两宿主全局样式、共享 theme/composer/message 消费者、头像/媒体/滚动/项目面板与包导出。没有字段、实体、Schema、迁移或契约生成；Mobile 不导入 CSS，不改变其宿主能力边界。
3. 副作用：样式可影响层叠、滚动、动效、暗色与可点击区域，因此统一原 import 顺序；既有媒体/提及身份消费者先映射原组件，不能仅删除规则导致裸显示。没有用 CSS 隐藏或放行权限，也未开放 terminal 菜单/路由。
4. 边界：减少动画、高对比深浅主题、长提及换行、触控/鼠标 hover、窄窗口和头像 slider tip 均沿原规则；没有异步副作用或结果枚举新增。原消费者的错误/UNKNOWN 显示不改写。页面全量视觉与设备体验仍需真实页面检查，不能以 CSS 字节相同断言用户完整体验已等效。

## 已运行证据与边界

在正式目录使用只读 `git show <固定commit>:desktop/src/shared/styles/globals/<模块>.css | cmp - client-kit/ts/platform/src/styles/<模块>.css`，11 项全部 exit 0。共享恢复文件及两宿主入口的 `git diff --check` exit 0。

既有 4 CPU / 8 GiB SDK `kailo-agent-receipt-xvkujx`、`/evidence/profile-settings-ortsoo.DRR20F/apps` 已同步上述候选。Web 原命令：

```text
./node_modules/.bin/vitest run src/features/chat/ui/MessageContent.test.tsx
Test Files 1 passed (1)
Tests 8 passed (8)
exit 0
```

该运行首次 import 耗时约 82 秒，无新增测试配置或安装。只读字节检查写完后，在私有 SDK 将 avatar-framing 的原 height 48px 改为 4px，比较确定失败：`differ: byte 384, line 16`、exit 1；apply_patch 还原后同一比较 exit 0。正式 CSS 未作破坏。

Web 消费者检查也在实现后主动破坏：只在私有 SDK 将原 wrapping class 清空，真实 `MessageContent.test.tsx` 得到 `1 failed | 7 passed`、exit 1，明确抓到原提及布局缺失。apply_patch 还原后同命令 `8 passed`、exit 0，正式/SDK MessageContent 的 `cmp` exit 0。无变异残留。

本子任务未进行部署、Windows/Mobile 设备验收或全页面截图，不将类型/组件检查冒充这些结果。候选构建与视觉复核由主线集中执行；已迁文件的字节一致只证明这 11 个原模块恢复，不证明全部应用已 100% 还原。

## 主线实际编译与浏览器候选复核

同一受限 SDK 使用 Web 现有 `postcss`、`@tailwindcss/postcss`，以真实 `src/shared/styles/globals.css` 为输入执行 PostCSS（与原 `postcss.config.js` 相同插件）。首次退出 1：`Cannot apply unknown utility class text-nsec-key`。全量对照发现 Web 的 Tailwind 配置遗漏原 15 个字号/行高/间距/阴影配置项；完整原配置按字节迁入共享包，两宿主均直接导出它。没有删掉原 CSS 或添加临时常量迁就编译。

修复后同一编译命令退出 0：`compiled CSS 320869 characters`。候选产物 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/shared-original-styles-candidate.css`，SHA-256 `4b8b89a3cd6a34dad45593188c331e9713a8420a24aa72c6ebe398cb3e2e17f9`。主线独立重跑固定源码与 11 模块、完整 Tailwind 配置的 cmp，以及两宿主 globals 入口 cmp，全部退出 0；Web `tsc --noEmit` 退出 0。

`playwright-cli -s=kailo-collab-b911-seam` 实际打开个人资料→头像编辑→表情，在相同 1440×1000 窗口记录并打开查看以下两张截图，目录 `/volumes/data/kailo/tmp/buzz-visible-pages-20261007.KFQi8t/`：

- `18-avatar-emoji-before-styles.png`：线上旧 CSS 下 `.buzz-emoji-mart` 为 block，选择器底部分页栏未出现在有界面板内。
- `19-avatar-emoji-candidate-styles.png`：仅在浏览器中禁用原主样式、保留原字体声明并加载实际候选 CSS；该原容器恢复 flex、有界背景和底部分页栏。容器实测均为 576×384，未以改变测试窗口掩盖问题。

这是旧线上 JS 上的候选 CSS 视觉复核，不是部署证明，也不能验收本批新 InlineChip 或显示名 JS。没有调用资料保存；截图后 reload 清除候选样式，线上文件和服务未更改。截图 SHA-256 分别为 `35a329b2b10f7d3d5c366b0c81b9b4a189a26b4fff6b0299271457df1708add9`、`c8026833484c10561e5c5bf68d7269eb79a547389b27fcae62b801c5af0eed70`。其他页面/状态、完整新包、Windows 和 Mobile 不在此次截图验收范围。

同一受限 SDK 以 Desktop 的实际 globals 入口执行相同 PostCSS 编译，退出 0：`compiled Desktop CSS 370129 characters`，产物为同目录 `shared-original-desktop-styles-candidate.css`。两宿主扫描各自消费路径，生成的 utility 集合不同，不能以产物字节不同判断共享原模块不同。受限 SDK 实际导入两个宿主配置，`assert.deepEqual(web, desktop)` 及 nsec-key 原值断言均通过、exit 0。这是两宿主 CSS 实际编译，不是完整应用打包或 Windows 设备验收。
