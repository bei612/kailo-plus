# 原 EmojiBurst 模块：双宿主共享根接线回执

## 固定全量对照与四步结论

- 固定 Buzz `779af8886caae1317b4de962082429867ab61503`：`desktop/src/main.tsx` 的根 `EmojiBurstProvider`、`desktop/src/shared/ui/EmojiBurstProvider.tsx::EmojiBurstProvider/useEmojiBurst`、`desktop/src/features/messages/ui/MessageReactions.tsx::ReactionPill` 均已只读核验。既有完整差异台账 `/volumes/data/kailo/tmp/codex-agent-receipt-regression-20261005.XvkUjX/current-main-diff.nNHzVS/collaboration-dd399f93f584.classification.tsv` 第 3850 行将原 Provider 路径列为缺失需恢复。台账历史基底 `dd399f93f584b30d4a6301a5024c3959d4d420e6` 不代表当前全树结论。
- 定位权威：用户要求完整原交互及 Web/Desktop 共用完整 TS 主体。本批归类为“共享迁移”并补齐缺失接线：共享完整模块早已存在，Web 根未挂载，Desktop 根仍挂载另一份 Context；共享反应组件调用的 `useEmojiBurst` 因此可能落到原 NOOP_CONTEXT。不是新设计，也不增加菜单或产品能力。
- 影响面：包新增唯一实际消费的 `./react/emoji-burst` export；Web `main.tsx` 按原层级挂载；Desktop 原同名文件改为共享模块薄 re-export。既有 Desktop 根消费者不改，共享 `MessageReactions` 与 `AgentCreationPreview` 因而获得同一 Context。Profile 编辑器自身嵌套 Provider 不在本批修改。未修改任何消息加载、发送、反应准入、身份或工作流调用。
- 副作用：只恢复原客户端视觉效果，反应仍调用原 `onSelect`，没有新增网络、持久状态、正文副本或执行权威。Canvas 的 pointer-events、aria-hidden、粒子上限、生命周期、缩放、图片缓存及碰撞算法均来自原完整模块，未重写。
- 边界：空反应、超量粒子、无 Canvas context、减少动态效果偏好、卸载取消动画等均保留原实现。本次真实消费者验证其中正常反应及偏好变化，不声称穷尽全部粒子分支。权限撤销、结果不明与投递失败沿原治理链和 `06-工程基线规范.md` §4，动画不是动作成功回执；无新错误分类、数据迁移、契约或后台状态。

完整模块比对：`client-kit/ts/platform/src/react/profile/buzz/shared/ui/EmojiBurstProvider.tsx` 相对上述固定官方文件，仅有既存来源注释、密集有界粒子数组的 `!`、非空固定庆祝数组索引的 `!` 与其解释注释。这些是共享 TS 严格索引检查适配，不改变运行效果。本批没有修改该实现；Desktop 删除的是旧重复副本，并非删除原粒子功能。

## 实际页面观察

正常独立 OIDC 登录后，打开既有频道，悬停真实消息显示原反应工具条；没有点击反应或发消息。截图已保存并打开：`/volumes/data/kailo/tmp/web-main-032b9c3-release.owfGjV/25-reaction-module-provider-absent.png`。

同一次浏览器读取 `canvasCount=0`、`reducedMotion=false`，`/app/platform-build-info.json` 返回 `buildId=sha256:f530ffa636a6980aaa21aa84ef5d44c83ae47d831504e95f173614f21f0a345e`、`reportedAt=2026-10-11T07:47:07.431Z`，仍为旧发布 `032b9c304c84336a52c699244992c9bc73ff55da`。图像证明原工具条可见；缺根挂载由 DOM 事实与源码共同定位，不用静态图片冒称验证了动画。会话 `kailo-emoji-burst` 已关闭。

## 实现后的消费者正反验证

扩展原 `web-client/web/src/main.test.tsx`，保留原相邻 tooltip dwell 断言。测试导入真实 Web main 根，将已有共享 MessageReactions 放在 App 消费位置；Canvas context 绘制边界使用 spy，原 Provider、hook、粒子循环和反应组件不 mock：

- 点击真实正向反应按钮后必须调用 Canvas drawImage，并且原 onSelect 恰好调用一次。
- 动态导入 Desktop 薄适配，Provider 与 hook 必须分别与共享 export 严格相同，避免第二 Context。
- 等原有限动画结束，触发真实偏好监听后再次点击，减少动态效果必须不绘制，但原 onSelect 仍调用。

原 SDK `kailo-web-thread-tooltip-sdk`，4 CPU/8 GiB、network none、1000:1000，复用 Data 依赖与 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/apps` 私有输入。开始前容器只有 sleep、load 12.89、MemAvailable 36589836 KiB。未创建 SDK、安装依赖、增加超时或运行全局构建。

实际容器命令（工作目录 `/candidate/apps/web-client/web`）：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/main.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism
```

日志目录 `/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9`：

| 轮次 | 实际结果 | 日志 |
|---|---|---|
| 初次 | tsc exit 2：私有 Desktop 快照无 node_modules，新增共享 export 无法解析；0 断言 | `emoji-burst-positive.log` |
| 正向 | 仅在私有 Desktop 输入链接已有 Web 依赖，正式 Desktop 原已有平台包依赖不改；tsc exit 0，1 passed，exit 0，11.98s | `emoji-burst-positive-linked.log` |
| 反证 | 只删私有 Web 根 Provider 开闭标签；真实反应调用落到 NOOP，drawImage 未调用，1 failed，exit 1，1.50s | `emoji-burst-negative.log` |
| 还原 | 私有 main 与正式源码 cmp exit 0；同一检查 1 passed，exit 0，1.46s | `emoji-burst-restored.log` |

反证不改正式文件、原反应调用或测试期望。Web 类型检查包含薄 Desktop import 的解析，不等于 Desktop 完整工程类型或安装包验收。

## 交付边界

此批未部署，因此没有新版粒子实际浏览器效果图；旧线上图片不是修复成功截图。未跑全量检查、Desktop 安装包或 Mobile 设备验收，不宣称 EmojiBurst 全部分支、全量原版一致或生产就绪。源码、窄验、阶段提交和最终发布分别记录。
