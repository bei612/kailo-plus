# Wren adjustment preparation 同状态刷新回执

## 来源、影响面与边界

- 固定上游：`/volumes/kailo/.references/WrenAI-ui-0.32.2`，commit `c5f02a0391c87420dba78632dcd86073710deb72`，完整路径 `wren-ui/src/components/pages/home/preparation/index.tsx`，符号 `Preparation` / `preparedTask`。已用 `git show` 回读；上游 memo 只依赖两个 task 的 status 和 adjustment payload。
- 当前基底：`653f07887467982bda6beb37592a02d9139d567f`。本批仅给 `data-query/wren-ui/src/components/pages/home/preparation/index.tsx::Preparation` 原 memo 增加 `adjustmentTask?.error`、`adjustmentTask?.queryId` 两项依赖。分类为已授权治理接入补齐，不是原样保留，也不另造 UI。
- 权威：`06-工程基线规范.md` §4 的 `UNKNOWN` 不得显示成已成功、失败或已取消；DD-76/87 的原组件接入边界。既有 `PreparationStatus` 已按 `NATIVE_EXECUTION_UNKNOWN` 显示待核验，父 memo 缺依赖会阻止这条真实消费链更新。
- 影响面：ThreadResponse 的 adjustmentTask → Preparation 合并后的 preparedTask → PreparationStatus 的状态文案及 `onCancel` → 原 `onStopAdjustTask(queryId)`；同一 memo 亦传给 PreparationSteps/ErrorBoundary。没有契约字段、持久状态、迁移、后端权限、重试、额度或终态规则变化，原样式/布局/文案保持。
- 副作用核对：不新增执行路径，不将 UNKNOWN 降级成取消，不把新查询的取消动作发送给旧 queryId，不复制第二份权威。只是让既有回调看到最新输入。
- 边界：同一 STOPPED 状态 error 从空变 UNKNOWN，再清空时均刷新；同一 GENERATING 状态只变 queryId 时取消只调用当前 adjustment 查询，不能调用 asking 回调。两 task 均 null、普通用户停止、现有 payload/status 变化继续走原分支。本批不改变并发、撤权、超时、幂等或查询引用为空时的后端准入行为。

## 真实 React 更新检查

独立输入与日志：`/volumes/data/kailo/tmp/wren-preparation-memo.4gHY2O`。未改其他队友的 feedback-closure 输入。

Wren 锁文件没有 jsdom/jest-environment-jsdom，因此没有给原 `yarn test` 添一个缺依赖的 DOM 用例，也没有安装工具。原 `src/nativeAskingPresentation.test.tsx` 字节不变，另在上述私有输入的 `src/preparationRerender.test.tsx` 驱动实际父组件：

1. `render(<Preparation ...>)`，adjustmentTask 为 STOPPED/query-a，断言原 Cancelled by user。
2. `rerender` 只加 error=`NATIVE_EXECUTION_UNKNOWN`；断言取消文案消失、Query awaiting verification 和 Verify and continue 按钮出现；再清 error，断言回到原取消状态。
3. 独立 render GENERATING/query-a，rerender 只换 query-b；点击原 antd Cancel 按钮，断言 `onStopAdjustTask` 恰好一次参数 query-b，且 asking 回调零调用。

使用真实 React 18.2.0、ReactDOM 18.2.0、@testing-library/react 14.0.0、Jest 29.4.3、antd 4.20.4、原 Preparation/PreparationStatus/语言/helper/GraphQL 枚举。仅 router locale、next/image、finished 状态依赖以及与该问题无关的 SQL 详情 ErrorBoundary/PreparationSteps 隔离；没有 mock React hook、父 memo、状态控件或 onCancel。三项既有静态状态用例同时执行。

检查沿已有 Node 24.21.0 SDK 镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，复用 Wren 原依赖与 Web jsdom 27.4.0，不新建 SDK 镜像。临时容器 `kailo-wren-preparation-memo`：2 CPU、4 GiB memory/swap、256 pids、1000:1000、network none、只读 rootfs；两份依赖只读、仅独立 Data 输入可写。运行前原 Web SDK 只有 sleep，load 6.19、MemAvailable 39734948 KiB。

容器内实际命令：

```sh
node /wren/node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand src/preparationRerender.test.tsx src/nativeAskingPresentation.test.tsx
```

原 Jest transformer 为 ts-jest；私有 DOM 环境在 Jest VM 外加载现有 jsdom 并提供 window/document。该检查为实际 React 渲染/交互，不是全量 TypeScript 检查；没有调高 timeout。配置、环境与用例源都保留在上述输入目录，可用同一个 `docker start -a kailo-wren-preparation-memo` 复核。

## 正向、反证、还原结果

| 轮次 | 实际结果 | 原日志 |
|---|---|---|
| 首次挂载 | exit 1；Node 在 Jest 加载前找不到 import-local，0 断言。已有依赖挂载名不是 node_modules；只更正挂载路径，移除该已退出的空容器后用同一原镜像重建，未删输入/缓存 | `positive.log` |
| 修正挂载后 | exit 1；原状态 3 通过，新增 2 失败；antd 图标参与 accessible name，测试选择器遗漏 reload/stop，实际 DOM 已显示待核验 | `positive-corrected-mount.log` |
| 精确匹配原按钮名后 | exit 0；2 suites、5 tests 全通过，1.669s | `positive-corrected-selector.log` |
| 私有反证 | 只移除父 memo 本批两行，exit 1；2 新用例失败、3 原用例通过，1.647s。真实残留 `Cancelled by user`；取消收到 query-a 而非 query-b | `negative.log` |
| 字节还原 | 与正式 index.tsx 的 cmp exit 0；原命令 exit 0，2 suites、5 tests 全通过，1.553s；容器实际状态 exited/0 | `restored.log` |

## 交付边界

源码两行与回执已写入；父组件真实更新的正向及破坏反证已完成。未构建镜像、未部署、未做对应版本浏览器截图；不能称作修复后视觉验收。未跑全量检查或完整 Wren 类型检查，本回执不证明完整原版还原、所有异常场景或生产就绪。由主线程复核精确候选后统一提交与推送。
