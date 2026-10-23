# Kailo 相对原版 Buzz 的差异清单（原版一致性恢复权威待办）

- 生成日期：2026-10-19；只读调查，未改源码、未构建、未运行 node/docker/浏览器。
- Kailo 源码：`/home/kailo-dev/work/main` main `e03a01565f448887fc3bec18ed03d83ed3bbbe0d`（工作树干净）。
- 固定上游：collaboration ← Buzz `779af8886caae1317b4de962082429867ab61503`（`.references/buzz`）；web-client ← buzz-web `a6766c482533d028582d0efcfd3740769f86217c`（`.references/buzz-web`）。
- 设计权威：`/home/kailo-dev/work/design-auth/.design`（含 DD-118–DD-127）。
- 2026-10-20 修订：按 DD-131（设计 `4fbb4107773b9c9a2c6f96e47e70f6d8d0ab1635`）改写 Top 30 第 4 项及第 6 节相关 67 行的分类与说明：卡片铸造（10 个文件）、锁定卡（1 个）及本机团队/目录实现（5 个）改为 (a)，`agent_snapshot.rs`、`team_snapshot.rs` 改为 (c)，其余第 4 项 (c) 行改注“DD-131 已定设计，待实现”。§1 的统计表未随之重算。
- 依据：GOAL.md 第 53–56 行。本清单只覆盖“固定源码 diff”这一项证据；页面截图与实际操作结果未在本次产生，任何 (b) 都不等于已验收。

## 0. 方法与可复核命令

```
cd /home/kailo-dev/work/main
runuser -u kailo-dev -- python3 tools/upstream_manifest.py diff web-client --name-status     # 262 行
runuser -u kailo-dev -- python3 tools/upstream_manifest.py diff collaboration --name-status   # 3423 行
runuser -u kailo-dev -- python3 tools/upstream_manifest.py diff web-client --check           # 一致（67 项）
runuser -u kailo-dev -- python3 tools/upstream_manifest.py diff collaboration --check         # 失败，见 §2
# 行数：同一 _Index 上执行 git diff --cached -M --numstat；改写内容：--diff-filter=MR -U0
```

分类规则（按顺序判定，逐文件；目录型 remove_paths 条目展开到文件）：

1. **(d)**：测试、e2e、fixtures、CI、打包/发布脚本、锁文件、构建配置、文档（.md）。
2. **(a)**：差异本身由 `.design/02` 的 DD 决定（如 Browser 不直连 Relay、Core 代签、本机 Agent 运行时由托管 Codex 取代、Buzz workflow 引擎关闭、DD-125 明确排除的 Welcome/Compute/Hosted communities/Mobile 配对/防休眠/Agent 默认配置等）。只认 `.design` 原文，实施记录中的“已授权”不算。
3. **(b)**：Kailo 中存在替代实现：源码注释引用了原路径，或原文件 ≥30% 的有效行出现在 Kailo 自有源码（client-kit、web-client/platform、collaboration 改动文件、core），或原位文件改为消费 `@client-kit` 共享主体。没有直接证据、按模块整体迁移归类的条目在说明中标“待核”（共 145 个删除文件）。**(b) 只表示源码层有替代，不表示功能完整或已验收。**
4. **(c)**：没有 DD 授权、Kailo 中找不到替代实现、用户可见；包括“共享实现只被 Web 宿主消费、Desktop 原文件已删”的 Desktop 宿主缺口（按导入可达性判定）。
5. **待定**：设计没有覆盖、或原地删减较多需逐 hunk 复核，逐条写明原因。

判定局限：按文件归类，迁移后文件内部缺少的菜单项/状态（局部缺口）不在本表；导入可达性只能证明“Desktop 能引用到”，不能证明 Desktop 确实渲染，因此 Desktop 宿主缺口是下界；新增（A）文件只计数，不分类。

## 1. 统计

### 1.1 总量

| 项目 | 删除文件 D | 改写文件 M/R | 新增文件 A | 删除行 | 新增行 | (a) | (b) | (c) | (d) | 待定 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| web-client | 110 | 26 | 126 | 22610 | 26614 | 35 | 65 | 0 | 35 | 1 |
| collaboration | 2432 | 855 | 136 | 755879 | 49843 | 720 | 1019 | 466 | 1043 | 39 |
| **合计** | **2542** | **881** | **262** | **778489** | **76457** | **755** | **1084** | **466** | **1078** | **40** |

分类列只统计 D 与 M/R（A 不分类）。删除/新增行为 `--numstat` 口径（含被删整文件）。

### 1.2 remove_paths 条目层面

| 项目 | 条目数 | 全部 (a) | 全部 (b) | 全部 (c) | 全部 (d) | 全部待定 | 混合 | 以改名(R)实现 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| web-client | 67 | 15 | 31 | 0 | 12 | 1 | 8 | 0 |
| collaboration | 1046 | 189 | 288 | 150 | 371 | 13 | 35 | 9 |

### 1.3 按目录/功能

| 目录/功能 | D | M/R | A | 删除行 | 新增行 | (a) | (b) | (c) | (d) | 待定 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CI/发布脚本 | 27 | 6 | 0 | 4353 | 12 | 0 | 0 | 0 | 33 | 0 |
| Desktop app（外壳/路由） | 32 | 30 | 3 | 5398 | 762 | 14 | 31 | 10 | 6 | 1 |
| Desktop features/agent-memory | 4 | 0 | 0 | 995 | 0 | 0 | 2 | 1 | 1 | 0 |
| Desktop features/agents | 357 | 0 | 0 | 83324 | 0 | 80 | 113 | 41 | 123 | 0 |
| Desktop features/channel-templates | 3 | 0 | 0 | 343 | 0 | 0 | 2 | 0 | 1 | 0 |
| Desktop features/channels | 92 | 60 | 3 | 20957 | 1858 | 38 | 72 | 10 | 31 | 1 |
| Desktop features/chat | 1 | 0 | 0 | 195 | 0 | 0 | 1 | 0 | 0 | 0 |
| Desktop features/communities | 39 | 0 | 0 | 7974 | 0 | 18 | 3 | 6 | 12 | 0 |
| Desktop features/community-members | 11 | 0 | 0 | 5047 | 0 | 0 | 7 | 2 | 2 | 0 |
| Desktop features/custom-emoji | 7 | 0 | 0 | 791 | 0 | 0 | 5 | 0 | 2 | 0 |
| Desktop features/forum | 17 | 0 | 1 | 3081 | 164 | 0 | 15 | 0 | 2 | 0 |
| Desktop features/gifs | 4 | 0 | 0 | 667 | 0 | 0 | 2 | 1 | 1 | 0 |
| Desktop features/home | 20 | 19 | 6 | 7085 | 1584 | 3 | 29 | 0 | 7 | 0 |
| Desktop features/huddle | 38 | 0 | 0 | 10492 | 0 | 0 | 0 | 30 | 8 | 0 |
| Desktop features/identity-archive | 1 | 0 | 0 | 186 | 0 | 0 | 0 | 1 | 0 | 0 |
| Desktop features/local-archive | 12 | 0 | 0 | 2584 | 0 | 0 | 0 | 8 | 4 | 0 |
| Desktop features/mesh-compute | 10 | 0 | 0 | 1316 | 0 | 7 | 0 | 0 | 3 | 0 |
| Desktop features/messages | 112 | 175 | 9 | 47574 | 2566 | 22 | 184 | 5 | 72 | 4 |
| Desktop features/moderation | 13 | 0 | 0 | 1121 | 0 | 0 | 8 | 2 | 3 | 0 |
| Desktop features/notifications | 1 | 13 | 0 | 1018 | 105 | 6 | 3 | 0 | 5 | 0 |
| Desktop features/onboarding | 70 | 1 | 0 | 17641 | 7 | 40 | 1 | 12 | 15 | 3 |
| Desktop features/platform | 0 | 0 | 16 | 0 | 1864 | 0 | 0 | 0 | 0 | 0 |
| Desktop features/presence | 7 | 0 | 0 | 1233 | 0 | 0 | 4 | 0 | 3 | 0 |
| Desktop features/profile | 68 | 10 | 1 | 18175 | 438 | 7 | 39 | 12 | 17 | 3 |
| Desktop features/projects | 279 | 0 | 0 | 48582 | 0 | 0 | 152 | 66 | 61 | 0 |
| Desktop features/pulse | 15 | 0 | 0 | 1939 | 0 | 0 | 11 | 0 | 4 | 0 |
| Desktop features/reminders | 17 | 0 | 0 | 2211 | 0 | 0 | 12 | 0 | 5 | 0 |
| Desktop features/search | 0 | 10 | 1 | 2614 | 315 | 0 | 10 | 0 | 0 | 0 |
| Desktop features/settings | 41 | 15 | 4 | 13227 | 327 | 15 | 17 | 13 | 11 | 0 |
| Desktop features/sidebar | 36 | 27 | 3 | 11993 | 531 | 13 | 26 | 3 | 21 | 0 |
| Desktop features/terminal | 22 | 0 | 0 | 7370 | 0 | 0 | 0 | 11 | 11 | 0 |
| Desktop features/user-status | 9 | 0 | 0 | 1597 | 0 | 0 | 6 | 0 | 3 | 0 |
| Desktop features/workflows | 67 | 0 | 0 | 13588 | 0 | 1 | 47 | 0 | 19 | 0 |
| Desktop protectedFeatures | 22 | 0 | 0 | 2103 | 0 | 0 | 0 | 0 | 22 | 0 |
| Desktop shared/(root) | 0 | 4 | 0 | 307 | 105 | 2 | 1 | 0 | 1 | 0 |
| Desktop shared/api | 49 | 22 | 4 | 8816 | 869 | 39 | 12 | 5 | 15 | 0 |
| Desktop shared/constants | 0 | 2 | 0 | 217 | 2 | 0 | 1 | 0 | 1 | 0 |
| Desktop shared/context | 2 | 1 | 0 | 106 | 4 | 1 | 2 | 0 | 0 | 0 |
| Desktop shared/features | 10 | 0 | 0 | 474 | 0 | 0 | 7 | 0 | 3 | 0 |
| Desktop shared/hooks | 7 | 6 | 0 | 851 | 13 | 1 | 11 | 0 | 1 | 0 |
| Desktop shared/layout | 0 | 8 | 0 | 900 | 8 | 0 | 8 | 0 | 0 | 0 |
| Desktop shared/lib | 21 | 40 | 0 | 6682 | 105 | 7 | 38 | 0 | 16 | 0 |
| Desktop shared/styles | 18 | 1 | 0 | 4825 | 3 | 0 | 17 | 1 | 1 | 0 |
| Desktop shared/theme | 6 | 6 | 0 | 3491 | 32 | 2 | 6 | 1 | 3 | 0 |
| Desktop shared/ui | 39 | 73 | 0 | 17554 | 623 | 6 | 90 | 7 | 8 | 1 |
| Desktop src 其他 | 6 | 2 | 0 | 11730 | 1581 | 1 | 1 | 0 | 6 | 0 |
| Desktop src-tauri archive | 19 | 0 | 0 | 12303 | 0 | 0 | 0 | 9 | 10 | 0 |
| Desktop src-tauri commands/agents/runtime | 41 | 0 | 0 | 17795 | 0 | 30 | 0 | 0 | 11 | 0 |
| Desktop src-tauri commands/media | 0 | 6 | 0 | 776 | 66 | 1 | 4 | 1 | 0 | 0 |
| Desktop src-tauri commands/mesh | 3 | 0 | 0 | 1641 | 0 | 2 | 0 | 0 | 1 | 0 |
| Desktop src-tauri commands/pairing | 3 | 0 | 0 | 1026 | 0 | 1 | 0 | 0 | 2 | 0 |
| Desktop src-tauri commands/personas/teams | 37 | 0 | 0 | 16559 | 0 | 7 | 0 | 15 | 15 | 0 |
| Desktop src-tauri commands/project git/terminal | 10 | 3 | 0 | 4066 | 308 | 0 | 10 | 2 | 1 | 0 |
| Desktop src-tauri commands/其他 | 22 | 15 | 4 | 8188 | 2001 | 23 | 1 | 4 | 7 | 2 |
| Desktop src-tauri huddle | 45 | 0 | 0 | 15796 | 0 | 0 | 0 | 37 | 8 | 0 |
| Desktop src-tauri managed_agents | 124 | 0 | 0 | 53891 | 0 | 102 | 0 | 0 | 22 | 0 |
| Desktop src-tauri mesh_llm | 10 | 0 | 0 | 4584 | 0 | 9 | 0 | 0 | 1 | 0 |
| Desktop src-tauri migration | 10 | 0 | 0 | 3554 | 0 | 7 | 0 | 0 | 3 | 0 |
| Desktop src-tauri terminal_runtime | 1 | 0 | 0 | 179 | 0 | 0 | 0 | 1 | 0 | 0 |
| Desktop src-tauri 其他 | 35 | 34 | 8 | 19128 | 2516 | 35 | 1 | 5 | 24 | 4 |
| Desktop src-tauri 资源/crates/配置 | 66 | 9 | 0 | 15559 | 1479 | 1 | 0 | 24 | 50 | 0 |
| Desktop 根配置/资源 | 18 | 8 | 0 | 513 | 31 | 14 | 2 | 0 | 10 | 0 |
| Desktop 测试/脚本 | 124 | 40 | 7 | 75697 | 2099 | 0 | 0 | 0 | 164 | 0 |
| Mobile features/activity | 12 | 1 | 0 | 3028 | 1 | 0 | 1 | 12 | 0 | 0 |
| Mobile features/age_gate | 3 | 0 | 0 | 342 | 0 | 0 | 0 | 0 | 0 | 3 |
| Mobile features/channels | 46 | 54 | 7 | 18112 | 3935 | 61 | 2 | 33 | 0 | 4 |
| Mobile features/forum | 5 | 0 | 0 | 1699 | 0 | 0 | 0 | 5 | 0 | 0 |
| Mobile features/home | 0 | 1 | 0 | 66 | 2 | 1 | 0 | 0 | 0 | 0 |
| Mobile features/invites | 6 | 0 | 0 | 1828 | 0 | 0 | 0 | 0 | 0 | 6 |
| Mobile features/pairing | 10 | 0 | 0 | 2819 | 0 | 10 | 0 | 0 | 0 | 0 |
| Mobile features/platform | 0 | 0 | 18 | 0 | 3393 | 0 | 0 | 0 | 0 | 0 |
| Mobile features/profile | 28 | 3 | 0 | 8162 | 86 | 0 | 0 | 30 | 0 | 1 |
| Mobile features/pulse | 7 | 0 | 0 | 1584 | 0 | 0 | 0 | 7 | 0 | 0 |
| Mobile features/search | 0 | 3 | 0 | 142 | 28 | 2 | 0 | 1 | 0 | 0 |
| Mobile features/settings | 4 | 5 | 0 | 717 | 438 | 4 | 0 | 5 | 0 | 0 |
| Mobile lib 根 | 0 | 2 | 0 | 366 | 54 | 1 | 0 | 0 | 0 | 1 |
| Mobile shared/animated_avatar.dart | 0 | 1 | 0 | 5 | 0 | 1 | 0 | 0 | 0 | 0 |
| Mobile shared/auth | 0 | 1 | 0 | 26 | 17 | 1 | 0 | 0 | 0 | 0 |
| Mobile shared/community | 1 | 3 | 0 | 862 | 23 | 4 | 0 | 0 | 0 | 0 |
| Mobile shared/crypto | 3 | 0 | 0 | 278 | 0 | 3 | 0 | 0 | 0 | 0 |
| Mobile shared/custom_emoji | 3 | 0 | 0 | 322 | 0 | 0 | 0 | 3 | 0 | 0 |
| Mobile shared/deeplink | 0 | 2 | 0 | 229 | 31 | 2 | 0 | 0 | 0 | 0 |
| Mobile shared/emoji | 2 | 2 | 0 | 579 | 3 | 2 | 0 | 2 | 0 | 0 |
| Mobile shared/huddle | 6 | 0 | 0 | 2789 | 0 | 6 | 0 | 0 | 0 | 0 |
| Mobile shared/platform | 0 | 0 | 9 | 0 | 2490 | 0 | 0 | 0 | 0 | 0 |
| Mobile shared/profile | 0 | 1 | 0 | 13 | 0 | 1 | 0 | 0 | 0 | 0 |
| Mobile shared/push | 10 | 0 | 0 | 3164 | 0 | 0 | 0 | 10 | 0 | 0 |
| Mobile shared/read_state | 0 | 5 | 0 | 814 | 285 | 5 | 0 | 0 | 0 | 0 |
| Mobile shared/relay | 2 | 10 | 1 | 663 | 148 | 11 | 0 | 0 | 0 | 1 |
| Mobile shared/reminders | 3 | 0 | 0 | 339 | 0 | 0 | 0 | 3 | 0 | 0 |
| Mobile shared/security | 1 | 0 | 0 | 158 | 0 | 0 | 0 | 0 | 0 | 1 |
| Mobile shared/theme | 1 | 9 | 0 | 835 | 25 | 9 | 0 | 0 | 0 | 1 |
| Mobile shared/widgets | 9 | 5 | 0 | 1074 | 9 | 5 | 0 | 9 | 0 | 0 |
| Mobile 平台工程（android/ios/配置） | 7 | 8 | 0 | 2220 | 61 | 2 | 0 | 0 | 11 | 2 |
| Mobile 测试 | 82 | 48 | 17 | 47278 | 10350 | 0 | 0 | 0 | 130 | 0 |
| Relay crates/buzz-acp | 0 | 1 | 0 | 36 | 13 | 1 | 0 | 0 | 0 | 0 |
| Relay crates/buzz-cli | 0 | 1 | 0 | 155 | 9 | 1 | 0 | 0 | 0 | 0 |
| Relay crates/buzz-core | 0 | 5 | 2 | 2 | 883 | 4 | 0 | 0 | 1 | 0 |
| Relay crates/buzz-db | 0 | 5 | 0 | 6 | 758 | 5 | 0 | 0 | 0 | 0 |
| Relay crates/buzz-deletion | 0 | 2 | 0 | 8 | 374 | 1 | 0 | 0 | 1 | 0 |
| Relay crates/buzz-media | 0 | 1 | 0 | 0 | 22 | 1 | 0 | 0 | 0 | 0 |
| Relay crates/buzz-project-git | 0 | 0 | 6 | 0 | 1639 | 0 | 0 | 0 | 0 | 0 |
| Relay crates/buzz-relay | 0 | 19 | 3 | 173 | 1791 | 18 | 1 | 0 | 0 | 0 |
| Relay crates/buzz-sdk | 0 | 2 | 2 | 0 | 305 | 1 | 0 | 0 | 1 | 0 |
| Relay crates/buzz-workflow | 0 | 1 | 0 | 313 | 10 | 1 | 0 | 0 | 0 | 0 |
| web-client: web 根配置 | 0 | 10 | 2 | 1003 | 3775 | 1 | 2 | 0 | 7 | 0 |
| web-client: web/public | 1 | 1 | 26 | 12 | 130 | 2 | 0 | 0 | 0 | 0 |
| web-client: web/src/app | 4 | 3 | 11 | 128 | 1102 | 3 | 3 | 0 | 1 | 0 |
| web-client: web/src/features/agents | 6 | 0 | 0 | 1005 | 0 | 3 | 1 | 0 | 2 | 0 |
| web-client: web/src/features/chat | 38 | 2 | 4 | 8906 | 1701 | 7 | 25 | 0 | 8 | 0 |
| web-client: web/src/features/community | 3 | 0 | 0 | 366 | 0 | 1 | 1 | 0 | 1 | 0 |
| web-client: web/src/features/inbox | 6 | 0 | 0 | 1411 | 0 | 0 | 4 | 0 | 2 | 0 |
| web-client: web/src/features/invite | 4 | 0 | 0 | 601 | 0 | 3 | 1 | 0 | 0 | 0 |
| web-client: web/src/features/repos | 19 | 0 | 0 | 2909 | 0 | 0 | 18 | 0 | 1 | 0 |
| web-client: web/src/main.test.tsx | 0 | 0 | 1 | 0 | 109 | 0 | 0 | 0 | 0 | 0 |
| web-client: web/src/main.tsx | 0 | 1 | 0 | 8 | 21 | 0 | 1 | 0 | 0 | 0 |
| web-client: web/src/platform（Kailo 新增宿主） | 0 | 0 | 79 | 0 | 19527 | 0 | 0 | 0 | 0 | 0 |
| web-client: web/src/shared | 24 | 8 | 3 | 4167 | 246 | 14 | 9 | 0 | 8 | 1 |
| web-client: web/src/vite-env.d.ts | 0 | 1 | 0 | 0 | 3 | 1 | 0 | 0 | 0 | 0 |
| web-client: 测试/构建 | 5 | 0 | 0 | 2094 | 0 | 0 | 0 | 0 | 5 | 0 |
| 仓库根/其他 | 1 | 8 | 1 | 691 | 282 | 1 | 1 | 0 | 7 | 0 |

## 2. 结构性发现（不属单项分类，但影响原版一致性结论）

1. `collaboration` 的 `remove_paths` 与实际不一致：`upstream_manifest.py diff collaboration --check` 退出 1，报“整块删除但未登记：`desktop/src/shared/ui/buzz-logo/buzz-logo-animation.css`”（原样迁入 `client-kit/ts/platform/src/react/projects/buzz-logo/buzz-logo-animation.css`，本表归 (b)）。需补登记。
2. `remove_paths` 中 9 个条目（`crates/buzz-relay/src/api/git/manifest.rs`、`project_git_{branches,diff,file_content}.rs`、`media_{animated,gif,snapshot_png}.rs`、一个测试与 `mobile/.../badges.dart`）在 diff 中表现为改名 R；其中 `badges.dart → error_view.dart` 实为删除 Mobile 临时频道徽标，本表归 (c)。
3. Web 与 Desktop 的 Composer/频道页仍是两套实现：`web-client/web/src/platform/ui/ChannelPane.tsx`（1802 行，含 `export function Composer`）由共享零件拼装，Desktop 用 `collaboration/desktop/src/features/messages/ui/MessageComposer.tsx`。REQ-24/DD-74 要求共用同一 TypeScript 主体，这是一项共源未达成的结构差异，不在本表逐文件分类中体现。
4. 共享 client-kit 中有 38 个文件只被 Web 宿主导入（Desktop 不可达）：agent-activity（BotActivityBar、ChannelWorkingBadge、ChannelComposerActivityAccessory、useChannelAgentActivity）、channel-templates 设置卡、gifs、huddle 界面、moderation（队列卡、禁言横幅）、presence host、sidebar（custom-channel-section、channel-section-dialogs、sidebar-dnd、channel-activity-popover、loading skeleton）、top-chrome-history（Back/Forward）、root-error-boundary、ephemeral-channel、channel-description、user-status index、protocol-document-*（Desktop 按 DD-104 BLOCKED，属 (a)）等。对应原 Desktop 文件已删，Desktop 用户缺这些功能（Top 30 第 3 项）。
5. 145 个删除文件按模块整体归 (b) 但没有直接证据（说明含“待核”），集中在 agents（44）、projects（29）、messages（19）、channels（18）、shared（16）、forum（8）。这些是下一轮逐项核对的首批对象，可能有部分应改为 (c)。

## 3. (a) 类引用的设计决策索引

| DD | 本表中的用法 |
|---|---|
| DD-02 | AgentGateway OIDC 边缘；Core 代签，浏览器无私钥、不直连 Relay |
| DD-01 + .design/03 TenantMembership | Tenant↔Community 一一对应；一个 HumanIdentity 多 Tenant 时一期不提供选择入口（社区切换/添加/离开不提供） |
| DD-15/20/26/110 | 平台 Agent 只由托管 Codex（SERVER_CODEX）经 AgentGateway 运行；不暴露本机 harness/provider/模型/环境变量 |
| DD-24/25 | Agent 管理在 Core；Persona ≙ Tenant 级 AgentDefinition，Workspace 经 AgentInstallation 安装 |
| DD-39 | Buzz Web 的 Relay 边界整体替换为 BFF transport（不收 Relay URL、不签 NIP-42/98/44） |
| DD-40 | 收藏/静音/已读/Projects Added 等用户状态由 Core CollaborationUserState 持有，30078 不进服务端链 |
| DD-41/80/119 | 频道建立、元数据、成员只由 Core 经 CONTROL 变更；原版管理入口逐项接 Core（删除不提供） |
| DD-53 | 外观偏好仅属于当前设备，不新增服务端偏好权威（按社区跨设备外观同步因此移除） |
| DD-65/66/68 | Agent 记忆（NIP-AE）由 Core 以 Installation/CONTROL pair 读写 |
| DD-72/75/77/78/79 | Web SERVER 托管；Desktop/Mobile 本机持钥直连 Relay，登录经原生 listener OIDC，设备公钥登记；不向手机交付私钥 |
| DD-83 | Tenant 邀请改为一次性邀请凭据，admin 确认兑换 |
| DD-96 | Community 只由 Tenant 生命周期经 operator 建立 |
| DD-104 | Desktop 在线编辑 BLOCKED（GAP-DSK-EDITOR-01） |
| DD-106/107 | Buzz 自带 workflow 引擎关闭；Workflows 页面由 AutomationDefinition + Temporal 承接 |
| DD-111 | 产品显示名/安装包名来自部署与发布配置 |
| DD-117 | Agent kind:0 由 Core 依 Installation 投影 |
| DD-118 | Projects Git：Web 经 BFF、Native 经本机命令；原 project_git* 抽为共用 crate |
| DD-120/121 | 在线/输入中/状态的 Web 接法；@提及准入结论只读回显 |
| DD-125(2)–(6) | 审核、Huddle（Mobile 不在范围）、Canvas/频道模板、其余面（排除 Welcome 起步、Compute、Hosted communities、Mobile 配对、防休眠、Agent 默认配置）、Agent 可观测与生命周期映射（不发 24200/44200、无物理删除、respondTo anyone 不提供） |
| GOAL 中文默认/英文适配 | 用户授权的 i18n 差异（与 DD-53 一致） |

## 4. (c) 类 Top 30（按用户可见程度排序）

排序口径：先 Web+Desktop 主界面上用户每天会碰到的页面/入口，再 Desktop 独有，再 Mobile；同层按影响面与删除量。工作量为单人估算，含迁移、接治理链与定向验证，不含全量门禁与截图验收。

| # | 功能 | 端 | 原版位置（`779af8886caa…`） | 说明 | 建议恢复方式 | 工作量 | 依据 | 本表文件数/删除行 |
|---:|---|---|---|---|---|---|---|---|
| 1 | Projects 完整仓库型项目详情页（Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复） | Web+Desktop | desktop/src/features/projects/ui/ProjectDetailScreen.tsx::ProjectDetailScreen、ProjectDetailFeedPanels.tsx、ProjectOverviewPanel.tsx、ProjectRightPanelControls.tsx、lib/projectReviewDisplay.ts、useProjectCommitDiff.ts、projectPullRequestConflictRecovery.ts | 进入任一仓库型 Project 后的主详情页：仓库概览、动态流、文件树/文件内容、提交与 diff、PR 列表与审核状态、右侧人员/元数据面板。当前共享侧只有 ProjectDetailChrome、ProjectChannelHome、Tasks/Reviews 只读 sheet 与只读详情。 | 以 DD-118 已落地的 BFF Projects Git 查询（SNAPSHOT/FILE_CONTENT/DIFF）为数据源，把原 ProjectDetailScreen 及其面板按原文件迁入 client-kit/projects，Web 走 BFF、Desktop 走 buzz-project-git 本机命令；PR 写操作（行内评论/合并/分支）沿 DD-118(5)(6)。 | L（8–12 人日） | REQ-24、DD-118 | 26/3790 |
| 2 | Desktop Huddle 整体缺失（界面、原生音频链、本机转写/朗读、全局按键通话、独立 Huddle 窗口、Agent 语音菜单） | Desktop | desktop/src-tauri/src/huddle/*（pipeline/stt/tts/playout/relay_api/wire 等 38 文件）、src-tauri/src/ptt_shortcut.rs、resources/pocket-voices/*.wav、desktop/src/features/huddle/**、desktop/src/app/AppHuddleBar.tsx、AppHuddleShell.tsx、useHuddlePresentation.ts | 频道/私聊发起语音 Huddle、参与者列表、麦克风控制、加入 Agent、转写与朗读、按键通话、独立窗口。Web 已由共享 client-kit/huddle + BFF 音频桥恢复（源码候选），Desktop 无任何 huddle 宿主。 | Desktop 宿主挂载共享 client-kit/huddle 界面；动作（huddle.start/agent.add/remove/end）经 BFF，48106/48100 与音频按 DD-125(3) 本人 CLIENT 身份直连 Relay；按原文件恢复 src-tauri/huddle 原生管线与 pocket-voices 资源。 | XL（15–25 人日） | DD-125(3)、REQ-24 | 87/21729 |
| 3 | Desktop 未接入 Web 已恢复的共享模块（Agent 工作中栏/徽标、频道模板设置卡、GIF、审核队列卡与禁言横幅、自定义侧栏分区与拖拽、在线状态宿主、Back/Forward、根错误边界） | Desktop | desktop/src/features/channels/ui/BotActivityBar.tsx、ChannelComposerActivityAccessory.tsx、sidebar/ui/SidebarSection.tsx、CustomChannelSection.tsx、ChannelSectionDialogs.tsx、SidebarDnd.tsx、settings/ui/ChannelTemplatesSettingsCard.tsx、ModerationQueueCard.tsx、moderation/ui/ComposerTimeoutBanner.tsx、gifs/** | 这些原 Desktop 文件已删除并迁入 client-kit，但按导入可达性只有 Web 宿主消费（web-only 38 个共享文件，见第 3 节）；Desktop 用户看不到这些功能。 | 在 collaboration/desktop 宿主中挂载对应共享组件（与 Web 同一主体），只在宿主适配层接 Native 会话/本机签名；逐项截图验收。 | M（4–6 人日） | REQ-24、DD-74、DD-125 | 12/3850 |
| 4 | Agents：Teams 分区、团队/Agent 快照导出导入、Agent 卡片铸造/查看、社区 Agent 目录、persona 分享 | Web+Desktop | desktop/src/features/agents/ui/TeamsSection.tsx、TeamDialog.tsx、TeamSnapshot*Dialog.tsx、AgentSnapshot*Dialog.tsx、AgentCardMintDialog.tsx、AgentCardViewerDialog.tsx、CommunityCatalogDialog.tsx、PersonaShareDialog.tsx；src-tauri/src/commands/teams/**、team_snapshot.rs、personas/snapshot/**、personas/sharing.rs、team_catalog.rs | Agents 页的 Teams 分组与团队管理、把 Agent/团队导出为快照并在他处导入、卡片铸造、社区共享目录、向他人分享 persona。 | 按 DD-131（设计 4fbb4107）：Team=Tenant 级 `agent_team`（不含团队 instructions）、Agent/团队快照经 DD-42 导出导入（只建 DRAFT，排除记忆与 SecretRef）、目录读 Core 已分享对象、分享=导出包附件；卡片铸造与锁定卡排除。按原文件迁入共享 Agents 页。 | XL（12–18 人日，含设计） | DD-131（2026-10-20 设计已定；卡片铸造、锁定卡、记忆导出为 DD-131(4)(5) 排除） | 63/18964 |
| 5 | 首次引导（Onboarding）资料与头像两步 | Web+Desktop | desktop/src/features/onboarding/ui/OnboardingFlow.tsx、ProfileStep.tsx、AvatarStep.tsx、OnboardingCard/Chrome/Footer/Input/SlideTransition.tsx、hooks.ts | 本人公钥没有 kind:0 时进入的首次资料（显示名/简介）与头像设置两步引导。DD-125(5) 明确保留（Welcome 自动起步排除）。 | 把 OnboardingFlow 外壳与 Profile/Avatar 两步迁入 client-kit，头像复用已共享的 ProfileAvatarEditor（已有 onboarding-modal/inline presentation），资料写入走既有本人资料发布链；身份/密钥/连接步骤保持按 DD-75/78/79 移除。 | M（3–5 人日） | DD-125(5) | 13/2965 |
| 6 | Agent 资料面板的页签/分区/聚焦视图与资料活动流 | Web+Desktop | desktop/src/features/profile/ui/UserProfilePanelTabs.tsx::ProfileTabBar/ProfileRuntimeTabContent、UserProfilePanelSections.tsx、UserProfilePanelFocusedViews.tsx::MemoryFocusedView/AgentInfoFocusedView、UserProfilePanelFields.tsx、UserProfilePanelHeaderContent.tsx、lib/profileActivity*.ts | 点击 Agent 头像打开的资料面板中的 Overview/Runtime/Memory 等页签、Agent 信息分区、聚焦视图与活动流。当前只共享了 UserProfilePanelFrame 框架。 | 页签数据改读 Installation 详情、Codex ThreadStore 会话（DD-125(6)）与 NIP-AE 记忆（DD-68），按原组件迁入 client-kit/profile；运行时页签中的本机 provider 字段按 DD-26 不渲染。 | M–L（5–8 人日） | DD-125(6)、DD-117、REQ-24 | 12/3884 |
| 7 | Projects 内的项目 Agent 对话（Chat with an agent、选中上下文→Agent、Agent 提示页） | Web+Desktop | desktop/src/features/projects/ui/ProjectAgentChatPanel.tsx、ProjectsAgentPromptPage.tsx、ProjectConversationPanel.tsx、lib/projectAgentConversation.ts、lib/projectDetailAgentContext.ts、ui/ProjectsSelectionCountMenu.tsx | 在 Projects 总览/详情中勾选 Issue/PR/文件等作为上下文，与 Agent 对话或发起提示。共享 ProjectsOverviewChromeActions 已注明“无受治理共享消费者”。 | 对话以普通频道/私聊消息 + @提及进入 agent.invoke（DD-121），上下文以消息引用携带；按原文件迁入共享 Projects。 | L（6–9 人日） | REQ-24、DD-121 | 17/3199 |
| 8 | Mobile Activity 页（Inbox、提醒、未读角标、底部 Tab） | Mobile | mobile/lib/features/activity/**（activity_page.dart、activity_provider.dart、inbox_item.dart、reminders_provider.dart）、mobile/lib/shared/reminders/**、mobile/lib/features/home/home_page.dart 中 Activity Tab | Mobile 第二个底部 Tab：提及/回复/提醒汇总、稍后提醒、未读红点。Kailo Mobile 底栏只剩 Home/Search。 | 复用 Desktop/Web 已恢复的 Inbox 数据权威（BFF/本人直连 Relay，CollaborationUserState 已读），按原 Dart 文件恢复；提醒沿 collab.reminders（kind 30300）。 | L（6–8 人日） | REQ-24、REQ-21 | 15/3360 |
| 9 | Mobile 推送通知 | Mobile | mobile/lib/shared/push/**（push_subscription.dart、push_bootstrap.dart、push_bridge.dart 等）、channel_push_cache.dart | 消息/提及的系统推送。上游 Dockerfile.push-gateway 仍在树内，设计无排除。 | 先确认推送网关部署与租户隔离（推送载荷不含正文或经授权），再按原文件恢复订阅/租约；需要一条设计决策说明推送订阅归属（本人 CLIENT 身份）。 | L（6–10 人日，含部署） | 无（设计未覆盖） | 11/3270 |
| 10 | Mobile 消息动作与回应（编辑、删除、稍后提醒、快捷回应、自定义表情回应/渲染） | Mobile | mobile/lib/features/channels/message_actions.dart、message_actions/message_action_popover.dart、quick_reaction_row.dart、reaction_row.dart、timeline_message.dart、mobile/lib/shared/custom_emoji/**、shared/emoji/** | 长按消息后的编辑/删除/提醒与快捷表情、自定义表情显示、表情爆发动效。 | 按原 Dart 恢复；编辑/删除沿本人 CLIENT 签名直连 Relay（DD-75），提醒沿 kind 30300。 | M（4–6 人日） | REQ-24 | 12/2475 |
| 11 | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态 | Mobile | mobile/lib/features/profile/**（profile_edit_page.dart、profile_avatar_editor.dart、animated_avatar_capture.dart、set_status_sheet.dart、user_status_provider.dart、presence_cache_provider.dart）、settings_profile_header.dart、user_profile_sheet.dart | 编辑本人资料与头像、设置在线/离开/自定义状态，查看他人在线与状态、打开私聊、复制公钥。 | 资料 kind:0 与 30315/20001 由本人 CLIENT 身份直连 Relay（DD-75、DD-120），按原 Dart 恢复。 | L（6–8 人日） | REQ-24、DD-120 | 39/9062 |
| 12 | Projects 仓库管理（新建/挂接仓库、绑定频道、修复首页仓库、本机仓库路径） | Web+Desktop（本机路径仅 Desktop） | desktop/src/features/projects/projectRepositoryCreation.ts、useAddProjectRepository.ts、useAttachProjectRepository.ts、useBindProjectRepositoryChannel.ts、useHealProjectHomeRepositories.ts、ui/ProjectRepositoryManagement.tsx；src-tauri/src/commands/project_repo_paths.rs | 在项目中新建/挂接 Git 仓库、把仓库绑定到频道、修复项目首页仓库引用。 | 仓库公告（30617）沿本人签名发布，push 沿 DD-118(5)(6)；本机路径恢复原 Tauri 命令。 | M–L（5–8 人日） | DD-118、REQ-24 | 15/1974 |
| 13 | Projects 频道申请、添加项目频道与项目频道管理 | Web+Desktop | desktop/src/features/projects/projectChannelRequest.ts、useProjectChannelRequests.ts、ui/ProjectChannelRequestDialog.tsx、useAddProjectChannel.ts、ui/ProjectChannelManagement.tsx、ui/ProjectsCategoryCreateDialogs.tsx | 在项目下申请/新增讨论频道、管理项目频道、分类创建对话框。 | 频道创建沿 workspace.create（DD-80），申请队列需要说明审批归属（可复用 ApprovalWorkflow）；按原文件迁入共享 Projects。 | M（4–6 人日） | DD-80、REQ-24 | 8/909 |
| 14 | Voice 设置分区 | Web+Desktop | desktop/src/features/settings/ui/VoiceSettingsCard.tsx、ui/voiceSettingsLogic.ts（及 src-tauri/src/huddle/tts_settings.rs、tts_voice_import.rs） | 朗读音色选择、导入音色、转写开关等。DD-125(5) 明确保留；当前共享设置 10 类中没有 voice。 | Web 偏好存浏览器并随会话交 BFF、导入音色不落服务端；Desktop 走本机原链（DD-125(3)(5)）。与 Desktop Huddle 同批。 | S–M（2–4 人日） | DD-125(5)、DD-125(3) | 2/440 |
| 15 | 提及频道外成员时的“邀请入频道”对话框（及提及候选中的全局人员） | Web+Desktop | desktop/src/features/messages/ui/NonMemberMentionDialog.tsx、ui/useNonMemberInvite.ts；buildMentionCandidates.ts（原全局人员搜索合并，现为待定） | @ 了不在频道里的人时弹出“邀请/仍发送/不处理”。 | 邀请走既有 workspace.member.add（DD-119/41）；按原文件迁入共享 composer。 | S–M（2–3 人日） | REQ-24、DD-41 | 2/292 |
| 16 | 频道内“邀请成员”卡片 | Web+Desktop | desktop/src/features/channels/ui/ChannelMemberInviteCard.tsx | 空频道/成员少时时间线中的邀请成员卡片。 | 复用共享 channel-members 的添加成员链，按原文件迁入。 | S（1–2 人日） | REQ-24 | 1/380 |
| 17 | Projects 内置终端（Terminal） | Desktop | desktop/src/features/terminal/**、src-tauri/src/terminal_runtime*.rs、terminal_transport.rs、commands/project_terminal.rs、src-tauri/crates/buzz-terminal/**、shared/styles/globals/terminal.css | 在项目仓库目录打开本机终端面板。设计没有授权排除，也没有接入决策。 | 需先补 DD：本机 PTY 不经平台、不执行 Agent 动作是否成立（与 01 §5 “本机自动化排除”的边界）；裁定后按原文件恢复 Desktop。 | L（6–10 人日，含设计） | 无（待设计） | 36/8764 |
| 18 | Desktop 自更新（Updates 设置分区与侧栏更新提示） | Desktop | desktop/src-tauri/src/commands/updater.rs、desktop/src/features/settings/UpdateChecker.tsx、UpdateIndicator.tsx、SidebarUpdateCard.tsx、hooks/use-updater.ts | 检查/下载/安装新版本。DD-125(5)：Updates 只在 Desktop 保留。 | 接 Kailo 自有发布链（ADR-06）的更新源与签名，按原文件恢复。 | M（3–5 人日，含发布链） | DD-125(5)、DD-74 | 7/691 |
| 19 | Mobile Pulse 页面 | Mobile | mobile/lib/features/pulse/** | Pulse 动态流、发帖、Agent 活动卡。 | 按原 Dart 恢复，本人 CLIENT 直连 Relay；关注改读 CollaborationUserState.followed_principals（DD-125(5)）。 | M（4–6 人日） | REQ-24 | 7/1584 |
| 20 | Mobile 论坛频道 | Mobile | mobile/lib/features/forum/** | 论坛帖子列表、帖子详情与回复。 | 按原 Dart 恢复。 | M（3–5 人日） | REQ-24 | 5/1699 |
| 21 | Mobile 频道详情、成员列表、添加成员、频道管理与 Canvas | Mobile | mobile/lib/features/channels/channel_details_page.dart、members_sheet.dart、add_members_sheet.dart、manage_channel_sheet.dart、channel_management_provider.dart、channel_detail_page/app_bar.dart | 频道设置页、成员查看、添加成员、改名/描述等管理，Canvas 阅读。 | 管理面经 BFF（DD-119/41），读取按 DD-75；按原 Dart 恢复。 | L（6–8 人日） | DD-119、DD-41、REQ-24 | 8/2601 |
| 22 | Mobile 频道列表与频道页细节（Starred/自定义分区、私聊在线点、输入中、临时频道徽标、Agent 活动面板） | Mobile | mobile/lib/features/channels/channel_sections/**、channels_page/sections.dart、body.dart、channel_tile.dart、channel_typing_*.dart、ephemeral_channel_display.dart、agent_activity/agent_activity_sheet.dart、channel_detail_page.dart | 频道列表分组/分区管理、在线点、输入中提示、临时频道标记、Agent 工作面板。 | 分区/排序读 CollaborationUserState（DD-125(5)）；输入中/在线按 DD-120 本人直连；按原 Dart 恢复。 | L（6–8 人日） | DD-125(5)、DD-120 | 16/3393 |
| 23 | 社区名称/图标编辑（Community 元数据） | Web+Desktop | desktop/src/features/communities/ui/EditCommunityDialog.tsx、CommunityEditForm.tsx、CommunityIconSettingsCard.tsx、communityIconCache.ts | 管理员修改社区名称与图标。DD-80 规定 Community 元数据只由 CONTROL 写，但没有对应受治理动作，也没有排除裁定。 | 先补 DD：新增 tenant 级受治理动作（如 tenant.update）由 CONTROL 签发元数据；再按原文件迁入共享设置。 | M（3–5 人日，含设计） | DD-80（无动作） | 6/887 |
| 24 | 频道快捷 Agent 栏（QuickBotBar，拖放 Agent 进频道） | Web+Desktop | desktop/src/features/channels/ui/QuickBotBar.tsx、useQuickBotDrop.ts | 频道顶部快捷 Agent 条与拖放添加。 | 添加映射为 agent.installation.create / ChannelAgentBinding；按原文件迁入。 | S–M（2–3 人日） | REQ-24、DD-25 | 2/169 |
| 25 | “发送反馈”对话框 | Web+Desktop | desktop/src/features/settings/ui/SendFeedbackDialog.tsx、SendFeedbackController.tsx、hooks/useSendFeedback.ts | 设置/菜单中的产品反馈提交（原写入 Relay product_feedback）。 | 确认反馈去向（Relay 原表或平台运维通道）后按原文件迁入；需一条设计说明。 | S（1–2 人日） | 无（设计未覆盖） | 3/535 |
| 26 | Desktop Local archive（本机身份/消息归档） | Desktop | desktop/src/features/local-archive/**、identity-archive/hooks.ts、src-tauri/src/archive/**、commands/identity_archive.rs、observer_archive.rs | 本机归档消息与身份、保留期设置。DD-125(5)：只在 Desktop 保留。 | 按原文件恢复本机归档；observer/Agent 指标归档按 DD-26/125(6) 裁剪对象。 | L（5–8 人日） | DD-125(5) | 22/8466 |
| 27 | Wave（私聊挥手） | Web+Desktop | desktop/src/features/messages/lib/waveMessage.ts、ui/WaveMessageAttachment.tsx | 资料面板发起“挥手”，以带原标记的私聊 kind:9 呈现。DD-125(3) 写明沿私聊发布保留。 | 发送沿私聊发布链，按原文件迁入共享消息呈现。 | S（1–2 人日） | DD-125(3) | 2/122 |
| 28 | Mobile 外观与设置分区（明暗模式/强调色、通知、社区分区） | Mobile | mobile/lib/features/settings/accent_picker_page.dart、settings_page/notifications_section.dart、community_section.dart、theme_option_sheets.dart | 外观模式与强调色选择、通知设置。 | 按原 Dart 恢复，偏好仅设备本地（DD-53）。 | S–M（2–3 人日） | REQ-24、DD-53 | 5/514 |
| 29 | 新成员加入提醒 | Web+Desktop | desktop/src/features/community-members/lib/joinAlerts.ts、useCommunityJoinAlerts.ts | 社区有新成员加入时提醒管理员/成员。 | 以 TenantMembership 投影事件为源（不另建权威），按原文件迁入。 | S（1–2 人日） | REQ-24 | 2/765 |
| 30 | Agent 记忆图视图 | Web+Desktop | desktop/src/features/agent-memory/lib/buildMemoryGraph.ts、ui/MemorySection.tsx 图模式 | 记忆条目关系图展示（列表视图已共享）。 | 纯前端，数据沿共享 memory.tsx 既有读取。 | S（1–2 人日） | DD-68 | 1/121 |

Top 30 之外的 (c)：

- Desktop 论坛帖子独立 URL 路由（Web 已有 /posts 路由）：`desktop/src/app/routes/channels.$channelId.posts.$postId.tsx`，S（≤1 人日）。
- Desktop 系统托盘菜单：`desktop/src-tauri/src/tray_menu.rs、desktop/src/app/useTrayMenu.ts`，S（1–2 人日）。
- Desktop 按 OS 空闲自动置 away：`desktop/src-tauri/src/commands/os_idle.rs、shared/api/osIdle.ts`，S（≤1 人日）。

未被 Top 30 规则覆盖的 (c) 文件 9 个（多为上列 3 项与 Mobile 杂项），全部可在第 6 节按“(c)”筛出。

## 5. 待定项

| 状态 | 路径 | 原因 |
|---|---|---|
| M | `desktop/src-tauri/src/app_state.rs` | 原地删减较多（+13/-105），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src-tauri/src/commands/mod.rs` | 原地删减较多（+5/-94），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src-tauri/src/commands/profile.rs` | 原地删减较多（+112/-276），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src-tauri/src/key_backup.rs` | 原地删减较多（+7/-85），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `desktop/src-tauri/src/nostr_bind.rs` | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src-tauri/src/reset.rs` | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| M | `desktop/src/app/routes/ChannelRouteScreen.tsx` | 原地删减较多（+30/-100），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src/features/channels/useLiveChannelUpdates.ts` | 原地删减较多（+19/-86），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src/features/messages/lib/buildMentionCandidates.ts` | 提及候选去掉 Agent 目录/persona/全局人员搜索合并；Agent 部分属 DD-26，“提及频道外成员”候选是否随 NonMemberMention 一起丢失需核 |
| M | `desktop/src/features/messages/lib/draftMentionRefs.ts` | 同上（提及候选） |
| M | `desktop/src/features/messages/lib/mentionCandidates.ts` | 同上（提及候选） |
| M | `desktop/src/features/messages/lib/mentionSuggestionMapping.ts` | 原地删减较多（+6/-88），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `desktop/src/features/onboarding/devFreshOnboarding.ts` | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/onboarding/ui/RelaunchRequiredScreen.tsx` | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/onboarding/ui/ResetFailedScreen.tsx` | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/profile/lib/nostrBindCallback.ts` | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src/features/profile/lib/nostrIdentityBinding.ts` | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src/features/profile/ui/NostrBindConsentDialog.tsx` | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src/shared/ui/calendar.tsx` | 通用 UI 件，随所属功能（引导、资料活动轮播、日期选择）处置 |
| D | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/AgeSignalRequest.kt` | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| M | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/MainActivity.kt` | 原地删减较多（+0/-96），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/app.dart` | 装配层：随 Activity/配对/年龄门禁/推送/资料编辑等删除一并移除，具体归类见各功能条目 |
| D | `mobile/lib/features/age_gate/age_restriction_page.dart` | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| D | `mobile/lib/features/age_gate/age_signal_provider.dart` | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| D | `mobile/lib/features/age_gate/age_signal_push_bootstrap.dart` | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| M | `mobile/lib/features/channels/channel.dart` | 原地删减较多（+25/-113），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/features/channels/channel_detail_page/banners.dart` | 原地删减较多（+2/-83），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/features/channels/deep_link_dispatcher.dart` | 原地删减较多（+14/-109），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/features/channels/emoji_picker/ios_native_picker.dart` | 原地删减较多（+0/-89），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/features/invites/invite_create_page.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_page/invite_link_section.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_page/person_invite_section.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_provider.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_join_provider.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_join_sheet.dart` | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| M | `mobile/lib/features/profile/profile_avatar.dart` | 原地删减较多（+21/-91），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/shared/relay/nostr_models.dart` | 原地删减较多（+11/-96），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/shared/security/sensitive_action_authorizer.dart` | 敏感操作生物识别授权（原用于导出/配对等本机密钥操作），随 DD-72/75 的本机钥边界确定 |
| M | `mobile/lib/shared/theme/theme_provider.dart` | 原地删减较多（+0/-92），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `web/src/shared/lib/buzz-download.ts` | 邀请页“下载 Buzz 桌面端”指向 block/buzz GitHub Releases；Kailo 安装包下载入口应由发布配置给出（DD-111(4)/ADR-06），当前无替代入口，需裁定是恢复为 Kailo 发布地址还是不提供 |

## 6. 完整逐项清单（删除与改写）

列：状态（D 删除 / M 改写 / R 改名）、原版路径、+/− 行、remove_paths 条目（与路径相同记“=”）、分类、依据、替代位置或证据（引用=源码注释引用原路径；内容覆盖=原文件有效行在 Kailo 中出现的比例与主要文件）、说明。

### CI/发布脚本（33）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `.github/workflows/_ci-desktop-macos.yml` | +0/−54 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `.github/workflows/_ci-desktop.yml` | +3/−21 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `.github/workflows/_ci-rust.yml` | +0/−15 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `.github/workflows/auto-tag-on-release-pr-merge.yml` | +2/−33 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `.github/workflows/ci.yml` | +0/−6 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `.github/workflows/desktop-release-cache-proof.yml` | +0/−164 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/desktop-release-candidate.yml` | +0/−28 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/linux-canary.yml` | +0/−265 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/macos-intel-canary.yml` | +0/−126 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/mesh-lifecycle.yml` | +0/−111 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/promote-oss-desktop-release.yml` | +0/−45 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/release.yml` | +0/−949 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/signed-macos-canary.yml` | +0/−257 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.github/workflows/windows-canary.yml` | +0/−197 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `.release/desktop-candidate.json` | +0/−10 | .release | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/bundle-sidecars.sh` | +0/−54 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/buzz-adopt-prod-agents.sh` | +0/−492 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/ci-mesh-lifecycle-smoke.sh` | +0/−113 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/cleanup-instance-agents.sh` | +0/−59 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/desktop-native-toolchain-id.sh` | +0/−34 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/desktop-release-cache-key.py` | +0/−85 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/desktop_release.py` | +0/−290 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/prepare-desktop-release.sh` | +0/−82 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/promote-oss-desktop-release.sh` | +0/−88 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/required-check-succeeded.jq` | +0/−25 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/test-desktop-release-cache-key.sh` | +0/−43 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/test-desktop-release-cache-workflow.sh` | +0/−77 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/test-desktop-release-candidate.sh` | +0/−228 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/test-oss-desktop-promotion-behavior.sh` | +0/−128 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/test-oss-desktop-promotion.sh` | +0/−37 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `scripts/test-release-ref-contract.sh` | +7/−111 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `scripts/test-signed-canary-contract.sh` | +0/−40 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `scripts/verify-desktop-release-merge.sh` | +0/−86 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |

### Desktop app（外壳/路由）（62）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/app/App.tsx` | +60/−661 |  | (b) | DD-74 | client-kit: i18n, react/NativeBootstrap, react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/AppHuddleBar.tsx` | +0/−29 | = | (c) | DD-74、REQ-24、DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/huddle/HuddleBar.tsx;内容覆盖30%:collaboration/desktop/src/app/AppShell.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/AppHuddleShell.tsx` | +0/−108 | = | (c) | DD-74、REQ-24、DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/huddle/HuddleShell.tsx;内容覆盖29% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/AppShell.helpers.ts` | +24/−41 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/AppShell.tsx` | +264/−716 |  | (b) | DD-74 | client-kit: inbox, react/context, react/new-message | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/AppShellChannelSurface.tsx` | +6/−22 |  | (b) | DD-74 | client-kit: react/surfaces | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/AppShellContext.tsx` | +10/−15 |  | (b) | DD-74 | client-kit: react/use-inbox-state | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/AppShellOverlays.tsx` | +0/−142 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖19% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/AppTopChrome.tsx` | +2/−10 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/app/AppTopChromePortal.tsx` | +0/−18 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/projects/AppTopChromePortal.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/AppTopChromePortal.tsx | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/AppWorkflowEditorOverlayProvider.tsx` | +0/−174 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖10% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/BuzzThemeSurfaces.tsx` | +0/−51 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖60%:client-kit/ts/platform/src/react/surfaces.tsx | 应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/RelayConnectionOverlay.tsx` | +8/−92 |  | (b) | DD-74 | client-kit: react/sidebar/relay-connection-overlay | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/TerminalContextOverrideContext.tsx` | +0/−38 | = | (c) | - | 内容覆盖12% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/app/communityViewTransition.test.mjs` | +0/−109 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/app/communityViewTransition.ts` | +0/−58 | = | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖8% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/app/huddleBackingChannelStorage.test.mjs` | +0/−33 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/app/huddleBackingChannelStorage.ts` | +0/−36 | = | (c) | DD-125(3) | 内容覆盖8% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/app/huddleChannelVisibility.test.mjs` | +0/−65 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/app/huddleChannelVisibility.ts` | +0/−19 | = | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| M | `desktop/src/app/navigation/backForwardChords.ts` | +5/−51 |  | (b) | DD-74 | client-kit: backForwardChords | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/navigation/navigationGuard.test.mjs` | +0/−100 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/app/navigation/navigationGuard.ts` | +0/−54 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖10% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/navigation/resolveSearchHitDestination.ts` | +5/−58 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/navigation/searchHighlightNavigation.ts` | +1/−47 |  | (b) | DD-74 | client-kit: react/search/searchHighlightNavigation | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/navigation/searchHitNavigation.test.mjs` | +11/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/app/navigation/searchHitNavigation.ts` | +0/−17 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/navigation/useAppNavigation.ts` | +26/−283 |  | (b) | DD-74 | client-kit: react/projects | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/navigation/useBackForwardControls.ts` | +4/−33 |  | (b) | DD-74 | client-kit: react/use-navigation-shortcuts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/routeTree.gen.ts` | +57/−162 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/app/routes.ts` | +6/−12 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/routes/ChannelRouteScreen.tsx` | +30/−100 |  | 待定 | DD-75、DD-80、DD-40 |  | 原地删减较多（+30/-100），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `desktop/src/app/routes/WorkflowsRouteScreen.tsx` | +0/−59 | = | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；collaboration/desktop/src/features/platform/；内容覆盖12% | Workflows 路由由 Native 宿主挂载共享页面 |
| D | `desktop/src/app/routes/agents.tsx` | +0/−50 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖17% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/routes/channels.$channelId.posts.$postId.tsx` | +0/−56 | = | (c) | - | 内容覆盖33%:collaboration/desktop/src/app/routes/channels.$channelId.tsx | 论坛帖子独立 URL 路由（深链到帖子）未恢复 |
| M | `desktop/src/app/routes/channels.$channelId.tsx` | +1/−24 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/routes/index.tsx` | +9/−62 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/app/routes/lazyWorkflowsRouteScreen.ts` | +0/−6 | = | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；collaboration/desktop/src/features/platform/；内容覆盖0% | Workflows 路由由 Native 宿主挂载共享页面 |
| M | `desktop/src/app/routes/messages.new.tsx` | +18/−4 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/routes/projects.$projectId.tsx` | +0/−46 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖10% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/routes/projects.tsx` | +0/−23 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖12% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/routes/pulse.tsx` | +0/−51 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖5% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/routes/reminders.tsx` | +0/−11 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖0% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/routes/root.tsx` | +1/−13 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/routes/searchHighlightRouteState.ts` | +1/−17 |  | (b) | DD-74 | client-kit: react/search/searchHighlightRouteState | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/routes/settings.tsx` | +0/−4 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/app/routes/workflows.$workflowId.tsx` | +0/−62 | = | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；collaboration/desktop/src/features/platform/；内容覆盖29% | Workflows 路由由 Native 宿主挂载共享页面 |
| D | `desktop/src/app/routes/workflows.tsx` | +0/−57 | = | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；collaboration/desktop/src/features/platform/；内容覆盖14% | Workflows 路由由 Native 宿主挂载共享页面 |
| M | `desktop/src/app/useAppShellDesktopNotifications.ts` | +17/−48 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/app/useAppShellKeyboardShortcuts.ts` | +5/−114 |  | (b) | DD-74 | client-kit: react/use-navigation-shortcuts, react/use-search-shortcuts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/useAppShellLifecycleEffects.ts` | +0/−27 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/app/useAppShellTrayMenu.tsx` | +0/−41 | = | (c) | - | 内容覆盖0% | Desktop 系统托盘菜单；设计无排除 |
| M | `desktop/src/app/useChannelActivityProjection.ts` | +5/−10 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/app/useChannelBrowserDialog.ts` | +0/−39 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖0% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| D | `desktop/src/app/useCommunityNavigationTransitions.ts` | +0/−128 | = | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖2% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/app/useHuddlePresentation.ts` | +0/−465 | = | (c) | DD-125(3) | 内容覆盖11% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/app/useLiveHomeFeedActions.ts` | +0/−128 | = | (b) | DD-74 | collaboration/desktop/src/app/；client-kit/ts/platform/src/react/；内容覆盖12% | 应用外壳/路由由 Native 宿主与共享主体承载 |
| M | `desktop/src/app/useMarkAsReadShortcuts.ts` | +1/−58 |  | (b) | DD-74 | client-kit: react/use-mark-as-read-shortcuts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/app/useSettingsShortcuts.ts` | +1/−45 |  | (b) | DD-74 | client-kit: react/use-settings-shortcuts | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/app/useTerminalContext.ts` | +0/−56 | = | (c) | - | 内容覆盖26% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/app/useTrayMenu.ts` | +0/−160 | = | (c) | - | 内容覆盖6% | Desktop 系统托盘菜单；设计无排除 |
| M | `desktop/src/app/useWebviewZoomShortcuts.ts` | +4/−143 |  | (b) | DD-74 | client-kit: react/use-text-scale-shortcuts | 原位文件改为消费共享主体（宿主适配层） |

### Desktop features/agent-memory（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/agent-memory/hooks.ts` | +0/−97 | desktop/src/features/agent-memory | (b) | DD-65、DD-68 | client-kit/ts/platform/src/react/memory.tsx；内容覆盖7% | Agent 记忆管理由共享 memory.tsx 经 Core 读写 NIP-AE |
| D | `desktop/src/features/agent-memory/lib/buildMemoryGraph.test.mjs` | +0/−144 | desktop/src/features/agent-memory | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agent-memory/lib/buildMemoryGraph.ts` | +0/−121 | desktop/src/features/agent-memory | (c) | DD-68 | 内容覆盖3% | 记忆图视图未恢复（列表视图已在共享 memory.tsx） |
| D | `desktop/src/features/agent-memory/ui/MemorySection.tsx` | +0/−633 | desktop/src/features/agent-memory | (b) | DD-65、DD-68 | client-kit/ts/platform/src/react/memory.tsx；内容覆盖9% | Agent 记忆管理由共享 memory.tsx 经 Core 读写 NIP-AE |

### Desktop features/agents（357）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/agents/AGENTS.md` | +0/−391 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/acpRuntimesQuery.test.mjs` | +0/−685 | desktop/src/features/agents | (d) | - | 内容覆盖31%:collaboration/desktop/src/features/messages/ui/MessageComposerDraftImagePersist.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/acpRuntimesQuery.ts` | +0/−306 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖10% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/activeAgentTurnsStore.test.mjs` | +0/−2452 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/activeAgentTurnsStore.ts` | +0/−839 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖9% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/agentManagement.test.mjs` | +0/−146 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/agentManagement.ts` | +0/−177 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖1% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/agentManagementBuffer.test.mjs` | +0/−62 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/agentManagementBuffer.ts` | +0/−29 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/agentReuse.test.mjs` | +0/−398 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/agentReuse.ts` | +0/−136 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖3% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/agentWorkingSignal.test.mjs` | +0/−228 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/agentWorkingSignal.ts` | +0/−335 | desktop/src/features/agents | (c) | DD-125(6)、REQ-24、DD-74 | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-activity/agentWorkingSignal.ts;内容覆盖46%:client-kit/ts/platform/src/react/agent-activity/agentWorkingSignal.ts | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/assets/agent-outline.svg` | +0/−15 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/cardMintStore.test.mjs` | +0/−219 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/cardMintStore.ts` | +0/−236 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖12% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/channelAgents.accessPolicy.test.mjs` | +0/−149 | desktop/src/features/agents | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/channelAgents.ts` | +0/−493 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/focusRefetchPolicy.test.mjs` | +0/−88 | desktop/src/features/agents | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/hooks.ts` | +0/−978 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖14% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ingestArchivedObserverEvents.test.mjs` | +0/−1189 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/knownAgentPubkeys.test.mjs` | +0/−62 | desktop/src/features/agents | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/knownAgentPubkeys.ts` | +0/−73 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖19% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/agentAccessWarning.test.mjs` | +0/−89 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentAccessWarning.ts` | +0/−63 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx；client-kit/ts/platform/src/react/agent-installation-use.tsx；内容覆盖0% | respondTo 映射为 Installation 使用授权（owner-only≙默认、allowlist≙use.grant；anyone 不提供） |
| D | `desktop/src/features/agents/lib/agentAutocompleteEligibility.test.mjs` | +0/−639 | desktop/src/features/agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentAutocompleteEligibility.ts` | +0/−432 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖9% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/agentCardAvatar.test.mjs` | +0/−37 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentCardAvatar.ts` | +0/−29 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖0% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/lib/agentCardGalleryState.test.mjs` | +0/−96 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentCardGalleryState.ts` | +0/−35 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖0% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/lib/agentCardModelLabel.test.mjs` | +0/−242 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentCardModelLabel.ts` | +0/−54 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖0% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/lib/agentConfigCore.test.mjs` | +0/−723 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentConfigCore.ts` | +0/−362 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖1% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/agentDescription.test.mjs` | +0/−42 | desktop/src/features/agents | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentDescription.ts` | +0/−29 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/agentDescription.ts;内容覆盖89%:client-kit/ts/platform/src/react/agent-library/agentDescription.ts | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/lib/agentParallelism.test.mjs` | +0/−56 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/agentParallelism.ts` | +0/−39 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/autoRestartPolicy.test.mjs` | +0/−124 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/autoRestartPolicy.ts` | +0/−109 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/cancelTurnOutcome.test.mjs` | +0/−102 | desktop/src/features/agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/cancelTurnOutcome.ts` | +0/−76 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/catalog.test.mjs` | +0/−81 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/catalog.ts` | +0/−23 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖9% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/lib/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/agents | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/formatAgentModelLabel.ts` | +0/−79 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/friendlyAgentLastError.test.mjs` | +0/−318 | desktop/src/features/agents | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/friendlyAgentLastError.ts` | +0/−128 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖5% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/instanceInputForDefinition.test.mjs` | +0/−336 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/instanceInputForDefinition.ts` | +0/−161 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖2% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/liveSwitchOutcome.test.mjs` | +0/−484 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/liveSwitchOutcome.ts` | +0/−170 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/managedAgentControlActions.test.mjs` | +0/−168 | desktop/src/features/agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/managedAgentControlActions.ts` | +0/−216 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；引用:client-kit/ts/platform/src/react/agent-activity/agentLifecycle.ts;内容覆盖1% | 停止/启动/重启映射为 agent.installation.disable/enable/upgrade |
| D | `desktop/src/features/agents/lib/managedAgentDeletionAvailability.test.mjs` | +0/−469 | desktop/src/features/agents | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/otherSetupAgent.test.mjs` | +0/−73 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/otherSetupAgent.ts` | +0/−63 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/personaCatalogRelay.invoke.test.mjs` | +0/−26 | desktop/src/features/agents | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/personaCatalogRelay.test.mjs` | +0/−173 | desktop/src/features/agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/personaCatalogRelay.ts` | +0/−164 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖7% | Persona 分享/社区 persona 目录：DD-131(6)(7) 定为 `agent.definition.share` 与导出包附件分享，待实现 |
| D | `desktop/src/features/agents/lib/personaEditCaches.ts` | +0/−42 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖18% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/personaSaveNotice.test.mjs` | +0/−29 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/personaSaveNotice.ts` | +0/−24 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/pickBotName.ts` | +0/−75 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/pickProfileAgent.test.mjs` | +0/−67 | desktop/src/features/agents | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/pickProfileAgent.ts` | +0/−30 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖22% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/resolvePersonaRuntime.test.mjs` | +0/−179 | desktop/src/features/agents | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/resolvePersonaRuntime.ts` | +0/−144 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/respondToAllowlist.test.mjs` | +0/−75 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/respondToAllowlist.ts` | +0/−72 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx；client-kit/ts/platform/src/react/agent-installation-use.tsx；内容覆盖5% | respondTo 映射为 Installation 使用授权（owner-only≙默认、allowlist≙use.grant；anyone 不提供） |
| D | `desktop/src/features/agents/lib/teamCatalogRelay.test.mjs` | +0/−145 | desktop/src/features/agents | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/teamCatalogRelay.ts` | +0/−112 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖10% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/lib/teamPersonas.test.mjs` | +0/−94 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/teamPersonas.ts` | +0/−74 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖0% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/lib/useAgentAvailability.test.mjs` | +0/−119 | desktop/src/features/agents | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/useAgentAvailability.ts` | +0/−76 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖11% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/useAgentsDataRefresh.test.mjs` | +0/−17 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/useAgentsDataRefresh.ts` | +0/−71 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖25% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/useAutoRestartPolicy.ts` | +0/−138 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖14% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/useBotRecents.test.mjs` | +0/−77 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/useBotRecents.ts` | +0/−91 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/useInstallOutputLine.test.mjs` | +0/−82 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/useInstallOutputLine.ts` | +0/−108 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖24% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/useLastRuntime.ts` | +0/−34 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/lib/usePersonaCatalogRelay.ts` | +0/−135 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖19% | Persona 分享/社区 persona 目录：DD-131(6)(7) 定为 `agent.definition.share` 与导出包附件分享，待实现 |
| D | `desktop/src/features/agents/lib/usePersonaSync.test.mjs` | +0/−914 | desktop/src/features/agents | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/lib/usePersonaSync.ts` | +0/−483 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖11% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/lib/useTeamCatalogRelay.ts` | +0/−118 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖18% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/managedAgentReconciliationPlan.test.mjs` | +0/−108 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/managedAgentReconciliationPlan.ts` | +0/−95 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/managedAgentRuntimeHooks.test.mjs` | +0/−110 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/managedAgentRuntimeHooks.ts` | +0/−228 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/managedAgentRuntimeReconciliation.test.mjs` | +0/−49 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/managedAgentRuntimeStatus.test.mjs` | +0/−113 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/managedAgentRuntimeStatus.ts` | +0/−113 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖2% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/observerRelayStore.ts` | +0/−984 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖7% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/observerRelaySubscriptionGate.test.mjs` | +0/−15 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/observerTranscriptRetention.test.mjs` | +0/−418 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/openCreateAgentEvent.ts` | +0/−42 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/open-create-agent-event.ts;内容覆盖18% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/openEditAgentEvent.test.mjs` | +0/−187 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/openEditAgentEvent.ts` | +0/−85 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/openSnapshotImportFromUrlEvent.test.mjs` | +0/−42 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/openSnapshotImportFromUrlEvent.ts` | +0/−65 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖6% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/preventSleepActivity.test.mjs` | +0/−37 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/preventSleepActivity.ts` | +0/−40 | desktop/src/features/agents | (a) | DD-125(5) | 内容覆盖5% | 防休眠对象是一期不存在的本机 Agent，排除 |
| D | `desktop/src/features/agents/snapshotHooks.ts` | +0/−97 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖3% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/teamHooks.ts` | +0/−65 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖27% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/AddAgentToChannelDialog.tsx` | +0/−251 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖19% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AddCustomHarnessDialog.tsx` | +0/−47 | desktop/src/features/agents | (a) | DD-26 | 内容覆盖31%:client-kit/ts/platform/src/react/community-members/CommunityInviteDialog.tsx | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/agents/ui/AddTeamToChannelDialog.tsx` | +0/−324 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖15% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/AdvancedRequiredBadge.tsx` | +0/−26 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentAiConfigurationMode.tsx` | +0/−113 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖13% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentAiDefaults.tsx` | +0/−107 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖2% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/ui/AgentCardMintDialog.test.mjs` | +0/−257 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/AgentCardMintDialog.tsx` | +0/−463 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖9% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/ui/AgentCardViewerDialog.tsx` | +0/−372 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖9% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/AgentConfigFields.tsx` | +0/−1045 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentConfigPanel.tsx` | +0/−522 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖8% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentConfigPanelPresentation.test.mjs` | +0/−30 | desktop/src/features/agents | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/AgentCreationPreview.tsx` | +0/−1043 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentCreationPreview.tsx;内容覆盖95%:client-kit/ts/platform/src/react/agent-library/AgentCreationPreview.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentCreationPreview.utils.ts` | +0/−16 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentCreationPreview.utils.ts;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/AgentCreationPreview.utils.ts | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentDefaultsDialog.tsx` | +0/−161 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖14% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/ui/AgentDefaultsEditor.tsx` | +0/−369 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖12% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/ui/AgentDefinitionDialog.tsx` | +0/−1018 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentDefinitionAdvanced.tsx;内容覆盖7% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentDefinitionDialogFooter.tsx` | +0/−60 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖5% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentDefinitionDialogShell.tsx` | +0/−57 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentManagementDialog.tsx;内容覆盖50%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentDefinitionMetadata.tsx` | +0/−65 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentDescriptionField.tsx` | +0/−115 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentDescriptionField.tsx;内容覆盖92%:client-kit/ts/platform/src/react/agent-library/AgentDescriptionField.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentDialog.tsx` | +0/−187 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖8% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentGroupRows.tsx` | +0/−57 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖4% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentHarnessField.tsx` | +0/−43 | desktop/src/features/agents | (a) | DD-26 | 内容覆盖40%:client-kit/ts/platform/src/react/agent-library/AgentDescriptionField.tsx | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/agents/ui/AgentIdentityCard.tsx` | +0/−102 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/AgentIdentityCard.tsx;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/AgentIdentityCard.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/AgentInstanceEditDialog.tsx` | +0/−1225 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖8% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentManagementDialogs.tsx` | +0/−50 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖9% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentRunLocationContext.tsx` | +0/−43 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖12% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentRuntimeAvatarControl.tsx` | +0/−279 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖12% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem.tsx` | +0/−1 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/ToolItem.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/CompactMessageSummary.tsx` | +0/−231 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖35%:client-kit/ts/platform/src/react/video-review/VideoPlayer.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/CompactToolSummaryRow.tsx` | +0/−159 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖77%:client-kit/ts/platform/src/react/agent-transcript/ToolItem.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/SentMessageContextDialog.tsx` | +0/−186 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖38%:client-kit/ts/platform/src/react/agent-transcript/PromptSectionList.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/ShellCommandBlock.tsx` | +0/−43 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/ToolItem.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/TodoToolSummary.tsx` | +0/−197 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖21% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/ToolDetailBlocks.tsx` | +0/−115 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖57%:client-kit/ts/platform/src/react/agent-transcript/ToolItem.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/ToolItem.tsx` | +0/−153 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖69%:client-kit/ts/platform/src/react/agent-transcript/ToolItem.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/ViewImageToolPreview.tsx` | +0/−43 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/messageLinks.ts` | +0/−76 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖5% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/useSentMessageBody.test.mjs` | +0/−174 | desktop/src/features/agents | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/AgentSessionToolItem/useSentMessageBody.ts` | +0/−51 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖4% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSessionTranscriptList.tsx` | +0/−996 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/AgentSessionTranscriptList.tsx;内容覆盖63%:client-kit/ts/platform/src/react/agent-transcript/AgentSessionTranscriptList.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/AgentSnapshotExportDialog.tsx` | +0/−203 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖15% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/AgentSnapshotImportDialog.tsx` | +0/−374 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖9% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/AgentStatusBadge.tsx` | +0/−64 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖11% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentsScreen.tsx` | +0/−159 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖13% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/AgentsView.tsx` | +0/−704 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖6% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/CardMintComposerChip.tsx` | +0/−78 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖8% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/ui/CardMintKeyCue.tsx` | +0/−29 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖0% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/ui/CommunityCatalogDialog.tsx` | +0/−912 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖12% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/CommunityCatalogDialogAvatarLeak.test.mjs` | +0/−331 | desktop/src/features/agents | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/CopyButton.tsx` | +0/−35 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/workflow-webhook-secret-dialog.tsx;内容覆盖14% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/CreateIdentityCard.tsx` | +0/−39 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/CreateIdentityCard.tsx;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/CreateIdentityCard.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/CreateNewButton.tsx` | +0/−33 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖33%:client-kit/ts/platform/src/react/workflow-channel-combobox.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/EditAgentAdvancedFields.tsx` | +0/−385 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖20% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/EditAgentProviderModelFields.tsx` | +0/−191 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/EffortPickerField.tsx` | +0/−75 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/EnvVarsEditor.test.mjs` | +0/−927 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/EnvVarsEditor.tsx` | +0/−678 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖12% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/FileContentBlock.tsx` | +0/−107 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/FileContentBlock.tsx;内容覆盖94%:client-kit/ts/platform/src/react/agent-transcript/FileContentBlock.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/FileEditDiffView.tsx` | +0/−29 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/FileContentBlock.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/HarnessCatalogRetryNotice.tsx` | +0/−24 | desktop/src/features/agents | (a) | DD-26 | 内容覆盖0% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/agents/ui/IdentityInitialsAvatar.tsx` | +0/−59 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/IdentityInitialsAvatar.tsx;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/IdentityInitialsAvatar.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/ManagedAgentLogPanel.tsx` | +0/−183 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖6% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/ManagedAgentRow.tsx` | +0/−429 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖11% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx` | +0/−378 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-activity/InstallationSessions.tsx;内容覆盖19% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/McpServersSection.test.mjs` | +0/−90 | desktop/src/features/agents | (d) | - | 内容覆盖40%:collaboration/desktop/src/features/messages/ui/MentionAutocomplete.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/McpServersSection.tsx` | +0/−125 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖7% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/ModelPicker.tsx` | +0/−299 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖16% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/OtherSetupAgentMarker.tsx` | +0/−45 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖18% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/OwnerOnlyAccessField.tsx` | +0/−35 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx；client-kit/ts/platform/src/react/agent-installation-use.tsx；内容覆盖15% | respondTo 映射为 Installation 使用授权（owner-only≙默认、allowlist≙use.grant；anyone 不提供） |
| D | `desktop/src/features/agents/ui/PersonaActionsMenu.tsx` | +0/−107 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖34%:client-kit/ts/platform/src/react/agent-activity/MembersSidebarAgentControls.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/PersonaAddedBy.tsx` | +0/−18 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖0% | Persona 分享/社区 persona 目录：DD-131(6)(7) 定为 `agent.definition.share` 与导出包附件分享，待实现 |
| D | `desktop/src/features/agents/ui/PersonaAdvancedFields.tsx` | +0/−326 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖15% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/PersonaDeleteDialog.test.mjs` | +0/−34 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/PersonaDeleteDialog.tsx` | +0/−86 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖4% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/PersonaDropdownField.tsx` | +0/−103 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/PersonaModelCombobox.tsx` | +0/−220 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖45%:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/PersonaModelField.tsx` | +0/−116 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖24% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/PersonaProviderApiKeyField.test.mjs` | +0/−170 | desktop/src/features/agents | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/PersonaProviderApiKeyField.tsx` | +0/−131 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/PersonaShareDialog.tsx` | +0/−750 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖14% | Persona 分享/社区 persona 目录：DD-131(6)(7) 定为 `agent.definition.share` 与导出包附件分享，待实现 |
| D | `desktop/src/features/agents/ui/PersonaShareRecipients.tsx` | +0/−302 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖32%:client-kit/ts/platform/src/react/new-message.tsx | Persona 分享/社区 persona 目录：DD-131(6)(7) 定为 `agent.definition.share` 与导出包附件分享，待实现 |
| D | `desktop/src/features/agents/ui/PromptSectionAccordion.tsx` | +0/−80 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/PromptSectionList.tsx;内容覆盖96%:client-kit/ts/platform/src/react/agent-transcript/PromptSectionList.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/ProviderConfigFields.test.mjs` | +0/−31 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/ProviderConfigFields.tsx` | +0/−84 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖5% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/RawEventRail.tsx` | +0/−49 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖11% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/RemoveMembersConfirmDialog.tsx` | +0/−74 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖10% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/RequestedAgentCreateDialogs.tsx` | +0/−68 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖12% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/RespondToField.tsx` | +0/−538 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx；client-kit/ts/platform/src/react/agent-installation-use.tsx；引用:client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx;内容覆盖23% | respondTo 映射为 Installation 使用授权（owner-only≙默认、allowlist≙use.grant；anyone 不提供） |
| D | `desktop/src/features/agents/ui/RestartDiffBadge.tsx` | +0/−209 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖1% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/RunOnSummarySection.tsx` | +0/−73 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/SnapshotOptionMenu.tsx` | +0/−75 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖62%:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamDeleteDialog.tsx` | +0/−61 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖6% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamDialog.tsx` | +0/−356 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖15% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamIdentityCard.tsx` | +0/−214 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖13% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamShareDialog.tsx` | +0/−81 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖14% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamSnapshotExportDialog.tsx` | +0/−177 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖15% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamSnapshotImportDialog.tsx` | +0/−328 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖11% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TeamsSection.tsx` | +0/−231 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖22% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/TurnLivenessIndicator.tsx` | +0/−74 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/TurnLivenessIndicator.tsx;内容覆盖87%:client-kit/ts/platform/src/react/agent-transcript/TurnLivenessIndicator.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/UnifiedAgentsSection.tsx` | +0/−551 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/UnifiedAgentsSectionCardTarget.test.mjs` | +0/−606 | desktop/src/features/agents | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/WhereToRunSection.tsx` | +0/−140 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/activityRenderClasses/ActivityRow.tsx` | +0/−214 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/ActivityRow.tsx;内容覆盖98%:client-kit/ts/platform/src/react/agent-transcript/ActivityRow.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/LifecycleActivity.tsx` | +0/−130 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖31%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/MessageActivity.tsx` | +0/−83 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖68%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/MessageLinkHoverCue.tsx` | +0/−24 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/PlanActivity.tsx` | +0/−62 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖53%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/RawRailActivity.render.test.mjs` | +0/−90 | desktop/src/features/agents | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/activityRenderClasses/RawRailActivity.tsx` | +0/−57 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖86%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/activityRenderClasses/SuppressedActivity.tsx` | +0/−39 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/ThoughtActivity.tsx` | +0/−33 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/ToolActivity.tsx` | +0/−11 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/TranscriptActivityItem.tsx` | +0/−37 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖89%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/TranscriptTimestamp.tsx` | +0/−71 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖45%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/UserMessageBubble.tsx` | +0/−181 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖61%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/activityRowLabelParts.test.mjs` | +0/−37 | desktop/src/features/agents | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/activityRenderClasses/types.ts` | +0/−18 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖67%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/activityRenderClasses/useTranscriptBubbleOverflow.ts` | +0/−34 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖94%:client-kit/ts/platform/src/react/agent-transcript/activityRenderers.tsx | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/addCustomHarness.test.mjs` | +0/−344 | desktop/src/features/agents | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/addCustomHarness.ts` | +0/−104 | desktop/src/features/agents | (a) | DD-26 | 内容覆盖8% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/agents/ui/agentAiConfigurationPolicy.test.mjs` | +0/−185 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentAiConfigurationPolicy.ts` | +0/−75 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/agentConfigControls.test.mjs` | +0/−117 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentConfigControls.tsx` | +0/−674 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖8% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/agentConfigFieldsContract.test.mjs` | +0/−220 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentConfigOptions.test.mjs` | +0/−296 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentConfigOptions.tsx` | +0/−798 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；引用:client-kit/ts/platform/src/react/agent-library/agentConfigOptions.ts;内容覆盖4% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现） |
| D | `desktop/src/features/agents/ui/agentCreateIntent.test.mjs` | +0/−16 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentCreateIntent.ts` | +0/−20 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/agentDefaultsEditor.test.mjs` | +0/−705 | desktop/src/features/agents | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentDefinitionSubmitPayload.test.mjs` | +0/−92 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentDefinitionSubmitPayload.ts` | +0/−75 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/agentDialogRouting.test.mjs` | +0/−112 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentInstanceEditCancelSafety.test.mjs` | +0/−1078 | desktop/src/features/agents | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentInstanceEditPinning.test.mjs` | +0/−403 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentProfileSyncWarning.ts` | +0/−11 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/agentSessionFileEditDiff.ts` | +0/−203 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionFileEditDiff.ts;内容覆盖99%:client-kit/ts/platform/src/react/agent-transcript/agentSessionFileEditDiff.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionFileRead.test.mjs` | +0/−141 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionFileRead.ts` | +0/−156 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖29% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionImageContent.test.mjs` | +0/−71 | desktop/src/features/agents | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionImageContent.ts` | +0/−40 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖23% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionPanelLayout.test.mjs` | +0/−120 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionPanelLayout.ts` | +0/−114 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionToolCatalog.ts` | +0/−281 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolCatalog.ts;内容覆盖63%:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolCatalog.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionToolClassifier.test.mjs` | +0/−191 | desktop/src/features/agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionToolClassifier.ts` | +0/−641 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolClassifier.ts;内容覆盖34%:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolClassifier.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionToolItemHelpers.test.mjs` | +0/−164 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionToolSummary.test.mjs` | +0/−388 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionToolSummary.ts` | +0/−131 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolSummary.ts;内容覆盖67%:client-kit/ts/platform/src/react/agent-transcript/agentSessionToolSummary.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTranscript.test.mjs` | +0/−2127 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionTranscript.ts` | +0/−1176 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptContext.ts` | +0/−13 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptContext.ts;内容覆盖100%:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptContext.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptGrouping.test.mjs` | +0/−1875 | desktop/src/features/agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptGrouping.ts` | +0/−817 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptGrouping.ts;内容覆盖91%:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptGrouping.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptHelpers.test.mjs` | +0/−1065 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptHelpers.ts` | +0/−750 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptPi.test.mjs` | +0/−71 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptPresentation.test.mjs` | +0/−314 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSessionTranscriptPresentation.ts` | +0/−100 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptPresentation.ts;内容覆盖94%:client-kit/ts/platform/src/react/agent-transcript/agentSessionTranscriptPresentation.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionTypes.ts` | +0/−152 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionTypes.ts;内容覆盖93%:client-kit/ts/platform/src/react/agent-transcript/agentSessionTypes.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSessionUtils.ts` | +0/−308 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/agentSessionUtils.ts;内容覆盖84%:client-kit/ts/platform/src/react/agent-transcript/agentSessionUtils.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/agentSnapshotImportDialog.test.mjs` | +0/−234 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentSnapshotSend.test.mjs` | +0/−720 | desktop/src/features/agents | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/agentUi.ts` | +0/−42 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/archivePagingState.ts` | +0/−126 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖3% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/bakedEnvHelpers.ts` | +0/−184 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/buzzAgentConfig.test.mjs` | +0/−630 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/buzzAgentConfig.ts` | +0/−80 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/buzzAgentModelTuningFields.tsx` | +0/−386 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖6% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/cardMintKeyUtils.ts` | +0/−75 | desktop/src/features/agents | (a) | DD-131(5) | 内容覆盖0% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src/features/agents/ui/catalogOwnerLabel.ts` | +0/−15 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/createAgentLocalModeGate.test.mjs` | +0/−1444 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/editAgentNormalizedFieldFocus.test.mjs` | +0/−280 | desktop/src/features/agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/editAgentProviderDiscovery.test.mjs` | +0/−1566 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/editAgentProviderSaveValid.test.mjs` | +0/−165 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/editAgentRequiredCredentials.test.mjs` | +0/−235 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/effortAutoClear.test.mjs` | +0/−509 | desktop/src/features/agents | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/effortPicker.test.mjs` | +0/−110 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/effortPicker.ts` | +0/−71 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/envVarsEditorFocus.test.mjs` | +0/−246 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/envVarsEditorMissing.test.mjs` | +0/−105 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/globalAgentCredentialState.test.mjs` | +0/−60 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/globalAgentCredentialState.ts` | +0/−70 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖0% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/ui/managedAgentAvatar.test.mjs` | +0/−86 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/managedAgentAvatar.ts` | +0/−61 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/modelCapabilities.ts` | +0/−441 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖1% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/modelCapabilitiesCorpus.test.mjs` | +0/−195 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaBehaviorDraft.test.mjs` | +0/−163 | desktop/src/features/agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaBehaviorDraft.ts` | +0/−102 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/personaCatalogOwnerLabel.test.mjs` | +0/−103 | desktop/src/features/agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaDialogEnvVars.ts` | +0/−3 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/personaDialogState.test.mjs` | +0/−334 | desktop/src/features/agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaDialogState.ts` | +0/−144 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖2% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/personaLibraryCopy.ts` | +0/−64 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖0% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/personaModelDiscoveryStatus.test.mjs` | +0/−160 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaModelDiscoveryStatus.ts` | +0/−175 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖6% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/personaRuntimeModel.test.mjs` | +0/−266 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/personaRuntimeModel.ts` | +0/−334 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖1% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/providerApiKeyFieldState.test.mjs` | +0/−96 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/providerApiKeyFieldState.ts` | +0/−144 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/providerEnvVarUpdates.test.mjs` | +0/−73 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/providerEnvVarUpdates.ts` | +0/−57 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖17% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/rawEventRail.test.mjs` | +0/−84 | desktop/src/features/agents | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/relayMeshModelPicker.test.mjs` | +0/−80 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/relayMeshModelPicker.ts` | +0/−99 | desktop/src/features/agents | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖2% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/agents/ui/respondToFieldContract.test.mjs` | +0/−77 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/runOnSummary.test.mjs` | +0/−171 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/runOnSummary.ts` | +0/−156 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/runtimeAvailabilityWarning.test.mjs` | +0/−89 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/runtimeAvailabilityWarning.ts` | +0/−32 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/runtimeModelProviderSelection.test.mjs` | +0/−267 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/runtimeModelProviderSelection.ts` | +0/−202 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖4% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/snapshotAvatarPng.test.mjs` | +0/−83 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/snapshotAvatarPng.ts` | +0/−84 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖3% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/teamDialogSelection.test.mjs` | +0/−92 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/teamDialogSelection.ts` | +0/−45 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖0% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/teamLibraryCopy.ts` | +0/−51 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖0% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/teamSnapshotImport.lib.ts` | +0/−63 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖4% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/transcriptAnimationPreference.ts` | +0/−61 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/transcriptPreferences.ts;内容覆盖56%:client-kit/ts/platform/src/react/messages/thread/threadViewModePreference.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/transcriptTimestampPreference.ts` | +0/−62 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；内容覆盖56%:client-kit/ts/platform/src/react/messages/thread/threadViewModePreference.ts | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/ui/unifiedAgentGroups.test.mjs` | +0/−77 | desktop/src/features/agents | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/unifiedAgentGroups.ts` | +0/−48 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖5% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/useAgentDialogDefaults.ts` | +0/−33 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖0% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/ui/useLoadArchivedObserverEvents.test.mjs` | +0/−936 | desktop/src/features/agents | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/useManagedAgentActions.ts` | +0/−476 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；引用:client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx;内容覆盖5% | 停止/启动/重启映射为 agent.installation.disable/enable/upgrade |
| D | `desktop/src/features/agents/ui/useObserverEvents.ts` | +0/−409 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖13% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/usePersonaActions.ts` | +0/−610 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖3% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/usePersonaModelDiscovery.test.mjs` | +0/−441 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/usePersonaModelDiscovery.ts` | +0/−409 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖4% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/useRequiredCredentialState.ts` | +0/−139 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖0% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/ui/useSnapshotSendController.ts` | +0/−469 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖7% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/useTeamActions.ts` | +0/−457 | desktop/src/features/agents | (c) | DD-131 | 内容覆盖2% | Agent Teams、团队/Agent 快照导入导出、卡片查看、社区 Agent 目录：DD-131 已定设计（团队=Core `agent_team`、快照走 DD-42、目录读 Core），待实现 |
| D | `desktop/src/features/agents/ui/useWindowFileDragOver.ts` | +0/−74 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖27% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/ui/whereToRunIntent.test.mjs` | +0/−131 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/ui/whereToRunIntent.ts` | +0/−75 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖3% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/useAgentAccessOwnerOnly.ts` | +0/−25 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-activity/RespondToField.tsx；client-kit/ts/platform/src/react/agent-installation-use.tsx；内容覆盖0% | respondTo 映射为 Installation 使用授权（owner-only≙默认、allowlist≙use.grant；anyone 不提供） |
| D | `desktop/src/features/agents/useAgentManagement.ts` | +0/−290 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖4% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/useAgentObserverIngestion.test.mjs` | +0/−88 | desktop/src/features/agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/useAgentObserverIngestion.ts` | +0/−116 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖15% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/useCreatedAgentChannelAttachment.ts` | +0/−74 | desktop/src/features/agents | (b) | DD-24、DD-25、DD-74 | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-library/；内容覆盖3% | Agents 页、Definition 创建/编辑、身份卡片：共享 Agents 页面 + Core AgentDefinition/Installation（逐文件证据见覆盖率列；无覆盖的辅助逻辑并入共享实现）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/agents/useGlobalAgentConfig.ts` | +0/−44 | desktop/src/features/agents | (a) | DD-125(5)、DD-26 | 内容覆盖9% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/agents/useKnownAgentPubkeys.test.mjs` | +0/−73 | desktop/src/features/agents | (d) | - | 内容覆盖34%:collaboration/desktop/src/features/channels/channelReference.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/useKnownAgentPubkeys.tsx` | +0/−147 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖4% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/useManagedAgentRuntimeReconciliation.ts` | +0/−135 | desktop/src/features/agents | (a) | DD-26、DD-15、DD-20、DD-110、DD-122、DD-125(6) | client-kit/ts/platform/src/react/agents.tsx；client-kit/ts/platform/src/react/agent-transcript/；内容覆盖5% | 本机运行时/provider/模型/环境变量/MCP 服务器/重启策略/本机 observer（24200/44200）：平台 Agent 只由托管 Codex 经 AgentGateway 运行，工具经 ToolBinding、模型经 llm_route；会话转写改读 Codex ThreadStore |
| D | `desktop/src/features/agents/useOpenAgentActivity.test.mjs` | +0/−84 | desktop/src/features/agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/agents/useOpenAgentActivity.ts` | +0/−195 | desktop/src/features/agents | (b) | DD-125(6) | client-kit/ts/platform/src/react/agent-transcript/；引用:client-kit/ts/platform/src/react/agent-transcript/open-agent-activity.tsx;内容覆盖8% | Agent 会话转写/工作中指示：共享 agent-transcript（BFF 读 Codex ThreadStore） |
| D | `desktop/src/features/agents/usePreventSleep.ts` | +0/−128 | desktop/src/features/agents | (a) | DD-125(5) | 内容覆盖8% | 防休眠对象是一期不存在的本机 Agent，排除 |

### Desktop features/channel-templates（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/channel-templates/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/channel-templates | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/channel-templates/hooks.ts` | +0/−121 | desktop/src/features/channel-templates | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖19% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channel-templates/useApplyTemplate.ts` | +0/−157 | desktop/src/features/channel-templates | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/channel-templates/applyChannelTemplate.ts;内容覆盖5% | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/channels（152）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/channels/channelMemberProfileCache.test.mjs` | +0/−132 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/channelMemberProfileCache.ts` | +0/−93 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖6% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/channelSnapshot.test.mjs` | +2/−23 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/channelSnapshot.ts` | +0/−19 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/dmResurface.test.mjs` | +0/−93 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/dmResurface.ts` | +0/−66 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖14% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/focusedThreadCloseRequest.ts` | +1/−16 |  | (b) | DD-74 | client-kit: react/thread/focusedThreadCloseRequest | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/forcedUnreadStore.ts` | +1/−182 |  | (b) | DD-74 | client-kit: react/sidebar/forcedUnreadStore | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/hiddenDmResurfaceAction.test.mjs` | +0/−121 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/hiddenDmResurfaceAction.ts` | +0/−49 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖14% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/hiddenDmResurfaceCoordinator.test.mjs` | +0/−92 | = | (d) | - | 内容覆盖27% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/hiddenDmResurfaceCoordinator.ts` | +0/−60 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖5% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/hooks.test.mjs` | +161/−113 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/hooks.ts` | +70/−637 |  | (b) | DD-74 | client-kit: contracts, react/channel-browser/loadChannelDirectory, react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/isDmNotifiableKind.test.mjs` | +0/−53 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/isDmNotifiableKind.ts` | +0/−19 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖33%:client-kit/ts/platform/src/react/messages/reactions/threadReactionInteraction.ts | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/lib/canonicalChannelName.test.mjs` | +0/−22 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/lib/canonicalChannelName.ts` | +0/−14 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-browser/canonicalChannelName.ts;内容覆盖100%:client-kit/ts/platform/src/react/channel-browser/canonicalChannelName.ts | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/lib/channelDescription.test.mjs` | +1/−9 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/lib/channelDescription.ts` | +7/−15 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/lib/channelLifecycle.test.mjs` | +0/−35 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/lib/channelLifecycle.ts` | +0/−23 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖0% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/lib/channelMemberAdmission.test.mjs` | +0/−77 | = | (d) | - | 内容覆盖32%:collaboration/desktop/tests/e2e/sidebar-snapshot.spec.ts | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/lib/channelMemberAdmission.ts` | +0/−39 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖10% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/lib/dmHuddleMembers.ts` | +0/−54 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖57%:client-kit/ts/platform/src/react/messages/system/SystemMessageRow.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/lib/dmParticipantDisplay.ts` | +0/−108 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/conversations/dm-participant-display.ts;内容覆盖85%:client-kit/ts/platform/src/react/conversations/dm-participant-display.ts | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/lib/ephemeralChannel.ts` | +0/−5 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/lib/huddleAvailability.test.mjs` | +0/−147 | = | (d) | - | 内容覆盖31%:collaboration/desktop/src/shared/ui/markdown/ChannelDeepLink.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/lib/huddleAvailability.ts` | +0/−40 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/huddle/HuddleIndicator.tsx;内容覆盖33%:client-kit/ts/platform/src/react/search/TopbarSearch.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/lib/memberUtils.test.mjs` | +0/−121 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/lib/memberUtils.ts` | +0/−97 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖8% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/lib/threadFocusLayout.ts` | +1/−51 |  | (b) | DD-74 | client-kit: react/thread/threadFocusLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/lib/threadPanelLayout.ts` | +1/−56 |  | (b) | DD-74 | client-kit: react/thread/threadPanelLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/lib/threadViewModePreference.ts` | +1/−79 |  | (b) | DD-74 | client-kit: react/thread/threadViewModePreference | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/lib/useClassifiedMembers.ts` | +0/−96 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖7% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/observedUnreadNative.test.mjs` | +5/−13 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/observedUnreadNativeRig.mjs` | +0/−15 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/observedUnreadTestHarness.mjs` | +36/−9 |  | (b) | DD-74 | client-kit: react/use-inbox-state | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/openChannelDirectory.test.mjs` | +0/−73 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/openChannelDirectory.ts` | +0/−282 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖55%:collaboration/desktop/src/features/channels/channelReference.ts | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| R | `desktop/src/features/channels/openChannelDirectoryResolver.test.mjs → desktop/src/features/channels/channelReference.test.mjs` | +28/−230 | desktop/src/features/channels/openChannelDirectoryResolver.test.mjs | (d) | - | collaboration/desktop/src/features/channels/channelReference.test.mjs | 测试改名 |
| M | `desktop/src/features/channels/readState/readStateFormat.test.mjs` | +1/−43 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/readState/readStateFormat.ts` | +2/−96 |  | (a) | DD-40 |  | 已读格式随 CollaborationUserState 简化 |
| D | `desktop/src/features/channels/readState/readStateIdentity.ts` | +0/−58 | = | (a) | DD-40 | client-kit/ts/platform/src/react/collaboration-preferences.tsx；内容覆盖14% | 已读 cursor 由 Core CollaborationUserState 持久化 |
| M | `desktop/src/features/channels/readState/readStateManager.test.mjs` | +30/−581 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/readState/readStateManager.ts` | +18/−858 |  | (a) | DD-40 |  | 已读 frontier 同步改为 CollaborationUserState |
| D | `desktop/src/features/channels/readState/readStateSnapshot.ts` | +0/−84 | = | (a) | DD-40 | client-kit/ts/platform/src/react/collaboration-preferences.tsx；内容覆盖12% | 已读 cursor 由 Core CollaborationUserState 持久化 |
| M | `desktop/src/features/channels/readState/readStateStorage.test.mjs` | +4/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/readState/readStateStorage.ts` | +4/−85 |  | (a) | DD-40 |  | 已读本机存储随 CollaborationUserState 简化 |
| M | `desktop/src/features/channels/readState/useReadState.ts` | +10/−45 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/rosterFreshness.ts` | +3/−31 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/ui/AddChannelBotDialog.tsx` | +0/−301 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖9% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/AddChannelBotGenericSection.tsx` | +0/−64 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖23% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/AddChannelBotPersonasSection.tsx` | +0/−181 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；引用:client-kit/ts/platform/src/react/channel-templates/TemplateFormDialog.tsx;内容覆盖14% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/AddChannelBotReuseGuard.tsx` | +0/−45 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖17% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/AddChannelBotTeamsSection.tsx` | +0/−186 | = | (c) | DD-131 | 内容覆盖16% | 向频道添加 Agent Team：DD-131(1) 定为逐个 `agent.installation.create`，待实现 |
| D | `desktop/src/features/channels/ui/AddMemberSearchResultRow.tsx` | +0/−98 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-members.tsx;内容覆盖49%:client-kit/ts/platform/src/react/channel-members.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/AgentSessionThreadPanel.tsx` | +0/−594 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-transcript/AgentSessionPanel.tsx;内容覆盖41%:client-kit/ts/platform/src/react/agent-transcript/AgentSessionPanel.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/BotActivityBar.tsx` | +0/−279 | = | (c) | DD-74、DD-119、REQ-24、DD-74 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-activity/BotActivityBar.tsx;内容覆盖68%:client-kit/ts/platform/src/react/agent-activity/BotActivityBar.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelBrowserDialog.tsx` | +0/−838 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-browser/ChannelBrowserDialog.tsx;内容覆盖80%:client-kit/ts/platform/src/react/channel-browser/ChannelBrowserDialog.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelCanvas.tsx` | +0/−151 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-canvas.tsx;内容覆盖39%:client-kit/ts/platform/src/react/channel-canvas.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelComposerActivityAccessory.tsx` | +0/−70 | = | (c) | DD-74、DD-119、REQ-24、DD-74 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-activity/ChannelComposerActivityAccessory.tsx;内容覆盖70%:client-kit/ts/platform/src/react/agent-activity/ChannelComposerActivityAccessory.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/ChannelGlyph.tsx` | +1/−29 |  | (b) | DD-74 | client-kit: react/channel-glyph | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/ChannelManagementAuxiliaryPanel.tsx` | +0/−71 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖62%:collaboration/desktop/src/features/channels/ui/ChannelPane.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelManagementModerationActions.tsx` | +0/−250 | = | (b) | DD-125(2) | client-kit/ts/platform/src/react/moderation/；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖9% | 频道管理面板中的审核动作由共享审核模块承载 |
| D | `desktop/src/features/channels/ui/ChannelManagementSheet.tsx` | +0/−994 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖26% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelManagementSheetRows.test.mjs` | +0/−70 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/ChannelManagementSheetRows.tsx` | +0/−493 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-canvas.tsx;内容覆盖57%:client-kit/ts/platform/src/react/channel-management-sheet.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelMemberAvatarStack.tsx` | +0/−76 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖47%:client-kit/ts/platform/src/react/channel-management-sheet.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelMemberInviteCard.tsx` | +0/−380 | = | (c) | - | 内容覆盖18% | 频道内“邀请成员”卡片未恢复 |
| D | `desktop/src/features/channels/ui/ChannelMembersBar.tsx` | +0/−293 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-members.tsx;内容覆盖25% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/ChannelPane.helpers.test.mjs` | +180/−54 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/ui/ChannelPane.helpers.ts` | +1/−103 |  | (a) | DD-125(5) |  | Welcome 频道引导三卡移除（其余空频道动作卡待核） |
| M | `desktop/src/features/channels/ui/ChannelPane.tsx` | +317/−645 |  | (b) | DD-74 | client-kit: react/context, react/conversations/dm-participant-display, react/messages | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/ChannelPane.types.ts` | +8/−101 |  | (b) | DD-74 | client-kit: react/messages/typingState, react/thread | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/ChannelPermissionsSettings.tsx` | +0/−111 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖88%:client-kit/ts/platform/src/react/channel-permissions-settings.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/ChannelScreen.tsx` | +192/−635 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/ChannelScreen.types.ts` | +1/−15 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/ChannelScreenHeader.tsx` | +90/−259 |  | (b) | DD-74 | client-kit: i18n, react/channel-management-sheet, react/channel-members | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/ChannelScreenLazyViews.ts` | +0/−10 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/ui/ChannelScreenLoadingFallback.tsx` | +0/−14 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖0% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/ChannelTypePicker.tsx` | +0/−124 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-type-settings.tsx;内容覆盖32%:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelTypeSettings.tsx` | +0/−232 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖28% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/ChannelWorkflowsSection.tsx` | +0/−77 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖30%:client-kit/ts/platform/src/react/channel-management-sheet.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/EditRespondToDialog.tsx` | +0/−113 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-activity/EditRespondToDialog.tsx;内容覆盖34%:client-kit/ts/platform/src/react/agent-activity/EditRespondToDialog.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/FocusThreadDrawer.tsx` | +1/−315 |  | (b) | DD-74 | client-kit: react/thread/FocusThreadDrawer | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/ForumChannelContent.tsx` | +0/−130 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖31%:collaboration/desktop/src/features/channels/ui/ChannelScreen.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/GuardedChannelPane.tsx` | +0/−9 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖0% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/IdleAuxiliaryPanel.tsx` | +0/−82 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/messages/thread/IdleAuxiliaryPanel.tsx;内容覆盖97%:client-kit/ts/platform/src/react/messages/thread/IdleAuxiliaryPanel.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/MembersSidebar.tsx` | +0/−925 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-members.tsx;内容覆盖15% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/MembersSidebarAgentControls.tsx` | +0/−78 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-activity/MembersSidebarAgentControls.tsx;内容覆盖97%:client-kit/ts/platform/src/react/agent-activity/MembersSidebarAgentControls.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/MembersSidebarMemberCard.tsx` | +0/−542 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/channel-members.tsx;内容覆盖21% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/QuickBotBar.tsx` | +0/−98 | = | (c) | - | 内容覆盖11% | 频道快捷 Agent 栏（拖放 Agent 进频道）未恢复 |
| M | `desktop/src/features/channels/ui/RightAuxiliaryPane.tsx` | +1/−77 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/ThreadPanelSurface.tsx` | +11/−43 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/ThreadViewModeToggle.tsx` | +1/−83 |  | (b) | DD-74 | client-kit: react/thread/ThreadViewModeToggle | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/WelcomeAgentCreateDialog.tsx` | +0/−102 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖29% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/channels/ui/WelcomeComposerBanner.tsx` | +0/−464 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖15% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/channels/ui/agentSessionScrollIds.test.mjs` | +0/−546 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/agentSessionSelection.test.mjs` | +0/−44 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/agentSessionSelection.ts` | +0/−96 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖19% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/channelFormStyles.ts` | +0/−5 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/roles.tsx;内容覆盖25% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/channelSearchKeys.ts` | +0/−5 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/ui/searchTargetForwarding.tsx` | +0/−20 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖0% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/unknownRelayAgentStatus.test.mjs` | +0/−35 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/useChannelActivityTyping.test.mjs` | +0/−158 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/useChannelActivityTyping.ts` | +0/−204 | = | (c) | DD-74、DD-119、REQ-24、DD-74 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/agent-activity/useChannelAgentActivity.ts;内容覆盖7% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/channels/ui/useChannelAgentSessions.ts` | +0/−337 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖22% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/ui/useChannelIntro.tsx` | +6/−130 |  | (a) | DD-125(5) |  | Welcome 频道引导三卡移除（其余空频道动作卡待核） |
| M | `desktop/src/features/channels/ui/useChannelOpenReadState.ts` | +9/−0 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/useChannelPaneMessages.ts` | +5/−43 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/useChannelPanelHistoryState.ts` | +3/−72 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/useChannelProfilePanel.ts` | +4/−29 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/useChannelRouteTarget.ts` | +9/−66 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/useChannelTargetReset.ts` | +0/−4 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/ui/useChannelUnreadState.ts` | +54/−36 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/ui/useEffectiveRuntimes.ts` | +0/−51 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖0% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| M | `desktop/src/features/channels/ui/useFocusDrawerPresence.ts` | +1/−33 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/useHuddleChannelMessages.ts` | +0/−78 | = | (c) | DD-125(3) | 内容覆盖18% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/channels/ui/useHuddleReadMarker.ts` | +0/−89 | = | (c) | DD-125(3) | 内容覆盖29% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/channels/ui/useHuddleThreadIsolation.test.mjs` | +0/−34 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/useHuddleThreadIsolation.ts` | +0/−47 | = | (c) | DD-125(3) | 内容覆盖13% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/channels/ui/useInChannelPersonaIds.ts` | +0/−38 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖29% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/useMembersSidebarActions.ts` | +0/−373 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖4% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/useMembersSidebarModeration.ts` | +0/−114 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/moderation/useMembersSidebarModeration.ts;内容覆盖6% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/useMessageProfiles.ts` | +11/−50 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/ui/useNavigationGuard.ts` | +0/−10 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖25% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/usePrepareDmSendChannel.ts` | +0/−55 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖20% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/ui/useQuickBotDrop.ts` | +0/−71 | = | (c) | - | 内容覆盖0% | 频道快捷 Agent 栏（拖放 Agent 进频道）未恢复 |
| D | `desktop/src/features/channels/ui/useReusableAgentDetection.ts` | +0/−66 | = | (a) | DD-26、DD-25、DD-122 | client-kit/ts/platform/src/react/agents.tsx（InstallationCreate）；client-kit/ts/platform/src/react/channel-members.tsx；内容覆盖8% | 频道“添加 bot”本机 provider/persona 现场创建与复用守卫，改为与 Agents 页相同的 InstallationCreate |
| D | `desktop/src/features/channels/ui/useRoutedMessageEdit.ts` | +0/−123 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；引用:client-kit/ts/platform/src/react/messages/thread/useChannelMessageEdit.ts;内容覆盖86%:client-kit/ts/platform/src/react/messages/thread/useRoutedMessageEdit.ts | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/ui/useSearchHighlightProps.ts` | +1/−18 |  | (b) | DD-74 | client-kit: react/search/useSearchHighlightProps | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/channels/ui/useThreadViewModeSwitch.ts` | +1/−136 |  | (b) | DD-74 | client-kit: react/thread/useThreadViewModeSwitch | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/ui/useWelcomeComposerBanner.ts` | +0/−114 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖6% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/channels/ui/useWelcomeInitialUnreadSuppression.test.mjs` | +0/−52 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/ui/useWelcomeInitialUnreadSuppression.ts` | +0/−110 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖17% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| M | `desktop/src/features/channels/unreadChannelCounts.ts` | +2/−16 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/unreadReadMarker.test.mjs` | +1/−38 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/useActiveChannelHeader.ts` | +43/−92 |  | (b) | DD-74 | client-kit: react/conversations/dm-participant-display, react/new-message | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/useCanAddChannelMembers.ts` | +0/−44 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖38%:collaboration/desktop/src/app/routes/index.tsx | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/channels/useChannelPaneHandlers.ts` | +14/−147 |  | (b) | DD-74 | client-kit/ts/platform/src/react/messages/thread/useChannelMessageEdit.ts | 编辑/删除/回应处理迁入共享线程编辑钩子（待核） |
| D | `desktop/src/features/channels/useDmResurfaceBatching.test.mjs` | +0/−278 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/src/features/channels/useDmResurfaceFromMessages.ts` | +0/−141 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖9% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/channels/useHiddenDmIds.ts` | +0/−62 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖19% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/useLiveChannelUpdates.test.mjs` | +33/−8 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/useLiveChannelUpdates.ts` | +19/−86 |  | 待定 | DD-75、DD-80、DD-40 |  | 原地删减较多（+19/-86），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src/features/channels/useMessageEventProfilePubkeys.ts` | +0/−2 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/channels/useMessageOwnerProfiles.ts` | +0/−22 | = | (b) | DD-74、DD-119 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/channel-management-sheet.tsx；内容覆盖0% | 频道页/成员/管理面板共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/channels/useThreadTargetSync.ts` | +9/−11 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/channels/useUnreadChannels.test.mjs` | +0/−60 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/channels/useUnreadChannels.ts` | +115/−70 |  | (b) | DD-74 | client-kit: inbox, react/use-inbox-state | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/channels/useWelcomeAgentCreate.ts` | +0/−88 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖22% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |

### Desktop features/chat（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/chat/ui/ChatHeader.tsx` | +0/−195 | desktop/src/features/chat | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/messages/chat-header.tsx;内容覆盖31%:client-kit/ts/platform/src/react/messages/chat-header.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/communities（39）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/communities/addCommunityPrefill.ts` | +0/−64 | desktop/src/features/communities | (b) | - | 内容覆盖30%:client-kit/ts/platform/src/conversationDensityPreference.ts | 有替代实现证据 |
| D | `desktop/src/features/communities/applyCommunitiesOrder.test.mjs` | +0/−110 | desktop/src/features/communities | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityIconCache.test.mjs` | +0/−42 | desktop/src/features/communities | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityIconCache.ts` | +0/−60 | desktop/src/features/communities | (c) | - | 内容覆盖4% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/communityMarkRead.test.mjs` | +0/−192 | desktop/src/features/communities | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityMarkRead.ts` | +0/−141 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖4% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/communityNavigationStorage.test.mjs` | +0/−100 | desktop/src/features/communities | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityNavigationStorage.ts` | +0/−111 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖10% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/communityStorage.test.mjs` | +0/−134 | desktop/src/features/communities | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityStorage.ts` | +0/−255 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖5% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/communityUnreadObserver.test.mjs` | +0/−921 | desktop/src/features/communities | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/communityUnreadObserver.ts` | +0/−387 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖12% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/hostedCommunityApi.test.mjs` | +0/−98 | desktop/src/features/communities | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/hostedCommunityApi.ts` | +0/−215 | desktop/src/features/communities | (a) | DD-125(5)、DD-96 | 内容覆盖2% | Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 |
| D | `desktop/src/features/communities/leaveCommunity.test.mjs` | +0/−175 | desktop/src/features/communities | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/leaveCommunity.ts` | +0/−88 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖5% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/legacyCommunityStorage.test.mjs` | +0/−153 | desktop/src/features/communities | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/legacyCommunityStorage.ts` | +0/−141 | desktop/src/features/communities | (a) | DD-40 | 内容覆盖5% | 旧版本机存储迁移；偏好权威改为 CollaborationUserState |
| D | `desktop/src/features/communities/lib/downscaleIcon.ts` | +0/−37 | desktop/src/features/communities | (c) | - | 内容覆盖12% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/relayProbe.test.mjs` | +0/−92 | desktop/src/features/communities | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/relayProbe.ts` | +0/−108 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖17% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/resolveCommunityRemoval.test.mjs` | +0/−28 | desktop/src/features/communities | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/resolveCommunityUpdateResult.test.mjs` | +0/−107 | desktop/src/features/communities | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/communities/types.ts` | +0/−27 | desktop/src/features/communities | (b) | - | 内容覆盖100%:collaboration/desktop/src/features/platform/activeCommunity.tsx | 有替代实现证据 |
| D | `desktop/src/features/communities/ui/AddCommunityDialog.tsx` | +0/−198 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖17% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/ui/CommunityApplyErrorScreen.tsx` | +0/−51 | desktop/src/features/communities | (b) | - | 内容覆盖44%:collaboration/desktop/src/features/platform/DeviceIdentityGate.tsx | 有替代实现证据 |
| D | `desktop/src/features/communities/ui/CommunityChangeOverlay.tsx` | +0/−99 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖25% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/ui/CommunityEditForm.tsx` | +0/−362 | desktop/src/features/communities | (c) | - | 内容覆盖14% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/ui/CommunityIconSettingsCard.tsx` | +0/−121 | desktop/src/features/communities | (c) | - | 内容覆盖5% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/ui/CommunitySwitcher.tsx` | +0/−465 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖12% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/ui/EditCommunityDialog.tsx` | +0/−239 | desktop/src/features/communities | (c) | - | 内容覆盖17% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/ui/HostedCommunityCreateFlow.tsx` | +0/−485 | desktop/src/features/communities | (a) | DD-125(5)、DD-96 | 内容覆盖9% | Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 |
| D | `desktop/src/features/communities/ui/HostedCommunityOnboarding.tsx` | +0/−809 | desktop/src/features/communities | (a) | DD-125(5)、DD-96 | 内容覆盖6% | Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 |
| D | `desktop/src/features/communities/ui/WelcomeSetup.tsx` | +0/−332 | desktop/src/features/communities | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖4% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/communities/useCommunities.tsx` | +0/−339 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖1% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/useCommunityIcons.ts` | +0/−68 | desktop/src/features/communities | (c) | - | 内容覆盖7% | 社区名称/图标/社区主题编辑与同步：Community 元数据只由 CONTROL 写（DD-80），但没有对应受治理动作也没有排除裁定，需新 DD |
| D | `desktop/src/features/communities/useCommunityInit.ts` | +0/−392 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖22% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/useCommunityUnread.ts` | +0/−182 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖9% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/communities/useNestNotifications.ts` | +0/−46 | desktop/src/features/communities | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖0% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |

### Desktop features/community-members（11）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/community-members/hooks.ts` | +0/−161 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；内容覆盖15% | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/lib/joinAlerts.test.mjs` | +0/−265 | desktop/src/features/community-members | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/features/community-members/lib/joinAlerts.ts` | +0/−227 | desktop/src/features/community-members | (c) | - | 内容覆盖6% | 新成员加入提醒未恢复 |
| D | `desktop/src/features/community-members/ui/AddMemberDialog.tsx` | +0/−490 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；内容覆盖25% | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/ui/CommunityInviteDialog.tsx` | +0/−71 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；引用:client-kit/ts/platform/src/react/community-members/CommunityInviteDialog.tsx;内容覆盖39%:client-kit/ts/platform/src/react/community-members/CommunityInviteDialog.tsx | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/ui/CommunityMembersCard.tsx` | +0/−289 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；内容覆盖20% | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx` | +0/−393 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；引用:client-kit/ts/platform/src/react/community-members/CommunityMembersSettingsCard.tsx;内容覆盖37%:client-kit/ts/platform/src/react/community-members/CommunityMembersSettingsCard.tsx | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/ui/ConfirmRemoveDialog.tsx` | +0/−92 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；内容覆盖25% | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/ui/InviteLinkSection.tsx` | +0/−284 | desktop/src/features/community-members | (b) | DD-74、DD-83 | client-kit/ts/platform/src/react/community-members/；引用:client-kit/ts/platform/src/react/community-members/InviteLinkSection.tsx;内容覆盖35%:client-kit/ts/platform/src/react/community-members/InviteLinkSection.tsx | 社区成员设置共享迁移 |
| D | `desktop/src/features/community-members/useCommunityJoinAlerts.test.mjs` | +0/−2237 | desktop/src/features/community-members | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/community-members/useCommunityJoinAlerts.ts` | +0/−538 | desktop/src/features/community-members | (c) | - | 内容覆盖6% | 新成员加入提醒未恢复 |

### Desktop features/custom-emoji（7）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/custom-emoji/emojiMartCategory.ts` | +0/−24 | desktop/src/features/custom-emoji | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/custom-emoji/emojiMartCategory.ts;内容覆盖67%:client-kit/ts/platform/src/react/custom-emoji/emojiMartCategory.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/custom-emoji/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/custom-emoji | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/custom-emoji/hooks.ts` | +0/−151 | desktop/src/features/custom-emoji | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖14% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/custom-emoji/ui/CustomEmojiSettingsCard.tsx` | +0/−343 | desktop/src/features/custom-emoji | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/custom-emoji/CustomEmojiSettingsCard.tsx;内容覆盖71%:client-kit/ts/platform/src/react/custom-emoji/CustomEmojiSettingsCard.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/custom-emoji/ui/EmojiPicker.tsx` | +0/−130 | desktop/src/features/custom-emoji | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/custom-emoji/EmojiPicker.tsx;内容覆盖94%:client-kit/ts/platform/src/react/custom-emoji/EmojiPicker.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/custom-emoji/ui/emojiMartPrewarm.test.mjs` | +0/−50 | desktop/src/features/custom-emoji | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/custom-emoji/ui/emojiMartPrewarm.ts` | +0/−28 | desktop/src/features/custom-emoji | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/custom-emoji/emojiMartPrewarm.ts;内容覆盖100%:client-kit/ts/platform/src/react/custom-emoji/emojiMartPrewarm.ts | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/forum（17）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/forum/focusRefetchPolicy.test.mjs` | +0/−65 | = | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/forum/hooks.ts` | +0/−207 | = | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖33%:collaboration/desktop/src/features/messages/hooks.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/lib/time.ts` | +0/−25 | desktop/src/features/forum/lib | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖11% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/DeleteActionMenu.tsx` | +0/−53 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖44%:client-kit/ts/platform/src/react/community-members/CommunityMembersSettingsCard.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/DeleteConfirmDialog.tsx` | +0/−48 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖15% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/ForumComposer.lifecycle.test.mjs` | +0/−578 | desktop/src/features/forum/ui | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/forum/ui/ForumComposer.tsx` | +0/−786 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/forum/ForumComposerSurface.tsx;内容覆盖40%:collaboration/desktop/src/features/messages/ui/MessageComposer.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/ForumComposer.types.ts` | +0/−37 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖73%:collaboration/desktop/src/features/messages/ui/MessageComposer.types.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/ForumComposerAutocompletes.tsx` | +0/−53 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖38%:collaboration/desktop/src/features/messages/ui/MessageComposerAutocompletes.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/ForumComposerCompactLayout.tsx` | +0/−59 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/forum/ForumComposerCompactLayout.tsx;内容覆盖21% | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/ForumComposerMediaStatus.tsx` | +0/−78 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖38%:collaboration/desktop/src/features/messages/ui/MessageComposer.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/forum/ui/ForumPostCard.tsx` | +0/−158 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖23% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/ForumThreadPanel.tsx` | +0/−348 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖24% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/ForumView.tsx` | +0/−266 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖18% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/useCompactComposerInteractions.ts` | +0/−40 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖10% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/useForumDraftRecovery.ts` | +0/−94 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖25% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/forum/ui/useForumMentionPreparation.ts` | +0/−186 | desktop/src/features/forum/ui | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖16% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |

### Desktop features/gifs（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/gifs/api.test.mjs` | +0/−179 | desktop/src/features/gifs | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/gifs/api.ts` | +0/−185 | desktop/src/features/gifs | (c) | DD-74、DD-125、REQ-24、DD-74 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/gifs/ComposerGifAttachments.tsx;内容覆盖2% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/gifs/relay.ts` | +0/−142 | desktop/src/features/gifs | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖9% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/gifs/ui/KlipyGifPicker.tsx` | +0/−161 | desktop/src/features/gifs | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/gifs/KlipyGifPicker.tsx;内容覆盖41%:client-kit/ts/platform/src/react/gifs/KlipyGifPicker.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/home（39）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/home/hiddenDmInboxAction.test.mjs` | +0/−141 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/home/hiddenDmInboxAction.ts` | +0/−76 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖20% | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/hooks.ts` | +21/−7 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/home/lib/homeMessageCapabilities.ts` | +10/−18 |  | (b) | DD-74 | client-kit: i18n | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/home/lib/homePaneLayout.ts` | +0/−72 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖100%:client-kit/ts/platform/src/react/inbox-view.tsx | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/lib/inbox.test.mjs` | +263/−102 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/home/lib/inbox.ts` | +49/−421 |  | (b) | DD-74 | client-kit: i18n, inbox, react/inbox-surface | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/home/lib/inboxListRows.test.mjs` | +0/−106 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/home/lib/inboxListRows.ts` | +0/−82 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖81%:client-kit/ts/platform/src/react/reminders/lib/inboxListRows.ts | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/lib/inboxSelection.test.mjs` | +0/−53 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/home/lib/inboxSelection.ts` | +0/−21 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖88%:client-kit/ts/platform/src/react/inbox-view.tsx | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/lib/inboxViewHelpers.test.mjs` | +39/−219 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/home/lib/inboxViewHelpers.ts` | +28/−89 |  | (b) | DD-74 | client-kit: inbox | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/home/lib/projectInbox.test.mjs` | +0/−245 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/home/lib/projectInbox.ts` | +0/−102 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖20% | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/ui/FeedSection.tsx` | +0/−272 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖19% | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/ui/HomeLoadingState.tsx` | +1/−116 |  | (b) | DD-74 | client-kit: react/inbox-surface | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/home/ui/HomeMembersSidebarOverlay.tsx` | +0/−37 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖46%:client-kit/ts/platform/src/react/conversations/dm-participant-display.ts | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/ui/HomePersonalInboxDetail.tsx` | +0/−45 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖23% | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/ui/HomeScreen.tsx` | +9/−22 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/home/ui/HomeView.tsx` | +478/−800 |  | (b) | DD-74 | client-kit: inbox, react/context, react/inbox-view | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/ui/InboxDetailPane.tsx` | +137/−607 |  | (b) | DD-74 | client-kit: react/context, react/inbox-detail-messages, react/inbox-surface | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/ui/InboxFilterMenu.tsx` | +1/−107 |  | (b) | DD-74 | client-kit: react/inbox-surface | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/ui/InboxListPane.tsx` | +28/−804 |  | (b) | DD-74 | client-kit: i18n, react/inbox-list-pane, react/video-review | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/ui/InboxMessageRow.tsx` | +33/−287 |  | (b) | DD-74 | client-kit: react/inbox-surface, react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/home/ui/ProjectInboxDetail.tsx` | +0/−132 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖14% | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/ui/ProjectInboxDetailPane.tsx` | +0/−160 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；引用:client-kit/ts/platform/src/react/projects/ProjectInboxDetail.tsx;内容覆盖26% | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/ui/RecentNotesSection.tsx` | +0/−98 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖34%:client-kit/ts/platform/src/react/pulse/ui/NoteCard.tsx | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/ui/inboxReopenNavigation.test.mjs` | +0/−794 | = | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `desktop/src/features/home/useHiddenDmInboxNavigation.ts` | +0/−151 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖15% | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/useHomeDrafts.ts` | +8/−33 |  | (b) | DD-74 | client-kit: react/inbox-surface | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/useHomeInboxAutoSelection.ts` | +1/−73 |  | (b) | DD-74 | client-kit: react/use-inbox-auto-selection | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/useHomeInboxContextMessages.ts` | +3/−35 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/home/useHomePersonalInbox.ts` | +0/−90 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖14% | Home/Inbox 共享迁移 |
| D | `desktop/src/features/home/useInboxEditMessage.ts` | +0/−36 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；内容覆盖19% | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/useInboxSelectionAnchor.ts` | +26/−369 |  | (b) | DD-74 | client-kit: react/use-inbox-selection-anchor | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/home/useInboxThreadContext.ts` | +42/−149 |  | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-surface.tsx | Inbox 线程上下文补水迁入共享 Inbox（待核） |
| D | `desktop/src/features/home/useOwnedAgentPubkeys.ts` | +0/−17 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/inbox-surface.tsx；引用:collaboration/desktop/src/features/home/useOwnedAgentActivity.ts;内容覆盖33%:collaboration/desktop/src/features/messages/lib/formatTimelineMessages.ts | Home/Inbox 共享迁移 |
| M | `desktop/src/features/home/useResizableInboxListWidth.ts` | +1/−97 |  | (b) | DD-74 | client-kit: react/use-resizable-inbox-list-width | 原位文件改为消费共享主体（宿主适配层） |

### Desktop features/huddle（38）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/huddle/HuddleContext.tsx` | +0/−977 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖35%:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/HuddleContext.types.ts` | +0/−50 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖79%:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/HuddlePresenceContext.test.mjs` | +0/−26 | desktop/src/features/huddle | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/HuddlePresenceContext.tsx` | +0/−85 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖8% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/AddAgentDialog.tsx` | +0/−206 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24、DD-74 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/AddAgentDialog.tsx;内容覆盖14% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：原 Huddle 界面迁入共享 client-kit huddle，仅 Web 宿主消费；Desktop 无 Huddle 宿主（见 c 类 Desktop Huddle） |
| D | `desktop/src/features/huddle/components/AgentVoiceMenu.tsx` | +0/−186 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖23% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/HuddleAttachment.tsx` | +0/−312 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/huddle.ts;内容覆盖28% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/components/HuddleBar.tsx` | +0/−895 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24、DD-74 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleBar.tsx;内容覆盖22% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：原 Huddle 界面迁入共享 client-kit huddle，仅 Web 宿主消费；Desktop 无 Huddle 宿主（见 c 类 Desktop Huddle） |
| D | `desktop/src/features/huddle/components/HuddleIndicator.tsx` | +0/−379 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/huddle.ts;内容覆盖24% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/components/HuddleProfileControl.tsx` | +0/−174 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖13% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/HuddleRoomHeader.tsx` | +0/−134 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖18% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/HuddleStartingView.tsx` | +0/−18 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖29% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/HuddleTranscriptIntro.tsx` | +0/−22 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖22% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/components/MicControls.tsx` | +0/−505 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24、DD-74 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/MicControls.tsx;内容覆盖42%:client-kit/ts/platform/src/react/huddle/MicControls.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：原 Huddle 界面迁入共享 client-kit huddle，仅 Web 宿主消费；Desktop 无 Huddle 宿主（见 c 类 Desktop Huddle） |
| D | `desktop/src/features/huddle/components/ParticipantList.tsx` | +0/−490 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24、DD-74 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/ParticipantList.tsx;内容覆盖22% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：原 Huddle 界面迁入共享 client-kit huddle，仅 Web 宿主消费；Desktop 无 Huddle 宿主（见 c 类 Desktop Huddle） |
| D | `desktop/src/features/huddle/hooks/useHuddleParticipantRoster.test.mjs` | +0/−376 | desktop/src/features/huddle | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/hooks/useHuddleParticipantRoster.ts` | +0/−393 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/queries.ts;内容覆盖7% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/index.ts` | +0/−15 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/lib/audioWorklet.ts` | +0/−146 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/host.tsx;内容覆盖13% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/huddleCardState.test.mjs` | +0/−29 | desktop/src/features/huddle | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/huddleCardState.ts` | +0/−9 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/huddle.ts;内容覆盖50%:client-kit/ts/platform/src/huddle.ts | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/huddleChannelName.test.mjs` | +0/−97 | desktop/src/features/huddle | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/huddleChannelName.ts` | +0/−77 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/huddle.ts;内容覆盖31%:client-kit/ts/platform/src/react/conversations/dm-participant-display.ts | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/huddleError.test.mjs` | +0/−46 | desktop/src/features/huddle | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/huddleError.ts` | +0/−37 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/huddle.ts;内容覆盖27% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/huddlePresence.test.mjs` | +0/−823 | desktop/src/features/huddle | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/huddlePresence.ts` | +0/−527 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/lib/huddlePresenceRuntime.test.mjs` | +0/−1640 | desktop/src/features/huddle | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/huddlePresenceRuntime.ts` | +0/−608 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/queries.ts;内容覆盖2% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/huddleWindow.ts` | +0/−23 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖12% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/lib/ttsLiveMessages.test.mjs` | +0/−271 | desktop/src/features/huddle | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/src/features/huddle/lib/ttsLiveMessages.ts` | +0/−208 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/lib/useAudioDevices.ts` | +0/−70 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖53%:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/useHuddlePttState.ts` | +0/−81 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖50%:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/useHuddleSpeakerActivity.ts` | +0/−99 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖24% | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/useMicLevelAnalyser.ts` | +0/−100 | desktop/src/features/huddle | (c) | DD-125(3)、REQ-24 | client-kit/ts/platform/src/react/huddle/；引用:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx;内容覆盖69%:client-kit/ts/platform/src/react/huddle/HuddleContext.tsx | 共享 Huddle 界面已在 Web 恢复，Desktop 宿主无任何 Huddle 接入（Desktop 原生音频链亦未恢复） |
| D | `desktop/src/features/huddle/lib/usePipelineHotstart.ts` | +0/−22 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖17% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src/features/huddle/lib/useTtsSubscription.ts` | +0/−336 | desktop/src/features/huddle | (c) | DD-125(3) | 内容覆盖3% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |

### Desktop features/identity-archive（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/identity-archive/hooks.ts` | +0/−186 | desktop/src/features/identity-archive | (c) | DD-125(5) | 内容覆盖11% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |

### Desktop features/local-archive（12）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/local-archive/agentMetricArchivePreference.ts` | +0/−71 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖18% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/observerArchivePreference.ts` | +0/−85 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖16% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/ui/LocalArchiveSettingsCard.tsx` | +0/−641 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖13% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/ui/localArchiveKinds.test.mjs` | +0/−369 | desktop/src/features/local-archive | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/local-archive/ui/localArchiveKinds.ts` | +0/−252 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖7% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/useAgentMetricArchiveSeed.test.mjs` | +0/−174 | desktop/src/features/local-archive | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/local-archive/useAgentMetricArchiveSeed.ts` | +0/−92 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖19% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/useArchiveAgentMetricsBridge.ts` | +0/−24 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖20% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/useArchiveSync.test.mjs` | +0/−334 | desktop/src/features/local-archive | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/features/local-archive/useArchiveSync.ts` | +0/−96 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖16% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/features/local-archive/useObserverArchiveSeed.test.mjs` | +0/−326 | desktop/src/features/local-archive | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/local-archive/useObserverArchiveSeed.ts` | +0/−120 | desktop/src/features/local-archive | (c) | DD-125(5) | 内容覆盖14% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |

### Desktop features/mesh-compute（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/mesh-compute/classifyModelRef.test.mjs` | +0/−59 | desktop/src/features/mesh-compute | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/mesh-compute/classifyModelRef.ts` | +0/−43 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖0% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/hooks/useMeshDownloadProgress.ts` | +0/−74 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖17% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/hooks/useMeshNodeStatus.ts` | +0/−58 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖19% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/hooks/useMeshServingUsage.ts` | +0/−43 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖22% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/servingUsage.test.mjs` | +0/−86 | desktop/src/features/mesh-compute | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/mesh-compute/servingUsage.ts` | +0/−101 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖3% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/shareToggleState.test.mjs` | +0/−90 | desktop/src/features/mesh-compute | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/mesh-compute/shareToggleState.ts` | +0/−65 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖0% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src/features/mesh-compute/ui/MeshComputeSettingsCard.tsx` | +0/−697 | desktop/src/features/mesh-compute | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖14% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |

### Desktop features/messages（287）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/features/messages/hooks.ts` | +54/−176 |  | (b) | DD-74 | client-kit: transport | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/agentAddressMention.d.mts` | +0/−12 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖14% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/agentAddressMention.mjs` | +0/−39 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖8% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/agentAddressMention.test.mjs` | +0/−30 | = | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/agentMentionRevalidation.test.mjs` | +0/−219 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/agentMentionRevalidation.ts` | +0/−155 | = | (a) | DD-26、DD-121 | client-kit/ts/platform/src/react/messages/AgentMentionStatus.tsx；内容覆盖5% | 提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 |
| D | `desktop/src/features/messages/lib/agentSnapshotClipboard.test.mjs` | +0/−176 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/agentSnapshotClipboard.ts` | +0/−177 | = | (c) | - | 内容覆盖7% | Agent 快照复制（依附快照功能）未恢复 |
| D | `desktop/src/features/messages/lib/applyEditTagOverlay.d.mts` | +0/−17 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖0% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/applyEditTagOverlay.mjs` | +0/−74 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/applyEditTagOverlay.ts;内容覆盖87%:client-kit/ts/platform/src/react/messages/applyEditTagOverlay.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/applyEditTagOverlay.test.mjs` | +0/−288 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/audioAttachment.ts` | +1/−143 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/audioAttachment | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/audioMediaLoadScheduler.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/audioMediaLoadScheduler.ts` | +0/−115 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/audio/audioMediaLoadScheduler.ts;内容覆盖100%:client-kit/ts/platform/src/react/messages/audio/audioMediaLoadScheduler.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/autoPinMentionedAgentsPreference.test.mjs` | +0/−47 | = | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/autoPinMentionedAgentsPreference.ts` | +0/−62 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/autoPinMentionedAgentsPreference.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/lib/autoPinMentionedAgentsPreference.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/auxBackfill.test.mjs` | +0/−180 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/auxBackfill.ts` | +0/−170 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖13% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/backgroundMediaUploadStore.ts` | +0/−11 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/buildMentionCandidates.test.mjs` | +36/−157 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/buildMentionCandidates.ts` | +12/−222 |  | 待定 | - |  | 提及候选去掉 Agent 目录/persona/全局人员搜索合并；Agent 部分属 DD-26，“提及频道外成员”候选是否随 NonMemberMention 一起丢失需核 |
| D | `desktop/src/features/messages/lib/canManageMessage.ts` | +0/−30 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖33%:client-kit/ts/platform/src/react/messages/system/SystemMessageRow.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/canSendToChannel.test.mjs` | +10/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/canSendToChannel.ts` | +16/−7 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/channelLink.ts` | +1/−70 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/channelLink | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/channelWindowResponse.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/channelWindowResponse.ts` | +1/−130 |  | (b) | DD-74 | client-kit: react/forum/channelWindowResponse | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/channelWindowStore.test.mjs` | +0/−59 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/channelWindowStore.ts` | +7/−319 |  | (b) | DD-74 | client-kit: react/forum/channelWindowResponse, react/messages/timeline/channelWindowStore | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/codeBlockExtensions.ts` | +1/−92 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/codeBlockExtensions | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/composerMentionCopy.ts` | +1/−52 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/composerMentionCopy | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/composerMessageLinkNode.test.mjs` | +4/−60 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/composerMessageLinkNode.ts` | +1/−532 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/composerMessageLinkNode | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/customEmojiNode.test.mjs` | +0/−138 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/customEmojiNode.ts` | +0/−276 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/customEmojiNode.ts;内容覆盖97%:client-kit/ts/platform/src/react/composer/features/messages/lib/customEmojiNode.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/dateFormatters.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/dateFormatters.ts` | +1/−106 |  | (b) | DD-74 | client-kit: react/messages/dateFormatters | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/detachedToastScope.ts` | +0/−60 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖0% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/dmThreadAgentMentionError.ts` | +0/−57 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖8% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/draftMentionRefs.test.mjs` | +35/−213 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/draftMentionRefs.ts` | +6/−213 |  | 待定 | - |  | 同上（提及候选） |
| D | `desktop/src/features/messages/lib/editMentionAuthority.test.mjs` | +0/−341 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/effectiveExplicitAgentPubkeys.test.mjs` | +0/−25 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/effectiveExplicitAgentPubkeys.ts` | +0/−19 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖18% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/extractMentionPersonas.ts` | +0/−37 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖12% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/extractMentionPubkeys.ts` | +2/−154 |  | (b) | DD-74 | client-kit: react/pulse/mentions | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/flushMentionDebounce.test.mjs` | +0/−88 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/flushMentionDebounce.ts` | +6/−28 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/formatTimelineMessages.test.mjs` | +59/−623 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/formatTimelineMessages.ts` | +52/−438 |  | (b) | DD-74 | client-kit: react/messages/buildMessageReactions, react/messages/messageEdits | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/getVisibleAgentAddressPubkeys.test.mjs` | +0/−39 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/getVisibleAgentAddressPubkeys.ts` | +0/−26 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖12% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/hasMention.ts` | +1/−5 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/hasMention | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/imetaMediaMarkdown.test.mjs` | +0/−334 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/imetaMediaMarkdown.ts` | +1/−388 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/imetaMediaMarkdown | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/independentThreadPanel.test.mjs` | +12/−124 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/independentThreadPanel.ts` | +12/−39 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/linkEditorFocus.ts` | +1/−14 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/linkEditorFocus | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/linkInteractionExtension.ts` | +1/−166 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/linkInteractionExtension | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/linkPasteTrailingSpace.ts` | +1/−64 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/linkPasteTrailingSpace | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/linkPreviewContent.ts` | +1/−24 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/linkPreviewContent | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/macEmacsTextShortcuts.ts` | +1/−107 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/macEmacsTextShortcuts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/membershipGroupPayload.ts` | +1/−126 |  | (b) | DD-74 | client-kit: react/messages/system/membershipGroupPayload | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/mentionCandidates.test.mjs` | +0/−173 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionCandidates.ts` | +5/−139 |  | 待定 | - |  | 同上（提及候选） |
| M | `desktop/src/features/messages/lib/mentionClipboard.test.mjs` | +16/−27 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionClipboard.ts` | +1/−439 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionClipboard | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/mentionClipboardPaste.ts` | +1/−82 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionClipboardPaste | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/mentionFallbacks.test.mjs` | +0/−224 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionHighlightExtension.test.mjs` | +2/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionHighlightExtension.ts` | +1/−879 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionHighlightExtension | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/mentionIdentityTrust.ts` | +1/−80 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionIdentityTrust | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/mentionMemberPubkeys.ts` | +0/−19 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖11% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/mentionPasteBinding.test.mjs` | +12/−12 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionPasteBinding.ts` | +1/−298 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionPasteBinding | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/mentionRanking.test.mjs` | +25/−224 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionRanking.ts` | +6/−155 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionRanking | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/mentionSuggestionMapping.test.mjs` | +0/−60 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/mentionSuggestionMapping.ts` | +6/−88 |  | 待定 | DD-75、DD-80、DD-40 |  | 原地删减较多（+6/-88），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src/features/messages/lib/mentionTokenSpans.ts` | +1/−122 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/mentionTokenSpans | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageGrouping.ts` | +1/−61 |  | (b) | DD-74 | client-kit: react/messages/messageGrouping | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageLink.ts` | +1/−135 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/messageLink | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageLinkLabel.ts` | +1/−24 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/messageLinkLabel | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageLinkMetadata.test.mjs` | +2/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/messageLinkMetadata.ts` | +1/−29 |  | (b) | DD-74 | client-kit: react/messages/message-link/messageLinkMetadata | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageQueryKeys.ts` | +2/−31 |  | (b) | DD-74 | client-kit: react/messages/messageOrder | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/messageRowEquality.test.mjs` | +15/−44 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/messageRowEquality.ts` | +3/−7 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/messageThreadPanelLayout.ts` | +1/−18 |  | (b) | DD-74 | client-kit: react/thread/messageThreadPanelLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/normalizeMentionClipboard.ts` | +1/−209 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/normalizeMentionClipboard | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/openPopoverLink.ts` | +1/−25 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/openPopoverLink | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/orderMentionPubkeys.test.mjs` | +0/−38 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/orderMentionPubkeys.ts` | +0/−50 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖4% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/lib/parseDiff.ts` | +0/−118 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖95%:client-kit/ts/platform/src/react/messages/diff/parseDiff.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/pastedMentionOccurrences.ts` | +1/−214 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/pastedMentionOccurrences | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/persistentAgentAudience.test.mjs` | +0/−274 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/persistentAgentAudience.ts` | +0/−263 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/persistentAgentAudience.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/lib/persistentAgentAudience.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/plainTextProjection.test.mjs` | +25/−53 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/plainTextProjection.ts` | +1/−290 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/plainTextProjection | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/recentMentionPubkeys.test.mjs` | +0/−114 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/recentMentionPubkeys.ts` | +0/−41 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖13% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/remarkChannelDeepLinks.ts` | +1/−22 |  | (b) | DD-74 | client-kit: react/messages/channel-link/remarkChannelDeepLinks | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/remarkEntityLinks.test.mjs` | +0/−36 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/remarkEntityLinks.ts` | +0/−22 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖100%:client-kit/ts/platform/src/react/messages/remarkEntityLinks.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/remarkMessageLinks.ts` | +1/−56 |  | (b) | DD-74 | client-kit: react/messages/channel-link/remarkMessageLinks | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/renderScopedReactions.test.mjs` | +0/−176 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/renderScopedReactions.ts` | +0/−140 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖6% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/resolveLinkAt.ts` | +1/−92 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/resolveLinkAt | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/rowHeightEstimate.ts` | +1/−184 |  | (b) | DD-74 | client-kit: react/messages/timeline/rowHeightEstimate | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/selectionBlockFormatting.test.mjs` | +1/−9 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/selectionBlockFormatting.ts` | +1/−341 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/selectionBlockFormatting | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/sendToChannelSemantics.test.mjs` | +1/−85 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/sendToChannelSemantics.ts` | +3/−53 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/sentFromThread.ts` | +1/−70 |  | (b) | DD-74 | client-kit: react/messages/sentFromThread | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/snapshotSharedBy.test.mjs` | +0/−31 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/snapshotSharedBy.ts` | +0/−18 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖50%:collaboration/desktop/src/features/messages/lib/formatTimelineMessages.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/spoilerFormatting.ts` | +1/−55 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/spoilerFormatting | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/spoilerMark.ts` | +1/−111 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/spoilerMark | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/stripImplicitAgentMentions.test.mjs` | +0/−45 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/stripImplicitAgentMentions.ts` | +0/−15 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/stripImplicitAgentMentions.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/lib/stripImplicitAgentMentions.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/systemEventCopy.ts` | +1/−76 |  | (b) | DD-74 | client-kit: react/messages/system/systemEventCopy | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/threadPanel.test.mjs` | +0/−41 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/threadPanel.ts` | +1/−617 |  | (b) | DD-74 | client-kit: react/thread/threadPanel | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/threadReplyHighlight.ts` | +1/−45 |  | (b) | DD-74 | client-kit: react/thread/threadReplyHighlight | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/threadTreeLayout.ts` | +1/−99 |  | (b) | DD-74 | client-kit: react/messages/threadTreeLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/threading.ts` | +2/−72 |  | (b) | DD-74 | client-kit: react/messages/threading | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/timelineImagePreload.test.mjs` | +0/−11 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/timelineImagePreload.ts` | +0/−5 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/timelineItems.ts` | +1/−311 |  | (b) | DD-74 | client-kit: react/messages/timeline/timelineItems | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/timelineMentionCopy.ts` | +0/−2 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/timelineSnapshot.test.mjs` | +0/−44 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/timelineSnapshot.ts` | +1/−380 |  | (b) | DD-74 | client-kit: react/thread/timelineSnapshot | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/useActiveAgentPubkeys.ts` | +0/−26 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖9% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/lib/useAttachmentEditing.ts` | +1/−53 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useAttachmentEditing | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useChannelLinks.ts` | +8/−215 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useChannelLinks | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useComposerAutofocus.ts` | +2/−54 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useComposerAutofocus | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/useComposerCustomEmoji.ts` | +0/−68 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/useComposerCustomEmoji.ts;内容覆盖95%:client-kit/ts/platform/src/react/composer/features/messages/lib/useComposerCustomEmoji.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/useComposerMessageLinks.ts` | +1/−59 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useComposerMessageLinks | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useComposerSpoilerParticles.ts` | +2/−180 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useComposerSpoilerParticles | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/useDefaultAgentSuggestion.ts` | +0/−50 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖50%:collaboration/desktop/src/features/messages/lib/flushMentionDebounce.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/useDraftMentionRouting.ts` | +2/−21 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/useDrafts.ts` | +5/−679 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useDrafts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useEmojiAutocomplete.ts` | +6/−283 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useEmojiAutocomplete | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useLinkEditor.tsx` | +3/−430 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useLinkEditor | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useMediaUpload.ts` | +3/−27 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/attachmentPreview | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/useMentionSelection.ts` | +0/−40 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖95%:client-kit/ts/platform/src/react/use-mention-selection.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/useMentions.test.mjs` | +0/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/useMentions.ts` | +84/−602 |  | (b) | DD-74 | client-kit: react/context, react/use-mention-selection | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/lib/useMessageEmoji.test.mjs` | +0/−27 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/useMessageEmoji.ts` | +0/−26 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/useMessageEmoji.ts;内容覆盖50%:client-kit/ts/platform/src/react/messages/useMessageEmoji.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/useMessageMentionIdentities.ts` | +0/−43 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖44%:collaboration/desktop/src/features/messages/lib/formatTimelineMessages.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/useRenderScopedReactionHydration.ts` | +0/−49 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖33%:collaboration/desktop/src/features/channels/ui/useChannelRouteTarget.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/useRichTextEditor.ts` | +5/−913 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/useRichTextEditor | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/useVerifyMentionIdentities.test.mjs` | +9/−34 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/useVerifyMentionIdentities.ts` | +1/−6 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/lib/useVoiceNoteRecorder.test.mjs` | +325/−3 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/useVoiceNoteRecorder.ts` | +0/−264 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/useVoiceNoteRecorder.ts;内容覆盖96%:client-kit/ts/platform/src/react/composer/features/messages/lib/useVoiceNoteRecorder.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/lib/videoReviewContext.test.mjs` | +14/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/lib/videoReviewContext.ts` | +1/−330 |  | (b) | DD-74 | client-kit: react/video-review/videoReviewContext | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/virtualizedTimelineItems.ts` | +1/−117 |  | (b) | DD-74 | client-kit: react/messages/timeline/virtualizedTimelineItems | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/lib/voiceNoteWav.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/lib/voiceNoteWav.ts` | +0/−67 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/lib/voiceNoteWav.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/lib/voiceNoteWav.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/lib/waveMessage.ts` | +0/−26 | = | (c) | DD-125(3) | 内容覆盖0% | Wave（带原标记的私聊 kind:9）DD-125(3) 写明沿私聊发布保留；共享主体未见 Wave 消费者 |
| M | `desktop/src/features/messages/types.ts` | +1/−52 |  | (b) | DD-74 | client-kit: react/messages/types | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/AudioMessageAttachment.tsx` | +25/−589 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/audioAttachment, react/messages/audio/AudioMessageAttachment | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/BotIdenticon.tsx` | +0/−35 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖0% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/ui/ChannelAutocomplete.tsx` | +2/−88 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/ChannelAutocomplete | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/ChannelIntroBlock.tsx` | +1/−128 |  | (b) | DD-74 | client-kit: react/messages/timeline/ChannelIntroBlock | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/ComposerActivityAccessory.tsx` | +0/−47 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖100%:client-kit/ts/platform/src/react/messages/ComposerActivityAccessory.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/ComposerAddressControls.test.mjs` | +0/−142 | = | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/ComposerAddressControls.tsx` | +0/−358 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/ComposerControls.tsx;内容覆盖94%:client-kit/ts/platform/src/react/composer/features/messages/ui/ComposerControls.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/ComposerAttachments.tsx` | +6/−932 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/ComposerAttachments | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/ComposerDockBackdrop.tsx` | +1/−58 |  | (b) | DD-74 | client-kit: react/thread/ComposerDockBackdrop | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/ComposerDockToolbar.tsx` | +1/−30 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/ComposerDockToolbar | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/ComposerEmojiPicker.tsx` | +0/−196 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/ComposerEmojiPicker.tsx;内容覆盖23% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/ComposerImageEditor.tsx` | +4/−478 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/ComposerImageEditor | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/ComposerReplyEditBanner.tsx` | +0/−91 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/ComposerReplyBanner.tsx;内容覆盖36%:client-kit/ts/platform/src/react/messages/ComposerReplyBanner.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/DayDivider.tsx` | +1/−32 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/DeleteMessageConfirmDialog.tsx` | +1/−53 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/DiffMessage.tsx` | +0/−157 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖91%:client-kit/ts/platform/src/react/messages/diff/DiffMessage.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/DiffMessageExpanded.tsx` | +0/−88 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖95%:client-kit/ts/platform/src/react/messages/diff/DiffMessageExpanded.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/DiffViewer.css` | +0/−94 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖100%:client-kit/ts/platform/src/react/messages/diff/DiffViewer.css | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/DiffViewer.tsx` | +0/−171 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖96%:client-kit/ts/platform/src/react/messages/diff/DiffViewer.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/DirectMessageIntroAvatarStack.tsx` | +0/−67 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/timeline/DirectMessageIntroAvatarStack.tsx;内容覆盖76%:client-kit/ts/platform/src/react/messages/timeline/DirectMessageIntroAvatarStack.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/DraftDetailPane.tsx` | +9/−263 |  | (b) | DD-74 | client-kit: react/draft-surfaces | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/DraftsPanel.tsx` | +19/−318 |  | (b) | DD-74 | client-kit: i18n, react/draft-surfaces | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/EmojiAutocomplete.tsx` | +2/−116 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/EmojiAutocomplete | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/FormattingToolbar.tsx` | +1/−423 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/FormattingToolbar | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MentionAutocomplete.test.mjs` | +48/−259 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/MentionAutocomplete.tsx` | +2/−456 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/MentionAutocomplete | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageActionBar.tsx` | +9/−655 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/MessageAgentAddressPrefix.tsx` | +0/−85 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖48%:client-kit/ts/platform/src/react/composer/features/messages/ui/useAgentAddressLockPicker.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/MessageAgentOwner.tsx` | +0/−60 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/system/MessageAgentOwner.tsx;内容覆盖92%:client-kit/ts/platform/src/react/messages/system/MessageAgentOwner.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/MessageAuthorWithIndicators.tsx` | +0/−34 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/MessageRowSurface.tsx;内容覆盖18% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/MessageComposer.tsx` | +204/−493 |  | (b) | DD-74 | client-kit: react/composer/MessageComposerSurface, react/composer/features/messages/lib/autoPinMentionedAgentsPreference, react/composer/features/messages/lib/persistentAgentAudience | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageComposer.types.ts` | +12/−51 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/ui/MessageComposerAutocompletes.tsx` | +21/−28 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/ui/MessageComposerDraftImagePersist.test.mjs` | +69/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/MessageComposerToolbar.tsx` | +1/−337 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/MessageComposerToolbar | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageHeader.tsx` | +14/−136 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/MessageReactions.tsx` | +0/−528 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/reactions/MessageReactions.tsx;内容覆盖91%:client-kit/ts/platform/src/react/messages/reactions/MessageReactions.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/MessageRow.tsx` | +33/−898 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageThreadPanel.tsx` | +52/−860 |  | (b) | DD-74 | client-kit: react/thread | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageThreadPanelSkeleton.tsx` | +1/−243 |  | (b) | DD-74 | client-kit: react/thread/MessageThreadPanelSkeleton | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageThreadReplyState.test.mjs` | +3/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/MessageThreadReplyState.tsx` | +1/−127 |  | (b) | DD-74 | client-kit: react/thread/MessageThreadReplyState | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageThreadSummaryRow.tsx` | +5/−305 |  | (b) | DD-74 | client-kit: react/thread/MessageThreadSummaryRow | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/MessageThreadTranscript.tsx` | +0/−79 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖44%:client-kit/ts/platform/src/react/messages/thread/ThreadPanelSurface.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/MessageTimeline.tsx` | +12/−915 |  | (b) | DD-74 | client-kit: react/messages/timeline/MessageTimelineSurface, react/messages/timeline/types | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageTimelineErrorCard.tsx` | +1/−36 |  | (b) | DD-74 | client-kit: react/messages/timeline/MessageTimelineErrorCard | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/MessageTimestamp.tsx` | +1/−75 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/MorphingPlayPauseIcon.tsx` | +0/−48 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/audio/MorphingPlayPauseIcon.tsx;内容覆盖100%:client-kit/ts/platform/src/react/messages/audio/MorphingPlayPauseIcon.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/NewMessageResultRow.tsx` | +0/−155 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖72%:client-kit/ts/platform/src/react/conversations/new-message-result-row.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/NewMessageScreen.tsx` | +0/−627 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/new-message.tsx;内容覆盖64%:client-kit/ts/platform/src/react/new-message.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/NonMemberMentionDialog.tsx` | +0/−117 | = | (c) | DD-119/DD-41 | 内容覆盖19% | 提及非成员时“邀请入频道”对话框未恢复（成员添加链 workspace.member.add 已存在） |
| M | `desktop/src/features/messages/ui/SelectionFormattingTray.tsx` | +1/−270 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/SelectionFormattingTray | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/SentFromThreadLine.tsx` | +19/−28 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/SystemMessageAvatars.tsx` | +0/−220 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/system/SystemMessageAvatars.tsx;内容覆盖99%:client-kit/ts/platform/src/react/messages/system/SystemMessageAvatars.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/SystemMessageRow.test.mjs` | +2/−110 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/SystemMessageRow.tsx` | +11/−960 |  | (b) | DD-74 | client-kit: react/messages/system | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/TimelineMessageList.tsx` | +19/−601 |  | (b) | DD-74 | client-kit: react/messages/timeline/VirtualizedTimelineRows, react/messages/timeline/types | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/TimelineMessageRow.tsx` | +19/−46 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/ui/TimelineRowShell.tsx` | +1/−27 |  | (b) | DD-74 | client-kit: react/messages/timeline/TimelineRowShell | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/TimelineSkeleton.tsx` | +1/−246 |  | (b) | DD-74 | client-kit: react/messages/timeline/TimelineSkeleton | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/TypingIndicatorRow.tsx` | +0/−143 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/TypingIndicatorRow.tsx;内容覆盖87%:client-kit/ts/platform/src/react/messages/TypingIndicatorRow.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/UnreadDivider.tsx` | +1/−20 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/VoiceNoteRecorder.tsx` | +0/−171 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/VoiceNoteRecorder.tsx;内容覆盖92%:client-kit/ts/platform/src/react/composer/features/messages/ui/VoiceNoteRecorder.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/WaveMessageAttachment.tsx` | +0/−96 | = | (c) | DD-125(3) | 内容覆盖31%:client-kit/ts/platform/src/react/composer/features/messages/ui/ComposerAttachments.tsx | Wave（带原标记的私聊 kind:9）DD-125(3) 写明沿私聊发布保留；共享主体未见 Wave 消费者 |
| M | `desktop/src/features/messages/ui/anchoredScrollPolicy.ts` | +1/−71 |  | (b) | DD-74 | client-kit: react/thread/anchoredScrollPolicy | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/composerAgentKeyboard.test.mjs` | +0/−187 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/configNudgeAuthPubkey.test.mjs` | +0/−170 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/configNudgeAuthPubkey.ts` | +0/−34 | = | (a) | DD-26、DD-121 | client-kit/ts/platform/src/react/messages/AgentMentionStatus.tsx；内容覆盖25% | 提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 |
| M | `desktop/src/features/messages/ui/messageTimestampContract.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/persistentAgentAudienceHosts.test.mjs` | +0/−46 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/selectionFormattingTrayEditorDom.ts` | +1/−10 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/selectionFormattingTrayEditorDom | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/submitMessageEdit.test.mjs` | +0/−472 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/submitMessageEdit.ts` | +0/−218 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖18% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/ui/timelineRetention.ts` | +1/−41 |  | (b) | DD-74 | client-kit: react/messages/timeline/timelineRetention | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useAddressMentionPulse.test.mjs` | +0/−50 | = | (d) | - | 内容覆盖45%:collaboration/desktop/src/features/messages/ui/SystemMessageRow.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useAddressMentionPulse.ts` | +0/−44 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useAddressMentionPulse.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/ui/useAddressMentionPulse.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/useAddressedAgentMentionRestore.ts` | +0/−66 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖6% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/ui/useAgentAddressLockPicker.test.mjs` | +0/−1096 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useAgentAddressLockPicker.ts` | +0/−455 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useAgentAddressLockPicker.ts;内容覆盖99%:client-kit/ts/platform/src/react/composer/features/messages/ui/useAgentAddressLockPicker.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/useAlwaysAddressShortcut.ts` | +0/−63 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useAlwaysAddressShortcut.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/ui/useAlwaysAddressShortcut.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/useAnchoredScroll.ts` | +1/−974 |  | (b) | DD-74 | client-kit: react/thread/useAnchoredScroll | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useAutoPinMentionedAgents.ts` | +0/−226 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useAutoPinMentionedAgents.ts;内容覆盖96%:client-kit/ts/platform/src/react/composer/features/messages/ui/useAutoPinMentionedAgents.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/useBufferedTimelineMessages.ts` | +1/−90 |  | (b) | DD-74 | client-kit: react/messages/timeline/useBufferedTimelineMessages | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useCommittedEmptyTimeline.ts` | +1/−35 |  | (b) | DD-74 | client-kit: react/messages/timeline/useCommittedEmptyTimeline | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useComposerAttachmentSpoilers.ts` | +1/−70 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/useComposerAttachmentSpoilers | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useComposerHeightPadding.ts` | +1/−133 |  | (b) | DD-74 | client-kit: react/thread/useComposerHeightPadding | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useComposerLinkPreviews.test.mjs` | +1/−90 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/useComposerLinkPreviews.tsx` | +11/−71 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/messages/ui/useComposerMentionPicker.test.mjs` | +0/−94 | = | (d) | - | 内容覆盖26% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/useComposerMentionPicker.ts` | +32/−69 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/messages/ui/useComposerPasteHandler.ts` | +1/−86 |  | (b) | DD-74 | client-kit: react/composer/features/messages/ui/useComposerPasteHandler | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useComposerVoiceNote.tsx` | +0/−167 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useComposerVoiceNote.tsx;内容覆盖89%:client-kit/ts/platform/src/react/composer/features/messages/ui/useComposerVoiceNote.tsx | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/useDetachedAgentStart.test.mjs` | +0/−842 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useDetachedAgentStart.ts` | +0/−223 | = | (a) | DD-26、DD-121 | client-kit/ts/platform/src/react/messages/AgentMentionStatus.tsx；内容覆盖8% | 提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 |
| M | `desktop/src/features/messages/ui/useDraftPersistSnapshot.ts` | +1/−3 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/stripImplicitAgentMentions | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useEnsureAgentMentionsReady.test.mjs` | +0/−178 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useEnsureAgentMentionsReady.ts` | +0/−163 | = | (a) | DD-26、DD-121 | client-kit/ts/platform/src/react/messages/AgentMentionStatus.tsx；内容覆盖9% | 提及时拉起/确认本机 Agent 进程；Kailo 提及走 agent.invoke 准入并只读回显结论 |
| D | `desktop/src/features/messages/ui/useImplicitAgentMentionProvenance.ts` | +0/−54 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useImplicitAgentMentionProvenance.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/ui/useImplicitAgentMentionProvenance.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/useLoadOlderOnScroll.ts` | +1/−89 |  | (b) | DD-74 | client-kit: react/messages/timeline/useLoadOlderOnScroll | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useMentionSendFlow.authority.test.mjs` | +0/−218 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useMentionSendFlow.cancellation.test.mjs` | +0/−606 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/useMentionSendFlow.helpers.test.mjs` | +114/−29 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/useMentionSendFlow.helpers.ts` | +40/−132 |  | (b) | DD-74 | client-kit: i18n | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useMentionSendFlow.test-support.mjs` | +0/−402 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| M | `desktop/src/features/messages/ui/useMentionSendFlow.ts` | +104/−663 |  | (b) | DD-74 | client-kit: react/new-message, transport | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useMentionSendFlow.types.ts` | +0/−12 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/messages/ui/useNewMessageRecipients.ts` | +0/−330 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖12% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/messages/ui/useNonMemberInvite.ts` | +0/−175 | = | (c) | DD-119/DD-41 | 内容覆盖19% | 提及非成员时“邀请入频道”对话框未恢复（成员添加链 workspace.member.add 已存在） |
| D | `desktop/src/features/messages/ui/useQuickReactionEmojis.test.mjs` | +0/−42 | = | (d) | - | 内容覆盖89%:client-kit/ts/platform/test/reactions.test.tsx | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useQuickReactionEmojis.ts` | +0/−277 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/reactions/useQuickReactionEmojis.ts;内容覆盖91%:client-kit/ts/platform/src/react/messages/reactions/useQuickReactionEmojis.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/messages/ui/useReactionHandler.test.mjs` | +0/−126 | = | (d) | - | 内容覆盖94%:client-kit/ts/platform/test/reactions.test.tsx | 测试/构建/发布文件 |
| D | `desktop/src/features/messages/ui/useReactionHandler.ts` | +0/−183 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/messages/reactions/useReactionHandler.ts;内容覆盖95%:client-kit/ts/platform/src/react/messages/reactions/useReactionHandler.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/useSettleGatedPrependMessages.ts` | +1/−180 |  | (b) | DD-74 | client-kit: react/messages/timeline/useSettleGatedPrependMessages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/messages/ui/useThreadAgentAudience.ts` | +0/−36 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:client-kit/ts/platform/src/react/composer/features/messages/ui/useThreadAgentAudience.ts;内容覆盖100%:client-kit/ts/platform/src/react/composer/features/messages/ui/useThreadAgentAudience.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |
| M | `desktop/src/features/messages/ui/useTimelineRetention.ts` | +1/−81 |  | (b) | DD-74 | client-kit: react/messages/timeline/useTimelineRetention | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useUpwardPaginationWheel.ts` | +1/−60 |  | (b) | DD-74 | client-kit: react/messages/timeline/useUpwardPaginationWheel | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useVirtualizedBottomSettle.ts` | +1/−130 |  | (b) | DD-74 | client-kit: react/messages/timeline/useVirtualizedBottomSettle | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/ui/useVirtualizedViewportResize.ts` | +1/−39 |  | (b) | DD-74 | client-kit: react/thread/useVirtualizedViewportResize | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/useChannelTyping.ts` | +57/−227 |  | (b) | DD-74 | client-kit: react/messages/typingState | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/messages/useIndependentThreadPanel.ts` | +2/−22 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/messages/useLoadMissingAncestors.ts` | +0/−106 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；内容覆盖22% | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/features/messages/useThreadReplies.ts` | +0/−25 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/messages/useTypingBroadcast.ts` | +0/−52 | = | (b) | DD-74 | client-kit/ts/platform/src/react/messages/；client-kit/ts/platform/src/react/composer/；引用:web-client/web/src/platform/ui/useTypingBroadcast.ts;内容覆盖39%:web-client/web/src/platform/ui/useTypingBroadcast.ts | 消息/输入框/回应共享迁移（逐文件证据见覆盖率列） |

### Desktop features/moderation（13）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/moderation/hooks.ts` | +0/−170 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/moderation/hooks.ts;内容覆盖17% | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/lib/moderationDm.test.mjs` | +0/−46 | desktop/src/features/moderation | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/moderation/lib/moderationDm.ts` | +0/−31 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖10% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/moderation/lib/relaySelf.ts` | +0/−11 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖50%:collaboration/desktop/src/shared/api/relaySelf.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/lib/restrictionState.test.mjs` | +0/−41 | desktop/src/features/moderation | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/moderation/lib/restrictionState.ts` | +0/−41 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/moderation.ts;内容覆盖58%:client-kit/ts/platform/src/moderation.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/lib/timeout.test.mjs` | +0/−94 | desktop/src/features/moderation | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/moderation/lib/timeout.ts` | +0/−120 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/moderation.ts;内容覆盖31%:client-kit/ts/platform/src/moderation.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/lib/timeoutStore.ts` | +0/−130 | desktop/src/features/moderation | (c) | DD-74、DD-125、REQ-24、DD-74 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/moderation/timeoutStore.ts;内容覆盖57%:client-kit/ts/platform/src/react/moderation/timeoutStore.ts | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/ui/ComposerTimeoutBanner.tsx` | +0/−34 | desktop/src/features/moderation | (c) | DD-74、DD-125、REQ-24、DD-74 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/moderation/ComposerTimeoutBanner.tsx;内容覆盖33%:client-kit/ts/platform/src/react/moderation/ComposerTimeoutBanner.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/ui/MessageModerationMenuItems.tsx` | +0/−206 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/moderation/MessageModerationMenuItems.tsx;内容覆盖32%:client-kit/ts/platform/src/react/moderation/MessageModerationMenuItems.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/ui/ReportMessageDialog.tsx` | +0/−139 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/moderation.ts;内容覆盖50%:client-kit/ts/platform/src/react/moderation/ReportMessageDialog.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/moderation/ui/TimeoutDurationSubmenu.tsx` | +0/−58 | desktop/src/features/moderation | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖69%:client-kit/ts/platform/src/react/sidebar/channel-group.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/notifications（14）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/features/notifications/hooks.test.mjs` | +9/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/notifications/hooks.ts` | +10/−348 |  | (b) | DD-74 | client-kit: react/notifications | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/notifications/lib/desktop.test.mjs` | +12/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/notifications/lib/desktop.ts` | +3/−0 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/notifications/lib/feed.test.mjs` | +20/−77 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/notifications/lib/feed.ts` | +8/−61 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/notifications/lib/homeBadge.ts` | +3/−17 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/notifications/lib/notificationFormat.test.mjs` | +26/−75 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/notifications/lib/notificationFormat.ts` | +1/−112 |  | (b) | DD-74 | client-kit: react/notifications/notificationFormat | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/notifications/lib/sound.test.mjs` | +0/−68 | = | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| M | `desktop/src/features/notifications/lib/sound.ts` | +1/−185 |  | (b) | DD-74 | client-kit: react/notifications/sound | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/notifications/lib/target.ts` | +1/−1 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/notifications/use-feed-desktop-notifications.ts` | +9/−34 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/notifications/useNotificationSenderName.ts` | +2/−3 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |

### Desktop features/onboarding（71）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/onboarding/assets/harness-logos/claude.png` | +-/−- | desktop/src/features/onboarding/assets | (a) | DD-26 |  | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/src/features/onboarding/communityOnboarding.test.mjs` | +0/−344 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/communityOnboarding.tsx` | +0/−386 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖4% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/devFreshOnboarding.ts` | +0/−16 | = | 待定 | - | 内容覆盖0% | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/onboarding/hooks.ts` | +0/−679 | = | (c) | DD-125(5) | 内容覆盖8% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/lib/encryptedBackup.test.mjs` | +0/−118 | desktop/src/features/onboarding/lib | (d) | - | 内容覆盖87%:collaboration/desktop/src/features/settings/lib/encryptedBackup.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/lib/encryptedBackup.ts` | +0/−135 | desktop/src/features/onboarding/lib | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖84%:collaboration/desktop/src/features/settings/lib/encryptedBackup.ts | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/lib/keyImportInput.test.mjs` | +0/−73 | desktop/src/features/onboarding/lib | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/lib/keyImportInput.ts` | +0/−127 | desktop/src/features/onboarding/lib | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖4% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/machineOnboarding.test.mjs` | +0/−174 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/machineOnboarding.ts` | +0/−258 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖12% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/AvatarStep.tsx` | +0/−436 | = | (c) | DD-125(5) | 内容覆盖13% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/BackupPasswordTimeline.tsx` | +0/−190 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖6% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/BackupStep.tsx` | +0/−458 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖6% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/BackupTestFlow.tsx` | +0/−821 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖52%:collaboration/desktop/src/features/settings/ui/BackupTestFlow.tsx | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/CommunityOnboardingFlow.tsx` | +0/−831 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖11% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/ui/ConnectionMethodSection.tsx` | +0/−70 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖7% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/DefaultConfigStep.tsx` | +0/−458 | = | (a) | DD-125(5)、DD-26 | 内容覆盖5% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/onboarding/ui/DownloadKeyStep.tsx` | +0/−184 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖4% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/EncryptedBackupCreator.tsx` | +0/−825 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖41%:collaboration/desktop/src/features/settings/ui/EncryptedBackupCreator.tsx | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/HarnessMarks.tsx` | +0/−49 | = | (a) | DD-26 | 内容覆盖25% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/onboarding/ui/IdentityKeyHelpDialog.tsx` | +0/−156 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖6% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/IdentityKeyIntroduction.tsx` | +0/−108 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖4% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/IdentityRecoveryPairing.tsx` | +0/−272 | = | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖11% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `desktop/src/features/onboarding/ui/InviteRedeemForm.tsx` | +0/−544 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖6% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/ui/JoinPolicyNotice.tsx` | +0/−108 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖16% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/ui/KeyringLockedScreen.tsx` | +0/−83 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖34%:collaboration/desktop/src/features/platform/DeviceIdentityGate.tsx | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/LandingBees.tsx` | +0/−168 | = | (c) | DD-125(5) | 内容覆盖4% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/MachineOnboardingFlow.tsx` | +0/−654 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖3% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/MembershipDenied.tsx` | +0/−298 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖14% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/ui/NostrKeyImportForm.tsx` | +0/−705 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖23% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| M | `desktop/src/features/onboarding/ui/NsecMaskedDisplay.tsx` | +7/−5 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/onboarding/ui/OnboardingCard.tsx` | +0/−90 | = | (c) | DD-125(5) | 内容覆盖10% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/OnboardingChrome.tsx` | +0/−86 | = | (c) | DD-125(5) | 内容覆盖0% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/OnboardingFlow.tsx` | +0/−642 | = | (c) | DD-125(5) | 内容覆盖4% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/OnboardingFooter.tsx` | +0/−167 | = | (c) | DD-125(5) | 内容覆盖7% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/OnboardingInput.tsx` | +0/−69 | = | (c) | DD-125(5) | 内容覆盖11% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/OnboardingSlideTransition.tsx` | +0/−74 | = | (c) | DD-125(5) | 内容覆盖17% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/PendingInviteGate.tsx` | +0/−55 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖35%:collaboration/desktop/src/features/platform/DeviceIdentityGate.tsx | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/ui/ProfileStep.tsx` | +0/−395 | = | (c) | DD-125(5) | 内容覆盖11% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/RecoveryScreen.tsx` | +0/−41 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖80%:collaboration/desktop/src/features/platform/DeviceIdentityGate.tsx | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/RelaunchRequiredScreen.tsx` | +0/−11 | = | 待定 | - | 内容覆盖25% | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/onboarding/ui/ResetFailedScreen.tsx` | +0/−11 | = | 待定 | - | 内容覆盖0% | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src/features/onboarding/ui/RuntimeErrorTooltip.tsx` | +0/−51 | = | (a) | DD-26 | 内容覆盖30%:client-kit/ts/platform/src/react/messages/thread/ThreadViewModeToggle.tsx | 本机运行时选择 |
| D | `desktop/src/features/onboarding/ui/RuntimeIcon.tsx` | +0/−92 | = | (a) | DD-26 | 内容覆盖0% | 本机运行时选择 |
| D | `desktop/src/features/onboarding/ui/SetupStep.acpForcedGate.test.mjs` | +0/−398 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/SetupStep.tsx` | +0/−1186 | = | (a) | DD-75、DD-77、DD-78、DD-79 | collaboration/desktop/src/features/platform/；内容覆盖4% | Desktop 本机生成/导入/备份 nsec 与连接 Relay 的引导，改为平台 OIDC 登录 + 设备公钥登记 |
| D | `desktop/src/features/onboarding/ui/WelcomeKickoffStage.tsx` | +0/−76 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖0% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/ui/agentReadiness.test.mjs` | +0/−254 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/agentReadiness.ts` | +0/−78 | = | (a) | DD-26 | 内容覆盖3% | 本机运行时选择 |
| D | `desktop/src/features/onboarding/ui/harnessConnectionOptions.test.mjs` | +0/−60 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/harnessConnectionOptions.ts` | +0/−74 | = | (a) | DD-26 | 内容覆盖0% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/onboarding/ui/onboardingCardStyles.ts` | +0/−7 | = | (c) | DD-125(5) | 内容覆盖0% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/ui/onboardingFlowSteps.test.mjs` | +0/−98 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/onboardingRuntimeSelection.test.mjs` | +0/−73 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/onboardingRuntimeSelection.ts` | +0/−53 | = | (a) | DD-26 | 内容覆盖0% | 本机运行时选择 |
| D | `desktop/src/features/onboarding/ui/presetLogos.test.mjs` | +0/−98 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/ui/types.ts` | +0/−96 | = | (c) | DD-125(5) | 内容覆盖7% | 首次引导的资料与头像两步 DD-125(5) 写明保留（本人公钥无 kind:0 时进入）；整套 Onboarding 流程（OnboardingFlow/ProfileStep/AvatarStep 及其外壳）未恢复 |
| D | `desktop/src/features/onboarding/useClaimInvite.ts` | +0/−52 | = | (a) | DD-83、DD-96、DD-01 | client-kit/ts/platform/src/react/invitations.tsx；内容覆盖12% | 加入社区/兑换邀请改为 Tenant 邀请凭据 + admin 确认；Community 由 Tenant 生命周期建立 |
| D | `desktop/src/features/onboarding/useWelcomeKickoffEntrance.ts` | +0/−43 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖11% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/useWelcomeKickoffStage.test.mjs` | +0/−115 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/useWelcomeKickoffStage.ts` | +0/−145 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖12% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/useWelcomeKickoffStagePresence.tsx` | +0/−61 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖8% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/welcome.test.mjs` | +0/−362 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/welcome.ts` | +0/−491 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖8% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/welcomeCanvas.test.mjs` | +0/−62 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/welcomeCanvas.ts` | +0/−41 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖0% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/welcomeGuide.test.mjs` | +0/−454 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/welcomeGuide.ts` | +0/−408 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖1% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |
| D | `desktop/src/features/onboarding/welcomeKickoff.test.mjs` | +0/−470 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/onboarding/welcomeKickoff.ts` | +0/−869 | = | (a) | DD-125(5)、DD-123、DD-26 | 内容覆盖5% | Welcome 自动起步（自动建频道、内置 persona 三个 Agent、开场/收尾）排除 |

### Desktop features/presence（7）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/presence/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/presence | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/presence/hooks.ts` | +0/−436 | desktop/src/features/presence | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/presence/hooks.ts;内容覆盖79%:client-kit/ts/platform/src/react/presence/hooks.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/presence/lib/presence.test.mjs` | +0/−143 | desktop/src/features/presence | (d) | - | 引用:client-kit/ts/platform/test/presence.test.tsx;内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/src/features/presence/lib/presence.ts` | +0/−106 | desktop/src/features/presence | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/channel-members.tsx;内容覆盖98%:client-kit/ts/platform/src/react/presence/lib/presence.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/presence/lib/presenceSubscriptionReconciler.test.mjs` | +0/−286 | desktop/src/features/presence | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/presence/lib/presenceSubscriptionReconciler.ts` | +0/−141 | desktop/src/features/presence | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖0% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/presence/ui/PresenceBadge.tsx` | +0/−56 | desktop/src/features/presence | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/presence/ui/PresenceBadge.tsx;内容覆盖93%:client-kit/ts/platform/src/react/presence/ui/PresenceBadge.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/profile（78）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/profile/avatarPresentationStore.test.mjs` | +0/−71 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/avatarPresentationStore.ts` | +0/−246 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖96%:client-kit/ts/platform/src/react/profile/buzz/features/profile/avatarPresentationStore.ts | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/avatarProfileSync.test.mjs` | +0/−303 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/avatarProfileSync.ts` | +0/−262 | = | (a) | DD-39、DD-75 | 内容覆盖3% | 本机资料缓存同步；资料读写经平台/本人签名链 |
| M | `desktop/src/features/profile/hooks.ts` | +77/−261 |  | (b) | DD-74 | client-kit: contracts, transport | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/profile/lib/animatedAvatarCapture.test.mjs` | +0/−46 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/animatedAvatarCapture.ts` | +0/−721 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/profile/assets/source.json;内容覆盖99%:client-kit/ts/platform/src/react/profile/buzz/features/profile/lib/animatedAvatarCapture.ts | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/lib/bucketPersonaInstances.test.mjs` | +0/−60 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `desktop/src/features/profile/lib/identity.ts` | +1/−114 |  | (b) | DD-74 | client-kit: react/messages/system/identity | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/profile/lib/nostrBindCallback.test.mjs` | +0/−48 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/nostrBindCallback.ts` | +0/−28 | = | 待定 | - | 内容覆盖7% | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src/features/profile/lib/nostrIdentityBinding.ts` | +0/−15 | = | 待定 | - | 内容覆盖0% | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| D | `desktop/src/features/profile/lib/profileActivityAgent.test.mjs` | +0/−51 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/profileActivityAgent.ts` | +0/−47 | = | (c) | DD-125(6)、DD-117 | 内容覆盖10% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/lib/profileActivityCarousel.test.mjs` | +0/−30 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/profileActivityCarousel.ts` | +0/−13 | = | (c) | DD-125(6)、DD-117 | 内容覆盖0% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/lib/profileActivityFeedScope.test.mjs` | +0/−250 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/profileActivityFeedScope.ts` | +0/−265 | = | (c) | DD-125(6)、DD-117 | 内容覆盖3% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/lib/resolveCanonicalManagedAgent.test.mjs` | +0/−154 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `desktop/src/features/profile/lib/selfProfileStorage.ts` | +0/−30 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/profile/lib/useCanonicalManagedAgentProfile.test.mjs` | +0/−94 | = | (d) | - | 内容覆盖30% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/lib/useCanonicalManagedAgentProfile.ts` | +0/−90 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖7% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| M | `desktop/src/features/profile/lib/userLabelStorage.test.mjs` | +0/−15 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/profile/lib/userLabelStorage.ts` | +0/−8 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/profile/profileCacheSync.test.mjs` | +0/−91 | = | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/profileCacheSync.ts` | +0/−91 | = | (a) | DD-39、DD-75 | 内容覆盖22% | 本机资料缓存同步；资料读写经平台/本人签名链 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarBackdropPanel.tsx` | +0/−98 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖94%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarBackdropPanel.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarCameraControls.tsx` | +0/−127 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖98%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarCameraControls.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarCameraPicker.tsx` | +0/−85 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖96%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarCameraPicker.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarCapture.helpers.ts` | +0/−144 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarCapture.helpers.ts | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarCapture.tsx` | +0/−1007 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖96%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarCapture.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarCapture.types.ts` | +0/−16 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarCapture.types.ts | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarControls.tsx` | +0/−488 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/settings-slider.tsx;内容覆盖94%:client-kit/ts/platform/src/react/settings-slider.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AnimatedAvatarReviewNav.tsx` | +0/−130 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖85%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AnimatedAvatarReviewNav.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ArchiveConfirmDialog.tsx` | +0/−83 | = | (a) | DD-125(6)、DD-119(7) | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；内容覆盖10% | Agent 物理删除不提供，映射为 agent.installation.disable |
| D | `desktop/src/features/profile/ui/AvatarCustomColorPanel.tsx` | +0/−298 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖99%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/AvatarCustomColorPanel.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/AvatarUpload.tsx` | +0/−211 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖32%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor.tsx | 资料面板/头像编辑共享迁移 |
| M | `desktop/src/features/profile/ui/MaskedAvatarBadgeFrame.tsx` | +1/−871 |  | (b) | DD-74 | client-kit: react/thread/MaskedAvatarBadgeFrame | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/profile/ui/NostrBindConsentDialog.tsx` | +0/−933 | = | 待定 | - | 内容覆盖9% | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| M | `desktop/src/features/profile/ui/ProfileAvatar.tsx` | +4/−57 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/profile/ui/ProfileAvatarEditor.helpers.ts` | +0/−79 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖97%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor.helpers.ts | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileAvatarEditor.tsx` | +0/−1073 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖99%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileAvatarEditor.types.ts` | +0/−40 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileAvatarEditor.types.ts | 资料面板/头像编辑共享迁移 |
| M | `desktop/src/features/profile/ui/ProfileAvatarEditor.utils.ts` | +1/−645 |  | (b) | DD-74 | client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ | 头像编辑工具迁入共享 profile |
| D | `desktop/src/features/profile/ui/ProfileAvatarModeTabs.tsx` | +0/−104 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖84%:client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileAvatarModeTabs.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileAvatarUntrusted.test.mjs` | +0/−136 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/ui/ProfileAvatarUploadPreview.tsx` | +0/−23 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖0% | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileAvatarWithStatus.tsx` | +0/−118 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/presence/ui/ProfileAvatarWithStatus.tsx;内容覆盖98%:client-kit/ts/platform/src/react/presence/ui/ProfileAvatarWithStatus.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileInstancesArchived.test.mjs` | +0/−149 | = | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/ui/ProfileInstancesSection.tsx` | +0/−121 | = | (c) | DD-125(6)、DD-117 | 内容覆盖20% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/ProfilePopover.tsx` | +0/−309 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/sidebar/profile-popover.tsx;内容覆盖78%:client-kit/ts/platform/src/react/sidebar/profile-popover.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/ProfileTabContentTransition.tsx` | +0/−116 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖100%:client-kit/ts/platform/src/react/pulse/ProfileTabContentTransition.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/SelectedRecipientChip.tsx` | +0/−134 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖70%:client-kit/ts/platform/src/react/conversations/selected-recipient-chip.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/UserProfileAgentActions.tsx` | +0/−234 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖12% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| D | `desktop/src/features/profile/ui/UserProfileAgentManagementRows.tsx` | +0/−306 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖10% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| D | `desktop/src/features/profile/ui/UserProfileEditAgentDialog.tsx` | +0/−34 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖22% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| M | `desktop/src/features/profile/ui/UserProfilePanel.tsx` | +105/−965 |  | (b) | DD-74 | client-kit: i18n, react/context, react/new-message | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/profile/ui/UserProfilePanelAgentDetails.tsx` | +0/−202 | = | (c) | DD-125(6)、DD-117 | 内容覆盖0% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelDeletion.ts` | +0/−166 | = | (a) | DD-125(6)、DD-119(7) | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；内容覆盖1% | Agent 物理删除不提供，映射为 agent.installation.disable |
| D | `desktop/src/features/profile/ui/UserProfilePanelFields.tsx` | +0/−591 | = | (c) | DD-125(6)、DD-117 | 内容覆盖18% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelFocusedViews.tsx` | +0/−203 | = | (c) | DD-125(6)、DD-117 | 内容覆盖9% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelFrame.tsx` | +0/−105 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/pulse/UserProfilePanelFrame.tsx;内容覆盖96%:client-kit/ts/platform/src/react/pulse/UserProfilePanelFrame.tsx | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/UserProfilePanelHeaderContent.tsx` | +0/−99 | = | (c) | DD-125(6)、DD-117 | 内容覆盖20% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelPersonaSubmit.test.mjs` | +0/−137 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/ui/UserProfilePanelPersonaSubmit.ts` | +0/−135 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖4% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| D | `desktop/src/features/profile/ui/UserProfilePanelSections.tsx` | +0/−802 | = | (c) | DD-125(6)、DD-117 | 内容覆盖18% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelTabs.tsx` | +0/−895 | = | (c) | DD-125(6)、DD-117 | 内容覆盖9% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePanelUtils.test.mjs` | +0/−246 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/ui/UserProfilePanelUtils.ts` | +0/−381 | = | (c) | DD-125(6)、DD-117 | 内容覆盖12% | 资料面板的 Agent 页签/分区/聚焦视图与资料活动流未恢复（原 UserProfilePanelFrame 已共享） |
| D | `desktop/src/features/profile/ui/UserProfilePersonaDialogs.tsx` | +0/−158 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖8% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| M | `desktop/src/features/profile/ui/UserProfilePopover.tsx` | +42/−634 |  | (b) | DD-74 | client-kit: react/context, react/pulse | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/profile/ui/UserProfilePrimaryActions.tsx` | +0/−257 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx;内容覆盖7% | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/ui/UserProfileRuntimeContent.test.mjs` | +0/−35 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/profile/ui/UserProfileSnapshotExportDialog.tsx` | +0/−52 | = | (c) | - | 内容覆盖17% | Agent 快照导出（依附快照功能） |
| D | `desktop/src/features/profile/ui/useAgentLifecycleActions.ts` | +0/−101 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖0% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| D | `desktop/src/features/profile/ui/useProfileEditAgentRequest.ts` | +0/−33 | = | (b) | DD-125(6)、DD-117 | client-kit/ts/platform/src/react/agent-activity/AgentLifecycleControls.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖17% | 资料面板中的 Agent 管理动作映射为 Installation 详情/生命周期动作 |
| D | `desktop/src/features/profile/ui/useProfileInteractionActions.ts` | +0/−285 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；引用:client-kit/ts/platform/src/react/pulse/profile-direct-message.tsx;内容覆盖25% | 资料面板/头像编辑共享迁移 |
| D | `desktop/src/features/profile/useAvatarUpload.ts` | +0/−120 | = | (b) | DD-74 | client-kit/ts/platform/src/react/profile/；内容覆盖91%:client-kit/ts/platform/src/react/profile/buzz/features/profile/useAvatarUpload.ts | 资料面板/头像编辑共享迁移 |

### Desktop features/projects（279）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/projects/assignmentOperationFetch.test.mjs` | +0/−322 | desktop/src/features/projects | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/assignmentOperationFetch.ts` | +0/−145 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖12% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/branchMutations.ts` | +0/−136 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/branchMutations.ts;内容覆盖55%:client-kit/ts/platform/src/react/projects/branchMutations.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/createProject.ts` | +0/−300 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/createProject.ts;内容覆盖12% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/deleteProject.test.mjs` | +0/−140 | desktop/src/features/projects | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/hooks.ts` | +0/−964 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectActivitySummaries.ts;内容覆盖27% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/issueAssignments.ts` | +0/−167 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/issueAssignments.ts;内容覆盖11% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/issueMutations.ts` | +0/−61 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/issueMutations.ts;内容覆盖27% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/discussionChannels.test.mjs` | +0/−172 | desktop/src/features/projects | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/discussionChannels.ts` | +0/−185 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/discussionChannels.ts;内容覆盖77%:client-kit/ts/platform/src/react/projects/discussionChannels.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectAgentConversation.test.mjs` | +0/−663 | desktop/src/features/projects | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectAgentConversation.ts` | +0/−257 | desktop/src/features/projects | (c) | - | 内容覆盖12% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/lib/projectAgentConversationStorage.ts` | +0/−119 | desktop/src/features/projects | (c) | - | 内容覆盖9% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/lib/projectAgentSelection.test.mjs` | +0/−21 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectAgentSelection.ts` | +0/−12 | desktop/src/features/projects | (c) | - | 内容覆盖0% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/lib/projectBranchErrors.test.mjs` | +0/−43 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectBranchErrors.ts` | +0/−35 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectBranchErrors.ts;内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectBranches.test.mjs` | +0/−120 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectBranches.ts` | +0/−119 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectBranches.ts;内容覆盖76%:client-kit/ts/platform/src/react/projects/lib/projectBranches.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectCloneUrl.test.mjs` | +0/−156 | desktop/src/features/projects | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectCloneUrl.ts` | +0/−52 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/lib/projectCloneUrl.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectCollection.test.mjs` | +0/−156 | desktop/src/features/projects | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectCollection.ts` | +0/−120 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖78%:client-kit/ts/platform/src/react/projects/lib/projectCollection.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectContributorMatching.test.mjs` | +0/−277 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectContributorMatching.ts` | +0/−307 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectContributorMatching.ts;内容覆盖63%:client-kit/ts/platform/src/react/projects/lib/projectContributorMatching.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectDetailAgentContext.test.mjs` | +0/−259 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectDetailAgentContext.ts` | +0/−352 | desktop/src/features/projects | (c) | - | 内容覆盖3% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/lib/projectDetailSearch.test.mjs` | +0/−81 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectDetailSearch.ts` | +0/−68 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖30% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/lib/projectDetailSelectionItem.test.mjs` | +0/−55 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectDetailSelectionItem.ts` | +0/−63 | desktop/src/features/projects | (c) | - | 内容覆盖14% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/lib/projectExternalUrl.test.mjs` | +0/−33 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectExternalUrl.ts` | +0/−26 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectGitError.test.mjs` | +0/−51 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectGitError.ts` | +0/−82 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/lib/projectHomeChannel.test.mjs` | +0/−141 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectHomeChannel.ts` | +0/−14 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectHomeSelection.ts` | +0/−60 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖30%:client-kit/ts/platform/src/react/messages/timeline/TimelineSkeleton.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectHomeSummary.test.mjs` | +0/−10 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectHomeSummary.ts` | +0/−6 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectHomeTemplate.test.mjs` | +0/−80 | desktop/src/features/projects | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectHomeTemplate.ts` | +0/−101 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖4% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectHomeWorkspaceSheet.test.mjs` | +0/−34 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectHomeWorkspaceSheet.ts` | +0/−40 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectLabels.ts` | +0/−5 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectLanguages.ts` | +0/−45 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖9% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectLocalRepos.ts` | +0/−54 | desktop/src/features/projects | (c) | - | 内容覆盖8% | Desktop 本机仓库克隆路径管理（打开本地仓库/终端）未恢复；无授权排除 |
| D | `desktop/src/features/projects/lib/projectPathDisplay.test.mjs` | +0/−22 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectPathDisplay.ts` | +0/−8 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖14% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectRelatedChannels.test.mjs` | +0/−351 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectRelatedChannels.ts` | +0/−196 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/lib/projectRelatedChannels.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectRepoAvailability.test.mjs` | +0/−116 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectRepoAvailability.ts` | +0/−134 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectRepoAvailability.ts;内容覆盖12% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectRepoHost.ts` | +0/−113 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖11% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/lib/projectReviewDisplay.test.mjs` | +0/−181 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectReviewDisplay.ts` | +0/−101 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/lib/projectSelection.test.mjs` | +0/−162 | desktop/src/features/projects | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectSelection.ts` | +0/−349 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectSelection.ts;内容覆盖18% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectShareLinks.test.mjs` | +0/−139 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectShareLinks.ts` | +0/−153 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectShareLinks.ts;内容覆盖38%:client-kit/ts/platform/src/react/projects/projectShareLinks.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectSidebarMembership.test.mjs` | +0/−210 | desktop/src/features/projects | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectSidebarMembership.ts` | +0/−276 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖6% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectSidebarMembershipSync.test.mjs` | +0/−79 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectSidebarMembershipSync.ts` | +0/−221 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖6% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/projectsActivityDigest.test.mjs` | +0/−57 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectsActivityDigest.ts` | +0/−88 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectsActivityDigest.ts;内容覆盖55%:client-kit/ts/platform/src/react/projects/lib/projectsActivityDigest.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectsSearch.test.mjs` | +0/−25 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectsSearch.ts` | +0/−10 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectsSearch.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/lib/projectsSearch.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/projectsViewHelpers.test.mjs` | +0/−247 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/lib/projectsViewHelpers.ts` | +0/−493 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/lib/projectsViewHelpers.ts;内容覆盖38%:client-kit/ts/platform/src/react/projects/lib/projectsViewHelpers.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/lib/useProjectSelection.tsx` | +0/−105 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖13% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/lib/useProjectSidebarMembership.ts` | +0/−173 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖18% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectActivity.d.mts` | +0/−7 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectActivity.mjs` | +0/−137 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectActivity.mjs;内容覆盖100%:client-kit/ts/platform/src/react/projects/projectActivity.mjs | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectChannelCreation.test.mjs` | +0/−105 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectChannelCreation.ts` | +0/−71 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖13% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/projectChannelRequest.test.mjs` | +0/−70 | desktop/src/features/projects | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectChannelRequest.ts` | +0/−81 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖5% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/projectChannelRequestQueue.test.mjs` | +0/−82 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectChannelRequestQueue.ts` | +0/−81 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖0% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/projectCreation.test.mjs` | +0/−208 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectCreation.ts` | +0/−269 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:core/crates/collab-bridge/src/projects.rs;内容覆盖100%:client-kit/ts/platform/src/react/projects/projectCreation.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectDeletion.test.mjs` | +0/−45 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectDeletion.ts` | +0/−112 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectDeleteAction.tsx;内容覆盖16% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectDeletionMutation.test.mjs` | +0/−63 | desktop/src/features/projects | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectDeletionMutation.ts` | +0/−24 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖10% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectEnumeration.test.mjs` | +0/−334 | desktop/src/features/projects | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectEnumeration.ts` | +0/−243 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectEnumeration.ts;内容覆盖24% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectFetch.ts` | +0/−75 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖8% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectIssues.d.mts` | +0/−82 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖9% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectIssues.mjs` | +0/−290 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/projectIssues.mjs | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectIssues.test.mjs` | +0/−471 | desktop/src/features/projects | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectModels.test.mjs` | +0/−767 | desktop/src/features/projects | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectModels.ts` | +0/−604 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectModels.ts;内容覆盖91%:client-kit/ts/platform/src/react/projects/projectModels.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectOwnerControl.test.mjs` | +0/−47 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectOwnerControl.ts` | +0/−128 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖22% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectPullRequestConflictRecovery.test.mjs` | +0/−38 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectPullRequestConflictRecovery.ts` | +0/−24 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/projectPullRequests.d.mts` | +0/−149 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖8% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectPullRequests.mjs` | +0/−417 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/projectPullRequests.mjs | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectPullRequests.test.mjs` | +0/−837 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectRepositoryCreation.test.mjs` | +0/−448 | desktop/src/features/projects | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectRepositoryCreation.ts` | +0/−265 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖27% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/projectRoutes.ts` | +0/−73 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖11% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/projectSnapshot.test.mjs` | +0/−155 | desktop/src/features/projects | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectSnapshot.ts` | +0/−233 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖16% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/projectTaskCategories.ts` | +0/−39 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/projectTaskCategories.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/projectWorkItems.test.mjs` | +0/−187 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/projectWorkItems.ts` | +0/−257 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectWorkItems.ts;内容覆盖8% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/pullRequestMutations.test.mjs` | +0/−103 | desktop/src/features/projects | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/pullRequestMutations.ts` | +0/−270 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/pullRequestMutations.ts;内容覆盖16% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/pullRequestReviews.ts` | +0/−349 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/pullRequestReviews.ts;内容覆盖17% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/repoSyncHooks.ts` | +0/−175 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖21% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/repositoryActivityHooks.ts` | +0/−33 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖17% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/AddProjectRepositoryDialog.tsx` | +0/−254 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖42%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/AgentContextPayloadPreview.test.mjs` | +0/−109 | desktop/src/features/projects | (d) | - | 内容覆盖33%:collaboration/desktop/src/features/messages/ui/MessageThreadReplyState.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/AgentContextPayloadPreview.tsx` | +0/−69 | desktop/src/features/projects | (c) | - | 内容覆盖18% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/AttachProjectRepositoryDialog.tsx` | +0/−92 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖35%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CopyShareLinkMenuItem.tsx` | +0/−37 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/CopyShareLinkMenuItem.tsx;内容覆盖56%:client-kit/ts/platform/src/react/reminders/ui/SnoozeMenu.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateIssueDialog.tsx` | +0/−34 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/CreateIssueDialog.tsx;内容覆盖50%:client-kit/ts/platform/src/react/projects/CreateProjectIssueDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateProjectDialog.tsx` | +0/−35 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/CreateProjectDialog.tsx;内容覆盖82%:client-kit/ts/platform/src/react/projects/CreateProjectDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateProjectFormContent.tsx` | +0/−190 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/CreateProjectFormContent.tsx;内容覆盖45%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateProjectFormSettings.tsx` | +0/−265 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖48%:client-kit/ts/platform/src/react/channel-permissions-settings.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateProjectIssueDialog.tsx` | +0/−104 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖69%:client-kit/ts/platform/src/react/projects/CreateProjectIssueDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreateProjectWorkItemDialog.tsx` | +0/−231 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖97%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/CreatePullRequestDialog.tsx` | +0/−244 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/CreatePullRequestDialog.tsx;内容覆盖59%:client-kit/ts/platform/src/react/projects/CreatePullRequestDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/DiscussionChannels.tsx` | +0/−481 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/DiscussionChannels.tsx;内容覆盖42%:client-kit/ts/platform/src/react/projects/DiscussionChannels.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/GitHubMark.tsx` | +0/−9 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/IssueAssigneesRow.tsx` | +0/−402 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/IssueAssigneeFacepile.tsx;内容覆盖31%:client-kit/ts/platform/src/react/projects/IssueAssigneeFacepile.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/MergePullRequestButton.tsx` | +0/−290 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/MergePullRequestButton.tsx;内容覆盖22% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectAgentChatPanel.tsx` | +0/−378 | desktop/src/features/projects | (c) | - | 内容覆盖13% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectAgentContextStrip.tsx` | +0/−57 | desktop/src/features/projects | (c) | - | 内容覆盖0% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectAgentSelectionComposerBanner.tsx` | +0/−112 | desktop/src/features/projects | (c) | - | 内容覆盖15% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectAgentSubmittedContextPill.test.mjs` | +0/−61 | desktop/src/features/projects | (d) | - | 内容覆盖43%:collaboration/desktop/src/features/messages/ui/SystemMessageRow.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/ProjectAgentSubmittedContextPill.tsx` | +0/−39 | desktop/src/features/projects | (c) | - | 内容覆盖8% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectAuthorIdentity.tsx` | +0/−80 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectAuthorIdentity.tsx;内容覆盖96%:client-kit/ts/platform/src/react/projects/ProjectAuthorIdentity.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectBranchActionDialogs.tsx` | +0/−38 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectBranchActionDialogs.tsx;内容覆盖76%:client-kit/ts/platform/src/react/projects/ProjectBranchActionDialogs.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectBranchDialogs.tsx` | +0/−208 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectBranchDialogs.tsx;内容覆盖49%:client-kit/ts/platform/src/react/projects/ProjectBranchDialogs.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectBrowserDialog.tsx` | +0/−192 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖40%:client-kit/ts/platform/src/react/channel-browser/ChannelBrowserDialog.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectCards.tsx` | +0/−667 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectCards.tsx;内容覆盖47%:client-kit/ts/platform/src/react/projects/ProjectCards.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectChannelHome.tsx` | +0/−443 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectChannelHome.tsx;内容覆盖12% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectChannelIcon.tsx` | +0/−20 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectChannelIcon.tsx;内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectChannelManagement.tsx` | +0/−82 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖9% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/ui/ProjectChannelRequestDialog.test.mjs` | +0/−41 | desktop/src/features/projects | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/ProjectChannelRequestDialog.tsx` | +0/−105 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖4% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/ui/ProjectCommitCopyButton.tsx` | +0/−64 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖86%:client-kit/ts/platform/src/react/projects/ProjectCommitCopyButton.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectCommitDetailPanel.tsx` | +0/−164 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectCommitDetailPanel.tsx;内容覆盖41%:client-kit/ts/platform/src/react/projects/ProjectCommitDetailPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectContextRail.tsx` | +0/−52 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectContextRail.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectContextRail.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectConversationPanel.tsx` | +0/−366 | desktop/src/features/projects | (c) | - | 内容覆盖23% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectConversationPanelContext.tsx` | +0/−152 | desktop/src/features/projects | (c) | - | 内容覆盖16% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectCreationDialog.tsx` | +0/−36 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖15% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/ProjectDetailChrome.tsx` | +0/−197 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectDetailChrome.tsx;内容覆盖94%:client-kit/ts/platform/src/react/projects/ProjectDetailChrome.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectDetailFeedPanels.tsx` | +0/−440 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖28% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectDetailMeta.tsx` | +0/−81 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectDetailMeta.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectDetailRightPanel.tsx` | +0/−59 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖8% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/ProjectDetailScreen.tsx` | +0/−990 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖4% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectDetailSection.tsx` | +0/−80 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectDetailSection.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectDetailUnavailableState.tsx` | +0/−70 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖16% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectEntityListRow.tsx` | +0/−417 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectChannelMembers.tsx;内容覆盖72%:client-kit/ts/platform/src/react/projects/ProjectEntityListRow.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectEventTypeIcon.tsx` | +0/−114 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectEventTypeIcon.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectEventTypeIcon.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectFeedRow.tsx` | +0/−101 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectFeedRow.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectHomeCodebasePanel.tsx` | +0/−133 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx;内容覆盖39%:client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectHomeColumn.tsx` | +0/−46 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectHomeColumn.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectHomeColumn.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectHomeCommitsPanel.test.mjs` | +0/−129 | desktop/src/features/projects | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/ProjectHomeCommitsPanel.tsx` | +0/−107 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖47%:client-kit/ts/platform/src/react/projects/ProjectCommitsPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectHomeContextPanel.tsx` | +0/−397 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectHomeContextPanel.tsx;内容覆盖41%:client-kit/ts/platform/src/react/projects/ProjectHomeContextPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectHomeWorkspaceSheet.test.mjs` | +0/−15 | desktop/src/features/projects | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/ProjectHomeWorkspaceSheet.tsx` | +0/−423 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectHomeGitSheet.tsx;内容覆盖6% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectIssueCommentTimeline.tsx` | +0/−157 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖95%:client-kit/ts/platform/src/react/projects/ProjectIssueCommentTimeline.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectIssuesPanel.tsx` | +0/−521 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectIssueDetail.tsx;内容覆盖48%:client-kit/ts/platform/src/react/projects/ProjectIssueDetail.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectListRowMenu.tsx` | +0/−37 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectListRowMenu.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectListRowMenu.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectOriginReference.tsx` | +0/−79 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectOriginReference.tsx;内容覆盖48%:client-kit/ts/platform/src/react/projects/ProjectPullRequestDetail.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectOverviewPanel.tsx` | +0/−84 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖18% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectPanelState.tsx` | +0/−45 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectPanelState.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectPanelState.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectProfileIdentity.tsx` | +0/−115 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectProfileIdentity.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectPullRequestFilesChangedPanel.tsx` | +0/−956 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectPullRequestFilesChangedPanel.tsx;内容覆盖48%:client-kit/ts/platform/src/react/projects/ProjectPullRequestFilesChangedPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectPullRequestInlineComments.tsx` | +0/−114 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectPullRequestInlineComments.tsx;内容覆盖60%:client-kit/ts/platform/src/react/projects/ProjectPullRequestInlineComments.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectPullRequestsPanel.tsx` | +0/−941 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectPullRequestDetail.tsx;内容覆盖65%:client-kit/ts/platform/src/react/projects/ProjectPullRequestDetail.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectReadmePanel.tsx` | +0/−336 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectReadmePanel.tsx;内容覆盖32%:client-kit/ts/platform/src/react/projects/ProjectReadmePanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRepositoryActionsPanel.tsx` | +0/−571 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositoryActionsPanel.tsx;内容覆盖16% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRepositoryLatestCommitRow.tsx` | +0/−41 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositoryLatestCommitRow.tsx;内容覆盖89%:client-kit/ts/platform/src/react/projects/ProjectRepositoryLatestCommitRow.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRepositoryManagement.tsx` | +0/−250 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖12% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectRepositoryPanel.tsx` | +0/−982 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositoryPanel.tsx;内容覆盖35%:client-kit/ts/platform/src/react/projects/ProjectRepositoryPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRepositorySource.tsx` | +0/−404 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositorySource.tsx;内容覆盖45%:client-kit/ts/platform/src/react/projects/ProjectRepositorySource.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRepositoryUnavailableState.tsx` | +0/−192 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositoryUnavailableState.tsx;内容覆盖15% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectRichContent.tsx` | +0/−34 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖14% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/ProjectRightPanelControls.tsx` | +0/−134 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖9% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectSectionHeader.tsx` | +0/−60 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectSectionHeader.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectSectionHeader.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectSelectableGroup.tsx` | +0/−120 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectSelectableGroup.tsx;内容覆盖57%:client-kit/ts/platform/src/react/projects/ProjectSelectableGroup.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectSelectionDiscussAction.tsx` | +0/−103 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectSelectionDiscussAction.tsx;内容覆盖42%:client-kit/ts/platform/src/react/projects/ProjectSelectionDiscussAction.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectStatusProgressIcon.tsx` | +0/−81 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectStatusProgressIcon.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectStatusProgressIcon.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkItemCommunicationActions.tsx` | +0/−43 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/ProjectWorkItemContextActions.tsx` | +0/−79 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectWorkItemContextActions.tsx;内容覆盖19% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkItemContextDetails.tsx` | +0/−109 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectWorkItemContextDetails.tsx;内容覆盖15% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkItemGroup.tsx` | +0/−36 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectWorkItemGroup.tsx;内容覆盖100%:client-kit/ts/platform/src/react/projects/ProjectWorkItemGroup.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkItemRow.tsx` | +0/−150 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectWorkItemRow.tsx;内容覆盖63%:client-kit/ts/platform/src/react/projects/ProjectWorkItemRow.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkspaceTabList.tsx` | +0/−68 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectWorkspaceTabList.tsx;内容覆盖21% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx` | +0/−642 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectRepositoryGitTabs.tsx;内容覆盖8% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsActivityFeed.tsx` | +0/−636 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsActivityFeed.tsx;内容覆盖75%:client-kit/ts/platform/src/react/projects/ProjectsActivityFeed.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsAgentPromptPage.tsx` | +0/−834 | desktop/src/features/projects | (c) | - | 内容覆盖20% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectsCategoryCreateDialogs.tsx` | +0/−106 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖4% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/ui/ProjectsChannelsList.tsx` | +0/−242 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsChannelsList.tsx;内容覆盖19% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsIssuesList.tsx` | +0/−356 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsIssuesList.tsx;内容覆盖71%:client-kit/ts/platform/src/react/projects/ProjectsIssuesList.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsListHeaderBar.tsx` | +0/−52 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsListHeaderBar.tsx;内容覆盖78%:client-kit/ts/platform/src/react/projects/ProjectsListHeaderBar.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsListScopeDropdown.tsx` | +0/−52 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖36%:client-kit/ts/platform/src/react/agent-library/PersonaDropdownField.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsOverviewChatToggle.tsx` | +0/−37 | desktop/src/features/projects | (c) | - | 内容覆盖0% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectsOverviewChromeActions.tsx` | +0/−61 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsOverviewChromeActions.tsx;内容覆盖50%:client-kit/ts/platform/src/react/projects/ProjectsOverviewChromeActions.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsOverviewContextSheet.tsx` | +0/−64 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖82%:client-kit/ts/platform/src/react/projects/ProjectsOverviewChromeActions.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsOverviewItems.tsx` | +0/−450 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖17% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectsOverviewPanel.tsx` | +0/−313 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsOverviewPanel.tsx;内容覆盖67%:client-kit/ts/platform/src/react/projects/ProjectsOverviewPanel.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsOverviewRail.test.mjs` | +0/−40 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/ProjectsOverviewRail.tsx` | +0/−185 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsOverviewRail.tsx;内容覆盖97%:client-kit/ts/platform/src/react/projects/ProjectsOverviewRail.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsPullRequestsList.tsx` | +0/−363 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsPullRequestsList.tsx;内容覆盖73%:client-kit/ts/platform/src/react/projects/ProjectsPullRequestsList.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsScreen.tsx` | +0/−33 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖60%:web-client/web/src/platform/ui/ForumPane.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsSectionSearch.tsx` | +0/−157 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsSectionSearch.tsx;内容覆盖89%:client-kit/ts/platform/src/react/projects/ProjectsSectionSearch.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsSelectionCountMenu.tsx` | +0/−158 | desktop/src/features/projects | (c) | - | 内容覆盖7% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/ProjectsToolbar.tsx` | +0/−199 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsToolbar.tsx;内容覆盖85%:client-kit/ts/platform/src/react/projects/ProjectsToolbar.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ProjectsView.tsx` | +0/−978 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖10% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/ProjectsWorkItemTable.tsx` | +0/−23 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/ProjectsWorkItemsLoadNotice.tsx` | +0/−74 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsWorkItemsLoadNotice.tsx;内容覆盖21% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/PullRequestMetaRail.tsx` | +0/−136 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖80%:client-kit/ts/platform/src/react/projects/PullRequestMetaHeader.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/PullRequestReviewCard.tsx` | +0/−331 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/PullRequestReviewCard.tsx;内容覆盖26% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/PullRequestReviewersRow.tsx` | +0/−373 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖52%:client-kit/ts/platform/src/react/projects/PullRequestReviewersRow.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/PullRequestsPanelSurface.tsx` | +0/−65 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖5% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/RepositoryCards.tsx` | +0/−317 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/RepositoryCards.tsx;内容覆盖58%:client-kit/ts/platform/src/react/projects/RepositoryCards.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/ShareLinkButton.tsx` | +0/−68 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ShareLinkButton.tsx;内容覆盖86%:client-kit/ts/platform/src/react/projects/ShareLinkButton.tsx | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/UnavailableProjectRepositories.tsx` | +0/−22 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/ui/buildProjectsViewAgentContext.test.mjs` | +0/−65 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/buildProjectsViewAgentContext.ts` | +0/−116 | desktop/src/features/projects | (c) | - | 内容覆盖20% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/projectContextActionStyles.ts` | +0/−2 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectContextActionStyles.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/projectContextActionStyles.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectDetailHelpers.ts` | +0/−69 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖4% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/projectGitErrorToast.ts` | +0/−17 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/projectGridCardStyles.ts` | +0/−2 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖100%:client-kit/ts/platform/src/react/projects/projectGridCardStyles.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectListRowStyles.ts` | +0/−31 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectListRowStyles.ts;内容覆盖35%:client-kit/ts/platform/src/react/projects/projectListRowStyles.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectPanelStyles.ts` | +0/−25 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsView.tsx;内容覆盖9% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectRightPanelContext.test.mjs` | +0/−44 | desktop/src/features/projects | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/projectRightPanelContext.ts` | +0/−44 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectRightPanelContext.ts;内容覆盖67%:client-kit/ts/platform/src/react/projects/projectRightPanelContext.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectWorkItemGroups.ts` | +0/−16 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectWorkItemGroups.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/projectWorkItemGroups.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectsOverviewContext.test.mjs` | +0/−292 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/projectsOverviewContext.ts` | +0/−438 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectsOverviewContext.ts;内容覆盖83%:client-kit/ts/platform/src/react/projects/projectsOverviewContext.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectsSectionMeta.ts` | +0/−33 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/projectsSectionMeta.ts;内容覆盖38%:client-kit/ts/platform/src/react/projects/projectsSectionMeta.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/projectsViewWorkItems.ts` | +0/−83 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖8% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/useCreateProjectFormSettings.test.mjs` | +0/−44 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/useCreateProjectFormSettings.ts` | +0/−209 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖5% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/ui/useOpenProjectTerminal.ts` | +0/−61 | desktop/src/features/projects | (c) | - | 内容覆盖12% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/projects/ui/useProjectDetailCrumbs.ts` | +0/−58 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖4% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/useProjectDetailPeople.ts` | +0/−101 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖22% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/useProjectDiscussInChannel.ts` | +0/−41 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖42%:client-kit/ts/platform/src/react/composer/features/messages/lib/useDrafts.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/useProjectPanelWidths.ts` | +0/−20 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/ProjectsView.tsx;内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/useProjectProfilePanel.ts` | +0/−60 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖8% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/useProjectRepositoryOpenActions.ts` | +0/−82 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖6% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/ui/useProjectRepositoryPanel.ts` | +0/−98 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖5% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/ui/useProjectsOverviewAgentContext.ts` | +0/−78 | desktop/src/features/projects | (c) | - | 内容覆盖4% | Projects 内的项目 Agent 对话（选中上下文→Agent、Agent 提示页、对话面板）未恢复 |
| D | `desktop/src/features/projects/ui/useProjectsScrollIndicator.ts` | +0/−46 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/useProjectsScrollIndicator.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/useProjectsScrollIndicator.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/useRepositoryFileContent.ts` | +0/−35 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖64%:client-kit/ts/platform/src/react/projects/useRepositoryFileContent.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/useRepositoryFileContentSource.ts` | +0/−88 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖16% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/ui/useRepositoryFilesNavigation.ts` | +0/−80 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/useRepositoryFilesNavigation.ts;内容覆盖86%:client-kit/ts/platform/src/react/projects/useRepositoryFilesNavigation.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/ui/useRetainedProjectGitViews.test.mjs` | +0/−492 | desktop/src/features/projects | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/ui/useRetainedProjectGitViews.ts` | +0/−218 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖1% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/useAddProjectChannel.test.mjs` | +0/−144 | desktop/src/features/projects | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/useAddProjectChannel.ts` | +0/−203 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖10% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/useAddProjectRepository.test.mjs` | +0/−202 | desktop/src/features/projects | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/useAddProjectRepository.ts` | +0/−334 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖5% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useAttachProjectRepository.ts` | +0/−128 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖4% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useBindProjectRepositoryChannel.ts` | +0/−79 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖11% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useCreateProject.ts` | +0/−92 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖14% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/useGitIdentity.ts` | +0/−17 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖25% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useHealProjectHomeRepositories.test.mjs` | +0/−43 | desktop/src/features/projects | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/useHealProjectHomeRepositories.ts` | +0/−85 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖9% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useOptimisticProjectBranches.ts` | +0/−88 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/useOptimisticProjectBranches.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/useOptimisticProjectBranches.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/useProjectChannelRequests.ts` | +0/−180 | desktop/src/features/projects | (c) | DD-80 | 内容覆盖5% | Projects 频道申请/添加项目频道/项目频道管理未恢复 |
| D | `desktop/src/features/projects/useProjectCommitDiff.ts` | +0/−69 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖7% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/useProjectOwnerProfiles.ts` | +0/−14 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；内容覆盖0% | Projects 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/projects/useProjectRepoHost.ts` | +0/−36 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖0% | 仓库管理（创建/挂接/绑定频道/修复）未恢复 |
| D | `desktop/src/features/projects/useProjectRepositoryRefSelection.test.mjs` | +0/−95 | desktop/src/features/projects | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/src/features/projects/useProjectRepositoryRefSelection.ts` | +0/−78 | desktop/src/features/projects | (b) | DD-118、DD-74 | client-kit/ts/platform/src/react/projects/；引用:client-kit/ts/platform/src/react/projects/useProjectRepositoryRefSelection.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/useProjectRepositoryRefSelection.ts | Projects 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/projects/useProjectRepositorySnapshots.ts` | +0/−67 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖29% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/useProjectsRepoSnapshots.ts` | +0/−116 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖2% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |
| D | `desktop/src/features/projects/useRepositoryAccess.ts` | +0/−47 | desktop/src/features/projects | (c) | DD-118 | 内容覆盖12% | 完整仓库型项目详情页（ProjectDetailScreen：Overview/Feed/Files/Commits/PR 面板、右侧面板、PR 审核显示、冲突恢复）未完整恢复；共享侧仅有 ProjectDetailChrome/首页/只读详情 |

### Desktop features/pulse（15）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/pulse/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/pulse | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/pulse/hooks.ts` | +0/−196 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/hooks.ts;内容覆盖20% | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/lib/groupAgentNotes.ts` | +0/−55 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/groupAgentNotes.ts;内容覆盖100%:client-kit/ts/platform/src/react/pulse/lib/groupAgentNotes.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/lib/noteActions.test.mjs` | +0/−61 | desktop/src/features/pulse | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/pulse/lib/noteActions.ts` | +0/−56 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/noteActions.ts;内容覆盖47%:client-kit/ts/platform/src/react/pulse/lib/noteActions.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/lib/projectComments.ts` | +0/−28 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/projectComments.ts;内容覆盖100%:client-kit/ts/platform/src/react/pulse/lib/projectComments.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/lib/replies.test.mjs` | +0/−75 | desktop/src/features/pulse | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `desktop/src/features/pulse/lib/replies.ts` | +0/−31 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/replies.ts;内容覆盖87%:client-kit/ts/platform/src/react/pulse/lib/replies.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/lib/useNoteActions.ts` | +0/−184 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖16% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/pulse/ui/AgentActivityCard.test.mjs` | +0/−65 | desktop/src/features/pulse | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/src/features/pulse/ui/AgentActivityCard.tsx` | +0/−139 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/formatRelativeTime.ts;内容覆盖75%:client-kit/ts/platform/src/react/pulse/ui/AgentActivityCard.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/ui/NoteCard.tsx` | +0/−334 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/lib/formatRelativeTime.ts;内容覆盖85%:client-kit/ts/platform/src/react/pulse/ui/NoteCard.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/ui/PulseScreen.tsx` | +0/−90 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖23% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/pulse/ui/PulseTabBar.tsx` | +0/−131 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/ui/PulseTabBar.tsx;内容覆盖96%:client-kit/ts/platform/src/react/pulse/ui/PulseTabBar.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/pulse/ui/PulseView.tsx` | +0/−429 | desktop/src/features/pulse | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/pulse/ui/PulseView.tsx;内容覆盖84%:client-kit/ts/platform/src/react/pulse/ui/PulseView.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/reminders（17）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/reminders/hooks.ts` | +0/−90 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖13% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/reminders/lib/reminderFilters.test.mjs` | +0/−181 | desktop/src/features/reminders | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/reminders/lib/reminderFilters.ts` | +0/−95 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖100%:client-kit/ts/platform/src/react/reminders/lib/reminderFilters.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/lib/reminderNavigation.test.mjs` | +0/−106 | desktop/src/features/reminders | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/reminders/lib/reminderNavigation.ts` | +0/−71 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖14% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/reminders/lib/reminderNotificationPoll.test.mjs` | +0/−41 | desktop/src/features/reminders | (d) | - | 内容覆盖39%:collaboration/desktop/src/shared/lib/useDocumentVisible.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/reminders/lib/reminderNotificationPoll.ts` | +0/−11 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖100%:client-kit/ts/platform/src/react/reminders/lib/reminderNotificationPoll.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/lib/reminderService.test.mjs` | +0/−141 | desktop/src/features/reminders | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/reminders/lib/reminderService.ts` | +0/−274 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖36%:client-kit/ts/platform/src/react/reminders/lib/reminderProtocol.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/lib/reminderTypes.ts` | +0/−33 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖0% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/features/reminders/lib/timePresets.test.mjs` | +0/−78 | desktop/src/features/reminders | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/reminders/lib/timePresets.ts` | +0/−66 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖84%:client-kit/ts/platform/src/react/reminders/lib/timePresets.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/ui/RemindMeLaterDialog.tsx` | +0/−156 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖86%:client-kit/ts/platform/src/react/reminders/ui/RemindMeLaterDialog.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/ui/RemindMeLaterProvider.tsx` | +0/−63 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖93%:client-kit/ts/platform/src/react/reminders/ui/RemindMeLaterProvider.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/ui/RemindersPanel.tsx` | +0/−545 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖71%:client-kit/ts/platform/src/react/reminders/ui/RemindersPanel.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/ui/SnoozeMenu.tsx` | +0/−111 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖90%:client-kit/ts/platform/src/react/reminders/ui/SnoozeMenu.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/reminders/useReminderNotifications.ts` | +0/−149 | desktop/src/features/reminders | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；内容覆盖24% | 共享迁移（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |

### Desktop features/search（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/features/search/hooks.ts` | +2/−6 |  | (b) | DD-74 | client-kit: react/search/searchQueryLimits | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/lib/parseSearchOperators.ts` | +1/−168 |  | (b) | DD-74 | client-kit: react/search/parseSearchOperators | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/lib/searchMatch.ts` | +1/−201 |  | (b) | DD-74 | client-kit: react/search/searchMatch | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/HighlightedSearchText.tsx` | +1/−26 |  | (b) | DD-74 | client-kit: react/search/HighlightedSearchText | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/SearchPromptPlaceholder.tsx` | +1/−206 |  | (b) | DD-74 | client-kit: react/search/SearchPromptPlaceholder | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/SearchResultItem.tsx` | +1/−269 |  | (b) | DD-74 | client-kit: react/search/SearchResultItem | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/SearchScopeControls.tsx` | +1/−145 |  | (b) | DD-74 | client-kit: react/search/SearchScopeControls | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/TopbarSearch.tsx` | +4/−995 |  | (b) | DD-74 | client-kit: react/search/TopbarSearch | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/ui/useSearchMenuKeyboardNavigation.ts` | +1/−90 |  | (b) | DD-74 | client-kit: react/search/useSearchMenuKeyboardNavigation | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/search/useSearchResults.ts` | +7/−508 |  | (b) | DD-74 | client-kit: react/search/useSearchResults | 原位文件改为消费共享主体（宿主适配层） |

### Desktop features/settings（56）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/features/settings/EncryptedBackupProvider.tsx` | +26/−18 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/SidebarUpdateCard.tsx` | +0/−121 | = | (c) | DD-125(5)、DD-74 | 内容覆盖12% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/UpdateChecker.tsx` | +0/−173 | = | (c) | DD-125(5)、DD-74 | 内容覆盖39%:client-kit/ts/platform/src/react/profile-settings.tsx | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/UpdateIndicator.tsx` | +0/−117 | = | (c) | DD-125(5)、DD-74 | 内容覆盖5% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/hooks/UpdaterProvider.tsx` | +0/−19 | desktop/src/features/settings/hooks | (c) | DD-125(5)、DD-74 | 内容覆盖0% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/hooks/use-updater.ts` | +0/−230 | desktop/src/features/settings/hooks | (c) | DD-125(5)、DD-74 | 内容覆盖2% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/hooks/useSendFeedback.helpers.test.mjs` | +0/−34 | desktop/src/features/settings/hooks | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/hooks/useSendFeedback.ts` | +0/−141 | desktop/src/features/settings/hooks | (c) | - | 内容覆盖3% | “发送反馈”对话框；设计无排除（原 product_feedback 由 Relay 存储） |
| D | `desktop/src/features/settings/lib/appearanceScopeCopy.test.mjs` | +0/−19 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/lib/appearanceScopeCopy.ts` | +0/−20 | = | (a) | DD-53 | 内容覆盖0% | “按社区/全局”外观作用域文案；外观偏好仅属当前设备 |
| M | `desktop/src/features/settings/lib/encryptedBackup.test.mjs` | +1/−6 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/settings/lib/encryptedBackup.ts` | +0/−9 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/settings/lib/moderationQueue.test.mjs` | +0/−257 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/lib/moderationQueue.ts` | +0/−264 | = | (b) | - | 引用:client-kit/ts/platform/src/moderation.ts;内容覆盖38%:client-kit/ts/platform/src/moderation.ts | 有替代实现证据 |
| D | `desktop/src/features/settings/sidebarUpdateCardVisibility.test.mjs` | +0/−30 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/sidebarUpdateCardVisibility.ts` | +0/−7 | = | (c) | DD-125(5)、DD-74 | 内容覆盖0% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src/features/settings/ui/AgentDefaultsSettingsCard.tsx` | +0/−16 | = | (a) | DD-125(5)、DD-26 | 内容覆盖14% | Agent 默认配置对象是本机 Agent，排除 |
| D | `desktop/src/features/settings/ui/AgentsSettingsPanel.tsx` | +0/−57 | = | (b) | - | 引用:client-kit/ts/platform/src/react/agents-settings.tsx;内容覆盖58%:client-kit/ts/platform/src/react/agents-settings.tsx | 有替代实现证据 |
| D | `desktop/src/features/settings/ui/AppearanceSettingsControls.tsx` | +0/−717 | = | (b) | - | 引用:client-kit/ts/platform/src/react/glass-background-setting.tsx;内容覆盖72%:client-kit/ts/platform/src/react/thread-layout-settings.tsx | 有替代实现证据 |
| M | `desktop/src/features/settings/ui/BackupTestFlow.tsx` | +25/−20 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/ChannelTemplatesSettingsCard.tsx` | +0/−791 | = | (c) | REQ-24、DD-74 | 引用:client-kit/ts/platform/src/react/channel-templates/ChannelTemplatesSettingsCard.tsx;内容覆盖17% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：有替代实现证据 |
| D | `desktop/src/features/settings/ui/CustomHarnessForm.tsx` | +0/−471 | = | (a) | DD-26 | 内容覆盖21% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| M | `desktop/src/features/settings/ui/EncryptedBackupCreator.tsx` | +27/−23 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/ExperimentalFeaturesCard.tsx` | +0/−66 | = | (b) | - | 引用:client-kit/ts/platform/src/react/experimental-features-settings.tsx;内容覆盖55%:client-kit/ts/platform/src/react/experimental-features-settings.tsx | 有替代实现证据 |
| D | `desktop/src/features/settings/ui/HarnessCatalogDialog.acpForcedGate.test.mjs` | +0/−646 | = | (d) | - | 内容覆盖27% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/HarnessCatalogDialog.tsx` | +0/−681 | = | (a) | DD-26 | 内容覆盖7% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/HarnessRow.tsx` | +0/−580 | = | (a) | DD-26 | 内容覆盖9% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/HarnessesSettingsPanel.tsx` | +0/−222 | = | (a) | DD-26 | 内容覆盖8% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/HostedCommunitiesSettingsCard.tsx` | +0/−994 | = | (a) | DD-125(5)、DD-96 | 内容覆盖10% | Hosted communities：Community 只由 Tenant 生命周期经 operator 建立，排除 |
| M | `desktop/src/features/settings/ui/KeyboardShortcutsCard.tsx` | +17/−63 |  | (b) | DD-74 | client-kit: react/context, react/settings | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/MobilePairingCard.tsx` | +0/−561 | = | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖7% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `desktop/src/features/settings/ui/ModerationQueueCard.tsx` | +0/−609 | = | (c) | REQ-24、DD-74 | 引用:client-kit/ts/platform/src/react/moderation/ModerationQueueCard.tsx;内容覆盖25% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：有替代实现证据 |
| M | `desktop/src/features/settings/ui/NotificationSettingsCard.tsx` | +1/−305 |  | (b) | DD-74 | client-kit: react/notifications | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/PreventSleepSettingsCard.tsx` | +0/−61 | = | (a) | DD-125(5) | 内容覆盖26% | 防休眠对象是一期不存在的本机 Agent，排除 |
| M | `desktop/src/features/settings/ui/PrivateKeyBackupRow.tsx` | +24/−22 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/settings/ui/ProfileSettingsCard.tsx` | +46/−864 |  | (b) | DD-74 | client-kit: i18n, react/context, react/profile-settings | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/SendFeedbackController.tsx` | +0/−27 | = | (c) | - | 内容覆盖25% | “发送反馈”对话框；设计无排除（原 product_feedback 由 Relay 存储） |
| D | `desktop/src/features/settings/ui/SendFeedbackDialog.tsx` | +0/−367 | = | (c) | - | 内容覆盖18% | “发送反馈”对话框；设计无排除（原 product_feedback 由 Relay 存储） |
| M | `desktop/src/features/settings/ui/SettingsOptionGroup.tsx` | +1/−87 |  | (b) | DD-74 | client-kit: react/settings-option-group | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/settings/ui/SettingsPanels.tsx` | +35/−789 |  | (b) | DD-74 | client-kit: i18n, react/agents-settings, react/appearance-settings | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/settings/ui/SettingsScreen.tsx` | +3/−6 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/settings/ui/SettingsSectionHeader.tsx` | +1/−30 |  | (b) | DD-74 | client-kit: react/settings | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/settings/ui/SettingsView.tsx` | +24/−355 |  | (b) | DD-74 | client-kit: react/context, react/settings | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/SignOutSection.tsx` | +0/−254 | = | (b) | DD-78 | client-kit/ts/platform/src/react/sidebar/profile-popover.tsx；内容覆盖20% | 登出保留为平台 Sign out（共享资料弹层） |
| M | `desktop/src/features/settings/ui/SoundPicker.tsx` | +1/−145 |  | (b) | DD-74 | client-kit: react/notifications | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/settings/ui/VoiceSettingsCard.tsx` | +0/−383 | = | (c) | DD-125(5) | 内容覆盖22% | Voice 设置分区 DD-125(5) 写明保留；Kailo 共享设置只有 10 类，无 voice |
| D | `desktop/src/features/settings/ui/harnessCatalogCopy.test.mjs` | +0/−11 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/harnessCatalogCopy.ts` | +0/−57 | = | (a) | DD-26 | 内容覆盖0% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/harnessCatalogLogic.test.mjs` | +0/−400 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/harnessCatalogLogic.ts` | +0/−226 | = | (a) | DD-26 | 内容覆盖0% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/harnessFormLogic.test.mjs` | +0/−291 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/harnessFormLogic.ts` | +0/−158 | = | (a) | DD-26 | 内容覆盖12% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/harnessGalleryLogic.test.mjs` | +0/−181 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/harnessGalleryLogic.ts` | +0/−109 | = | (a) | DD-26 | 内容覆盖0% | 本机 ACP harness 目录/自定义 harness，平台只激活 SERVER_CODEX |
| D | `desktop/src/features/settings/ui/voiceSettingsLogic.test.mjs` | +0/−60 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/settings/ui/voiceSettingsLogic.ts` | +0/−57 | = | (c) | DD-125(5) | 内容覆盖0% | Voice 设置分区 DD-125(5) 写明保留；Kailo 共享设置只有 10 类，无 voice |

### Desktop features/sidebar（63）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/sidebar/data/sidebarData.ts` | +0/−56 | desktop/src/features/sidebar/data | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；内容覆盖17% | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/lib/channelLabels.ts` | +4/−2 |  | (b) | DD-74 | client-kit: react/conversations/dm-participant-display | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/lib/channelMutesStorage.test.mjs` | +0/−158 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/channelMutesStorage.ts` | +0/−21 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/sidebar/lib/channelMutesSync.test.mjs` | +0/−198 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelMutesSync.ts` | +0/−247 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖8% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/channelSectionsHelpers.test.mjs` | +0/−79 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelSectionsHelpers.ts` | +0/−21 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖7% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/channelSectionsStorage.test.mjs` | +0/−390 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelSectionsStorage.ts` | +0/−196 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖21% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/channelSectionsSync.test.mjs` | +0/−282 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelSectionsSync.ts` | +0/−276 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖6% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| M | `desktop/src/features/sidebar/lib/channelSortPreference.test.mjs` | +7/−95 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/channelSortPreference.ts` | +1/−186 |  | (b) | DD-74 | client-kit: react/sidebar/channelSortPreference | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/lib/channelSortSync.test.mjs` | +0/−262 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelSortSync.ts` | +0/−263 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖9% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| M | `desktop/src/features/sidebar/lib/channelStarsStorage.test.mjs` | +0/−173 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/channelStarsStorage.ts` | +0/−21 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/features/sidebar/lib/channelStarsSync.test.mjs` | +0/−202 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/channelStarsSync.ts` | +0/−247 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖8% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/dmSidebarSort.test.mjs` | +0/−121 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/dmSidebarSort.ts` | +0/−52 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/sidebar/dmSidebarSort.ts;内容覆盖92%:client-kit/ts/platform/src/react/sidebar/dmSidebarSort.ts | 侧栏共享迁移 |
| D | `desktop/src/features/sidebar/lib/sidebarSyncTestHelpers.mjs` | +0/−85 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/sidebarSyncWatermark.test.mjs` | +0/−253 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/sidebarSyncWatermark.ts` | +0/−135 | = | (a) | DD-40、DD-125(5) | client-kit/ts/platform/src/react/collaboration-preferences.tsx；client-kit/ts/platform/src/react/sidebar/；内容覆盖6% | 收藏/静音/自定义分区/排序由 30078 同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/useActiveWorkingChannelsById.test.mjs` | +0/−37 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/useActiveWorkingChannelsById.ts` | +0/−60 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；内容覆盖8% | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/lib/useChannelMutes.test.mjs` | +1/−14 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/useChannelMutes.ts` | +8/−113 |  | (a) | DD-40 |  | 静音同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/useChannelSections.test.mjs` | +0/−78 | = | (d) | - | 内容覆盖30%:collaboration/desktop/src/features/messages/lib/useVoiceNoteRecorder.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/lib/useChannelSections.ts` | +0/−353 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；内容覆盖18% | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/lib/useChannelSortPreference.ts` | +1/−192 |  | (b) | DD-74 | client-kit: react/sidebar/useChannelSortPreference | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/lib/useChannelStars.test.mjs` | +1/−14 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/useChannelStars.ts` | +7/−112 |  | (a) | DD-40 |  | 收藏同步改为 CollaborationUserState |
| D | `desktop/src/features/sidebar/lib/useCreateChannelForm.ts` | +0/−220 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/channel-templates/CreateChannelTemplateField.tsx;内容覆盖31%:client-kit/ts/platform/src/react/projects/CreateProjectWorkItemDialog.tsx | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.test.mjs` | +5/−7 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/lib/useSidebarUnreadOverflow.ts` | +2/−69 |  | (b) | DD-74 | client-kit: react/sidebar/useSidebarUnreadOverflow | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/lib/useUnreadOverflow.ts` | +2/−248 |  | (b) | DD-74 | client-kit: react/sidebar/useUnreadOverflow | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/AppSidebar.tsx` | +250/−757 |  | (b) | DD-74 | client-kit: contracts, i18n, react/channel-browser | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/AppSidebar.types.ts` | +17/−80 |  | (b) | DD-74 | client-kit: contracts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx` | +17/−150 |  | (b) | DD-74 | client-kit: react/sidebar/app-sidebar-frame, react/sidebar/app-sidebar-primary-menu | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/ChannelActivityPopover.tsx` | +21/−163 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/ChannelContextMenu.tsx` | +12/−374 |  | (b) | DD-74 | client-kit: react/sidebar/channel-context-menu | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/ui/ChannelSectionDialogs.tsx` | +0/−372 | = | (c) | DD-74、DD-125(5)、REQ-24、DD-74 | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/sidebar/channel-section-dialogs.tsx;内容覆盖46%:client-kit/ts/platform/src/react/sidebar/custom-channel-section.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：侧栏共享迁移 |
| D | `desktop/src/features/sidebar/ui/CommunityRail.test.mjs` | +0/−72 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/ui/CommunityRail.tsx` | +0/−442 | = | (a) | DD-01、DD-02（.design/03 §TenantMembership：一期不提供选择 Tenant 的入口） | 内容覆盖9% | 多 Community 切换/添加/离开与跨社区未读：Tenant↔Community 一一对应，一个 HumanIdentity 多 Tenant 时一期拒绝而不提供选择入口 |
| D | `desktop/src/features/sidebar/ui/CreateChannelDialog.tsx` | +0/−93 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/create-channel-dialog.tsx;内容覆盖27% | 侧栏共享迁移 |
| D | `desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx` | +0/−257 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/channel-templates/CreateChannelTemplateField.tsx;内容覆盖28% | 侧栏共享迁移 |
| D | `desktop/src/features/sidebar/ui/CustomChannelSection.tsx` | +0/−785 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/sidebar/channel-group.tsx;内容覆盖60%:client-kit/ts/platform/src/react/sidebar/channel-group.tsx | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/ui/MoreUnreadButton.test.mjs` | +9/−117 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/features/sidebar/ui/MoreUnreadButton.tsx` | +2/−134 |  | (b) | DD-74 | client-kit: react/sidebar/MoreUnreadButton | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/ui/SidebarDnd.tsx` | +0/−282 | = | (c) | DD-74、DD-125(5)、REQ-24、DD-74 | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/sidebar/sidebar-dnd.tsx;内容覆盖17% | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：侧栏共享迁移 |
| M | `desktop/src/features/sidebar/ui/SidebarProfileCard.tsx` | +14/−244 |  | (b) | DD-74 | client-kit: react/sidebar/sidebar-profile-card | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/ui/SidebarProjectsSection.test.mjs` | +0/−268 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/ui/SidebarProjectsSection.tsx` | +0/−694 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/projects/ProjectDeleteAction.tsx;内容覆盖28% | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/ui/SidebarRelayConnectionCard.tsx` | +2/−112 |  | (b) | DD-74 | client-kit: react/sidebar/sidebar-relay-connection-card | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/ui/SidebarSection.test.mjs` | +0/−52 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/sidebar/ui/SidebarSection.tsx` | +0/−559 | = | (c) | DD-74、DD-125(5)、REQ-24、DD-74 | client-kit/ts/platform/src/react/sidebar/；引用:client-kit/ts/platform/src/react/agent-activity/ChannelWorkingBadge.tsx;内容覆盖48%:client-kit/ts/platform/src/react/conversations/dm-channel-icon.tsx | 共享实现已在 Web 恢复，但 Desktop 宿主未接入（原 Desktop 文件已删）：侧栏共享迁移 |
| D | `desktop/src/features/sidebar/ui/listSidebarProjects.ts` | +0/−201 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；内容覆盖100%:client-kit/ts/platform/src/react/sidebar/listSidebarProjects.ts | 侧栏共享迁移 |
| M | `desktop/src/features/sidebar/ui/sidebarLoadingSkeleton.tsx` | +10/−57 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/features/sidebar/ui/sidebarMenuHelpers.tsx` | +1/−35 |  | (b) | DD-74 | client-kit: react/sidebar/sidebarMenuHelpers | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/features/sidebar/ui/sidebarSectionStyles.ts` | +1/−5 |  | (b) | DD-74 | client-kit: react/sidebar/sidebarSectionStyles | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/features/sidebar/useDmSidebarMetadata.ts` | +0/−150 | = | (b) | DD-74、DD-125(5) | client-kit/ts/platform/src/react/sidebar/；内容覆盖14% | 侧栏共享迁移 |

### Desktop features/terminal（22）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/terminal/TerminalBootstrap.test.mjs` | +0/−655 | desktop/src/features/terminal | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/TerminalBootstrap.tsx` | +0/−438 | desktop/src/features/terminal | (c) | - | 内容覆盖9% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/TerminalSubstrate.test.mjs` | +0/−1037 | desktop/src/features/terminal | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/TerminalSubstrate.tsx` | +0/−813 | desktop/src/features/terminal | (c) | - | 内容覆盖12% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/fadeController.test.mjs` | +0/−154 | desktop/src/features/terminal | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/fadeController.ts` | +0/−100 | desktop/src/features/terminal | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalBanner.test.mjs` | +0/−109 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalBanner.ts` | +0/−276 | desktop/src/features/terminal | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalBannerColor.test.mjs` | +0/−216 | desktop/src/features/terminal | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalBannerColor.ts` | +0/−408 | desktop/src/features/terminal | (c) | - | 内容覆盖1% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalBannerPainter.test.mjs` | +0/−127 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalBannerPainter.ts` | +0/−87 | desktop/src/features/terminal | (c) | - | 内容覆盖14% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalBannerWave.test.mjs` | +0/−1131 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalBannerWave.ts` | +0/−484 | desktop/src/features/terminal | (c) | - | 内容覆盖1% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalClient.test.mjs` | +0/−114 | desktop/src/features/terminal | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalClient.ts` | +0/−153 | desktop/src/features/terminal | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalPanelStore.test.mjs` | +0/−33 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalPanelStore.ts` | +0/−53 | desktop/src/features/terminal | (c) | - | 内容覆盖21% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalRenderer.test.mjs` | +0/−250 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalRenderer.ts` | +0/−334 | desktop/src/features/terminal | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/features/terminal/terminalState.test.mjs` | +0/−215 | desktop/src/features/terminal | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/terminal/terminalState.ts` | +0/−183 | desktop/src/features/terminal | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |

### Desktop features/user-status（9）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/user-status/UserStatusLookupContext.tsx` | +0/−79 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/UserStatusLookupContext.tsx;内容覆盖100%:client-kit/ts/platform/src/react/user-status/UserStatusLookupContext.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/user-status/focusRefetchPolicy.test.mjs` | +0/−65 | desktop/src/features/user-status | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/src/features/user-status/hooks.test.mjs` | +0/−97 | desktop/src/features/user-status | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/src/features/user-status/hooks.ts` | +0/−466 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/hooks.ts;内容覆盖81%:client-kit/ts/platform/src/react/user-status/hooks.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/user-status/statusExpiration.test.mjs` | +0/−152 | desktop/src/features/user-status | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/src/features/user-status/types.ts` | +0/−5 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/types.ts;内容覆盖100%:client-kit/ts/platform/src/react/user-status/types.ts | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/user-status/ui/SetStatusDialog.tsx` | +0/−558 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/ui/SetStatusDialog.tsx;内容覆盖79%:client-kit/ts/platform/src/react/user-status/ui/SetStatusDialog.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/user-status/ui/StatusEmoji.tsx` | +0/−79 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/ui/StatusEmoji.tsx;内容覆盖86%:client-kit/ts/platform/src/react/user-status/ui/StatusEmoji.tsx | 共享迁移（逐文件证据见覆盖率列） |
| D | `desktop/src/features/user-status/ui/UserNameIndicators.tsx` | +0/−96 | desktop/src/features/user-status | (b) | DD-74、DD-125 | client-kit/ts/platform/src/react/；引用:client-kit/ts/platform/src/react/user-status/ui/UserNameIndicators.tsx;内容覆盖54%:client-kit/ts/platform/src/react/user-status/ui/UserNameIndicators.tsx | 共享迁移（逐文件证据见覆盖率列） |

### Desktop features/workflows（67）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features/workflows/focusRefetchPolicy.test.mjs` | +0/−204 | desktop/src/features/workflows | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/hooks.ts` | +0/−251 | desktop/src/features/workflows | (a) | DD-106、DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖15% | Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinition + Temporal 承接 |
| D | `desktop/src/features/workflows/ui/ChannelCombobox.tsx` | +0/−352 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-channel-combobox.tsx;内容覆盖81%:client-kit/ts/platform/src/react/workflow-channel-combobox.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/CronExpressionInput.tsx` | +0/−169 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/cron-expression-input.tsx;内容覆盖95%:client-kit/ts/platform/src/react/cron-expression-input.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowActionsMenu.tsx` | +0/−109 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-actions-menu.tsx;内容覆盖28% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowApprovalCard.tsx` | +0/−31 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖0% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowAuthorPicker.tsx` | +0/−362 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖75%:client-kit/ts/platform/src/react/workflow-author-picker.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowCard.tsx` | +0/−328 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-card-actions.tsx;内容覆盖15% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowDeleteDialog.tsx` | +0/−78 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-delete-dialog.tsx;内容覆盖14% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx` | +0/−401 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/agents.tsx;内容覆盖14% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowDialog.tsx` | +0/−965 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/agents.tsx;内容覆盖9% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowDurationField.tsx` | +0/−95 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-duration-field.tsx;内容覆盖82%:client-kit/ts/platform/src/react/workflow-duration-field.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowEditorHost.tsx` | +0/−110 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖7% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowEmojiField.tsx` | +0/−96 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-emoji-field.tsx;内容覆盖55%:client-kit/ts/platform/src/react/workflow-emoji-field.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx` | +0/−989 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-form-canvas.tsx;内容覆盖18% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowMessagePicker.tsx` | +0/−470 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-message-host.tsx;内容覆盖42%:client-kit/ts/platform/src/react/workflow-message-picker.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowMessageTextConditionEditor.tsx` | +0/−290 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-message-text-condition-editor.tsx;内容覆盖44%:client-kit/ts/platform/src/react/workflow-message-text-condition-editor.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowRichTriggerDescription.tsx` | +0/−56 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖50%:client-kit/ts/platform/src/react/workflow-trigger-presentation.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowRunTrace.tsx` | +0/−128 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-run-trace.tsx;内容覆盖16% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowScheduleFields.tsx` | +0/−258 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-schedule-fields.tsx;内容覆盖86%:client-kit/ts/platform/src/react/workflow-schedule-fields.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowStepCard.tsx` | +0/−531 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-steps.tsx;内容覆盖21% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowTemplateTextarea.tsx` | +0/−188 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-template-textarea.tsx;内容覆盖85%:client-kit/ts/platform/src/react/workflow-template-textarea.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowTriggerConditions.tsx` | +0/−535 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖87%:client-kit/ts/platform/src/react/workflow-trigger-conditions.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowUnavailableDialog.tsx` | +0/−66 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-unavailable-dialog.tsx;内容覆盖33%:client-kit/ts/platform/src/react/channel-members.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowWebhookHeadersEditor.tsx` | +0/−120 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-webhook-step.tsx;内容覆盖16% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowWebhookSecretDialog.tsx` | +0/−106 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-webhook-secret-dialog.tsx;内容覆盖18% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowsScreen.tsx` | +0/−41 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖10% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/WorkflowsView.tsx` | +0/−405 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-activation-dialog.tsx;内容覆盖17% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/cronExpression.test.mjs` | +0/−54 | desktop/src/features/workflows | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/cronExpression.ts` | +0/−156 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/cron-expression.ts;内容覆盖67%:client-kit/ts/platform/src/react/cron-expression.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/useWorkflowAuthorPresentation.ts` | +0/−59 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖27% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/useWorkflowListAuthorPresentations.test.mjs` | +0/−30 | desktop/src/features/workflows | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/useWorkflowListAuthorPresentations.ts` | +0/−61 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖12% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/useWorkflowListMessagePresentations.test.mjs` | +0/−67 | desktop/src/features/workflows | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/useWorkflowListMessagePresentations.ts` | +0/−92 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖2% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/useWorkflowTriggerPresentation.ts` | +0/−70 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-trigger-presentation.tsx;内容覆盖14% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowActivationWarning.test.mjs` | +0/−107 | desktop/src/features/workflows | (d) | - | 引用:client-kit/ts/platform/test/workflow-activation.test.tsx;内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowActivationWarning.ts` | +0/−160 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-activation-warning.ts;内容覆盖48%:client-kit/ts/platform/src/react/workflow-activation-warning.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowAuthorCandidates.test.mjs` | +0/−146 | desktop/src/features/workflows | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowAuthorCandidates.ts` | +0/−130 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖98%:client-kit/ts/platform/src/react/workflow-author-candidates.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowConditionExpression.test.mjs` | +0/−171 | desktop/src/features/workflows | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowConditionExpression.ts` | +0/−276 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖94%:client-kit/ts/platform/src/react/workflow-condition-expression.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowDefinition.test.mjs` | +0/−323 | desktop/src/features/workflows | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowDefinition.ts` | +0/−456 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-card-actions.tsx;内容覆盖1% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowDuration.test.mjs` | +0/−55 | desktop/src/features/workflows | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowDuration.ts` | +0/−127 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-duration.ts;内容覆盖82%:client-kit/ts/platform/src/react/workflow-duration.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowEditorPane.test.mjs` | +0/−60 | desktop/src/features/workflows | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowEditorPane.ts` | +0/−32 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖6% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowFormPrimitives.tsx` | +0/−48 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖80%:client-kit/ts/platform/src/react/workflow-schedule-fields.tsx | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowFormTypes.test.mjs` | +0/−388 | desktop/src/features/workflows | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowFormTypes.ts` | +0/−684 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-webhook-step.tsx;内容覆盖5% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowMessageCandidates.test.mjs` | +0/−218 | desktop/src/features/workflows | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowMessageCandidates.ts` | +0/−139 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-message-candidates.ts;内容覆盖63%:client-kit/ts/platform/src/react/workflow-message-candidates.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowMessageTextCondition.test.mjs` | +0/−55 | desktop/src/features/workflows | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowMessageTextCondition.ts` | +0/−117 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-message-text-condition.ts;内容覆盖26% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowReactionCondition.test.mjs` | +0/−49 | desktop/src/features/workflows | (d) | - | 引用:client-kit/ts/platform/test/workflow-activation.test.tsx;内容覆盖26% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowReactionCondition.ts` | +0/−15 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-reaction-condition.ts;内容覆盖12% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowSchedule.test.mjs` | +0/−89 | desktop/src/features/workflows | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowSchedule.ts` | +0/−181 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-schedule.ts;内容覆盖91%:client-kit/ts/platform/src/react/workflow-schedule.ts | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowStepDescription.test.mjs` | +0/−142 | desktop/src/features/workflows | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowStepDescription.ts` | +0/−89 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-form-canvas.tsx;内容覆盖18% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowTemplateVariables.test.mjs` | +0/−87 | desktop/src/features/workflows | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowTemplateVariables.ts` | +0/−147 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；引用:client-kit/ts/platform/src/react/workflow-template-variables.ts;内容覆盖19% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowTriggerDescription.test.mjs` | +0/−252 | desktop/src/features/workflows | (d) | - | 引用:client-kit/ts/platform/test/workflow-message-picker.test.tsx;内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowTriggerDescription.ts` | +0/−260 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖13% | Workflows 页面共享迁移，执行改 Temporal |
| D | `desktop/src/features/workflows/ui/workflowYamlDocument.test.mjs` | +0/−148 | desktop/src/features/workflows | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/features/workflows/ui/workflowYamlDocument.ts` | +0/−114 | desktop/src/features/workflows | (b) | DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖0% | Workflows 页面共享迁移，执行改 Temporal |

### Desktop protectedFeatures（22）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/protectedFeatures/bestie/BestieCardBadge.tsx` | +0/−25 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BestieGlobalOverlay.tsx` | +0/−212 | desktop/src/protectedFeatures | (d) | - | 内容覆盖16% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BestieMessageAction.tsx` | +0/−46 | desktop/src/protectedFeatures | (d) | - | 内容覆盖35%:client-kit/ts/platform/src/react/agent-activity/BotActivityBar.tsx | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BestiePopover.tsx` | +0/−496 | desktop/src/protectedFeatures | (d) | - | 内容覆盖18% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BestieProfileSection.tsx` | +0/−86 | desktop/src/protectedFeatures | (d) | - | 内容覆盖10% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BestieSidebarEntry.tsx` | +0/−50 | desktop/src/protectedFeatures | (d) | - | 内容覆盖14% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/BloomMenu.tsx` | +0/−362 | desktop/src/protectedFeatures | (d) | - | 内容覆盖22% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/api.ts` | +0/−56 | desktop/src/protectedFeatures | (d) | - | 内容覆盖10% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/bestieMessageContext.test.mjs` | +0/−45 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/protectedFeatures/bestie/bestieMessageContext.ts` | +0/−18 | desktop/src/protectedFeatures | (d) | - | 内容覆盖11% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/filterBestieDmChannels.test.mjs` | +0/−51 | desktop/src/protectedFeatures | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/protectedFeatures/bestie/filterBestieDmChannels.ts` | +0/−25 | desktop/src/protectedFeatures | (d) | - | 内容覆盖8% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/findAssignedLocalAgent.test.mjs` | +0/−29 | desktop/src/protectedFeatures | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/src/protectedFeatures/bestie/findAssignedLocalAgent.ts` | +0/−17 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/bestie/useBestie.ts` | +0/−180 | desktop/src/protectedFeatures | (d) | - | 内容覆盖7% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/buildProtectedFeatureArtifacts.test.mjs` | +0/−95 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/protectedFeatures/internal.ts` | +0/−11 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/internalUi.ts` | +0/−89 | desktop/src/protectedFeatures | (d) | - | 内容覆盖9% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/protectedFeatures.test.mjs` | +0/−22 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/protectedFeatures/public.ts` | +0/−7 | desktop/src/protectedFeatures | (d) | - | 内容覆盖0% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/publicUi.ts` | +0/−51 | desktop/src/protectedFeatures | (d) | - | 内容覆盖17% | 上游受保护特性：OSS 构建只编入空桩（public.ts 定义为空），原版公开构建中用户不可见，属构建期注入机制 |
| D | `desktop/src/protectedFeatures/tauriCommand.test.mjs` | +0/−130 | desktop/src/protectedFeatures | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |

### Desktop shared/(root)（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/deep-link.test.mjs` | +40/−62 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/deep-link.ts` | +33/−205 |  | (a) | DD-01、DD-83 |  | 社区/邀请深链移除 |
| M | `desktop/src/shared/useAppDeepLinks.ts` | +6/−8 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/useEntityDeepLinks.ts` | +26/−32 |  | (b) | DD-74 | client-kit: i18n, react/projects | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/api（71）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/shared/api/agentControl.ts` | +0/−38 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/agentModels.ts` | +0/−16 | = | (a) | DD-26、DD-125(6) | 内容覆盖20% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| M | `desktop/src/shared/api/channelWindow.ts` | +5/−0 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/communityProfile.ts` | +0/−51 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖9% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src/shared/api/concurrency.ts` | +0/−30 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/customEmoji.test.mjs` | +0/−168 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/customEmoji.ts` | +0/−225 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/custom-emoji/emoji.ts;内容覆盖60%:client-kit/ts/platform/src/react/custom-emoji/emoji.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/api/editMessage.ts` | +0/−25 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖42%:collaboration/desktop/src/shared/api/tauriMessages.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/api/forum.ts` | +0/−168 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖18% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/api/identityTypes.ts` | +0/−4 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/installTypes.ts` | +0/−20 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/inviteHelpers.test.mjs` | +0/−43 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/inviteHelpers.ts` | +0/−96 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖3% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src/shared/api/invites.test.mjs` | +0/−211 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/invites.ts` | +0/−242 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖3% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src/shared/api/moderation.ts` | +0/−375 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖12% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/api/observerRelay.test.mjs` | +0/−62 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/observerRelay.ts` | +0/−46 | = | (a) | DD-26、DD-125(6) | 内容覆盖8% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/osIdle.ts` | +0/−7 | = | (c) | DD-120(5) | 内容覆盖0% | Desktop 按 OS 空闲自动置 away；DD-120 保留 auto/away/offline 设备偏好，原生空闲探测未恢复 |
| D | `desktop/src/shared/api/parseInviteInput.test.mjs` | +0/−213 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/presenceRelaySubscription.test.mjs` | +0/−62 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/presenceRelaySubscription.ts` | +0/−45 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖23% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/api/projectGit.ts` | +0/−701 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/projects/projectGit.ts;内容覆盖11% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/api/projectGitMergeError.test.mjs` | +0/−43 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/readOnlyRelayClient.ts` | +0/−341 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖44%:collaboration/desktop/src/shared/api/relayClientSession.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/api/readOnlyRelayClientPublishRejection.test.mjs` | +0/−156 | = | (d) | - | 内容覆盖42%:collaboration/desktop/src/shared/api/relayClientUnconfirmedResend.test.mjs | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/relayChannelFilters.test.mjs` | +0/−55 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| M | `desktop/src/shared/api/relayChannelFilters.ts` | +10/−152 |  | (a) | DD-80、DD-39 |  | Relay 频道目录过滤改经 BFF |
| M | `desktop/src/shared/api/relayClientSession.ts` | +167/−181 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/relayClientShared.ts` | +2/−9 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/relayClosedRecovery.test.mjs` | +13/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/api/relayClosedRecovery.ts` | +1/−0 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/relayEventPublisher.ts` | +13/−5 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/relayGateBoundary.ts` | +0/−35 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/relayMembers.test.mjs` | +0/−114 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/relayMembers.ts` | +0/−191 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖5% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| M | `desktop/src/shared/api/relayReconnectReplay.test.mjs` | +23/−18 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/api/searchTypes.ts` | +1/−28 |  | (b) | DD-74 | client-kit: react/search/types | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/api/social.ts` | +0/−234 | = | (a) | DD-125(5)、DD-77 | client-kit/ts/platform/src/react/pulse/；内容覆盖12% | Pulse 关注改为 CollaborationUserState.followed_principals（kind 3 不进成员白名单） |
| M | `desktop/src/shared/api/socialTypes.ts` | +0/−7 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/api/tauri.ts` | +13/−717 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/imetaMediaMarkdown | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/api/tauriAcpDiscovery.ts` | +0/−24 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriAgentAccess.ts` | +0/−4 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriAgentAuth.ts` | +0/−55 | = | (a) | DD-26、DD-125(6) | 内容覆盖5% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriArchive.ts` | +0/−557 | = | (c) | DD-125(5) | 内容覆盖1% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| M | `desktop/src/shared/api/tauriChannelHeadCache.ts` | +0/−3 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/tauriChannelTemplates.ts` | +0/−117 | = | (a) | DD-125(4)、DD-40 | client-kit/ts/platform/src/react/channel-templates/；内容覆盖2% | 频道模板本机存储改为 CollaborationUserState.channel_templates |
| M | `desktop/src/shared/api/tauriChannels.ts` | +0/−141 |  | (a) | DD-80 |  | 频道管理 Tauri 命令封装移除 |
| D | `desktop/src/shared/api/tauriEngrams.ts` | +0/−54 | = | (a) | DD-65、DD-66、DD-68 | client-kit/ts/platform/src/react/memory.tsx；内容覆盖12% | Agent 记忆（NIP-AE）由 Core 以 Installation/CONTROL pair 读写，客户端不直写 |
| D | `desktop/src/shared/api/tauriGlobalAgentConfig.ts` | +0/−31 | = | (a) | DD-125(5)、DD-26 | 内容覆盖0% | Agent 默认配置对象是本机 Agent，排除 |
| M | `desktop/src/shared/api/tauriIdentity.ts` | +20/−67 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/tauriIdentityArchive.ts` | +0/−75 | = | (c) | DD-125(5) | 内容覆盖5% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src/shared/api/tauriManagedAgentMessageMarkers.ts` | +0/−15 | = | (a) | DD-26、DD-125(6) | 内容覆盖14% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriManagedAgentMessages.ts` | +0/−43 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖46%:collaboration/desktop/src/shared/api/tauriMessages.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/api/tauriManagedAgents.ts` | +0/−116 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| M | `desktop/src/shared/api/tauriMedia.ts` | +0/−36 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/tauriMesh.ts` | +0/−114 | = | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖0% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| M | `desktop/src/shared/api/tauriMessages.ts` | +24/−2 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/tauriObserver.ts` | +0/−21 | = | (a) | DD-26、DD-125(6) | 内容覆盖22% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriPairing.ts` | +0/−5 | = | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖0% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `desktop/src/shared/api/tauriPersonas.snapshotImport.test.mjs` | +0/−157 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/tauriPersonas.test.mjs` | +0/−39 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/tauriPersonas.ts` | +0/−482 | = | (a) | DD-26、DD-125(6) | 内容覆盖2% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| M | `desktop/src/shared/api/tauriProfiles.ts` | +18/−18 |  | (b) | DD-74 | client-kit: contracts, transport | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/api/tauriRelayAgents.ts` | +0/−37 | = | (a) | DD-26、DD-125(6) | 内容覆盖0% | 本机 Agent 管理/observer 的 Tauri API 封装 |
| D | `desktop/src/shared/api/tauriTeams.snapshotImport.test.mjs` | +0/−237 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src/shared/api/tauriTeams.ts` | +0/−268 | = | (c) | - | 内容覆盖4% | Teams API（依附 Teams） |
| D | `desktop/src/shared/api/tauriWorkflows.ts` | +0/−294 | = | (a) | DD-106、DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖3% | Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinition + Temporal 承接 |
| M | `desktop/src/shared/api/tauriWorkspace.ts` | +2/−17 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/api/trayMenu.ts` | +0/−6 | = | (c) | - | 内容覆盖0% | Desktop 系统托盘菜单；设计无排除 |
| M | `desktop/src/shared/api/types.ts` | +14/−647 |  | (b) | DD-74 | client-kit: react/search/types | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/constants（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/constants/kinds.test.mjs` | +1/−41 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/constants/kinds.ts` | +1/−176 |  | (b) | DD-74 | client-kit: react/thread/kinds | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/context（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/shared/context/AgentSessionContext.tsx` | +0/−34 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖23% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/context/ProfilePanelContext.tsx` | +4/−22 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/context/WorkflowEditorOverlayContext.tsx` | +0/−50 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖11% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |

### Desktop shared/features（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/shared/features/FeatureGate.tsx` | +0/−28 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/FeatureGate.tsx;内容覆盖60%:client-kit/ts/platform/src/react/features/FeatureGate.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/index.ts` | +0/−15 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/features/index.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/manifest.test.mjs` | +0/−33 | desktop/src/shared/features | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/features/manifest.ts` | +0/−59 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/manifest.ts;内容覆盖4% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/resolveEnabled.test.mjs` | +0/−33 | desktop/src/shared/features | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/features/resolveEnabled.ts` | +0/−19 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/resolveEnabled.ts;内容覆盖100%:client-kit/ts/platform/src/react/features/resolveEnabled.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/store.test.mjs` | +0/−53 | desktop/src/shared/features | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src/shared/features/store.ts` | +0/−48 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/store.ts;内容覆盖100%:client-kit/ts/platform/src/react/features/store.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/types.ts` | +0/−25 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/types.ts;内容覆盖100%:client-kit/ts/platform/src/react/features/types.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/features/useFeatureEnabled.ts` | +0/−161 | desktop/src/shared/features | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/features/useFeatureEnabled.ts;内容覆盖80%:client-kit/ts/platform/src/react/features/useFeatureEnabled.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |

### Desktop shared/hooks（13）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/hooks/escapeSurfaces.ts` | +1/−34 |  | (b) | DD-74 | client-kit: react/thread/escapeSurfaces | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/hooks/use-mobile.tsx` | +1/−56 |  | (b) | DD-74 | client-kit: react/sidebar/use-mobile | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/hooks/useDeferredStartup.ts` | +0/−63 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖11% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/hooks/useEscapeKey.ts` | +1/−32 |  | (b) | DD-74 | client-kit: react/thread/useEscapeKey | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/hooks/useFileImportZone.ts` | +0/−60 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖10% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/hooks/useHistorySearchState.ts` | +9/−91 |  | (b) | DD-74 | client-kit: react/use-history-search-state | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/hooks/useIncrementalMount.test.mjs` | +0/−157 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src/shared/hooks/useIncrementalMount.ts` | +0/−86 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/projects/useIncrementalMount.ts;内容覆盖100%:client-kit/ts/platform/src/react/projects/useIncrementalMount.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/hooks/usePanelReturnTarget.ts` | +0/−40 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖0% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/hooks/useScrollBoundaryLock.ts` | +0/−43 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/channel-management-sheet.tsx;内容覆盖81%:client-kit/ts/platform/src/react/channel-management-sheet.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/hooks/useThreadPanelWidth.ts` | +1/−143 |  | (b) | DD-74 | client-kit: react/thread/useThreadPanelWidth | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/hooks/useToastEffect.ts` | +0/−36 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖7% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/hooks/useWebviewScrollBoundaryLock.ts` | +0/−10 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |

### Desktop shared/layout（8）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/layout/AuxiliaryPanelBody.tsx` | +1/−46 |  | (b) | DD-74 | client-kit: react/thread/AuxiliaryPanelBody | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/AuxiliaryPanelHeader.tsx` | +1/−397 |  | (b) | DD-74 | client-kit: react/thread/AuxiliaryPanelHeader | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/AuxiliaryPanelShell.tsx` | +1/−165 |  | (b) | DD-74 | client-kit: react/thread/AuxiliaryPanelShell | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/auxiliaryPanelContext.ts` | +1/−52 |  | (b) | DD-74 | client-kit: react/thread/auxiliaryPanelContext | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/auxiliaryPanelLayout.ts` | +1/−31 |  | (b) | DD-74 | client-kit: react/thread/auxiliaryPanelLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/chromeLayout.ts` | +1/−63 |  | (b) | DD-74 | client-kit: react/messages/chromeLayout | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/observeElementBlockSize.ts` | +1/−63 |  | (b) | DD-74 | client-kit: react/messages/observeElementBlockSize | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/layout/useMeasuredCssVariable.ts` | +1/−83 |  | (b) | DD-74 | client-kit: react/messages/useMeasuredCssVariable | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/lib（61）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/lib/authors.ts` | +1/−97 |  | (b) | DD-74 | client-kit: react/messages/authors | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/codeBlockClipboard.ts` | +0/−56 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖92%:client-kit/ts/platform/src/react/composer/shared/lib/codeBlockClipboard.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/lib/computeConfigNudge.ts` | +0/−59 | = | (a) | DD-26 | 内容覆盖0% | 本机 Agent 配置提示/安装错误 |
| D | `desktop/src/shared/lib/configNudge.test.mjs` | +0/−430 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/configNudge.ts` | +0/−184 | = | (a) | DD-26 | 内容覆盖5% | 本机 Agent 配置提示/安装错误 |
| M | `desktop/src/shared/lib/conversationDensityPreference.test.mjs` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/conversationDensityPreference.ts` | +0/−101 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/conversationDensityPreference.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/createRemarkPrefixPlugin.ts` | +1/−121 |  | (b) | DD-74 | client-kit: react/messages/channel-link/createRemarkPrefixPlugin | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/customEmojiTags.test.mjs` | +0/−34 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/customEmojiTags.ts` | +0/−46 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖20% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/lib/datetime.ts` | +1/−175 |  | (b) | DD-74 | client-kit: react/messages/datetime | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/detectPrefixQuery.ts` | +1/−81 |  | (b) | DD-74 | client-kit: react/pulse/mentions | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/emojiName.test.mjs` | +0/−19 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/emojiName.ts` | +0/−35 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/messages/reactions/emojiName.ts;内容覆盖100%:client-kit/ts/platform/src/react/messages/reactions/emojiName.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/emojiOnly.test.mjs` | +9/−24 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/emojiOnly.ts` | +1/−138 |  | (b) | DD-74 | client-kit: react/messages/emojiOnly | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/emojiSearch.ts` | +2/−192 |  | (b) | DD-74 | client-kit: react/composer/features/messages/lib/emojiSearch | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/entityLink.test.mjs` | +0/−261 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/entityLink.ts` | +0/−310 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:collaboration/desktop/src-tauri/src/deep_link.rs;内容覆盖100%:client-kit/ts/platform/src/react/projects/entityLink.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/fontSizePreference.test.mjs` | +2/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/fontSizePreference.ts` | +0/−101 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/fontSizePreference.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/foregroundReady.ts` | +1/−45 |  | (b) | DD-74 | client-kit: react/notifications/foregroundReady | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/installError.test.mjs` | +0/−184 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/installError.ts` | +0/−25 | = | (a) | DD-26 | 内容覆盖0% | 本机 Agent 配置提示/安装错误 |
| M | `desktop/src/shared/lib/keyboard-shortcuts.ts` | +1/−285 |  | (b) | DD-74 | client-kit: keyboard-shortcuts | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/linkPreview.test.mjs` | +0/−204 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/linkPreview.ts` | +1/−693 |  | (b) | DD-74 | client-kit: linkPreview | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/linkPreviewSnapshot.test.mjs` | +33/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/linkPreviewSnapshot.ts` | +1/−179 |  | (b) | DD-74 | client-kit: linkPreviewSnapshot | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/linkPreviewStylePreference.ts` | +1/−56 |  | (b) | DD-74 | client-kit: linkPreviewStylePreference | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/localStorageQuota.ts` | +1/−172 |  | (b) | DD-74 | client-kit: react/composer/shared/lib/localStorageQuota | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/localStorageSweep.ts` | +1/−1 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/lib/mediaUrl.test.mjs` | +2/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/mediaUrl.ts` | +3/−3 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/lib/mentionBoundaries.ts` | +1/−177 |  | (b) | DD-74 | client-kit: react/composer/shared/lib/mentionBoundaries | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/mentionDisplay.ts` | +1/−40 |  | (b) | DD-74 | client-kit: react/composer/shared/lib/mentionDisplay | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/mentionOccurrences.ts` | +1/−30 |  | (b) | DD-74 | client-kit: react/pulse/mentions | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/mentionPattern.ts` | +1/−59 |  | (b) | DD-74 | client-kit: react/messages/channel-link/mentionPattern | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/ncryptsecSourceScan.test.mjs` | +5/−26 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/normalizeRelayUrl.ts` | +1/−8 |  | (b) | DD-74 | client-kit: react/sidebar/normalizeRelayUrl | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/nostrUtils.ts` | +1/−37 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| D | `desktop/src/shared/lib/panelReturnTarget.test.mjs` | +0/−86 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/panelReturnTarget.ts` | +0/−72 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖25% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/lib/platform.ts` | +5/−42 |  | (b) | DD-74 | client-kit: keyboard-platform | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/promptPreview.ts` | +0/−15 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖0% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/lib/rehypeLeadingInlineContent.ts` | +1/−115 |  | (b) | DD-74 | client-kit: react/video-review/rehypeLeadingInlineContent | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/rehypeSearchHighlight.ts` | +1/−88 |  | (b) | DD-74 | client-kit: react/search/rehypeSearchHighlight | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/relayError.ts` | +0/−2 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/lib/remarkChannelLinks.ts` | +1/−36 |  | (b) | DD-74 | client-kit: react/messages/channel-link/remarkChannelLinks | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/remarkCustomEmoji.test.mjs` | +0/−101 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/remarkCustomEmoji.ts` | +0/−151 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/custom-emoji/remarkCustomEmoji.ts;内容覆盖100%:client-kit/ts/platform/src/react/custom-emoji/remarkCustomEmoji.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/remarkSpoilers.ts` | +1/−181 |  | (b) | DD-74 | client-kit: react/composer/shared/lib/remarkSpoilers | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/resolveMentionNames.ts` | +1/−181 |  | (b) | DD-74 | client-kit: react/messages/resolveMentionNames | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/safeStorage.ts` | +1/−86 |  | (b) | DD-74 | client-kit: theme/safe-storage | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/trimMapToSize.ts` | +1/−15 |  | (b) | DD-74 | client-kit: react/composer/shared/lib/trimMapToSize | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/lib/url.ts` | +0/−15 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/messages/diff/url.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/useDocumentVisible.test.mjs` | +0/−100 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/shared/lib/useNow.ts` | +0/−62 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/useNow.ts;内容覆盖100%:client-kit/ts/platform/src/react/useNow.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/lib/useResolvedLinkPreviews.test.mjs` | +0/−306 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/lib/useResolvedLinkPreviews.ts` | +17/−219 |  | (b) | DD-74 | client-kit: linkPreviewTypes | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/lib/videoPlaybackSpeedPreference.ts` | +1/−116 |  | (b) | DD-74 | client-kit: react/video-review/videoPlaybackSpeedPreference | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/styles（19）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/styles/globals.css` | +3/−33 |  | (b) | DD-74 | client-kit: src, styles.css | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/styles/globals/animations.css` | +0/−932 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/animations.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/avatar-framing.css` | +0/−156 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/avatar-framing.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/components.css` | +0/−827 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/components.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/composer.css` | +0/−321 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖98%:client-kit/ts/platform/src/react/composer/composer.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/image-lightbox.css` | +0/−65 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/image-lightbox.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/markdown.css` | +0/−390 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/messages/markdown.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/media-controls.css` | +0/−54 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/media-controls.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/motion.css` | +0/−119 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/motion.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/progress.css` | +0/−9 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/progress.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/scrollbars.css` | +0/−99 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/scrollbars.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/skeleton.css` | +0/−114 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/skeleton.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/spoilers.css` | +0/−137 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/composer/spoilers.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/terminal.css` | +0/−327 | = | (c) | - | 内容覆盖26% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/shared/styles/globals/theme.css` | +0/−967 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖88%:client-kit/ts/platform/src/theme.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/tooltipSemantics.test.mjs` | +0/−27 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/styles/globals/typography.css` | +0/−74 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/typography.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/utilities.css` | +0/−126 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/utilities.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/styles/globals/video-review.css` | +0/−48 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/styles/video-review.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |

### Desktop shared/theme（12）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src/shared/theme/CommunityThemeController.tsx` | +15/−124 |  | (a) | DD-53 |  | 按社区外观同步移除 |
| M | `desktop/src/shared/theme/ThemePreviewFrame.tsx` | +1/−633 |  | (b) | DD-74 | client-kit: theme/theme-preview-frame | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/theme/ThemeProvider.tsx` | +13/−561 |  | (b) | DD-74 | client-kit: theme/glass-preference, theme/theme-loader, theme/use-appearance | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/theme/adaptive-theme.ts` | +0/−290 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖79%:client-kit/ts/platform/src/theme/adaptive-theme.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/theme/communityThemePreference.test.mjs` | +1/−51 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/theme/communityThemePreference.ts` | +1/−63 |  | (b) | DD-74 | client-kit: theme/theme-loader | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/theme/communityThemeSync.test.mjs` | +0/−602 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src/shared/theme/communityThemeSync.ts` | +0/−399 | = | (a) | DD-53 | 内容覆盖6% | 按社区跨设备同步外观偏好（经 Relay 加密偏好）；DD-53 规定外观偏好仅属于当前设备，不新增服务端偏好权威 |
| D | `desktop/src/shared/theme/terminal-palette.test.mjs` | +0/−55 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src/shared/theme/terminal-palette.ts` | +0/−181 | = | (c) | - | 内容覆盖7% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/shared/theme/theme-loader.ts` | +0/−420 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖98%:client-kit/ts/platform/src/theme/theme-loader.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/theme/useThemePreviewVars.ts` | +1/−112 |  | (b) | DD-74 | client-kit: theme/use-theme-preview-vars | 原位文件改为消费共享主体（宿主适配层） |

### Desktop shared/ui（112）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/shared/ui/AnimatedCount.tsx` | +0/−183 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/pulse/AnimatedCount.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/AvatarClipPaths.tsx` | +1/−99 |  | (b) | DD-74 | client-kit: react/thread/AvatarClipPaths | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/BuzzLoadingState.tsx` | +1/−34 |  | (b) | DD-74 | client-kit: react/projects/BuzzLoadingState | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/EmojiBurstProvider.tsx` | +7/−732 |  | (b) | DD-74 | client-kit: react/emoji-burst | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/InlineChip.tsx` | +1/−80 |  | (b) | DD-74 | client-kit: react/messages/system/InlineChip | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/OverlayPanelBackdrop.tsx` | +1/−40 |  | (b) | DD-74 | client-kit: react/thread/OverlayPanelBackdrop | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/PoofBurstProvider.tsx` | +14/−6 |  | (b) | DD-74 | client-kit: react/sidebar/poof-burst-classes | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/PortalledScrollArea.tsx` | +0/−39 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/shared/ui/portalled-scroll-area.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/Shimmer.tsx` | +0/−26 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/messages/Shimmer.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/SimpleImageLightbox.tsx` | +0/−74 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖69%:client-kit/ts/platform/src/react/composer/features/messages/ui/ComposerAttachments.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/SpoilerParticles.tsx` | +1/−501 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/SpoilerParticles | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/TerminalPanelIcon.tsx` | +0/−52 | = | (c) | - | 内容覆盖67%:client-kit/ts/platform/src/react/sidebar/DrawerPanelIcon.tsx | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/shared/ui/TopChromeBackdrop.tsx` | +0/−28 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖25% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| M | `desktop/src/shared/ui/UnreadPill.tsx` | +1/−59 |  | (b) | DD-74 | client-kit: react/messages/timeline/UnreadPill | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/UserAvatar.tsx` | +3/−122 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VideoPlayer.tsx` | +10/−2203 |  | (b) | DD-74 | client-kit: react/custom-emoji, react/video-review | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VideoReviewCommentMarkdown.tsx` | +4/−72 |  | (b) | DD-74 | client-kit: react/video-review | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VideoReviewNavigation.tsx` | +1/−101 |  | (b) | DD-74 | client-kit: react/video-review/VideoReviewNavigation | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VideoReviewPosterPreview.tsx` | +1/−22 |  | (b) | DD-74 | client-kit: react/video-review/VideoReviewPosterPreview | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VideoReviewTimecodeButton.tsx` | +1/−78 |  | (b) | DD-74 | client-kit: react/video-review/VideoReviewTimecodeButton | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/ViewLoadingFallback.tsx` | +1/−93 |  | (b) | DD-74 | client-kit: react/messages/ChannelLoadingFallback | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/VirtualizedList.tsx` | +2/−183 |  | (b) | DD-74 | client-kit: react/VirtualizedList | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/alert.tsx` | +0/−54 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖11% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/ui/animatedCountParts.test.mjs` | +0/−34 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src/shared/ui/animatedCountParts.ts` | +0/−47 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖96%:client-kit/ts/platform/src/react/pulse/animatedCountParts.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/assets/drawer-panel-closed-state.svg` | +0/−4 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖0% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/ui/assets/drawer-panel-open-state.svg` | +0/−4 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖0% | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列）；本文件无直接引用/内容覆盖证据，按模块整体迁移归类（待核） |
| D | `desktop/src/shared/ui/assets/terminal-closed-state.svg` | +0/−4 | = | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/shared/ui/assets/terminal-open-state.svg` | +0/−4 | = | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src/shared/ui/assets/terminal.svg` | +0/−4 | = | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| M | `desktop/src/shared/ui/attachment.tsx` | +1/−201 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/attachment | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/button.tsx` | +1/−58 |  | (b) | DD-74 | client-kit: react/button | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/buzz-logo/BuzzLogoAnimation.tsx` | +2/−722 |  | (b) | DD-74 | client-kit: react/projects/BuzzLogoAnimation | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/buzz-logo/BuzzMark.tsx` | +0/−57 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖33%:client-kit/ts/platform/src/react/projects/buzz-logo/BuzzLogoAnimation.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/buzz-logo/FuzzyLogo.tsx` | +0/−55 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/agent-transcript/TurnLivenessIndicator.tsx;内容覆盖60%:client-kit/ts/platform/src/react/agent-transcript/TurnLivenessIndicator.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/buzz-logo/buzz-logo-animation.css` | +0/−88 |  | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/projects/buzz-logo/buzz-logo-animation.css | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/calendar.tsx` | +0/−213 | = | 待定 | - | 内容覆盖1% | 通用 UI 件，随所属功能（引导、资料活动轮播、日期选择）处置 |
| D | `desktop/src/shared/ui/carousel.tsx` | +0/−265 | = | (c) | - | 内容覆盖15% | 资料活动轮播（依附资料活动流） |
| M | `desktop/src/shared/ui/checkbox.tsx` | +1/−53 |  | (b) | DD-74 | client-kit: react/profile/buzz/shared/ui/checkbox | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/chooser-dialog-content.tsx` | +0/−95 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/agent-library/AgentManagementDialog.tsx;内容覆盖59%:client-kit/ts/platform/src/react/composer/shared/ui/chooser-dialog-content.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/compact-link-preview-attachment.tsx` | +1/−199 |  | (b) | DD-74 | client-kit: react/link-preview | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/config-nudge-attachment.test.mjs` | +0/−219 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/shared/ui/config-nudge-attachment.tsx` | +0/−434 | = | (a) | DD-26 | 内容覆盖3% | 本机 Agent 配置提示/安装错误 |
| M | `desktop/src/shared/ui/context-menu.tsx` | +1/−212 |  | (b) | DD-74 | client-kit: react/sidebar/context-menu | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/dialog.tsx` | +1/−197 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/dialog | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/dropdown-menu.tsx` | +1/−215 |  | (b) | DD-74 | client-kit: react/sidebar/dropdown-menu | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/icons.ts` | +1/−25 |  | (b) | DD-74 | client-kit: react/messages/icons | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/identity-card-skeleton.tsx` | +0/−44 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/agent-library/identity-card-skeleton.tsx;内容覆盖100%:client-kit/ts/platform/src/react/agent-library/identity-card-skeleton.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/import-status-icon.tsx` | +0/−29 | = | (a) | DD-26 | 内容覆盖0% | 本机 Agent 配置提示/安装错误 |
| M | `desktop/src/shared/ui/input.tsx` | +1/−25 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/input | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/link-preview-attachment.tsx` | +8/−57 |  | (b) | DD-74 | client-kit: react/link-preview | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/link-preview-controls.tsx` | +0/−125 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/link-preview/link-preview-controls.tsx;内容覆盖81%:client-kit/ts/platform/src/react/link-preview/link-preview-controls.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/markdown.test.mjs` | +162/−519 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/ui/markdown.tsx` | +55/−1375 |  | (b) | DD-74 | client-kit: react/custom-emoji, react/image-lightbox, react/message-body | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/markdown/AgentSnapshotCard.tsx` | +0/−214 | = | (c) | - | 内容覆盖19% | 消息中的 Agent 快照卡片（依附快照功能） |
| M | `desktop/src/shared/ui/markdown/BuzzLinkChip.tsx` | +9/−217 |  | (b) | DD-74 | client-kit: i18n, react/messages/message-link | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/ChannelDeepLink.test.mjs` | +68/−17 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/ui/markdown/ChannelDeepLink.tsx` | +23/−485 |  | (b) | DD-74 | client-kit: i18n, react/messages/channel-link | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/CodeBlock.tsx` | +20/−240 |  | (b) | DD-74 | client-kit: react/message-body, theme/theme-loader | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/FileCard.tsx` | +9/−53 |  | (b) | DD-74 | client-kit: react/messages | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/markdown/ImageGalleryStatus.tsx` | +0/−31 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/image-lightbox/ImageGalleryStatus.tsx;内容覆盖88%:client-kit/ts/platform/src/react/image-lightbox/ImageGalleryStatus.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/markdown/ImageLightboxZoomControls.tsx` | +0/−91 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/image-lightbox/ImageLightboxZoomControls.tsx;内容覆盖98%:client-kit/ts/platform/src/react/image-lightbox/ImageLightboxZoomControls.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/markdown/ImageMosaic.tsx` | +1/−28 |  | (b) | DD-74 | client-kit: react/image-lightbox | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/markdown/InlineEmojiPopover.tsx` | +0/−102 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/custom-emoji/InlineEmojiPopover.tsx;内容覆盖97%:client-kit/ts/platform/src/react/custom-emoji/InlineEmojiPopover.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/markdown/LinkPreviewImageLightbox.tsx` | +1/−114 |  | (b) | DD-74 | client-kit: react/image-lightbox | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/MarkdownMention.tsx` | +3/−47 |  | (b) | DD-74 | client-kit: react/messages/MarkdownMentionChip | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/MarkdownTable.tsx` | +2/−13 |  | (b) | DD-74 | client-kit: react/message-body | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/MarkdownVideoPlayer.tsx` | +4/−2 |  | (b) | DD-74 | client-kit: react/context | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/MediaContextMenu.tsx` | +6/−111 |  | (b) | DD-74 | client-kit: react/image-lightbox | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/MessageLinkPill.tsx` | +16/−281 |  | (b) | DD-74 | client-kit: i18n, react/messages/message-link | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/markdown/ProgressiveImage.tsx` | +0/−141 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/image-lightbox/ProgressiveImage.tsx;内容覆盖100%:client-kit/ts/platform/src/react/image-lightbox/ProgressiveImage.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/markdown/SpoilerInline.tsx` | +1/−148 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/markdown/SpoilerInline | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/entityLinks.tsx` | +15/−346 |  | (b) | DD-74 | client-kit: i18n, react/projects | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/imageLightbox.ts` | +49/−523 |  | (b) | DD-74 | client-kit: react/image-lightbox | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/mediaEntry.ts` | +1/−77 |  | (b) | DD-74 | client-kit: react/video-review/mediaEntry | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/nodeCache.test.mjs` | +0/−26 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/ui/markdown/nodeCache.ts` | +7/−13 |  | (b) | DD-74 | client-kit: react/custom-emoji, react/projects | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/parseImeta.ts` | +1/−63 |  | (b) | DD-74 | client-kit: react/messages/parseImeta | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/runtimeContext.ts` | +0/−1 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/ui/markdown/types.ts` | +1/−33 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/ui/markdown/useInlineTooltipPosition.ts` | +1/−130 |  | (b) | DD-74 | client-kit: react/messages/message-link/useInlineTooltipPosition | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/useMessageLinkMetadata.ts` | +9/−5 |  | (b) | DD-74 | client-kit: i18n, react/context | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdown/useMessageLinkPreviews.ts` | +8/−22 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/src/shared/ui/markdown/utils.ts` | +12/−176 |  | (b) | DD-74 | client-kit: react/image-lightbox, react/message-body, react/projects | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdownFileCard.test.mjs` | +7/−248 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/ui/markdownFileCard.ts` | +8/−128 |  | (b) | DD-74 | client-kit: react/messages/resolveFileCard | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/markdownMentionDisplay.test.mjs` | +29/−37 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src/shared/ui/markdownUtils.ts` | +1/−79 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/markdownMedia | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/mentionChip.ts` | +1/−80 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/mentionChip | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/modalBackdrop.ts` | +1/−1 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/modalBackdrop | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/modalMotion.ts` | +1/−5 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/modalMotion | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/modalSearchStyles.ts` | +0/−5 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/channel-browser/modalSearchStyles.ts;内容覆盖100%:client-kit/ts/platform/src/react/channel-browser/modalSearchStyles.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/popover.tsx` | +1/−1 |  | (b) | DD-74 | client-kit: react/popover-surface | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/popoverSurface.ts` | +0/−20 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/test/pages.test.tsx;内容覆盖100%:client-kit/ts/platform/src/react/popover-surface.ts | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/progress.tsx` | +1/−45 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/progress | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/rich-link-preview-attachment.tsx` | +1/−355 |  | (b) | DD-74 | client-kit: react/link-preview | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/segmented-control.tsx` | +0/−222 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/segmented-control.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/sidebar-action-card.tsx` | +2/−340 |  | (b) | DD-74 | client-kit: react/sidebar/sidebar-action-card | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/sidebar.tsx` | +4/−1007 |  | (b) | DD-74 | client-kit: react/sidebar/sidebar | 原位文件改为消费共享主体（宿主适配层） |
| D | `desktop/src/shared/ui/step-progress.tsx` | +0/−56 | = | (c) | DD-125(5) | 内容覆盖0% | 引导步骤进度条（依附首次引导资料/头像两步） |
| D | `desktop/src/shared/ui/styled-qr-code.test.mjs` | +0/−54 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/src/shared/ui/styled-qr-code.tsx` | +0/−226 | = | (a) | DD-125(5)、DD-72、DD-75 | 内容覆盖2% | 仅供移动端配对二维码，配对向手机交付私钥被排除 |
| D | `desktop/src/shared/ui/switch.tsx` | +0/−27 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/switch.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/tabs.tsx` | +0/−53 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/shared/ui/tabs.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| D | `desktop/src/shared/ui/textarea.tsx` | +0/−25 | = | (b) | DD-74、DD-53 | client-kit/ts/platform/src/；引用:client-kit/ts/platform/src/react/profile/buzz/shared/ui/textarea.tsx;内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/shared/ui/textarea.tsx | 共享 UI/样式/主题/特性开关迁入 client-kit（逐文件证据见覆盖率列） |
| M | `desktop/src/shared/ui/toggle.tsx` | +1/−46 |  | (b) | DD-74 | client-kit: react/composer/shared/ui/toggle | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/tooltip.tsx` | +1/−54 |  | (b) | DD-74 | client-kit: react/sidebar/tooltip | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/useVideoContextMenu.tsx` | +7/−61 |  | (b) | DD-74 | client-kit: react/video-review | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/videoAspectRatio.ts` | +1/−47 |  | (b) | DD-74 | client-kit: react/video-review/videoAspectRatio | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/videoDownload.ts` | +1/−20 |  | (b) | DD-74 | client-kit: react/video-review/videoDownload | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/videoPlayerState.ts` | +1/−57 |  | (b) | DD-74 | client-kit: react/video-review/videoPlayerState | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/shared/ui/videoReviewTimecode.ts` | +1/−41 |  | (b) | DD-74 | client-kit: react/video-review/videoReviewTimecode | 原位文件改为消费共享主体（宿主适配层） |

### Desktop src 其他（8）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src/features-manifest.d.ts` | +0/−9 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/jdenticon.d.ts` | +0/−3 | = | (d) | - | 内容覆盖0% | 类型声明 |
| M | `desktop/src/main.tsx` | +15/−44 |  | (b) | DD-74 | client-kit: conversationDensityPreference, fontSizePreference | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/src/testing/e2eBridge.ts` | +1566/−11265 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src/testing/e2eBridgeCustomHarnesses.test.mjs` | +0/−246 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/testing/e2eBridgeCustomHarnesses.ts` | +0/−127 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src/types/qrcode.d.ts` | +0/−17 | desktop/src/types | (a) | DD-125(5)、DD-72、DD-75 | 内容覆盖0% | 仅供移动端配对二维码，配对向手机交付私钥被排除 |
| D | `desktop/src/upng-js.d.ts` | +0/−19 | = | (d) | - | 内容覆盖100%:client-kit/ts/platform/src/react/profile/buzz/upng-js.d.ts | 类型声明 |

### Desktop src-tauri archive（19）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/archive/agent_usage.rs` | +0/−886 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖7% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/agent_usage_p4a_tests.rs` | +0/−512 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/agent_usage_tests.rs` | +0/−837 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/archive_db.rs` | +0/−199 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖7% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/archive_db_tests.rs` | +0/−246 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/metric_store.rs` | +0/−630 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖5% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/metric_store_tests.rs` | +0/−864 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/mod.rs` | +0/−869 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖19% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/mod_agent_metric_tests.rs` | +0/−411 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/mod_tests.rs` | +0/−1028 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/pipeline.rs` | +0/−489 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖3% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/retention.rs` | +0/−216 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖2% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/retention_tests.rs` | +0/−440 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/store.rs` | +0/−891 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖6% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/store_migration_tests.rs` | +0/−867 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/store_migrations.rs` | +0/−459 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖9% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/store_tests.rs` | +0/−859 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/archive/sync.rs` | +0/−617 | desktop/src-tauri/src/archive | (c) | DD-125(5) | 内容覆盖10% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/archive/sync_tests.rs` | +0/−983 | desktop/src-tauri/src/archive | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |

### Desktop src-tauri commands/agents/runtime（41）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/agent_access.rs` | +0/−31 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_auth.rs` | +0/−729 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖8% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_config.rs` | +0/−550 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖12% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_config_tests.rs` | +0/−773 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery.rs` | +0/−1804 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/forced_single_flight.rs` | +0/−80 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖11% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_capture.rs` | +0/−319 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_capture_tests.rs` | +0/−437 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_exec.rs` | +0/−930 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_report.rs` | +0/−595 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_report_redaction_tests.rs` | +0/−480 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_report_test_support.rs` | +0/−106 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery/install_report_tests.rs` | +0/−564 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery/managed_node.rs` | +0/−672 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/managed_node_tests.rs` | +0/−481 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_discovery/post_install_verification.rs` | +0/−80 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/relay_directory.rs` | +0/−663 | desktop/src-tauri/src/commands/agent_discovery | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖13% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_discovery/relay_directory/owned_tests.rs` | +0/−192 | desktop/src-tauri/src/commands/agent_discovery | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_logs.rs` | +0/−40 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖24% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_metric_archive.rs` | +0/−18 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_model_process.rs` | +0/−86 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models.rs` | +0/−788 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖10% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_databricks.rs` | +0/−342 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_databricks_tests.rs` | +0/−109 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_models_discovery_config.rs` | +0/−112 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_env.rs` | +0/−130 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖21% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_openrouter.rs` | +0/−112 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖15% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_tests.rs` | +0/−991 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_models_update.rs` | +0/−477 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_models_update_tests.rs` | +0/−373 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/agent_providers.rs` | +0/−46 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖11% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_settings.rs` | +0/−106 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖21% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agent_update_rollback.rs` | +0/−231 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents.rs` | +0/−1180 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖12% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents/provider_access.rs` | +0/−235 | desktop/src-tauri/src/commands/agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents/provider_deploy.rs` | +0/−468 | desktop/src-tauri/src/commands/agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖9% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents_create_fields.rs` | +0/−49 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents_deploy.rs` | +0/−808 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents_pending.rs` | +0/−438 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖11% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents_profile.rs` | +0/−376 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖14% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/commands/agents_tests.rs` | +0/−794 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |

### Desktop src-tauri commands/media（6）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src-tauri/src/commands/media.rs` | +54/−244 |  | (b) | DD-39 | collaboration/crates/buzz-sdk/src/media/ | 上传前图片处理迁入 buzz-sdk |
| R | `desktop/src-tauri/src/commands/media_animated.rs → crates/buzz-sdk/src/media/media_animated.rs` | +3/−1 | desktop/src-tauri/src/commands/media_animated.rs | (b) | DD-39 | collaboration/crates/buzz-sdk/src/media/media_animated.rs | 原图片处理迁入 buzz-sdk，Native 与 BFF 共用 |
| M | `desktop/src-tauri/src/commands/media_download.rs` | +0/−440 |  | (c) | - |  | Agent/团队快照下载（依附快照功能） |
| R | `desktop/src-tauri/src/commands/media_gif.rs → crates/buzz-sdk/src/media/media_gif.rs` | +3/−1 | desktop/src-tauri/src/commands/media_gif.rs | (b) | DD-39 | collaboration/crates/buzz-sdk/src/media/media_gif.rs | 原图片处理迁入 buzz-sdk，Native 与 BFF 共用 |
| R | `desktop/src-tauri/src/commands/media_snapshot_png.rs → crates/buzz-sdk/src/media/media_snapshot_png.rs` | +3/−86 | desktop/src-tauri/src/commands/media_snapshot_png.rs | (b) | DD-39 | collaboration/crates/buzz-sdk/src/media/media_snapshot_png.rs | 原图片处理迁入 buzz-sdk，Native 与 BFF 共用 |
| M | `desktop/src-tauri/src/commands/media_transcode.rs` | +3/−4 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |

### Desktop src-tauri commands/mesh（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/mesh_llm.rs` | +0/−858 | = | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖4% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/commands/mesh_llm_tests.rs` | +0/−532 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/mesh_readiness.rs` | +0/−251 | = | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖7% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |

### Desktop src-tauri commands/pairing（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/pairing.rs` | +0/−793 | = | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖13% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `desktop/src-tauri/src/commands/pairing_generation_tests.rs` | +0/−129 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/pairing_relay_tests.rs` | +0/−104 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |

### Desktop src-tauri commands/personas/teams（37）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/personas/card.rs` | +0/−999 | desktop/src-tauri/src/commands/personas | (a) | DD-131(5) | client-kit/ts/platform/src/react/agent-library/；内容覆盖8% | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| D | `desktop/src-tauri/src/commands/personas/card/tests.rs` | +0/−399 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖1% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/create.rs` | +0/−94 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖15% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/delete_cascade_tests.rs` | +0/−209 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/inbound.rs` | +0/−854 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖6% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/inbound/catalog_reconcile_tests.rs` | +0/−165 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/inbound/inbound_tests.rs` | +0/−935 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/mod.rs` | +0/−356 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖11% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/pending.rs` | +0/−586 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖12% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/sharing.rs` | +0/−397 | desktop/src-tauri/src/commands/personas | (c) | DD-131 | 内容覆盖22% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/personas/snapshot.rs` | +0/−536 | desktop/src-tauri/src/commands/personas | (c) | DD-131 | 内容覆盖8% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/fidelity_tests.rs` | +0/−277 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/import.rs` | +0/−901 | desktop/src-tauri/src/commands/personas | (c) | DD-131 | 内容覆盖10% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/import_avatar_tests.rs` | +0/−107 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/tests.rs` | +0/−980 | desktop/src-tauri/src/commands/personas | (c) | DD-131 | 内容覆盖2% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/tests_encode_size.rs` | +0/−55 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/tests_locked.rs` | +0/−130 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/snapshot/tests_memory_entries.rs` | +0/−55 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/personas/update.rs` | +0/−327 | desktop/src-tauri/src/commands/personas | (a) | DD-25、DD-125(4) | client-kit/ts/platform/src/react/agent-library/；内容覆盖6% | Persona ≙ Tenant 级 AgentDefinition；本机 persona 目录/入站/挂起改为 Core Definition/Version |
| D | `desktop/src-tauri/src/commands/personas/update/name_propagation_tests.rs` | +0/−211 | desktop/src-tauri/src/commands/personas | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/team_snapshot.rs` | +0/−976 | = | (c) | DD-131 | 内容覆盖10% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/team_snapshot/tests.rs` | +0/−795 | desktop/src-tauri/src/commands/team_snapshot | (c) | DD-131 | 内容覆盖4% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/adopt.rs` | +0/−204 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖19% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/adopt/apply.rs` | +0/−489 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖5% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/adopt/tests.rs` | +0/−942 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖6% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/adopt/tests/concealment.rs` | +0/−104 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/adopt/tests/retention.rs` | +0/−345 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/adopt/tests/reuse.rs` | +0/−104 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/adopt/tests/scope_fence.rs` | +0/−166 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/mod.rs` | +0/−547 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖12% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/pending.rs` | +0/−500 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖7% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/pending/tests.rs` | +0/−830 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖20% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/pending/tests/cross_device.rs` | +0/−307 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/pending/tests/gate.rs` | +0/−402 | desktop/src-tauri/src/commands/teams | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/teams/sharing.rs` | +0/−149 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖16% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/sharing/tests.rs` | +0/−700 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖20% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/commands/teams/tests.rs` | +0/−426 | desktop/src-tauri/src/commands/teams | (c) | DD-131 | 内容覆盖7% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |

### Desktop src-tauri commands/project git/terminal（13）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/project_git.rs` | +0/−873 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；引用:collaboration/crates/buzz-project-git/src/lib.rs;内容覆盖44%:collaboration/crates/buzz-project-git/src/snapshot.rs | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| R | `desktop/src-tauri/src/commands/project_git_branches.rs → crates/buzz-project-git/src/branches.rs` | +169/−79 | desktop/src-tauri/src/commands/project_git_branches.rs | (b) | DD-118 | collaboration/crates/buzz-project-git/src/branches.rs | 原 project_git* 读取实现迁入 Desktop/Core 共用 crate |
| R | `desktop/src-tauri/src/commands/project_git_diff.rs → crates/buzz-project-git/src/diff.rs` | +98/−197 | desktop/src-tauri/src/commands/project_git_diff.rs | (b) | DD-118 | collaboration/crates/buzz-project-git/src/diff.rs | 原 project_git* 读取实现迁入 Desktop/Core 共用 crate |
| D | `desktop/src-tauri/src/commands/project_git_exec.rs` | +0/−522 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；引用:collaboration/crates/buzz-project-git/src/exec.rs;内容覆盖54%:collaboration/crates/buzz-project-git/src/exec.rs | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| R | `desktop/src-tauri/src/commands/project_git_file_content.rs → crates/buzz-project-git/src/file_content.rs` | +41/−57 | desktop/src-tauri/src/commands/project_git_file_content.rs | (b) | DD-118 | collaboration/crates/buzz-project-git/src/file_content.rs | 原 project_git* 读取实现迁入 Desktop/Core 共用 crate |
| D | `desktop/src-tauri/src/commands/project_git_merge_error.rs` | +0/−152 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；内容覆盖21% | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| D | `desktop/src-tauri/src/commands/project_git_push.rs` | +0/−136 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；内容覆盖22% | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| D | `desktop/src-tauri/src/commands/project_git_recipient_notes.rs` | +0/−430 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；内容覆盖23% | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| D | `desktop/src-tauri/src/commands/project_git_tests.rs` | +0/−111 | = | (d) | - | 内容覆盖78%:collaboration/crates/buzz-project-git/src/snapshot.rs | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/project_git_types.rs` | +0/−91 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；引用:collaboration/crates/buzz-project-git/src/types.rs;内容覆盖44%:collaboration/crates/buzz-project-git/src/types.rs | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| D | `desktop/src-tauri/src/commands/project_git_workflow.rs` | +0/−898 | = | (b) | DD-118 | collaboration/crates/buzz-project-git/src/；引用:collaboration/crates/buzz-project-git/src/merge.rs;内容覆盖17% | 原 project_git* 远程读取/分支/merge 抽为 Desktop 与 Core 共用的 buzz-project-git（Desktop 本机命令宿主未注册的部分见待定/c 备注） |
| D | `desktop/src-tauri/src/commands/project_repo_paths.rs` | +0/−236 | = | (c) | - | 内容覆盖9% | Desktop 本机仓库克隆路径管理（打开本地仓库/终端）未恢复；无授权排除 |
| D | `desktop/src-tauri/src/commands/project_terminal.rs` | +0/−284 | = | (c) | - | 内容覆盖20% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |

### Desktop src-tauri commands/其他（37）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/commands/bestie.rs` | +0/−218 | = | (d) | - | 内容覆盖23% | 受保护特性 Bestie 的后端命令（OSS 构建不可见） |
| D | `desktop/src-tauri/src/commands/canvas.rs` | +0/−60 | = | (a) | DD-125(4)、DD-80 | client-kit/ts/platform/src/react/channel-canvas.tsx；内容覆盖43%:collaboration/desktop/src-tauri/src/commands/messages.rs | Canvas 写入改为 workspace.canvas.set（CONTROL 签 40100），读取经本人身份 |
| M | `desktop/src-tauri/src/commands/channel_reconnect_repair.rs` | +1/−3 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/commands/channel_templates.rs` | +0/−200 | = | (a) | DD-125(4)、DD-40 | client-kit/ts/platform/src/react/channel-templates/；内容覆盖20% | 频道模板本机存储改为 CollaborationUserState.channel_templates |
| M | `desktop/src-tauri/src/commands/channel_window.rs` | +33/−21 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/commands/channels.rs` | +9/−464 |  | (a) | DD-80、DD-119、DD-46 | client-kit/ts/platform/src/react/channel-management-sheet.tsx | Desktop 建频道/改名/归档/删除/加减成员/加入离开改经 BFF 管理面（删除按 DD-119(7) 不提供） |
| M | `desktop/src-tauri/src/commands/channels/fetch.rs` | +75/−294 |  | (a) | DD-80 |  | 开放频道目录读取改经 BFF |
| M | `desktop/src-tauri/src/commands/channels/fetch_tests.rs` | +16/−125 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/commands/channels_tests.rs` | +3/−226 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/dms.rs` | +0/−91 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖39%:collaboration/desktop/src-tauri/src/commands/messages.rs | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src-tauri/src/commands/engrams.rs` | +0/−372 | = | (a) | DD-65、DD-66、DD-68 | client-kit/ts/platform/src/react/memory.tsx；内容覆盖37%:collaboration/crates/buzz-cli/src/commands/mem.rs | Agent 记忆（NIP-AE）由 Core 以 Installation/CONTROL pair 读写，客户端不直写 |
| M | `desktop/src-tauri/src/commands/export_util.rs` | +1/−1 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/commands/global_agent_config.rs` | +0/−497 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| M | `desktop/src-tauri/src/commands/identity.rs` | +62/−458 |  | (a) | DD-75、DD-77、DD-79 |  | nsec 导入/导出、共享身份、自加密改为平台登录 + 设备公钥登记 |
| D | `desktop/src-tauri/src/commands/identity_archive.rs` | +0/−993 | = | (c) | DD-125(5) | 内容覆盖39%:collaboration/desktop/src-tauri/src/commands/relay_self.rs | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/commands/identity_key_backup_tests.rs` | +0/−139 | = | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/join_policy.rs` | +0/−193 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖21% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src-tauri/src/commands/legacy_storage.rs` | +0/−294 | = | (a) | DD-40 | 内容覆盖9% | 旧版本机存储迁移；偏好权威改为 CollaborationUserState |
| D | `desktop/src-tauri/src/commands/managed_agent_definition.rs` | +0/−124 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| M | `desktop/src-tauri/src/commands/messages.rs` | +575/−630 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/commands/messages/event_batch.rs` | +2/−18 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/commands/messages/forum.rs` | +0/−318 | = | (b) | DD-74 | client-kit/ts/platform/src/react/forum/ForumView.tsx；内容覆盖23% | 论坛读写由共享 Forum 主体与原生消息命令承载 |
| M | `desktop/src-tauri/src/commands/messages/thread_ref.rs` | +1/−1 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/commands/messages_tests.rs` | +49/−146 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/commands/mod.rs` | +5/−94 |  | 待定 | DD-75、DD-78、DD-79、DD-80 |  | 原地删减较多（+5/-94），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `desktop/src-tauri/src/commands/observer_archive.rs` | +0/−18 | = | (c) | DD-125(5) | 内容覆盖0% | Local archive（本机身份/消息归档）DD-125(5) 写明“只在 Desktop”保留，Kailo Desktop 已删除，未恢复（Agent 指标/observer 归档部分对象受 DD-26 影响需裁剪） |
| D | `desktop/src-tauri/src/commands/os_idle.rs` | +0/−16 | = | (c) | DD-120(5) | 内容覆盖0% | Desktop 按 OS 空闲自动置 away；DD-120 保留 auto/away/offline 设备偏好，原生空闲探测未恢复 |
| D | `desktop/src-tauri/src/commands/prevent_sleep.rs` | +0/−15 | = | (a) | DD-125(5) | 内容覆盖43%:collaboration/desktop/src-tauri/src/platform/commands.rs | 防休眠对象是一期不存在的本机 Agent，排除 |
| M | `desktop/src-tauri/src/commands/profile.rs` | +112/−276 |  | 待定 | DD-75、DD-78、DD-79、DD-80 |  | 原地删减较多（+112/-276），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `desktop/src-tauri/src/commands/profile_presence_tests.rs` | +0/−103 | = | (d) | - | 内容覆盖29% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/commands/qr_download.rs` | +0/−52 | = | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖18% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `desktop/src-tauri/src/commands/relay_members.rs` | +0/−128 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖34%:collaboration/desktop/src-tauri/src/commands/channel_reconnect_repair.rs | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| D | `desktop/src-tauri/src/commands/social.rs` | +0/−476 | = | (a) | DD-125(5)、DD-77 | client-kit/ts/platform/src/react/pulse/；内容覆盖18% | Pulse 关注改为 CollaborationUserState.followed_principals（kind 3 不进成员白名单） |
| D | `desktop/src-tauri/src/commands/updater.rs` | +0/−24 | = | (c) | DD-125(5)、DD-74 | 内容覆盖25% | Updates 设置分区 DD-125(5) 写明“只在 Desktop”保留；Kailo Desktop 已删除自更新入口，需接 Kailo 发布链（ADR-06） |
| D | `desktop/src-tauri/src/commands/workflows.rs` | +0/−471 | = | (a) | DD-106、DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖21% | Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinition + Temporal 承接 |
| D | `desktop/src-tauri/src/commands/workflows_tests.rs` | +0/−314 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/commands/workspace.rs` | +25/−315 |  | (a) | DD-01、DD-40 |  | 多 workspace/社区图标与本机保留期迁移 |

### Desktop src-tauri huddle（45）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/huddle/agent_tts_publisher.rs` | +0/−75 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖6% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/agent_tts_routing.rs` | +0/−57 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/agent_tts_routing_tests.rs` | +0/−58 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/agent_voice.rs` | +0/−310 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖7% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/agents.rs` | +0/−326 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:core/crates/collab-bridge/src/huddle.rs;内容覆盖11% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/audio_output.rs` | +0/−166 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖10% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/commands.rs` | +0/−216 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:web-client/web/src/platform/huddle/WebHuddleHost.ts;内容覆盖9% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/human_floor.rs` | +0/−73 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖3% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/jitter.rs` | +0/−267 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/latency_bench.rs` | +0/−332 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/local_barge_in.rs` | +0/−151 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖3% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/mod.rs` | +0/−932 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:web-client/web/src/platform/huddle/WebHuddleHost.test.ts;内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/models.rs` | +0/−997 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/models_tests.rs` | +0/−159 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/models_voice_upgrade.rs` | +0/−128 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖3% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/pipeline.rs` | +0/−881 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/playout.rs` | +0/−827 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:client-kit/ts/platform/src/huddle.ts;内容覆盖3% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/pocket.rs` | +0/−4 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/preprocessing.rs` | +0/−543 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/reconnect.rs` | +0/−52 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖10% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/relay_api.rs` | +0/−713 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:client-kit/ts/platform/src/huddle.ts;内容覆盖8% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/state.rs` | +0/−553 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:client-kit/ts/platform/src/react/huddle/host.tsx;内容覆盖4% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/stt.rs` | +0/−845 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖2% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/stt_tests.rs` | +0/−260 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/transcription.rs` | +0/−74 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖11% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts.rs` | +0/−953 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_activity.rs` | +0/−45 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖5% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_append.rs` | +0/−107 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_audio.rs` | +0/−135 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_broadcast.rs` | +0/−270 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖6% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_pipeline_controls.rs` | +0/−129 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖0% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_playback.rs` | +0/−884 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_settings.rs` | +0/−973 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖6% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_speaker_cancellation.rs` | +0/−327 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_startup.rs` | +0/−24 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖18% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_startup_tests.rs` | +0/−44 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/tts_streaming.rs` | +0/−97 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖6% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_tests.rs` | +0/−974 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/tts_tests/token_split.rs` | +0/−22 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/tts_voice_import.rs` | +0/−59 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖12% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_voice_registry.rs` | +0/−129 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖2% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/tts_voice_selection_tests.rs` | +0/−424 | desktop/src-tauri/src/huddle | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/huddle/tts_voice_transition.rs` | +0/−788 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/window.rs` | +0/−67 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 内容覆盖29% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/src/huddle/wire.rs` | +0/−346 | desktop/src-tauri/src/huddle | (c) | DD-125(3) | 引用:client-kit/ts/platform/src/huddle.ts;内容覆盖1% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |

### Desktop src-tauri managed_agents（124）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/managed_agents/access_policy.rs` | +0/−190 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/agent_description.rs` | +0/−154 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/agent_env.rs` | +0/−453 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/agent_events.rs` | +0/−490 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/agent_snapshot.rs` | +0/−555 | desktop/src-tauri/src/managed_agents | (c) | DD-131(2) | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖13% | Agent 快照清单：按 DD-131(2) 由 Core 以 TransferFormat `buzz-agent-snapshot@1` 恢复导出/导入（只含可移植字段，排除记忆与本机运行时字段），待实现 |
| D | `desktop/src-tauri/src/managed_agents/agent_snapshot_envelope.rs` | +0/−644 | desktop/src-tauri/src/managed_agents | (a) | DD-131(5) | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 加密锁定卡排除：解锁需要 Agent 私钥，Kailo Agent 私钥只由 Core 持有（DD-131(5)、DD-72/75） |
| D | `desktop/src-tauri/src/managed_agents/agent_snapshot_tests.rs` | +0/−672 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/backend.rs` | +0/−704 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖9% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/backend_tests.rs` | +0/−452 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/bestie_assignment.rs` | +0/−595 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/claude_config/mod.rs` | +0/−33 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/claude_config/tests.rs` | +0/−63 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/buzz_agent.rs` | +0/−7 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/claude.rs` | +0/−238 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/codex.rs` | +0/−311 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/effort.rs` | +0/−506 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/effort_cmd_tests.rs` | +0/−356 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/effort_tests.rs` | +0/−703 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/goose.rs` | +0/−312 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/mod.rs` | +0/−38 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/reader.rs` | +0/−882 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/reader_tests.rs` | +0/−969 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/reader_tests_ext.rs` | +0/−977 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/reader_tests_ext2.rs` | +0/−69 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/schema_walker.rs` | +0/−292 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/config_bridge/types.rs` | +0/−380 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖24% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/custom_harnesses.rs` | +0/−1231 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/definition_validation.rs` | +0/−327 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery.rs` | +0/−1258 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖8% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/auth_status_cache.rs` | +0/−105 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/bounded_command.rs` | +0/−999 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/catalog.rs` | +0/−156 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/login_shell.rs` | +0/−510 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/login_shell_spawn_probe.rs` | +0/−108 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖9% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/overrides.rs` | +0/−211 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/presets.rs` | +0/−604 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/runtime_metadata.rs` | +0/−221 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/tests.rs` | +0/−1757 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/discovery/tests/codex_version.rs` | +0/−75 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/discovery/tests/effort_clear.rs` | +0/−188 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/discovery/tests/forced_discovery.rs` | +0/−170 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/discovery/tests/managed_path_resolution.rs` | +0/−221 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/discovery/windows_install.rs` | +0/−225 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/effective_config/mod.rs` | +0/−318 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/effective_config/tests.rs` | +0/−884 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/env_vars.rs` | +0/−286 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/env_vars/tests.rs` | +0/−514 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/git_bash.rs` | +0/−676 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/global_config/mod.rs` | +0/−237 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/global_config/tests.rs` | +0/−662 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/managed_node_paths.rs` | +0/−101 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖16% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/mod.rs` | +0/−149 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/nest.rs` | +0/−834 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/nest/render_tests.rs` | +0/−719 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/nest/tests.rs` | +0/−566 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/nest_agents.md` | +0/−65 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/nest_skill.md` | +0/−175 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/parallelism.rs` | +0/−313 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/persona_avatars.rs` | +0/−8 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/persona_events.rs` | +0/−699 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖13% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/persona_events/stale_pin_tests.rs` | +0/−156 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/persona_events/tests.rs` | +0/−1053 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/personas.rs` | +0/−398 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/personas/tests.rs` | +0/−419 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/process_lifecycle.rs` | +0/−207 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/readiness.rs` | +0/−1712 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/readiness/cli_login.rs` | +0/−80 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/readiness/cli_probe.rs` | +0/−248 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/readiness/tests/openrouter_tests.rs` | +0/−57 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/readiness_goose_file_config_tests.rs` | +0/−190 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/reconcile.rs` | +0/−169 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖7% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/reconcile/tests.rs` | +0/−402 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖12% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/relay_mesh.rs` | +0/−422 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/repos.rs` | +0/−790 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/reserved_env_keys.rs` | +0/−88 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/restore.rs` | +0/−580 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖8% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/retention.rs` | +0/−633 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/retention/legacy_migration.rs` | +0/−212 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/retention/legacy_migration/tests.rs` | +0/−186 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖9% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/retention/tests.rs` | +0/−844 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime.rs` | +0/−940 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/cli_tests.rs` | +0/−38 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/runtime/instance_reaper.rs` | +0/−359 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/lifecycle.rs` | +0/−125 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/metadata.rs` | +0/−257 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/orphan_sweep.rs` | +0/−387 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/path.rs` | +0/−658 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/process.rs` | +0/−469 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/setup_payload.rs` | +0/−125 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/spawn_key.rs` | +0/−84 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/stop.rs` | +0/−253 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/sweep.rs` | +0/−721 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/test_fixtures.rs` | +0/−98 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime/tests.rs` | +0/−1246 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime_commands.rs` | +0/−734 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖8% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/runtime_types.rs` | +0/−120 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖34%:collaboration/crates/buzz-db/src/store/deletion.rs | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/screenshot_skill.md` | +0/−103 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/session_policy.rs` | +0/−146 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/snapshot_avatar.rs` | +0/−42 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖8% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/spawn_snapshot.rs` | +0/−355 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff.rs` | +0/−308 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/spawn_snapshot/diff/tests.rs` | +0/−631 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/spawn_snapshot/tests.rs` | +0/−944 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖1% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/spawn_snapshot/tests_ext.rs` | +0/−472 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/storage.rs` | +0/−994 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/storage_tests.rs` | +0/−832 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/team_catalog.rs` | +0/−857 | desktop/src-tauri/src/managed_agents | (a) | DD-131(6)、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖10% | Relay kind:30178 团队目录事件不进入运行链；目录读模型改为 Core 的已分享 `agent_team`（DD-131(6)），目录 UI 见 CommunityCatalogDialog 等 (c) 行 |
| D | `desktop/src-tauri/src/managed_agents/team_catalog/tests.rs` | +0/−994 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖3% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/team_catalog/tests/concealment.rs` | +0/−72 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/team_catalog/tests/reuse_hint.rs` | +0/−90 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/team_events.rs` | +0/−271 | desktop/src-tauri/src/managed_agents | (a) | DD-131(1)、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖10% | 本机团队的 kind:30176 同步不进入运行链；团队权威为 Core `agent_team`（DD-131(1)） |
| D | `desktop/src-tauri/src/managed_agents/team_repair.rs` | +0/−58 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖6% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/team_snapshot.rs` | +0/−597 | desktop/src-tauri/src/managed_agents | (c) | DD-131(3) | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 团队快照清单：按 DD-131(3) 由 Core 以 `buzz-team-snapshot@1` 恢复，导入整包原子，待实现 |
| D | `desktop/src-tauri/src/managed_agents/teams.rs` | +0/−487 | desktop/src-tauri/src/managed_agents | (a) | DD-131(1)、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖2% | 本机 `teams.json` 存储不进入运行链；团队权威为 Core `agent_team`（DD-131(1)） |
| D | `desktop/src-tauri/src/managed_agents/teams_tests.rs` | +0/−869 | desktop/src-tauri/src/managed_agents | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/managed_agents/types.rs` | +0/−1001 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖18% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/catalog_source.rs` | +0/−52 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖14% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/catalog_source/tests.rs` | +0/−62 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/relay_mesh.rs` | +0/−19 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖40%:collaboration/desktop/src-tauri/src/platform/config.rs | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/requests.rs` | +0/−500 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖10% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/team_catalog_source.rs` | +0/−77 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖11% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/team_catalog_source/tests.rs` | +0/−94 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/managed_agents/types/teams.rs` | +0/−68 | desktop/src-tauri/src/managed_agents | (a) | DD-131(1) | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖55%:core/crates/platform-core/src/user_state_collab.rs | TeamRecord 以 Core `AgentTeam` 取代；团队级 instructions 排除（不进入成员版本 config_hash，DD-131(1)） |
| D | `desktop/src-tauri/src/managed_agents/types/tests.rs` | +0/−819 | desktop/src-tauri/src/managed_agents | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖0% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |

### Desktop src-tauri mesh_llm（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/mesh_llm/catalog.rs` | +0/−347 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖5% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/coordinator.rs` | +0/−672 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖10% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/discovery.rs` | +0/−360 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖21% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/identity.rs` | +0/−149 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 引用:collaboration/crates/buzz-relay/examples/mesh_relay_lifecycle_smoke.rs;内容覆盖34%:collaboration/crates/buzz-relay/examples/mesh_relay_lifecycle_smoke.rs | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/mod.rs` | +0/−950 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖10% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/mod_tests.rs` | +0/−726 | desktop/src-tauri/src/mesh_llm | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/mesh_llm/progress.rs` | +0/−73 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖12% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/recovery.rs` | +0/−712 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖4% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/transport_policy.rs` | +0/−527 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖3% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |
| D | `desktop/src-tauri/src/mesh_llm/usage.rs` | +0/−68 | desktop/src-tauri/src/mesh_llm | (a) | DD-125(5)、DD-26、DD-87 | 内容覆盖10% | Compute（本机算力供他人运行 Agent）属第二运行链，排除 |

### Desktop src-tauri migration（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/migration/backfill.rs` | +0/−140 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖0% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/backfill_tests.rs` | +0/−337 | desktop/src-tauri/src/migration | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration/detach.rs` | +0/−150 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖6% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/fold.rs` | +0/−316 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖5% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/materialize.rs` | +0/−140 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖7% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/pollen.rs` | +0/−862 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖7% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/team_membership.rs` | +0/−353 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖1% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/team_membership_tests.rs` | +0/−625 | desktop/src-tauri/src/migration | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration/team_suffix.rs` | +0/−182 | desktop/src-tauri/src/migration | (a) | DD-26、DD-40 | 内容覆盖2% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration/team_suffix_tests.rs` | +0/−449 | desktop/src-tauri/src/migration | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |

### Desktop src-tauri terminal_runtime（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/src-tauri/src/terminal_runtime/scroll_sign.rs` | +0/−179 | desktop/src-tauri/src/terminal_runtime | (c) | - | 内容覆盖5% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |

### Desktop src-tauri 其他（69）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src-tauri/src/app_menu.rs` | +6/−13 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/app_state.rs` | +13/−105 |  | 待定 | DD-75、DD-78、DD-79、DD-80 |  | 原地删减较多（+13/-105），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src-tauri/src/app_state_accessors.rs` | +0/−51 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/app_state_pending_channels.rs` | +0/−55 | = | (a) | DD-80、DD-41、DD-83 | client-kit/ts/platform/src/react/channel-members.tsx；client-kit/ts/platform/src/react/invitations.tsx；内容覆盖7% | 频道/私聊建立、成员与加入策略、邀请只经 BFF 管理面由 Core 经 CONTROL 投影 |
| M | `desktop/src-tauri/src/app_state_tests.rs` | +2/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/build_identity.rs` | +0/−108 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/builderlab.rs` | +0/−687 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖19% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| M | `desktop/src-tauri/src/channel_head_cache.rs` | +0/−19 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/deep_link.rs` | +112/−396 |  | (a) | DD-01、DD-83 |  | 添加社区/加入邀请深链移除（社区切换、邀请改 Tenant 邀请）；实体深链保留 |
| M | `desktop/src-tauri/src/deep_link_tests.rs` | +13/−293 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/egress_guard.rs` | +7/−13 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/egress_guard_tests.rs` | +24/−157 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/event_sync.rs` | +0/−797 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖9% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/event_sync_team_catalog_tests.rs` | +0/−438 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/event_sync_team_events_tests.rs` | +0/−266 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/event_sync_tests.rs` | +0/−499 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/events.rs` | +130/−764 |  | (a) | DD-80、DD-119、DD-125 |  | 频道管理/成员/relay admin 事件构造移除（只由 CONTROL 签发）；Huddle 事件改由 Core 投影 |
| D | `desktop/src-tauri/src/events/workflows.rs` | +0/−50 | = | (a) | DD-106、DD-107 | client-kit/ts/platform/src/react/workflows.tsx；内容覆盖19% | Buzz Relay 自带 workflow 引擎/命令关闭；Workflows 产品页面改由 Core AutomationDefinition + Temporal 承接 |
| M | `desktop/src-tauri/src/key_backup.rs` | +7/−85 |  | 待定 | DD-75、DD-78、DD-79、DD-80 |  | 原地删减较多（+7/-85），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `desktop/src-tauri/src/key_backup_tests.rs` | +14/−110 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/lib.rs` | +91/−729 |  | (a) | DD-26、DD-80、DD-125 |  | 已删除命令/插件的注册移除（各功能分类见对应条目） |
| M | `desktop/src-tauri/src/macos_notifications.rs` | +1/−1 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/main.rs` | +0/−4 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/mesh_llm_stubs.rs` | +0/−44 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖4% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| D | `desktop/src-tauri/src/migration.rs` | +0/−1429 | = | (a) | DD-26、DD-40 | 内容覆盖4% | 上游本机 Agent/团队/存储的版本迁移；对应本机数据权威在 Kailo 不存在 |
| D | `desktop/src-tauri/src/migration_avatar_tests.rs` | +0/−335 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_command_tests.rs` | +0/−185 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_databricks_tests.rs` | +0/−360 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_sync_guard_tests.rs` | +0/−27 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_team_dir_tests.rs` | +0/−329 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_test_support.rs` | +0/−45 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/migration_tests.rs` | +0/−993 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/models.rs` | +4/−129 |  | (a) | DD-26 |  | 本机 Agent 模型类型 |
| M | `desktop/src-tauri/src/mouse_nav.rs` | +1/−1 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/native_relay_client.rs` | +66/−720 |  | (a) | DD-75 |  | Native 直连 Relay 会话改为受治理平台会话；本机归档会话随 Local archive 删除（见 c） |
| M | `desktop/src-tauri/src/native_relay_client_tests.rs` | +65/−717 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/native_relay_client_transport_tests.rs` | +0/−169 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/nostr_bind.rs` | +0/−108 | = | 待定 | - | 内容覆盖5% | 上游“绑定 Nostr 身份到外部站点”的挑战签名（buzz-nostr-identity 协议）；Kailo 身份由平台托管（DD-75/77/79），设计未明确是否保留该对外绑定能力 |
| M | `desktop/src-tauri/src/nostr_convert.rs` | +3/−160 |  | (a) | DD-26、DD-125(5) |  | Agent 目录/联系人列表转换 |
| D | `desktop/src-tauri/src/nostr_convert/agent_directory.rs` | +0/−241 | = | (a) | DD-26、DD-15、DD-24 | client-kit/ts/platform/src/react/agents.tsx；core/crates/platform-core/src/agent_installation.rs；内容覆盖5% | 上游本机 Agent 进程/ACP harness/provider/模型发现与部署；Kailo Agent 只由平台托管 Codex（SERVER_CODEX）经 AgentGateway 运行，Agent 管理在 Core |
| M | `desktop/src-tauri/src/nostr_convert/oa_profile_tests.rs` | +2/−3 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/nostr_convert/runtime_policy_tests.rs` | +0/−143 | = | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/nostr_convert/tests.rs` | +0/−549 |  | (d) | - |  | 测试 |
| M | `desktop/src-tauri/src/nostr_convert/user_search.rs` | +0/−19 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/observed_unread.rs` | +1/−2 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/persona_catalog.rs` | +0/−318 | = | (a) | DD-131(6)、DD-24 | client-kit/ts/platform/src/react/agent-library/；内容覆盖20% | Relay kind:30175 shared persona 目录不进入运行链；目录读模型改为 Core 的已分享 AgentDefinition（DD-131(6)） |
| D | `desktop/src-tauri/src/persona_catalog_tests.rs` | +0/−286 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/prevent_sleep.rs` | +0/−200 | = | (a) | DD-125(5) | 内容覆盖13% | 防休眠对象是一期不存在的本机 Agent，排除 |
| D | `desktop/src-tauri/src/ptt_shortcut.rs` | +0/−151 | = | (c) | DD-125(3) | 内容覆盖14% | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| M | `desktop/src-tauri/src/relay.rs` | +7/−260 |  | (a) | DD-26、DD-117 |  | 本机 Agent 资料同步移除（Agent kind:0 由 Core 投影） |
| D | `desktop/src-tauri/src/relay/get.rs` | +0/−42 | = | (b) | DD-75 | collaboration/desktop/src-tauri/src/relay.rs；内容覆盖47%:collaboration/desktop/src-tauri/src/relay.rs | 合入 relay.rs |
| M | `desktop/src-tauri/src/relay/scope.rs` | +3/−125 |  | (a) | DD-01 |  | 多 Relay 切换的作用域绑定 |
| M | `desktop/src-tauri/src/relay/submit.rs` | +4/−57 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/relay/tests.rs` | +2/−171 |  | (d) | - |  | 测试 |
| M | `desktop/src-tauri/src/relay_admission.rs` | +3/−5 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| D | `desktop/src-tauri/src/reset.rs` | +0/−942 | = | 待定 | - | 内容覆盖2% | 上游“重置应用/清除本机身份”与重启提示；Kailo Desktop 登出走平台会话（DD-78），本机设备钥清除路径设计未明确 |
| D | `desktop/src-tauri/src/reset_demo_tests.rs` | +0/−169 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/src/secret_store.rs` | +0/−234 |  | (a) | DD-75、DD-79 |  | 本机密钥存储改为设备身份 |
| M | `desktop/src-tauri/src/shutdown.rs` | +2/−274 |  | (a) | DD-26、DD-125(5) |  | 关停本机 Agent/mesh 运行时的逻辑 |
| D | `desktop/src-tauri/src/team_catalog.rs` | +0/−330 | = | (c) | DD-131 | 内容覆盖14% | Agent Teams、团队/Agent 快照导出导入、persona 分享：DD-131 已定设计（DD-125(4) team 条目随之解除 BLOCKED），待实现 |
| D | `desktop/src-tauri/src/team_catalog_tests.rs` | +0/−352 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/src/templates/mod.rs` | +0/−5 | desktop/src-tauri/src/templates | (a) | DD-125(4)、DD-40 | client-kit/ts/platform/src/react/channel-templates/ | 频道模板本机存储改为 CollaborationUserState.channel_templates |
| D | `desktop/src-tauri/src/templates/storage.rs` | +0/−226 | desktop/src-tauri/src/templates | (a) | DD-125(4)、DD-40 | client-kit/ts/platform/src/react/channel-templates/；内容覆盖5% | 频道模板本机存储改为 CollaborationUserState.channel_templates |
| D | `desktop/src-tauri/src/templates/types.rs` | +0/−96 | desktop/src-tauri/src/templates | (a) | DD-125(4)、DD-40 | client-kit/ts/platform/src/react/channel-templates/；引用:client-kit/ts/platform/src/collaboration-preferences.ts;内容覆盖50%:core/crates/platform-core/src/user_state_collab.rs | 频道模板本机存储改为 CollaborationUserState.channel_templates |
| D | `desktop/src-tauri/src/terminal_runtime.rs` | +0/−997 | = | (c) | - | 内容覆盖12% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/src/terminal_transport.rs` | +0/−382 | = | (c) | - | 内容覆盖1% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/src/tray_menu.rs` | +0/−665 | = | (c) | - | 内容覆盖8% | Desktop 系统托盘菜单；设计无排除 |
| M | `desktop/src-tauri/src/unread_catch_up.rs` | +14/−35 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/src/util.rs` | +0/−456 |  | (a) | DD-26 |  | 本机 Agent 工作目录/符号链接工具 |

### Desktop src-tauri 资源/crates/配置（75）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `desktop/src-tauri/.gitignore` | +0/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/Cargo.lock` | +1461/−7988 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/Cargo.toml` | +7/−52 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/Entitlements.plist` | +0/−5 |  | (a) | DD-75、DD-78、DD-79、DD-80 |  | Native 宿主改走受治理平台会话/设备身份，管理面经 BFF |
| M | `desktop/src-tauri/Info.plist` | +2/−4 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/assets/card_template.png` | +-/−- | desktop/src-tauri/assets | (a) | DD-131(5) |  | 卡片铸造排除：本机 OPENAI_API_KEY 直连提供方并发送 instructions，绕过 AgentGateway PEP 与计量（DD-131(5)、DD-21）；收到的 .agent.png 按 DD-131(2) 导入 |
| M | `desktop/src-tauri/build.rs` | +0/−93 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/src-tauri/capabilities/default.json` | +3/−9 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/Cargo.toml` | +0/−18 | desktop/src-tauri/crates | (d) | - | 内容覆盖33%:collaboration/Cargo.toml | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/context.rs` | +0/−103 | desktop/src-tauri/crates | (c) | - | 内容覆盖15% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/context_tests.rs` | +0/−139 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/damage.rs` | +0/−490 | desktop/src-tauri/crates | (c) | - | 内容覆盖5% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/env_fence.rs` | +0/−85 | desktop/src-tauri/crates | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/env_fence_tests.rs` | +0/−362 | desktop/src-tauri/crates | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/fences.rs` | +0/−262 | desktop/src-tauri/crates | (c) | - | 内容覆盖8% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/lib.rs` | +0/−290 | desktop/src-tauri/crates | (c) | - | 内容覆盖4% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/lifecycle.rs` | +0/−267 | desktop/src-tauri/crates | (c) | - | 内容覆盖9% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/lifecycle_tests.rs` | +0/−581 | desktop/src-tauri/crates | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/listener.rs` | +0/−144 | desktop/src-tauri/crates | (c) | - | 内容覆盖5% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/path.rs` | +0/−46 | desktop/src-tauri/crates | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/reader.rs` | +0/−354 | desktop/src-tauri/crates | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/shared.rs` | +0/−305 | desktop/src-tauri/crates | (c) | - | 内容覆盖4% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/shell.rs` | +0/−138 | desktop/src-tauri/crates | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/src/units.rs` | +0/−382 | desktop/src-tauri/crates | (c) | - | 内容覆盖0% | Projects 内置终端（本机 PTY、终端面板、横幅渲染）；设计无授权排除（01 §5 只排除 Agent 本机自动化），需先补设计决策 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/clusters.rs` | +0/−348 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/cursor.rs` | +0/−41 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/fences.rs` | +0/−169 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/latency.rs` | +0/−156 | desktop/src-tauri/crates | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/resize.rs` | +0/−196 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/scrollback.rs` | +0/−399 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/slicing.rs` | +0/−882 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/slicing_adversarial.rs` | +0/−399 | desktop/src-tauri/crates | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/crates/buzz-terminal/tests/snapshot.rs` | +0/−287 | desktop/src-tauri/crates | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/resources/pocket-voices/NOTICE.md` | +0/−35 | desktop/src-tauri/resources | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/resources/pocket-voices/anna.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/azelma.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/charles.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/eponine.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/eve.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/fantine.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/george.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/jane.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/michael.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/paul.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| D | `desktop/src-tauri/resources/pocket-voices/vera.wav` | +-/−- | desktop/src-tauri/resources | (c) | DD-125(3) |  | Desktop Huddle：DD-125(3) 要求 Desktop 走本机原链（音频直连 Relay、本机转写/朗读、全局按键通话、独立 Huddle 窗口），Kailo Desktop 无任何 huddle 宿主；Web 侧已由共享 Huddle + BFF 音频桥恢复 |
| M | `desktop/src-tauri/tauri.conf.json` | +1/−12 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tauri.windows.conf.json` | +0/−11 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `desktop/src-tauri/tests/csp.rs` | +5/−48 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_bare_https.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_https_over_2048.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_javascript.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_malformed_port.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_non_ascii_over_utf8_limit.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_unicode_bom.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_unicode_em_space.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_unicode_nbsp.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_avatar_url_whitespace_in_url.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_builtin_slug_wrong_type.json` | +0/−13 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_description_wrong_type.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_duplicate_member_key.json` | +0/−16 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_instructions_wrong_type.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_name_pool_not_array.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_name_pool_null.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_respond_to_pascal_case.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/invalid_team_name_blank.json` | +0/−11 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_avatar_url_https.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_avatar_url_non_ascii_at_utf8_limit.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_avatar_url_shorthand_scheme.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_avatar_url_unicode_nel.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_avatar_url_uppercase_scheme.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_minimal.json` | +0/−11 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_respond_to_allowlist.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_respond_to_anyone.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/fixtures/team_catalog_content/valid_respond_to_owner_only.json` | +0/−12 | desktop/src-tauri/tests/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/src-tauri/tests/rodio_mixer_diagnostic.rs` | +0/−142 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |

### Desktop 根配置/资源（26）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/.env.e2e` | +0/−1 | = | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/.gitignore` | +1/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/package.json` | +11/−18 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/playwright.config.ts` | +9/−111 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/playwright.release-smoke.config.ts` | +0/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/public/app-icon@2x.png` | +-/−- | = | (d) | - |  | 应用图标资源（随发布配置） |
| D | `desktop/public/app-icon@3x.png` | +-/−- | = | (d) | - |  | 应用图标资源（随发布配置） |
| D | `desktop/public/harness-logos/CREDITS.md` | +0/−41 | desktop/public/harness-logos | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/public/harness-logos/amp.png` | +-/−- | desktop/public/harness-logos | (a) | DD-26 |  | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/devin.svg` | +0/−4 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/grok.svg` | +0/−4 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/hermes.png` | +-/−- | desktop/public/harness-logos | (a) | DD-26 |  | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/kimi.png` | +-/−- | desktop/public/harness-logos | (a) | DD-26 |  | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/omp.svg` | +0/−16 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/openclaw.svg` | +0/−16 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/opencode.svg` | +0/−7 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/harness-logos/pi.svg` | +0/−21 | desktop/public/harness-logos | (a) | DD-26 | 内容覆盖0% | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/onboarding/starter-team/fizz.png` | +-/−- | desktop/public/onboarding | (a) | DD-125(5) |  | Welcome 起步内置 persona 头像 |
| D | `desktop/public/onboarding/starter-team/honey.png` | +-/−- | desktop/public/onboarding | (a) | DD-125(5) |  | Welcome 起步内置 persona 头像 |
| D | `desktop/public/onboarding/starter-team/pollen.png` | +-/−- | desktop/public/onboarding | (a) | DD-125(5) |  | Welcome 起步内置 persona 头像 |
| D | `desktop/public/runtime-icons/claude.png` | +-/−- | desktop/public/runtime-icons | (a) | DD-26 |  | 本机 harness/runtime 图标；平台只托管 SERVER_CODEX 运行时 |
| D | `desktop/public/worklet.js` | +0/−67 | = | (b) | DD-125(3) | web-client/web/public/huddle-capture-worklet.js；引用:web-client/web/public/huddle-capture-worklet.js;内容覆盖76%:web-client/web/public/huddle-capture-worklet.js | 采集 worklet 迁入 Web Huddle（Desktop 原生 Huddle 未恢复，见 c 类） |
| M | `desktop/tailwind.config.js` | +1/−148 |  | (b) | DD-74 | client-kit: tailwind.config | 原位文件改为消费共享主体（宿主适配层） |
| M | `desktop/test-loader-hooks.mjs` | +4/−26 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |
| M | `desktop/tsconfig.json` | +1/−5 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/vite.config.ts` | +4/−27 |  | (d) | - |  | 测试/构建/发布文件 |

### Desktop 测试/脚本（164）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `desktop/scripts/build-protected-feature-artifacts.mjs` | +0/−151 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/scripts/build-release-config.mjs` | +0/−67 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| M | `desktop/scripts/check-pubkey-truncation.mjs` | +0/−6 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/scripts/fix-appimage.sh` | +0/−208 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/scripts/generate-oss-latest-json.sh` | +0/−44 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/scripts/set-dmg-finder-text-size.sh` | +0/−82 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/scripts/set-version-from-tag.mjs` | +0/−38 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/scripts/tauri-command.mjs` | +0/−80 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/scripts/verify-macos-entitlements.sh` | +0/−44 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/active-turn-resilience.spec.ts` | +0/−142 | = | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/activity-scope-label-screenshots.spec.ts` | +0/−163 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/add-community-screenshots.spec.ts` | +0/−208 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-access-warning.spec.ts` | +0/−363 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-availability.spec.ts` | +0/−744 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-control-regressions.spec.ts` | +0/−430 | = | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-error-state-screenshots.spec.ts` | +0/−215 | = | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-lifecycle-feedback.spec.ts` | +0/−395 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-numeric-tuning.spec.ts` | +0/−372 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-provider-dropdowns.spec.ts` | +0/−255 | = | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-readiness-screenshots.spec.ts` | +0/−342 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agent-snapshot-recipient.spec.ts` | +0/−357 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agents-everywhere.live.spec.ts` | +0/−261 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/agents.spec.ts` | +0/−2935 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/animated-avatar.spec.ts` | +0/−344 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/badge.spec.ts` | +13/−475 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/bestie.spec.ts` | +0/−394 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/buzz-theme-screenshots.spec.ts` | +19/−211 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/channel-activity-popover.spec.ts` | +6/−283 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/channel-add-screenshots.spec.ts` | +0/−46 | = | (d) | - | 内容覆盖37%:collaboration/desktop/tests/e2e/drafts-screenshots.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/channel-browser.spec.ts` | +0/−555 | = | (d) | - | 内容覆盖33%:collaboration/desktop/tests/e2e/integration.spec.ts | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/channel-composer-overflow.spec.ts` | +56/−134 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/channel-controls.spec.ts` | +0/−407 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/channel-sort.spec.ts` | +0/−41 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/channel-window-mock-paging.spec.ts` | +3/−23 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/channels.spec.ts` | +264/−5125 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/cloud-provenance.spec.ts` | +0/−207 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/community-rail.spec.ts` | +0/−1539 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/composer-selection-formatting.spec.ts` | +10/−3 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/composer-tooltip-dismiss.spec.ts` | +0/−16 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/config-bridge-screenshots.spec.ts` | +0/−373 | = | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/core-memory-screenshots.spec.ts` | +0/−214 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/custom-emoji-ui.spec.ts` | +0/−116 | = | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/custom-emoji.spec.ts` | +0/−728 | = | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/deep-link-invite.spec.ts` | +0/−415 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/dm-double-notification.spec.ts` | +0/−117 | = | (d) | - | 内容覆盖49%:collaboration/desktop/tests/e2e/integration.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/dm-history-live-regression.spec.ts` | +0/−203 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/dm-new-message-screenshots.spec.ts` | +0/−73 | = | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/doctor-cta-screenshots.spec.ts` | +0/−300 | = | (d) | - | 内容覆盖33%:collaboration/desktop/tests/e2e/drafts-screenshots.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/doctor-states.spec.ts` | +0/−1062 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/drafts-screenshots.spec.ts` | +0/−31 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/edit-agent-run-on.spec.ts` | +0/−212 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/edit-agent.spec.ts` | +0/−409 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/empty-edit-delete.spec.ts` | +0/−121 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/entity-link-recipient-cards.spec.ts` | +0/−747 | = | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/exact-key-profile.spec.ts` | +0/−138 | = | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/file-attachment.spec.ts` | +6/−88 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/fixtures/fake-acp-agent.mjs` | +0/−104 | desktop/tests/e2e/fixtures | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/forum-agent-invitation.spec.ts` | +0/−640 | = | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/global-agent-config-screenshots.spec.ts` | +0/−1104 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/harness-catalog-screenshots.spec.ts` | +0/−179 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/harness-management.spec.ts` | +0/−619 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/hosted-communities-settings-screenshots.spec.ts` | +0/−313 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/huddle-thread-load-failure.spec.ts` | +0/−182 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/huddle-transcription.spec.ts` | +0/−1891 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/human-edit-agent-content.spec.ts` | +0/−288 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/identity-archive-hide.spec.ts` | +0/−203 | = | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/identity-archive.spec.ts` | +0/−143 | = | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/identity-key-help.spec.ts` | +0/−88 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/identity-lost.spec.ts` | +0/−514 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/image-attachment-gallery.spec.ts` | +0/−86 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/inbox-edit.spec.ts` | +0/−729 | = | (d) | - | 内容覆盖30%:collaboration/desktop/tests/e2e/inbox-live-update.spec.ts | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/inbox-live-update.spec.ts` | +2/−430 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/inbox-reactions.spec.ts` | +0/−184 | = | (d) | - | 内容覆盖42%:collaboration/desktop/tests/e2e/inbox-live-update.spec.ts | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/inbox-refactor-screenshots.spec.ts` | +2/−532 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/inbox-title-overlap.spec.ts` | +29/−8 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/inline-custom-harness.spec.ts` | +0/−193 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/integration.spec.ts` | +0/−210 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/invite-link-copy.spec.ts` | +0/−163 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/invites-settings-screenshots.spec.ts` | +0/−233 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/key-import-reveal.spec.ts` | +0/−67 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/local-archive-screenshots.spec.ts` | +0/−163 | = | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/mention-clipboard.spec.ts` | +0/−958 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/mention-recipients.spec.ts` | +3/−813 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/mentions.spec.ts` | +102/−3611 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/mesh-compute.spec.ts` | +0/−149 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/message-copy-link.spec.ts` | +6/−95 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/messaging.spec.ts` | +16/−2069 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/mobile-pairing-qr.spec.ts` | +0/−454 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/navigation.spec.ts` | +9/−430 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/needs-restart-screenshots.spec.ts` | +0/−562 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/nostr-bind.spec.ts` | +0/−470 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/observer-archive-policy.spec.ts` | +0/−281 | = | (d) | - | 内容覆盖34%:collaboration/desktop/tests/e2e/buzz-theme-screenshots.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/observer-feed-screenshots.spec.ts` | +0/−817 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/onboarding-agent-defaults.spec.ts` | +0/−1214 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/onboarding-avatar-skip.spec.ts` | +0/−418 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/onboarding-backup.spec.ts` | +0/−531 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/onboarding-docked-cta-screenshots.spec.ts` | +0/−745 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/onboarding.spec.ts` | +0/−4549 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/overscroll-boundary.spec.ts` | +22/−58 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/owned-agent-discovery.spec.ts` | +0/−56 | = | (d) | - | 内容覆盖35%:collaboration/desktop/tests/e2e/image-attachment-gallery.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/persistent-agent-audience.spec.ts` | +0/−1588 | = | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/persona-env-vars.spec.ts` | +0/−353 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/persona-model-combobox-screenshots.spec.ts` | +0/−151 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/persona-sync.spec.ts` | +0/−224 | = | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/profile-active-turn.spec.ts` | +0/−148 | = | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/profile-backup-settings.spec.ts` | +0/−259 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/profile-custom-emoji-status.spec.ts` | +0/−480 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/profile-nsec-reveal.spec.ts` | +0/−65 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/profile.spec.ts` | +6/−2524 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-cold-start.spec.ts` | +0/−171 | = | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-commit-detail.spec.ts` | +0/−1637 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-conversation-load-failure.spec.ts` | +0/−193 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-empty-state-alignment.spec.ts` | +0/−69 | = | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-inbox.spec.ts` | +0/−190 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-issue-comments.spec.ts` | +0/−262 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/project-pr-review.spec.ts` | +0/−3621 | = | (d) | - | 内容覆盖10% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/projects-v3-screenshots.spec.ts` | +0/−1280 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/pubkey-display-screenshots.spec.ts` | +1/−276 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/reaction-names.spec.ts` | +0/−170 | = | (d) | - | 内容覆盖30%:collaboration/desktop/tests/e2e/messaging.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/reaction-order.spec.ts` | +0/−183 | = | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/relay-connectivity.spec.ts` | +0/−33 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/reminder-click-repro.spec.ts` | +0/−144 | = | (d) | - | 内容覆盖34%:collaboration/desktop/tests/e2e/badge.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/reminders.spec.ts` | +0/−362 | = | (d) | - | 内容覆盖26% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/remote-owned-mentions.spec.ts` | +0/−692 | = | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/scrollback-buzzbugs.perf.ts` | +0/−422 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/search-scope-screenshots.spec.ts` | +0/−72 | = | (d) | - | 内容覆盖44%:collaboration/desktop/tests/e2e/smoke.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/send-channel-binding.spec.ts` | +0/−190 | = | (d) | - | 内容覆盖46%:collaboration/desktop/tests/e2e/mentions.spec.ts | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/settings-section-layout.spec.ts` | +0/−129 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/sidebar-offcanvas-rail.spec.ts` | +0/−159 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/sidebar-snapshot.spec.ts` | +2/−153 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/sidebar.spec.ts` | +0/−459 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/signout-confirmation.spec.ts` | +0/−117 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/signout-screenshots.spec.ts` | +0/−76 | = | (d) | - | 内容覆盖46%:collaboration/desktop/tests/e2e/drafts-screenshots.spec.ts | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/smoke.spec.ts` | +4/−436 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/spoiler.spec.ts` | +4/−3 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/stream.spec.ts` | +0/−26 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/team-catalog-screenshots.spec.ts` | +0/−302 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/team-catalog.spec.ts` | +0/−606 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/team-mentions.spec.ts` | +0/−70 | = | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/team-snapshot.spec.ts` | +0/−536 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/terminal-wheel.spec.ts` | +0/−261 | = | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/thread-focus-mode.spec.ts` | +1/−10 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/thread-head-stale-edit.spec.ts` | +0/−169 | = | (d) | - | 内容覆盖29% | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/tooltip-semantics.spec.ts` | +1/−92 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/video-attachment.spec.ts` | +81/−21 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/e2e/virtualization.spec.ts` | +0/−240 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/voice-note.spec.ts` | +0/−936 | = | (d) | - | 内容覆盖21% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/voice-settings.spec.ts` | +0/−212 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/welcome-agent-modal-screenshots.spec.ts` | +0/−292 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/where-to-run-config.spec.ts` | +0/−231 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflow-local-controls.spec.ts` | +0/−880 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflow-local-controls.spec.ts-snapshots/workflow-template-variable-autocomplete-smoke-darwin.png` | +-/−- | desktop/tests/e2e/workflow-local-controls.spec.ts-snapshots | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflow-local-controls.spec.ts-snapshots/workflow-template-variable-autocomplete-smoke-linux.png` | +-/−- | desktop/tests/e2e/workflow-local-controls.spec.ts-snapshots | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflow-reaction-picker.spec.ts` | +0/−252 | = | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflow-title-stability.spec.ts` | +0/−305 | = | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `desktop/tests/e2e/workflows.spec.ts` | +0/−1081 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| M | `desktop/tests/helpers/bridge.ts` | +37/−703 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/helpers/css.ts` | +0/−11 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/helpers/features.ts` | +0/−37 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `desktop/tests/helpers/fileDrag.ts` | +0/−52 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `desktop/tests/helpers/onboarding.ts` | +0/−23 | = | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| M | `desktop/tests/helpers/screenshot.mjs` | +34/−33 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `desktop/tests/helpers/seedRelay.ts` | +0/−340 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `desktop/tests/helpers/welcomeTeam.ts` | +0/−87 | = | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |

### Mobile features/activity（13）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/activity/activity_page.dart` | +0/−456 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖34%:collaboration/mobile/lib/features/search/search_page.dart | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/activity_page/header_actions.dart` | +0/−220 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖28% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/activity_page/inbox_row.dart` | +0/−489 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖44%:collaboration/mobile/lib/features/search/search_page.dart | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/activity_page/lists.dart` | +0/−174 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖22% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/activity_page/status_views.dart` | +0/−180 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖49%:collaboration/mobile/lib/features/search/search_page.dart | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/activity_provider.dart` | +0/−666 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖14% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| R | `mobile/lib/features/activity/compose_drafts_provider.dart → mobile/lib/features/channels/compose_drafts_provider.dart` | +1/−7 |  | (b) | - | collaboration/mobile/lib/features/channels/compose_drafts_provider.dart | 原文件改名迁移 |
| D | `mobile/lib/features/activity/dm_resurface.dart` | +0/−27 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖0% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/feed_item.dart` | +0/−137 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖25% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/inbox_item.dart` | +0/−284 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖12% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/inbox_local_state_provider.dart` | +0/−93 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖7% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/inbox_read_state.dart` | +0/−71 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖0% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |
| D | `mobile/lib/features/activity/reminders_provider.dart` | +0/−224 | mobile/lib/features/activity | (c) | REQ-24、REQ-21 | 内容覆盖17% | Mobile Activity（Inbox/提醒/未读角标）整页及底部 Tab 未恢复 |

### Mobile features/age_gate（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/age_gate/age_restriction_page.dart` | +0/−51 | mobile/lib/features/age_gate | 待定 | - | 内容覆盖67%:collaboration/mobile/lib/features/search/search_page.dart | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| D | `mobile/lib/features/age_gate/age_signal_provider.dart` | +0/−94 | mobile/lib/features/age_gate | 待定 | - | 内容覆盖0% | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| D | `mobile/lib/features/age_gate/age_signal_push_bootstrap.dart` | +0/−197 | mobile/lib/features/age_gate | 待定 | - | 内容覆盖7% | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |

### Mobile features/channels（100）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/channels/add_members_sheet.dart` | +0/−269 | = | (c) | DD-119、DD-41 | 内容覆盖28% | Mobile 频道详情/成员列表/添加成员/频道管理未恢复（管理面应经 BFF，设计未排除 Mobile） |
| D | `mobile/lib/features/channels/agent_activity/agent_activity_sheet.dart` | +0/−257 | mobile/lib/features/channels/agent_activity | (c) | REQ-24、DD-120 | 内容覆盖44%:collaboration/mobile/lib/features/channels/channels_page/new_direct_message_sheet.dart | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/agent_activity/observer_models.dart` | +0/−149 | mobile/lib/features/channels/agent_activity | (a) | DD-125(6) | 内容覆盖5% | Kailo Agent 不发 24200/44200，observer 订阅无对象 |
| D | `mobile/lib/features/channels/agent_activity/observer_subscription.dart` | +0/−373 | mobile/lib/features/channels/agent_activity | (a) | DD-125(6) | 内容覆盖6% | Kailo Agent 不发 24200/44200，observer 订阅无对象 |
| D | `mobile/lib/features/channels/agent_activity/transcript_builder.dart` | +0/−714 | mobile/lib/features/channels/agent_activity | (a) | DD-125(6) | 内容覆盖1% | Kailo Agent 不发 24200/44200，observer 订阅无对象 |
| D | `mobile/lib/features/channels/agent_activity/transcript_item_widget.dart` | +0/−492 | mobile/lib/features/channels/agent_activity | (c) | REQ-24、DD-120 | 内容覆盖53%:collaboration/mobile/lib/features/search/search_page.dart | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/agent_activity/working_bots_provider.dart` | +0/−27 | mobile/lib/features/channels/agent_activity | (c) | REQ-24、DD-120 | 内容覆盖9% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| M | `mobile/lib/features/channels/channel.dart` | +25/−113 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+25/-113），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/features/channels/channel_actions_sheet.dart` | +268/−431 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channel_detail_page.dart` | +106/−510 |  | (c) | REQ-24、DD-120 |  | Mobile 频道页：输入中、论坛视图、在线状态、表情爆发等移除（Huddle 部分属 DD-125(3) 排除） |
| M | `mobile/lib/features/channels/channel_detail_page/app_bar.dart` | +41/−206 |  | (c) | REQ-24 |  | Mobile 频道顶栏成员按钮/设置入口 |
| M | `mobile/lib/features/channels/channel_detail_page/banners.dart` | +2/−83 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+2/-83），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_call_avatar.dart` | +0/−275 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖21% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_call_controls.dart` | +0/−133 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖23% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_call_participants.dart` | +0/−203 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖20% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_drawer.dart` | +0/−296 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖15% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_participant_cluster.dart` | +0/−413 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖12% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_participant_overlay.dart` | +0/−393 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖44%:collaboration/mobile/lib/features/search/search_page.dart | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_reactions.dart` | +0/−117 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖14% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/channel_detail_page/huddle_sheet.dart` | +0/−850 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖15% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| M | `mobile/lib/features/channels/channel_detail_page/message_bubble.dart` | +7/−32 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channel_detail_page/message_list.dart` | +10/−7 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channel_detail_page/system_rows.dart` | +27/−151 |  | (c) | REQ-24 |  | Mobile 系统消息行动作 |
| D | `mobile/lib/features/channels/channel_details_page.dart` | +0/−723 | = | (c) | DD-119、DD-41 | 内容覆盖25% | Mobile 频道详情/成员列表/添加成员/频道管理未恢复（管理面应经 BFF，设计未排除 Mobile） |
| D | `mobile/lib/features/channels/channel_directory.dart` | +0/−494 | = | (b) | - | collaboration/mobile/lib/features/channels/channels_refresh.dart；内容覆盖55%:collaboration/mobile/lib/features/channels/channels_refresh.dart | 频道目录合入刷新逻辑 |
| D | `mobile/lib/features/channels/channel_huddle_actions.dart` | +0/−91 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖15% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| M | `mobile/lib/features/channels/channel_management_actions.dart` | +317/−358 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channel_management_provider.dart` | +7/−416 |  | (c) | DD-119、DD-125(4) |  | Mobile 频道管理（添加成员、Canvas、人员目录搜索） |
| M | `mobile/lib/features/channels/channel_messages_provider.dart` | +44/−2 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_metadata_updates.dart` | +0/−19 | = | (c) | DD-119、DD-41 | 内容覆盖11% | Mobile 频道详情/成员列表/添加成员/频道管理未恢复（管理面应经 BFF，设计未排除 Mobile） |
| D | `mobile/lib/features/channels/channel_mutes/channel_mutes_manager.dart` | +0/−265 | mobile/lib/features/channels/channel_mutes | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖19% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_mutes/channel_mutes_provider.dart` | +0/−115 | mobile/lib/features/channels/channel_mutes | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖33%:collaboration/mobile/lib/shared/read_state/read_state_provider.dart | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_mutes/channel_mutes_storage.dart` | +0/−91 | mobile/lib/features/channels/channel_mutes | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖4% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_push_cache.dart` | +0/−106 | = | (c) | - | 内容覆盖11% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/features/channels/channel_sections/channel_sections_manager.dart` | +0/−501 | mobile/lib/features/channels/channel_sections | (c) | DD-125(5) | 内容覆盖14% | Mobile 自定义频道分区：DD-125 保留并以 CollaborationUserState.sidebar_sections 为三端权威，Mobile 未恢复 |
| D | `mobile/lib/features/channels/channel_sections/channel_sections_provider.dart` | +0/−133 | mobile/lib/features/channels/channel_sections | (c) | DD-125(5) | 内容覆盖28% | Mobile 自定义频道分区：DD-125 保留并以 CollaborationUserState.sidebar_sections 为三端权威，Mobile 未恢复 |
| D | `mobile/lib/features/channels/channel_sections/channel_sections_storage.dart` | +0/−116 | mobile/lib/features/channels/channel_sections | (c) | DD-125(5) | 内容覆盖9% | Mobile 自定义频道分区：DD-125 保留并以 CollaborationUserState.sidebar_sections 为三端权威，Mobile 未恢复 |
| D | `mobile/lib/features/channels/channel_sort/channel_sort_manager.dart` | +0/−322 | mobile/lib/features/channels/channel_sort | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖12% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_sort/channel_sort_provider.dart` | +0/−126 | mobile/lib/features/channels/channel_sort | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖28% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_sort/channel_sort_storage.dart` | +0/−219 | mobile/lib/features/channels/channel_sort | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖8% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_stars/channel_stars_manager.dart` | +0/−265 | mobile/lib/features/channels/channel_stars | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖19% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_stars/channel_stars_provider.dart` | +0/−115 | mobile/lib/features/channels/channel_stars | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖33%:collaboration/mobile/lib/shared/read_state/read_state_provider.dart | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_stars/channel_stars_storage.dart` | +0/−91 | mobile/lib/features/channels/channel_stars | (a) | DD-40 | collaboration/mobile/lib/shared/platform/platform_read_state.dart；内容覆盖4% | 收藏/静音/排序改为 CollaborationUserState |
| D | `mobile/lib/features/channels/channel_typing_indicator.dart` | +0/−156 | = | (c) | REQ-24、DD-120 | 内容覆盖29% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/channel_typing_provider.dart` | +0/−113 | = | (c) | REQ-24、DD-120 | 内容覆盖15% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| M | `mobile/lib/features/channels/channels_page.dart` | +50/−64 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| R | `mobile/lib/features/channels/channels_page/badges.dart → mobile/lib/features/channels/channels_page/error_view.dart` | +0/−22 | mobile/lib/features/channels/channels_page/badges.dart | (c) | REQ-24 |  | 改名检测（相似度 77%）：保留 _ErrorView，删除 Mobile 临时频道徽标 _EphemeralBadge |
| M | `mobile/lib/features/channels/channels_page/body.dart` | +43/−195 |  | (c) | DD-125(5) |  | Mobile 频道列表的 Starred/自定义分区分组与重命名/删除分区 |
| D | `mobile/lib/features/channels/channels_page/browse_channels_sheet.dart` | +0/−191 | = | (b) | - | collaboration/mobile/lib/features/search/search_page.dart；内容覆盖32%:collaboration/mobile/lib/features/search/search_page.dart | 浏览频道合入搜索页 |
| M | `mobile/lib/features/channels/channels_page/channel_tile.dart` | +46/−156 |  | (c) | DD-120 |  | Mobile 私聊行在线状态点 |
| M | `mobile/lib/features/channels/channels_page/community.dart` | +17/−455 |  | (a) | DD-01、DD-02 |  | Mobile 社区切换器移除 |
| M | `mobile/lib/features/channels/channels_page/quick_actions.dart` | +51/−31 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channels_page/quick_actions_launcher.dart` | +28/−24 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channels_page/sections.dart` | +7/−432 |  | (c) | DD-125(5) |  | Mobile 自定义分区（重命名/上移/下移/删除） |
| M | `mobile/lib/features/channels/channels_page/sheets.dart` | +258/−489 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channels_page/skeleton.dart` | +2/−12 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/channels_provider.dart` | +69/−224 |  | (a) | DD-01、DD-40 |  | 多社区与静音来源改为平台权威 |
| M | `mobile/lib/features/channels/compose_bar.dart` | +5/−7 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/attachments.dart` | +0/−2 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/compose_bar_widget.dart` | +81/−74 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/draft_lifecycle.dart` | +15/−4 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/helpers.dart` | +99/−265 |  | (c) | REQ-24、DD-41 |  | Mobile 提及频道外成员时“邀请/仍发送”提示与输入中发送移除 |
| M | `mobile/lib/features/channels/compose_bar/layout.dart` | +20/−0 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/markdown_editing_controller.dart` | +1/−17 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/suggestions.dart` | +1/−6 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/compose_bar/voice_note.dart` | +0/−4 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/date_formatters.dart` | +55/−39 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/deep_link_dispatcher.dart` | +14/−109 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+14/-109），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/features/channels/dm_channel_labels.dart` | +0/−128 | = | (c) | REQ-24、DD-120 | 内容覆盖9% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| M | `mobile/lib/features/channels/emoji_picker.dart` | +9/−66 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/emoji_picker/emoji_grid.dart` | +2/−75 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/emoji_picker/ios_native_picker.dart` | +0/−89 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+0/-89），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/features/channels/ephemeral_channel_display.dart` | +0/−129 | = | (c) | REQ-24、DD-120 | 内容覆盖15% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/huddle_channel_filter.dart` | +0/−45 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖9% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/manage_channel_sheet.dart` | +0/−349 | = | (c) | DD-119、DD-41 | 内容覆盖35%:collaboration/mobile/lib/features/channels/channels_page/new_direct_message_sheet.dart | Mobile 频道详情/成员列表/添加成员/频道管理未恢复（管理面应经 BFF，设计未排除 Mobile） |
| D | `mobile/lib/features/channels/members_sheet.dart` | +0/−468 | = | (c) | DD-119、DD-41 | 内容覆盖39%:collaboration/mobile/lib/features/search/search_page.dart | Mobile 频道详情/成员列表/添加成员/频道管理未恢复（管理面应经 BFF，设计未排除 Mobile） |
| M | `mobile/lib/features/channels/mentions/mention_candidates.dart` | +10/−59 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/mentions/mention_candidates_provider.dart` | +2/−75 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/message_actions.dart` | +6/−342 |  | (c) | REQ-24 |  | Mobile 消息编辑/删除/提醒与快捷回应 |
| M | `mobile/lib/features/channels/message_actions/message_action_popover.dart` | +13/−148 |  | (c) | REQ-24 |  | Mobile 消息“编辑/删除/稍后提醒”动作 |
| M | `mobile/lib/features/channels/message_actions/message_action_popover_widgets.dart` | +1/−3 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/features/channels/message_actions/message_reaction_tray.dart` | +0/−36 | = | (c) | REQ-24、DD-120 | 内容覆盖43%:collaboration/mobile/lib/features/channels/message_actions/message_action_popover.dart | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/message_actions/quick_reaction_row.dart` | +0/−139 | = | (c) | REQ-24、DD-120 | 内容覆盖16% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/message_actions/reaction_popover.dart` | +0/−345 | = | (c) | REQ-24、DD-120 | 内容覆盖43%:collaboration/mobile/lib/features/channels/message_actions/message_action_popover.dart | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| M | `mobile/lib/features/channels/message_content.dart` | +6/−66 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/message_content/inline_components.dart` | +2/−15 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/features/channels/message_mention_pubkeys.dart` | +0/−26 | = | (c) | REQ-24、DD-120 | 内容覆盖8% | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| D | `mobile/lib/features/channels/mobile_huddle_controller.dart` | +0/−514 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖7% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/features/channels/reaction_row.dart` | +0/−508 | = | (c) | REQ-24、DD-120 | 内容覆盖34%:collaboration/mobile/lib/features/channels/message_content.dart | Mobile 输入中提示、快捷回应/回应行、私聊标签、临时频道显示、Agent 活动面板未恢复 |
| M | `mobile/lib/features/channels/recent_emoji_provider.dart` | +1/−40 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/send_message_provider.dart` | +134/−58 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_helpers.dart` | +0/−22 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_page.dart` | +3/−26 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_page/message_list.dart` | +12/−2 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_page/nested_thread_summary_row.dart` | +20/−4 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_page/sticky_date.dart` | +5/−1 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/thread_detail_page/thread_message.dart` | +3/−31 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/timeline_message.dart` | +3/−140 |  | (c) | REQ-24 |  | Mobile 自定义表情回应呈现 |
| M | `mobile/lib/features/channels/unread_badge/observed_unread_event.dart` | +2/−4 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/channels/unread_badge/unread_badge_provider.dart` | +5/−6 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile features/forum（5）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/forum/forum_models.dart` | +0/−250 | mobile/lib/features/forum | (c) | REQ-24、REQ-21 | 内容覆盖32%:collaboration/mobile/lib/shared/relay/nostr_models.dart | Mobile 论坛频道（帖子列表/详情）未恢复 |
| D | `mobile/lib/features/forum/forum_post_card.dart` | +0/−361 | mobile/lib/features/forum | (c) | REQ-24、REQ-21 | 内容覆盖53%:collaboration/mobile/lib/features/search/search_page.dart | Mobile 论坛频道（帖子列表/详情）未恢复 |
| D | `mobile/lib/features/forum/forum_posts_view.dart` | +0/−226 | mobile/lib/features/forum | (c) | REQ-24、REQ-21 | 内容覆盖44%:collaboration/mobile/lib/features/search/search_page.dart | Mobile 论坛频道（帖子列表/详情）未恢复 |
| D | `mobile/lib/features/forum/forum_provider.dart` | +0/−189 | mobile/lib/features/forum | (c) | REQ-24、REQ-21 | 内容覆盖21% | Mobile 论坛频道（帖子列表/详情）未恢复 |
| D | `mobile/lib/features/forum/forum_thread_page.dart` | +0/−673 | mobile/lib/features/forum | (c) | REQ-24、REQ-21 | 内容覆盖54%:collaboration/mobile/lib/features/search/search_page.dart | Mobile 论坛频道（帖子列表/详情）未恢复 |

### Mobile features/home（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/features/home/home_page.dart` | +2/−66 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile features/invites（6）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/invites/invite_create_page.dart` | +0/−170 | mobile/lib/features/invites | 待定 | - | 内容覆盖37%:collaboration/mobile/lib/features/channels/channels_page/sheets.dart | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_page/invite_link_section.dart` | +0/−249 | mobile/lib/features/invites | 待定 | - | 内容覆盖28% | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_page/person_invite_section.dart` | +0/−283 | mobile/lib/features/invites | 待定 | - | 内容覆盖18% | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_create_provider.dart` | +0/−417 | mobile/lib/features/invites | 待定 | - | 内容覆盖15% | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_join_provider.dart` | +0/−463 | mobile/lib/features/invites | 待定 | - | 内容覆盖9% | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |
| D | `mobile/lib/features/invites/invite_join_sheet.dart` | +0/−246 | mobile/lib/features/invites | 待定 | - | 内容覆盖44%:collaboration/mobile/lib/features/channels/channels_page/sheets.dart | Mobile 创建邀请/扫码加入：DD-83 已把邀请改为 Tenant 邀请凭据，但未写 Mobile 是否提供管理入口（REQ-21 允许只读/可降级），需裁定 |

### Mobile features/pairing（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/pairing/pairing_crypto.dart` | +0/−164 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖0% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_page.dart` | +0/−419 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖24% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_page/onboarding_background.dart` | +0/−41 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖16% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_page/pairing_welcome_view.dart` | +0/−261 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖34%:collaboration/mobile/lib/features/search/search_page.dart | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_provider.dart` | +0/−993 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖7% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_qr_scanner.dart` | +0/−175 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖12% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_qr_scanner/dynamic_island_portal.dart` | +0/−177 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖24% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_qr_scanner/fallback_scanner.dart` | +0/−282 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖23% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_qr_scanner/scanner_camera.dart` | +0/−53 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖32%:collaboration/mobile/lib/features/search/search_page.dart | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |
| D | `mobile/lib/features/pairing/pairing_socket.dart` | +0/−254 | mobile/lib/features/pairing | (a) | DD-125(5)、DD-72、DD-75、DD-79 | collaboration/mobile/lib/features/platform/platform_devices_page.dart；内容覆盖13% | 移动端配对向手机交付私钥，排除；设备公钥按 DD-79 本机生成登记 |

### Mobile features/profile（31）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/profile/animated_avatar_capture.dart` | +0/−998 | = | (c) | REQ-24、DD-120 | 内容覆盖9% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/animated_avatar_capture/capture_controls.dart` | +0/−186 | mobile/lib/features/profile/animated_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖29% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/animated_avatar_capture/error_text.dart` | +0/−29 | mobile/lib/features/profile/animated_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖42%:collaboration/mobile/lib/features/channels/channels_page/error_view.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/animated_avatar_capture/frame_processing.dart` | +0/−110 | mobile/lib/features/profile/animated_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖4% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/animated_avatar_capture/review_controls.dart` | +0/−423 | mobile/lib/features/profile/animated_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖28% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/animated_avatar_orientation.dart` | +0/−24 | = | (c) | REQ-24、DD-120 | 内容覆盖0% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/avatar_background_grid.dart` | +0/−85 | = | (c) | REQ-24、DD-120 | 内容覆盖41%:collaboration/mobile/lib/features/settings/theme_option_sheets.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/avatar_editor_option_button.dart` | +0/−149 | = | (c) | REQ-24、DD-120 | 内容覆盖57%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/camera_disposal_barrier.dart` | +0/−71 | = | (c) | REQ-24、DD-120 | 内容覆盖0% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/emoji_avatar_tile.dart` | +0/−58 | = | (c) | REQ-24、DD-120 | 内容覆盖46%:collaboration/mobile/lib/features/channels/channels_page/quick_actions.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/image_avatar_capture.dart` | +0/−662 | = | (c) | REQ-24、DD-120 | 内容覆盖11% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/image_avatar_capture/camera_preview.dart` | +0/−21 | mobile/lib/features/profile/image_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖20% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/image_avatar_capture/morphing_camera_action.dart` | +0/−149 | mobile/lib/features/profile/image_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖40%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/image_avatar_capture/shutter_button.dart` | +0/−75 | mobile/lib/features/profile/image_avatar_capture | (c) | REQ-24、DD-120 | 内容覆盖49%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/ios_profile_text_editor.dart` | +0/−78 | = | (c) | REQ-24、DD-120 | 内容覆盖9% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/presence_cache_provider.dart` | +0/−90 | = | (c) | REQ-24、DD-120 | 内容覆盖11% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| M | `mobile/lib/features/profile/profile_avatar.dart` | +21/−91 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+21/-91），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/lib/features/profile/profile_avatar_crop_page.dart` | +0/−493 | = | (c) | REQ-24、DD-120 | 内容覆盖9% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_avatar_draft.dart` | +0/−132 | = | (c) | REQ-24、DD-120 | 内容覆盖2% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_avatar_editor.dart` | +0/−757 | = | (c) | REQ-24、DD-120 | 内容覆盖14% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_avatar_editor/emoji_avatar_picker.dart` | +0/−401 | mobile/lib/features/profile/profile_avatar_editor | (c) | REQ-24、DD-120 | 内容覆盖21% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_edit_page.dart` | +0/−720 | = | (c) | REQ-24、DD-120 | 内容覆盖18% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_provider.dart` | +0/−416 | = | (c) | REQ-24、DD-120 | 内容覆盖10% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_text_edit_sheet.dart` | +0/−165 | = | (c) | REQ-24、DD-120 | 内容覆盖36%:collaboration/mobile/lib/features/channels/channels_page/new_direct_message_sheet.dart | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/profile_text_editor.dart` | +0/−233 | = | (c) | REQ-24、DD-120 | 内容覆盖23% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/set_status_sheet.dart` | +0/−489 | = | (c) | REQ-24、DD-120 | 内容覆盖25% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| M | `mobile/lib/features/profile/settings_profile_header.dart` | +10/−380 |  | (c) | DD-120 |  | Mobile 设置页资料头的在线状态与自定义状态入口 |
| M | `mobile/lib/features/profile/user_profile_sheet.dart` | +55/−199 |  | (c) | DD-120 |  | Mobile 他人资料卡的在线/状态、打开私聊、复制公钥 |
| D | `mobile/lib/features/profile/user_status.dart` | +0/−55 | = | (c) | REQ-24、DD-120 | 内容覆盖5% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/user_status_cache_provider.dart` | +0/−245 | = | (c) | REQ-24、DD-120 | 内容覆盖17% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |
| D | `mobile/lib/features/profile/user_status_provider.dart` | +0/−178 | = | (c) | REQ-24、DD-120 | 内容覆盖22% | Mobile 资料编辑、头像拍摄/编辑、在线状态与自定义状态未恢复 |

### Mobile features/pulse（7）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/pulse/agent_activity_card.dart` | +0/−176 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖50%:collaboration/mobile/lib/features/search/search_page.dart | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/compose_note_page.dart` | +0/−269 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖62%:collaboration/mobile/lib/features/channels/channels_page/new_direct_message_sheet.dart | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/note_card.dart` | +0/−353 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖37%:collaboration/mobile/lib/features/search/search_page.dart | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/pulse_actions.dart` | +0/−105 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖15% | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/pulse_models.dart` | +0/−139 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖22% | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/pulse_page.dart` | +0/−325 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖28% | Mobile Pulse 页面未恢复 |
| D | `mobile/lib/features/pulse/pulse_provider.dart` | +0/−217 | mobile/lib/features/pulse | (c) | REQ-24、REQ-21 | 内容覆盖18% | Mobile Pulse 页面未恢复 |

### Mobile features/search（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/features/search/recent_searches_provider.dart` | +1/−9 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/search/search_page.dart` | +17/−102 |  | (c) | REQ-24 |  | Mobile 搜索页“People”人员分区移除 |
| M | `mobile/lib/features/search/search_provider.dart` | +10/−31 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile features/settings（9）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/features/settings/accent_picker_page.dart` | +0/−81 | = | (c) | REQ-24、DD-53 | 内容覆盖50%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 强调色、社区与通知设置分区未恢复 |
| M | `mobile/lib/features/settings/settings_page.dart` | +346/−150 |  | (c) | REQ-24 |  | Mobile 设置页“编辑资料（显示名/简介/头像）”入口移除；新增的平台入口属 (a) DD-78 |
| D | `mobile/lib/features/settings/settings_page/community_section.dart` | +0/−41 | mobile/lib/features/settings/settings_page | (c) | REQ-24、DD-53 | 内容覆盖50%:collaboration/mobile/lib/features/settings/settings_page.dart | Mobile 强调色、社区与通知设置分区未恢复 |
| D | `mobile/lib/features/settings/settings_page/connection_section.dart` | +0/−189 | mobile/lib/features/settings/settings_page | (a) | DD-78、DD-41、DD-111(3) | collaboration/mobile/lib/features/platform/platform_sign_in_page.dart；内容覆盖33%:collaboration/mobile/lib/features/settings/settings_page.dart | 服务器/Relay 连接改为选择服务器 + OIDC 登录，成员资格由 Core |
| D | `mobile/lib/features/settings/settings_page/notifications_section.dart` | +0/−93 | mobile/lib/features/settings/settings_page | (c) | REQ-24、DD-53 | 内容覆盖14% | Mobile 强调色、社区与通知设置分区未恢复 |
| M | `mobile/lib/features/settings/theme_option_sheets.dart` | +30/−149 |  | (c) | DD-53 |  | Mobile 外观模式/强调色选择面板（待核是否移至他处） |
| M | `mobile/lib/features/settings/theme_picker_page.dart` | +1/−0 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/settings/theme_picker_page/theme_home_preview.dart` | +14/−3 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart` | +47/−11 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile lib 根（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/app.dart` | +49/−350 |  | 待定 | - |  | 装配层：随 Activity/配对/年龄门禁/推送/资料编辑等删除一并移除，具体归类见各功能条目 |
| M | `mobile/lib/main.dart` | +5/−16 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/animated_avatar.dart（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/animated_avatar.dart` | +0/−5 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/auth（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/auth/auth_provider.dart` | +17/−26 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/community（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/community/community.dart` | +4/−100 |  | (a) | DD-01、DD-02 |  | 多社区模型移除 |
| D | `mobile/lib/shared/community/community_membership_provider.dart` | +0/−127 | = | (a) | DD-78、DD-41、DD-111(3) | collaboration/mobile/lib/features/platform/platform_sign_in_page.dart；内容覆盖12% | 服务器/Relay 连接改为选择服务器 + OIDC 登录，成员资格由 Core |
| M | `mobile/lib/shared/community/community_provider.dart` | +18/−583 |  | (a) | DD-01、DD-02 |  | 多社区管理移除（.design/03：一期不提供选择 Tenant） |
| M | `mobile/lib/shared/community/community_storage.dart` | +1/−52 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/crypto（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/crypto/ecdh.dart` | +0/−65 | = | (a) | DD-40、01 §5 | 内容覆盖0% | NIP-44 30078 用户状态不再在客户端加解密，改为 CollaborationUserState |
| D | `mobile/lib/shared/crypto/hkdf.dart` | +0/−44 | = | (a) | DD-40、01 §5 | 内容覆盖0% | NIP-44 30078 用户状态不再在客户端加解密，改为 CollaborationUserState |
| D | `mobile/lib/shared/crypto/nip44.dart` | +0/−169 | = | (a) | DD-40、01 §5 | 内容覆盖0% | NIP-44 30078 用户状态不再在客户端加解密，改为 CollaborationUserState |

### Mobile shared/custom_emoji（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/custom_emoji/custom_emoji.dart` | +0/−139 | mobile/lib/shared/custom_emoji | (c) | REQ-24 | 内容覆盖7% | Mobile 自定义表情渲染/表情爆发动效未恢复 |
| D | `mobile/lib/shared/custom_emoji/custom_emoji_provider.dart` | +0/−60 | mobile/lib/shared/custom_emoji | (c) | REQ-24 | 内容覆盖25% | Mobile 自定义表情渲染/表情爆发动效未恢复 |
| D | `mobile/lib/shared/custom_emoji/custom_emoji_render.dart` | +0/−123 | mobile/lib/shared/custom_emoji | (c) | REQ-24 | 内容覆盖19% | Mobile 自定义表情渲染/表情爆发动效未恢复 |

### Mobile shared/deeplink（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/deeplink/deep_link.dart` | +28/−181 |  | (a) | DD-01、DD-83 |  | 邀请/社区深链移除 |
| M | `mobile/lib/shared/deeplink/pending_deep_link_provider.dart` | +3/−48 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/emoji（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/emoji/emoji_avatar.dart` | +0/−58 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/emoji/emoji_burst.dart` | +0/−404 | = | (c) | REQ-24 | 内容覆盖7% | Mobile 自定义表情渲染/表情爆发动效未恢复 |
| M | `mobile/lib/shared/emoji/emoji_only.dart` | +3/−26 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/emoji/positive_emoji.dart` | +0/−91 | = | (c) | REQ-24 | 内容覆盖0% | Mobile 自定义表情渲染/表情爆发动效未恢复 |

### Mobile shared/huddle（6）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/huddle/huddle.dart` | +0/−5 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖0% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/shared/huddle/huddle_auth.dart` | +0/−124 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖7% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/shared/huddle/huddle_media.dart` | +0/−759 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖3% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/shared/huddle/huddle_session.dart` | +0/−777 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖8% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/shared/huddle/huddle_transport.dart` | +0/−931 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖2% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/lib/shared/huddle/huddle_wire.dart` | +0/−193 | mobile/lib/shared/huddle | (a) | DD-125(3)、REQ-21 | 内容覆盖1% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |

### Mobile shared/profile（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/profile/user_cache_provider.dart` | +0/−13 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/push（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/push/dev_push_lease.dart` | +0/−658 | mobile/lib/shared/push | (c) | - | 内容覆盖8% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_bootstrap.dart` | +0/−408 | mobile/lib/shared/push | (c) | - | 内容覆盖6% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_bridge.dart` | +0/−367 | mobile/lib/shared/push | (c) | - | 内容覆盖5% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_lease_revocation_outbox.dart` | +0/−553 | mobile/lib/shared/push | (c) | - | 内容覆盖9% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_presentation_cache.dart` | +0/−372 | mobile/lib/shared/push | (c) | - | 内容覆盖6% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_presentation_export_recovery.dart` | +0/−49 | mobile/lib/shared/push | (c) | - | 内容覆盖0% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_relay_capability_provider.dart` | +0/−63 | mobile/lib/shared/push | (c) | - | 内容覆盖13% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_snapshot.dart` | +0/−53 | mobile/lib/shared/push | (c) | - | 内容覆盖33%:collaboration/mobile/lib/shared/community/community.dart | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_subscription.dart` | +0/−579 | mobile/lib/shared/push | (c) | - | 内容覆盖6% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |
| D | `mobile/lib/shared/push/push_subscription_provider.dart` | +0/−62 | mobile/lib/shared/push | (c) | - | 内容覆盖14% | Mobile 推送通知（push 订阅/租约/呈现缓存）未恢复；上游 Dockerfile.push-gateway 仍在树内，设计无排除 |

### Mobile shared/read_state（5）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/read_state/read_state_format.dart` | +17/−172 |  | (a) | DD-40 |  | 已读改为平台权威 |
| M | `mobile/lib/shared/read_state/read_state_manager.dart` | +129/−409 |  | (a) | DD-40 |  | 已读改为平台权威 |
| M | `mobile/lib/shared/read_state/read_state_provider.dart` | +90/−51 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/read_state/read_state_storage.dart` | +49/−180 |  | (a) | DD-40 |  | 已读改为平台权威 |
| M | `mobile/lib/shared/read_state/read_state_time.dart` | +0/−2 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/relay（12）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/relay/identity_scoped_prefs.dart` | +0/−50 | = | (a) | DD-78、DD-41、DD-111(3) | collaboration/mobile/lib/features/platform/platform_sign_in_page.dart；内容覆盖7% | 服务器/Relay 连接改为选择服务器 + OIDC 登录，成员资格由 Core |
| M | `mobile/lib/shared/relay/media_auth.dart` | +0/−13 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/media_image.dart` | +0/−9 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/nostr_filters.dart` | +0/−185 |  | (a) | DD-40 |  | 30078 等过滤器移除 |
| M | `mobile/lib/shared/relay/nostr_models.dart` | +11/−96 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+11/-96），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| M | `mobile/lib/shared/relay/relay.dart` | +0/−1 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/relay_client.dart` | +0/−28 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/relay_provider.dart` | +0/−19 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/relay_session.dart` | +49/−24 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/relay/relay_session_types.dart` | +9/−1 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/relay/relay_validation.dart` | +0/−164 | = | (a) | DD-78、DD-41、DD-111(3) | collaboration/mobile/lib/features/platform/platform_sign_in_page.dart；内容覆盖3% | 服务器/Relay 连接改为选择服务器 + OIDC 登录，成员资格由 Core |
| M | `mobile/lib/shared/relay/signed_event_relay.dart` | +22/−73 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |

### Mobile shared/reminders（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/reminders/remind_me_later_sheet.dart` | +0/−120 | mobile/lib/shared/reminders | (c) | REQ-24 | 内容覆盖22% | Mobile 提醒（稍后提醒）未恢复 |
| D | `mobile/lib/shared/reminders/reminder_service.dart` | +0/−149 | mobile/lib/shared/reminders | (c) | REQ-24 | 内容覆盖22% | Mobile 提醒（稍后提醒）未恢复 |
| D | `mobile/lib/shared/reminders/reminder_time_presets.dart` | +0/−70 | mobile/lib/shared/reminders | (c) | REQ-24 | 内容覆盖4% | Mobile 提醒（稍后提醒）未恢复 |

### Mobile shared/security（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/lib/shared/security/sensitive_action_authorizer.dart` | +0/−158 | mobile/lib/shared/security | 待定 | - | 内容覆盖0% | 敏感操作生物识别授权（原用于导出/配对等本机密钥操作），随 DD-72/75 的本机钥边界确定 |

### Mobile shared/theme（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/theme/accent_colors.dart` | +0/−16 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/app_colors.dart` | +0/−23 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/app_theme.dart` | +0/−9 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/community_theme_preference.dart` | +23/−101 |  | (a) | DD-53 |  | 按社区外观偏好移除 |
| M | `mobile/lib/shared/theme/community_theme_provider.dart` | +2/−183 |  | (a) | DD-53 |  | 按社区外观同步移除 |
| D | `mobile/lib/shared/theme/community_theme_sync.dart` | +0/−366 | = | (a) | DD-53 | 内容覆盖6% | 按社区跨设备同步外观偏好（经 Relay 加密偏好）；DD-53 规定外观偏好仅属于当前设备，不新增服务端偏好权威 |
| M | `mobile/lib/shared/theme/message_typography.dart` | +0/−21 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/theme.dart` | +0/−1 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/theme_catalog.dart` | +0/−23 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/theme/theme_provider.dart` | +0/−92 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+0/-92），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |

### Mobile shared/widgets（14）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/lib/shared/widgets/avatar_image.dart` | +7/−44 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/widgets/bouncing_dots_indicator.dart` | +0/−90 | = | (c) | REQ-24 | 内容覆盖36%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 通用部件（随资料/表情/引导等功能删除） |
| M | `mobile/lib/shared/widgets/buzz_search_field.dart` | +0/−3 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| M | `mobile/lib/shared/widgets/concentric_sheet_surface.dart` | +1/−19 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/widgets/editor_option_button.dart` | +0/−131 | = | (c) | REQ-24 | 内容覆盖61%:collaboration/mobile/lib/features/settings/theme_picker_page/theme_preview_sheet.dart | Mobile 通用部件（随资料/表情/引导等功能删除） |
| M | `mobile/lib/shared/widgets/frosted_app_bar.dart` | +0/−16 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/widgets/immediate_page_route.dart` | +0/−10 | = | (c) | REQ-24 | 内容覆盖0% | Mobile 通用部件（随资料/表情/引导等功能删除） |
| D | `mobile/lib/shared/widgets/ios_native_segmented_control.dart` | +0/−86 | = | (c) | REQ-24 | 内容覆盖26% | Mobile 通用部件（随资料/表情/引导等功能删除） |
| D | `mobile/lib/shared/widgets/ios_native_skin_tone_control.dart` | +0/−78 | = | (c) | REQ-24 | 内容覆盖27% | Mobile 通用部件（随资料/表情/引导等功能删除） |
| D | `mobile/lib/shared/widgets/lucide_star_icon.dart` | +0/−67 | = | (c) | REQ-24 | 内容覆盖0% | Mobile 通用部件（随资料/表情/引导等功能删除） |
| D | `mobile/lib/shared/widgets/masked_avatar_badge.dart` | +0/−356 | = | (c) | REQ-24 | 内容覆盖7% | Mobile 通用部件（随资料/表情/引导等功能删除） |
| M | `mobile/lib/shared/widgets/modal_presentation.dart` | +1/−1 |  | (a) | DD-75、DD-78、DD-40、REQ-21 |  | Mobile 改走平台登录/会话与 CollaborationUserState |
| D | `mobile/lib/shared/widgets/playing_avatar_image.dart` | +0/−110 | = | (c) | REQ-24 | 内容覆盖39%:collaboration/mobile/lib/shared/widgets/avatar_image.dart | Mobile 通用部件（随资料/表情/引导等功能删除） |
| D | `mobile/lib/shared/widgets/tappable_flapping_bee.dart` | +0/−63 | = | (c) | REQ-24 | 内容覆盖47%:collaboration/mobile/lib/features/channels/message_actions/message_action_popover.dart | Mobile 通用部件（随资料/表情/引导等功能删除） |

### Mobile 平台工程（android/ios/配置）（15）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `mobile/.gitignore` | +1/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/HUDDLES.md` | +0/−114 | = | (d) | - | 引用:web-client/web/public/huddle-playout-worklet.js;内容覆盖0% | 测试/构建/发布文件 |
| M | `mobile/android/app/build.gradle.kts` | +21/−42 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/android/app/src/main/AndroidManifest.xml` | +8/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/AgeSignalRequest.kt` | +0/−62 | = | 待定 | - | 内容覆盖20% | Google Play 年龄信号门禁（应用商店合规）；与 Kailo 企业部署分发方式相关，设计未覆盖 |
| D | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/HuddleAudioEngine.kt` | +0/−925 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖0% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| D | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/HuddleMediaPlugin.kt` | +0/−507 | = | (a) | DD-125(3)、REQ-21 | 内容覆盖1% | Huddle 一期只在 Web 与 Desktop 恢复，“Mobile 不在本条范围” |
| M | `mobile/android/app/src/main/kotlin/xyz/block/buzz/mobile/MainActivity.kt` | +0/−96 |  | 待定 | DD-75、DD-78、DD-40、REQ-21 |  | 原地删减较多（+0/-96），默认归治理适配证据不足，需逐 hunk 复核是否删掉用户可见功能 |
| D | `mobile/android/app/src/test/kotlin/xyz/block/buzz/mobile/AgeSignalPayloadTest.kt` | +0/−122 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `mobile/android/app/src/test/kotlin/xyz/block/buzz/mobile/AgeSignalRequestTest.kt` | +0/−86 | = | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `mobile/android/app/src/test/kotlin/xyz/block/buzz/mobile/HuddleActiveTalkerSelectorTest.kt` | +0/−141 | = | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| M | `mobile/ios/Podfile` | +0/−7 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/ios/Runner/Info.plist` | +13/−5 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/pubspec.lock` | +13/−105 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/pubspec.yaml` | +5/−7 |  | (d) | - |  | 测试/构建/发布文件 |

### Mobile 测试（130）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `mobile/test/features/activity/activity_page_test.dart` | +0/−1065 | mobile/test/features/activity | (d) | - | 内容覆盖32%:collaboration/mobile/test/features/channels/channels_page_test.dart | 测试/构建/发布文件 |
| D | `mobile/test/features/activity/activity_provider_test.dart` | +0/−1157 | mobile/test/features/activity | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| R | `mobile/test/features/activity/compose_drafts_provider_test.dart → mobile/test/features/channels/compose_drafts_provider_test.dart` | +1/−30 |  | (d) | - | collaboration/mobile/test/features/channels/compose_drafts_provider_test.dart | 测试改名 |
| D | `mobile/test/features/activity/dm_resurface_test.dart` | +0/−61 | mobile/test/features/activity | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/features/activity/feed_item_test.dart` | +0/−303 | mobile/test/features/activity | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `mobile/test/features/activity/inbox_item_test.dart` | +0/−285 | mobile/test/features/activity | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `mobile/test/features/activity/inbox_read_state_test.dart` | +0/−138 | mobile/test/features/activity | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `mobile/test/features/activity/reminders_provider_test.dart` | +0/−127 | mobile/test/features/activity | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `mobile/test/features/age_gate/README.md` | +0/−43 | mobile/test/features/age_gate | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/features/age_gate/age_gate_app_test.dart` | +0/−532 | mobile/test/features/age_gate | (d) | - | 内容覆盖27% | 测试/构建/发布文件 |
| D | `mobile/test/features/age_gate/age_restriction_page_test.dart` | +0/−18 | mobile/test/features/age_gate | (d) | - | 内容覆盖29% | 测试/构建/发布文件 |
| D | `mobile/test/features/age_gate/age_signal_provider_test.dart` | +0/−200 | mobile/test/features/age_gate | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/agent_activity/observer_subscription_test.dart` | +0/−630 | mobile/test/features/channels/agent_activity | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/agent_activity/transcript_builder_test.dart` | +0/−144 | mobile/test/features/channels/agent_activity | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/agent_activity/transcript_item_widget_test.dart` | +0/−52 | mobile/test/features/channels/agent_activity | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_actions_sheet_test.dart` | +0/−571 | = | (d) | - | 内容覆盖27% | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channel_detail_page_test.dart` | +2117/−9363 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channel_management_provider_test.dart` | +3/−619 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channel_messages_provider_test.dart` | +120/−71 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_preferences_manager_test.dart` | +0/−57 | = | (d) | - | 内容覆盖20% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_sections/channel_sections_manager_test.dart` | +0/−407 | mobile/test/features/channels/channel_sections | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_sections/channel_sections_storage_test.dart` | +0/−43 | mobile/test/features/channels/channel_sections | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_sort/channel_sort_manager_test.dart` | +0/−377 | mobile/test/features/channels/channel_sort | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_sort/channel_sort_storage_test.dart` | +0/−124 | mobile/test/features/channels/channel_sort | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/channel_stars/channel_stars_storage_test.dart` | +0/−114 | mobile/test/features/channels/channel_stars | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channel_test.dart` | +0/−203 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channel_window_test.dart` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channels_page_test.dart` | +127/−1746 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/channels_provider_test.dart` | +61/−1438 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/compose_bar_test.dart` | +200/−804 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/compose_bar_test/exact_mention_tests.dart` | +4/−8 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/date_formatters_test.dart` | +24/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/deep_link_dispatcher_test.dart` | +38/−635 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/emoji_picker_test.dart` | +0/−762 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/mentions/mention_candidates_test.dart` | +0/−161 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/message_actions_test.dart` | +27/−587 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/message_content_custom_emoji_test.dart` | +0/−125 | = | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/message_content_stability_test.dart` | +0/−59 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/message_content_test.dart` | +0/−174 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/message_mention_pubkeys_test.dart` | +0/−82 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `mobile/test/features/channels/reaction_row_test.dart` | +0/−390 | = | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/read_state/read_state_format_test.dart` | +13/−156 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/read_state/read_state_manager_test.dart` | +125/−271 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/read_state/read_state_provider_test.dart` | +56/−9 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/send_message_provider_test.dart` | +298/−130 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/timeline_message_test.dart` | +0/−142 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/channels/unread_badge/unread_badge_provider_test.dart` | +6/−25 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/forum/forum_models_test.dart` | +0/−257 | mobile/test/features/forum | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `mobile/test/features/forum/forum_widgets_test.dart` | +0/−965 | mobile/test/features/forum | (d) | - | 内容覆盖42%:collaboration/mobile/test/features/channels/channel_detail_page_test.dart | 测试/构建/发布文件 |
| M | `mobile/test/features/home/home_page_test.dart` | +5/−152 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/invites/invite_create_page_test.dart` | +0/−449 | mobile/test/features/invites | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `mobile/test/features/invites/invite_create_provider_test.dart` | +0/−164 | mobile/test/features/invites | (d) | - | 内容覆盖23% | 测试/构建/发布文件 |
| D | `mobile/test/features/invites/invite_join_provider_test.dart` | +0/−763 | mobile/test/features/invites | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `mobile/test/features/invites/invite_join_sheet_test.dart` | +0/−119 | mobile/test/features/invites | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `mobile/test/features/pairing/pairing_page_test.dart` | +0/−766 | mobile/test/features/pairing | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| D | `mobile/test/features/pairing/pairing_provider_test.dart` | +0/−1168 | mobile/test/features/pairing | (d) | - | 内容覆盖9% | 测试/构建/发布文件 |
| D | `mobile/test/features/pairing/pairing_qr_scanner_test.dart` | +0/−277 | mobile/test/features/pairing | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `mobile/test/features/pairing/pairing_socket_test.dart` | +0/−310 | mobile/test/features/pairing | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/animated_avatar_capture_test.dart` | +0/−621 | mobile/test/features/profile | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/camera_disposal_barrier_test.dart` | +0/−58 | mobile/test/features/profile | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/image_avatar_capture_lifecycle_test.dart` | +0/−248 | mobile/test/features/profile | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/presence_cache_provider_test.dart` | +0/−194 | mobile/test/features/profile | (d) | - | 内容覆盖40%:collaboration/mobile/test/features/channels/channel_messages_provider_test.dart | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_avatar_draft_test.dart` | +0/−115 | mobile/test/features/profile | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_avatar_test.dart` | +0/−150 | mobile/test/features/profile | (d) | - | 内容覆盖18% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_edit_page_test.dart` | +0/−1092 | mobile/test/features/profile | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_edit_page_test/image_selection_tests.dart` | +0/−708 | mobile/test/features/profile | (d) | - | 内容覆盖22% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_edit_page_test/motion_and_accessibility_tests.dart` | +0/−566 | mobile/test/features/profile | (d) | - | 内容覆盖29% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_edit_retry_test.dart` | +0/−698 | mobile/test/features/profile | (d) | - | 内容覆盖31%:collaboration/mobile/test/features/settings/theme_picker_page_test.dart | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/profile_provider_test.dart` | +0/−801 | mobile/test/features/profile | (d) | - | 内容覆盖19% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/set_status_sheet_test.dart` | +0/−254 | mobile/test/features/profile | (d) | - | 内容覆盖31%:collaboration/mobile/test/features/settings/theme_picker_page_test.dart | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/settings_profile_header_test.dart` | +0/−411 | mobile/test/features/profile | (d) | - | 内容覆盖25% | 测试/构建/发布文件 |
| D | `mobile/test/features/profile/user_status_provider_test.dart` | +0/−235 | mobile/test/features/profile | (d) | - | 内容覆盖31%:collaboration/mobile/test/features/channels/channel_messages_provider_test.dart | 测试/构建/发布文件 |
| D | `mobile/test/features/pulse/compose_note_page_test.dart` | +0/−226 | mobile/test/features/pulse | (d) | - | 内容覆盖30% | 测试/构建/发布文件 |
| D | `mobile/test/features/pulse/note_card_test.dart` | +0/−297 | mobile/test/features/pulse | (d) | - | 内容覆盖41%:collaboration/mobile/test/features/channels/channel_detail_page_test.dart | 测试/构建/发布文件 |
| M | `mobile/test/features/search/recent_searches_provider_test.dart` | +0/−21 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/search/search_page_test.dart` | +21/−39 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/features/settings/connection_section_test.dart` | +0/−330 | = | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `mobile/test/features/settings/settings_page_loading_test.dart` | +0/−69 | = | (d) | - | 内容覆盖44%:collaboration/mobile/test/features/channels/channel_detail_page_test.dart | 测试/构建/发布文件 |
| M | `mobile/test/features/settings/settings_page_test.dart` | +72/−499 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/features/settings/theme_picker_page_test.dart` | +90/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/animated_avatar_test.dart` | +1/−8 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/auth/auth_provider_test.dart` | +0/−305 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/community/community_membership_provider_test.dart` | +0/−72 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| M | `mobile/test/shared/community/community_provider_test.dart` | +46/−696 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/community/community_storage_test.dart` | +0/−163 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/community/community_test.dart` | +17/−53 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/crypto/nip44_interop_test.dart` | +0/−21 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/shared/custom_emoji/custom_emoji_render_test.dart` | +0/−109 | mobile/test/shared/custom_emoji | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/shared/custom_emoji/custom_emoji_test.dart` | +0/−165 | mobile/test/shared/custom_emoji | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| M | `mobile/test/shared/deeplink/deep_link_test.dart` | +27/−212 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/deeplink/pending_deep_link_provider_test.dart` | +24/−23 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/emoji/emoji_burst_test.dart` | +0/−227 | = | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| M | `mobile/test/shared/emoji/emoji_only_test.dart` | +6/−34 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/emoji/positive_emoji_test.dart` | +0/−48 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/shared/huddle/huddle_media_test.dart` | +0/−171 | mobile/test/shared/huddle | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `mobile/test/shared/huddle/huddle_session_test.dart` | +0/−643 | mobile/test/shared/huddle | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `mobile/test/shared/huddle/huddle_transport_test.dart` | +0/−902 | mobile/test/shared/huddle | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `mobile/test/shared/huddle/huddle_wire_test.dart` | +0/−146 | mobile/test/shared/huddle | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| M | `mobile/test/shared/mentions/agent_identity_provider_test.dart` | +0/−25 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/profile/user_cache_batch_limit_test.dart` | +10/−90 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/dev_push_lease_test.dart` | +0/−436 | mobile/test/shared/push | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_bootstrap_test.dart` | +0/−240 | mobile/test/shared/push | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_bridge_test.dart` | +0/−464 | mobile/test/shared/push | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_gateway_origin_validator_test.dart` | +0/−95 | mobile/test/shared/push | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_lease_revocation_outbox_test.dart` | +0/−331 | mobile/test/shared/push | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_presentation_cache_test.dart` | +0/−144 | mobile/test/shared/push | (d) | - | 内容覆盖17% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_presentation_export_test.dart` | +0/−608 | mobile/test/shared/push | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_presentation_recovery_test.dart` | +0/−707 | mobile/test/shared/push | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_relay_capability_provider_test.dart` | +0/−73 | mobile/test/shared/push | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_snapshot_test.dart` | +0/−23 | mobile/test/shared/push | (d) | - | 内容覆盖12% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_subscription_provider_test.dart` | +0/−66 | mobile/test/shared/push | (d) | - | 内容覆盖15% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_subscription_test.dart` | +0/−154 | mobile/test/shared/push | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `mobile/test/shared/push/push_unconfigured_build_test.dart` | +0/−116 | mobile/test/shared/push | (d) | - | 内容覆盖28% | 测试/构建/发布文件 |
| D | `mobile/test/shared/relay/identity_scoped_prefs_test.dart` | +0/−92 | = | (d) | - | 内容覆盖16% | 测试/构建/发布文件 |
| M | `mobile/test/shared/relay/nostr_models_test.dart` | +0/−62 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/relay/relay_session_test.dart` | +157/−187 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/relay/relay_validation_test.dart` | +0/−161 | = | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `mobile/test/shared/reminders/remind_me_later_sheet_test.dart` | +0/−128 | mobile/test/shared/reminders | (d) | - | 内容覆盖27% | 测试/构建/发布文件 |
| D | `mobile/test/shared/reminders/reminder_service_test.dart` | +0/−124 | mobile/test/shared/reminders | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `mobile/test/shared/security/sensitive_action_authorizer_test.dart` | +0/−197 | mobile/test/shared/security | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| M | `mobile/test/shared/theme/app_theme_test.dart` | +0/−13 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/theme/community_theme_preference_test.dart` | +18/−102 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/theme/community_theme_provider_test.dart` | +23/−357 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/theme/community_theme_sync_test.dart` | +0/−546 | = | (d) | - | 内容覆盖13% | 测试/构建/发布文件 |
| M | `mobile/test/shared/theme/message_typography_test.dart` | +0/−29 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/utils/string_utils_test.dart` | +1/−11 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/shared/widgets/avatar_image_test.dart` | +0/−10 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `mobile/test/shared/widgets/masked_avatar_badge_test.dart` | +0/−147 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| M | `mobile/test/shared/widgets/modal_presentation_test.dart` | +0/−65 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `mobile/test/widget_test.dart` | +45/−14 |  | (d) | - |  | 测试/构建/发布文件 |

### Relay crates/buzz-acp（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-acp/src/relay.rs` | +13/−36 |  | (a) | DD-26、DD-04 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-cli（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-cli/src/commands/mem.rs` | +9/−155 |  | (a) | DD-65、DD-68 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-core（5）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-core/Cargo.toml` | +2/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `crates/buzz-core/src/channel.rs` | +99/−0 |  | (a) | DD-118 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-core/src/engram.rs` | +204/−1 |  | (a) | DD-118 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-core/src/lib.rs` | +6/−0 |  | (a) | DD-118 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-core/src/relay.rs` | +98/−1 |  | (a) | DD-118 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-db（5）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-db/src/store/channel_members.rs` | +1/−1 |  | (a) | DD-80、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-db/src/store/deletion.rs` | +63/−2 |  | (a) | DD-80、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-db/src/store/dm.rs` | +348/−2 |  | (a) | DD-80、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-db/src/store/event.rs` | +345/−1 |  | (a) | DD-80、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-db/src/store/relay_invite.rs` | +1/−0 |  | (a) | DD-80、DD-125 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-deletion（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-deletion/Cargo.toml` | +1/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `crates/buzz-deletion/src/lib.rs` | +373/−8 |  | (a) | DD-109 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-media（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-media/src/storage.rs` | +22/−0 |  | (a) | DD-39 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-relay（19）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-relay/examples/mesh_relay_lifecycle_smoke.rs` | +1/−2 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/api/bridge.rs` | +9/−6 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| R | `crates/buzz-relay/src/api/git/manifest.rs → crates/buzz-core/src/git_manifest.rs` | +1/−12 | crates/buzz-relay/src/api/git/manifest.rs | (b) | DD-118 | collaboration/crates/buzz-core/src/git_manifest.rs | Git manifest 解析器迁入 buzz-core，Relay 与原生删除共用 |
| M | `crates/buzz-relay/src/api/git/mod.rs` | +18/−1 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/api/git/transport.rs` | +1/−0 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/api/operator.rs` | +1/−1 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/audio/handler.rs` | +26/−7 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/audio/mod.rs` | +1/−0 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/config.rs` | +61/−0 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/handlers/command_executor.rs` | +196/−21 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/handlers/event.rs` | +23/−1 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/handlers/ingest.rs` | +41/−11 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/handlers/mod.rs` | +2/−0 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/handlers/side_effects.rs` | +202/−84 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/lib.rs` | +2/−0 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/main.rs` | +77/−9 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/router.rs` | +18/−12 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/state.rs` | +6/−4 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |
| M | `crates/buzz-relay/src/workflow_sink.rs` | +6/−2 |  | (a) | SS-BUZ-GOVERNANCE、DD-80、DD-106、DD-118、DD-120、DD-125 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-sdk（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-sdk/Cargo.toml` | +5/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `crates/buzz-sdk/src/lib.rs` | +5/−0 |  | (a) | DD-39 |  | Relay/SDK 治理接缝改造 |

### Relay crates/buzz-workflow（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `crates/buzz-workflow/src/executor.rs` | +10/−313 |  | (a) | DD-106 |  | Relay/SDK 治理接缝改造 |

### web-client: web 根配置（10）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `web/.gitignore` | +1/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/Caddyfile` | +30/−6 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |
| M | `web/Dockerfile` | +25/−6 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/biome.json` | +8/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/index.html` | +3/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/package-lock.json` | +3583/−905 |  | (b) | DD-74 | client-kit: contracts, platform | 原位文件改为消费共享主体（宿主适配层） |
| M | `web/package.json` | +70/−13 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/tailwind.config.js` | +1/−69 |  | (b) | DD-74 | client-kit: tailwind.config | 原位文件改为消费共享主体（宿主适配层） |
| M | `web/tsconfig.json` | +1/−1 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/vite.config.ts` | +37/−0 |  | (d) | - |  | 测试/构建/发布文件 |

### web-client: web/public（2）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/public/config.json` | +0/−9 | = | (a) | DD-39、DD-111 | web-client/web/src/platform/bff-client.ts；内容覆盖0% | Browser 不接收 Relay URL；运行配置改由平台部署配置/BFF 下发 |
| M | `web/public/manifest.webmanifest` | +3/−3 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |

### web-client: web/src/app（7）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `web/src/app/routeTree.gen.ts` | +176/−86 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/src/app/routes.ts` | +13/−6 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |
| M | `web/src/app/routes/index.tsx` | +3/−4 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |
| D | `web/src/app/routes/invite.$code.tsx` | +0/−8 | = | (a) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；web-client/web/src/app/routes/invite.tsx；内容覆盖0% | Relay 邀请码改为 Tenant 邀请凭据（Core 生成、admin 确认） |
| D | `web/src/app/routes/repos.$repoId.blob.$.tsx` | +0/−8 | = | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/app/routes/repos.$repoId.tsx` | +0/−8 | = | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/app/routes/repos.tsx` | +0/−8 | = | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |

### web-client: web/src/features/agents（6）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/agents/agent-control-client.test.ts` | +0/−48 | web/src/features/agents | (d) | - | 内容覆盖7% | 测试/构建/发布文件 |
| D | `web/src/features/agents/agent-control-client.ts` | +0/−22 | web/src/features/agents | (a) | DD-39、DD-26、DD-24 | client-kit/ts/platform/src/react/agents.tsx；内容覆盖18% | 直读 Relay Agent 目录/本机控制替换为 Core Agent 管理平面 |
| D | `web/src/features/agents/lib/relay-agents.test.ts` | +0/−110 | web/src/features/agents | (d) | - | 内容覆盖5% | 测试/构建/发布文件 |
| D | `web/src/features/agents/lib/relay-agents.ts` | +0/−111 | web/src/features/agents | (a) | DD-39、DD-26、DD-24 | client-kit/ts/platform/src/react/agents.tsx；内容覆盖4% | 直读 Relay Agent 目录/本机控制替换为 Core Agent 管理平面 |
| D | `web/src/features/agents/ui/AgentsView.tsx` | +0/−539 | web/src/features/agents | (b) | DD-24、DD-74 | web-client/web/src/platform/ui/AgentDefinitionsPane.tsx；client-kit/ts/platform/src/react/agents.tsx；内容覆盖8% | Agents 页由共享 Agents 页面承载 |
| D | `web/src/features/agents/use-relay-agents.ts` | +0/−175 | web/src/features/agents | (a) | DD-39、DD-26、DD-24 | client-kit/ts/platform/src/react/agents.tsx；内容覆盖4% | 直读 Relay Agent 目录/本机控制替换为 Core Agent 管理平面 |

### web-client: web/src/features/chat（40）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/chat/lib/channel-discovery.test.ts` | +0/−56 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/channel-discovery.ts` | +0/−56 | = | (a) | DD-39 | web-client/web/src/platform/ui/StreamConnection.tsx；内容覆盖10% | Relay 会话/订阅/发布改为 BFF stream 与语义命令 |
| D | `web/src/features/chat/lib/chat-model.test.ts` | +0/−351 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/chat-model.ts` | +0/−516 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖9% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/lib/chat-types.ts` | +0/−81 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖40%:client-kit/ts/platform/src/react/search/types.ts | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/lib/composer-mentions.test.ts` | +0/−38 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/composer-mentions.ts` | +0/−50 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖7% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/lib/connection-state.ts` | +0/−17 | = | (b) | DD-39 | web-client/web/src/platform/ui/StreamConnection.tsx；内容覆盖0% | 连接状态由 BFF stream 连接状态呈现 |
| D | `web/src/features/chat/lib/conversation-drafts.test.ts` | +0/−78 | = | (d) | - | 内容覆盖3% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/conversation-drafts.ts` | +0/−84 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖9% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/lib/session-events.ts` | +0/−73 | = | (a) | DD-39 | web-client/web/src/platform/ui/StreamConnection.tsx；内容覆盖14% | Relay 会话/订阅/发布改为 BFF stream 与语义命令 |
| D | `web/src/features/chat/lib/use-buzz-session.ts` | +0/−679 | = | (a) | DD-39 | web-client/web/src/platform/ui/StreamConnection.tsx；内容覆盖7% | Relay 会话/订阅/发布改为 BFF stream 与语义命令 |
| D | `web/src/features/chat/lib/use-relay-user-state.test.ts` | +0/−142 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/use-relay-user-state.ts` | +0/−690 | = | (a) | DD-40 | client-kit/ts/platform/src/react/collaboration-preferences.tsx；内容覆盖4% | 30078 用户状态改为 Core CollaborationUserState |
| D | `web/src/features/chat/lib/use-session-mutations.ts` | +0/−579 | = | (a) | DD-39 | web-client/web/src/platform/ui/StreamConnection.tsx；内容覆盖2% | Relay 会话/订阅/发布改为 BFF stream 与语义命令 |
| D | `web/src/features/chat/lib/workspace-shortcuts.test.ts` | +0/−55 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/features/chat/lib/workspace-shortcuts.ts` | +0/−47 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖0% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/AppDialogs.tsx` | +0/−342 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖19% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/AppNavigation.tsx` | +0/−539 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖3% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/AuthenticatedRoute.tsx` | +0/−44 | = | (a) | DD-02、DD-39 | web-client/web/src/platform/ui/PlatformApp.tsx；内容覆盖8% | 密钥身份门替换为网关 OIDC SSO 会话 |
| D | `web/src/features/chat/ui/Avatar.tsx` | +0/−95 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖5% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/BuzzWebApp.tsx` | +0/−810 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖3% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/ChannelBrowserDialog.tsx` | +0/−286 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖13% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/ChannelDetailsPanel.tsx` | +0/−166 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖8% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/ChannelHeaderActions.tsx` | +0/−54 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖4% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/IdentityGate.tsx` | +0/−455 | = | (a) | DD-02、DD-39 | web-client/web/src/platform/ui/PlatformApp.tsx；内容覆盖6% | 密钥身份门替换为网关 OIDC SSO 会话 |
| D | `web/src/features/chat/ui/LeftPanelSizing.tsx` | +0/−40 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖0% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/MemberPanel.tsx` | +0/−288 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖6% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/MentionAutocomplete.tsx` | +0/−62 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖36%:client-kit/ts/platform/src/react/mention-autocomplete.tsx | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/MessageComposer.tsx` | +0/−359 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖23% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| M | `web/src/features/chat/ui/MessageContent.test.tsx` | +791/−18 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/src/features/chat/ui/MessageContent.tsx` | +419/−154 |  | (b) | DD-74 | client-kit: react/cn, react/composer/features/messages/lib/audioAttachment, react/composer/features/messages/lib/channelLink | 原位文件改为消费共享主体（宿主适配层） |
| D | `web/src/features/chat/ui/MessageDialogs.tsx` | +0/−114 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖18% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/MessageList.test.ts` | +0/−55 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/features/chat/ui/MessageList.tsx` | +0/−609 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖11% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/NewDmView.tsx` | +0/−115 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖12% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/SettingsDialog.tsx` | +0/−384 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖8% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/SystemMessageRow.tsx` | +0/−126 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖15% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/ThreadPanel.tsx` | +0/−177 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖8% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |
| D | `web/src/features/chat/ui/WorkspaceToolPanel.tsx` | +0/−22 | = | (b) | DD-74、REQ-24 | web-client/web/src/platform/ui/PlatformApp.tsx；client-kit/ts/platform/src/react/；内容覆盖0% | buzz-web 自有聊天壳替换为 Web/Desktop 共用的原 Desktop 页面主体 |

### web-client: web/src/features/community（3）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/community/invite-api.test.ts` | +0/−53 | web/src/features/community | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `web/src/features/community/invite-api.ts` | +0/−64 | web/src/features/community | (a) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；web-client/web/src/app/routes/invite.tsx；内容覆盖7% | Relay 邀请码改为 Tenant 邀请凭据（Core 生成、admin 确认） |
| D | `web/src/features/community/ui/CommunityInviteDialog.tsx` | +0/−249 | web/src/features/community | (b) | DD-74 | client-kit/ts/platform/src/react/community-members/CommunityInviteDialog.tsx；内容覆盖9% | 社区邀请对话框共享迁移 |

### web-client: web/src/features/inbox（6）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/inbox/lib/inbox-model.test.ts` | +0/−227 | web/src/features/inbox | (d) | - | 内容覆盖6% | 测试/构建/发布文件 |
| D | `web/src/features/inbox/lib/inbox-model.ts` | +0/−155 | web/src/features/inbox | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；web-client/web/src/platform/ui/InboxPane.tsx；内容覆盖11% | Inbox 由共享原 Desktop Inbox 主体承载 |
| D | `web/src/features/inbox/ui/InboxPanelSizing.tsx` | +0/−40 | web/src/features/inbox | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；web-client/web/src/platform/ui/InboxPane.tsx；内容覆盖0% | Inbox 由共享原 Desktop Inbox 主体承载 |
| D | `web/src/features/inbox/ui/InboxView.tsx` | +0/−439 | web/src/features/inbox | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；web-client/web/src/platform/ui/InboxPane.tsx；内容覆盖8% | Inbox 由共享原 Desktop Inbox 主体承载 |
| D | `web/src/features/inbox/use-inbox.test.ts` | +0/−89 | web/src/features/inbox | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `web/src/features/inbox/use-inbox.ts` | +0/−461 | web/src/features/inbox | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；web-client/web/src/platform/ui/InboxPane.tsx；内容覆盖6% | Inbox 由共享原 Desktop Inbox 主体承载 |

### web-client: web/src/features/invite（4）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/invite/invite-api.ts` | +0/−48 | web/src/features/invite | (a) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；web-client/web/src/app/routes/invite.tsx；内容覆盖10% | Relay 邀请码改为 Tenant 邀请凭据（Core 生成、admin 确认） |
| D | `web/src/features/invite/ui/InviteJoinPolicyNotice.tsx` | +0/−149 | web/src/features/invite | (a) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；web-client/web/src/app/routes/invite.tsx；内容覆盖16% | Relay 邀请码改为 Tenant 邀请凭据（Core 生成、admin 确认） |
| D | `web/src/features/invite/ui/InvitePage.tsx` | +0/−370 | web/src/features/invite | (b) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；内容覆盖5% | 邀请页由平台邀请页承载 |
| D | `web/src/features/invite/ui/InvitePageRoute.tsx` | +0/−34 | web/src/features/invite | (a) | DD-83 | web-client/web/src/platform/ui/InvitePage.tsx；web-client/web/src/app/routes/invite.tsx；内容覆盖10% | Relay 邀请码改为 Tenant 邀请凭据（Core 生成、admin 确认） |

### web-client: web/src/features/repos（19）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/features/repos/git-client.ts` | +0/−456 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖1% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/mock-repos.ts` | +0/−141 | web/src/features/repos | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `web/src/features/repos/ui/ConnectButton.tsx` | +0/−20 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖25% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/OrgSidebar.tsx` | +0/−52 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖15% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/PubkeyAvatar.tsx` | +0/−31 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖9% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoBlobViewer.tsx` | +0/−330 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖9% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoCommitsSection.tsx` | +0/−74 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖3% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoContentTabs.tsx` | +0/−79 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoDetailPage.tsx` | +0/−328 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖7% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoListItem.tsx` | +0/−46 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖11% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoReadmeSection.tsx` | +0/−42 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoRefsSection.tsx` | +0/−64 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖13% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/RepoTreeSection.tsx` | +0/−81 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/ReposPage.tsx` | +0/−195 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖3% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/ui/ReposPanel.tsx` | +0/−611 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖7% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/use-git-browse.ts` | +0/−146 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖11% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/use-repo-context.ts` | +0/−45 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖0% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/use-repo-refs.ts` | +0/−77 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖15% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |
| D | `web/src/features/repos/use-repos.ts` | +0/−91 | web/src/features/repos | (b) | DD-118 | client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx；web-client/web/src/platform/ui/ProjectsPane.tsx；内容覆盖13% | buzz-web 直连 Relay git 的仓库浏览器移除；仓库内容由共享 Desktop Projects 视图经 BFF Projects Git 查询读取（独立 /repos 列表路由与组织侧栏未保留，见 c 类 Top30 备注） |

### web-client: web/src/main.tsx（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `web/src/main.tsx` | +21/−8 |  | (b) | DD-74 | client-kit: conversationDensityPreference, fontSizePreference, react/emoji-burst | 原位文件改为消费共享主体（宿主适配层） |

### web-client: web/src/shared（32）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/src/shared/api/media-client.test.ts` | +0/−116 | web/src/shared/api | (d) | - | 内容覆盖11% | 测试/构建/发布文件 |
| D | `web/src/shared/api/media-client.ts` | +0/−100 | web/src/shared/api | (a) | DD-39 | web-client/web/src/platform/bff-client.ts；内容覆盖8% | Relay WebSocket/媒体直连客户端整体替换为 BFF transport |
| D | `web/src/shared/api/media-sanitizer.test.ts` | +0/−96 | web/src/shared/api | (d) | - | 内容覆盖2% | 测试/构建/发布文件 |
| D | `web/src/shared/api/media-sanitizer.ts` | +0/−548 | web/src/shared/api | (a) | DD-39 | web-client/web/src/platform/bff-client.ts；内容覆盖2% | Relay WebSocket/媒体直连客户端整体替换为 BFF transport |
| D | `web/src/shared/api/nostr-types.ts` | +0/−27 | web/src/shared/api | (a) | DD-39 | web-client/web/src/platform/bff-client.ts；内容覆盖0% | Relay WebSocket/媒体直连客户端整体替换为 BFF transport |
| D | `web/src/shared/api/relay-client.test.ts` | +0/−278 | web/src/shared/api | (d) | - | 内容覆盖4% | 测试/构建/发布文件 |
| D | `web/src/shared/api/relay-client.ts` | +0/−408 | web/src/shared/api | (a) | DD-39 | web-client/web/src/platform/bff-client.ts；内容覆盖7% | Relay WebSocket/媒体直连客户端整体替换为 BFF transport |
| D | `web/src/shared/config/runtime-config.test.ts` | +0/−15 | web/src/shared/config | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/shared/config/runtime-config.ts` | +0/−93 | web/src/shared/config | (a) | DD-39、DD-111 | web-client/web/src/platform/bff-client.ts；内容覆盖0% | Browser 不接收 Relay URL；运行配置改由平台部署配置/BFF 下发 |
| D | `web/src/shared/features/relay-features.test.ts` | +0/−27 | web/src/shared/features | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/shared/features/relay-features.ts` | +0/−36 | web/src/shared/features | (a) | DD-39 | web-client/web/src/platform/gif-capability.ts；内容覆盖7% | NIP-11 能力探测改由 BFF/部署能力投影 |
| M | `web/src/shared/i18n/index.test.ts` | +27/−5 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `web/src/shared/i18n/index.ts` | +63/−734 |  | (a) | GOAL 中文默认/英文适配、DD-53 |  | 中文默认与英文适配 |
| D | `web/src/shared/lib/buzz-download.ts` | +0/−157 | = | 待定 | - | 内容覆盖1% | 邀请页“下载 Buzz 桌面端”指向 block/buzz GitHub Releases；Kailo 安装包下载入口应由发布配置给出（DD-111(4)/ADR-06），当前无替代入口，需裁定是恢复为 Kailo 发布地址还是不提供 |
| D | `web/src/shared/lib/identity-backup.ts` | +0/−9 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖17% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| D | `web/src/shared/lib/identity-vault.ts` | +0/−200 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖5% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| D | `web/src/shared/lib/nip98.ts` | +0/−45 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖0% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| D | `web/src/shared/lib/nostr-client.ts` | +0/−157 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖8% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| D | `web/src/shared/lib/nostr-signer.test.ts` | +0/−47 | = | (d) | - | 内容覆盖0% | 测试/构建/发布文件 |
| D | `web/src/shared/lib/nostr-signer.ts` | +0/−251 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖1% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| D | `web/src/shared/lib/pubkey.test.ts` | +0/−15 | = | (d) | - | 内容覆盖14% | 测试/构建/发布文件 |
| M | `web/src/shared/lib/pubkey.ts` | +0/−20 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |
| M | `web/src/shared/lib/relative-time.ts` | +10/−11 |  | (b) | DD-74 | client-kit: format, i18n | 原位文件改为消费共享主体（宿主适配层） |
| D | `web/src/shared/lib/use-nip07-availability.ts` | +0/−28 | = | (a) | DD-39、DD-02、DD-75 | core/crates/collab-bridge/src/bridge.rs；内容覆盖0% | Browser 不持 Nostr 私钥、不签 NIP-42/98，不用 NIP-07；Core 代签 |
| M | `web/src/shared/styles/globals.css` | +4/−312 |  | (b) | DD-74 | client-kit: src, styles.css | 原位文件改为消费共享主体（宿主适配层） |
| M | `web/src/shared/theme/ThemeProvider.tsx` | +8/−70 |  | (b) | DD-74 | client-kit: theme/use-appearance | 原位文件改为消费共享主体（宿主适配层） |
| D | `web/src/shared/theme/ThemeToggle.tsx` | +0/−32 | = | (b) | DD-53 | client-kit/ts/platform/src/react/appearance-settings.tsx；内容覆盖14% | 主题切换由共享原 Desktop 外观设置承载 |
| M | `web/src/shared/ui/button.tsx` | +1/−50 |  | (b) | DD-74 | client-kit: react/button | 原位文件改为消费共享主体（宿主适配层） |
| D | `web/src/shared/ui/card.tsx` | +0/−58 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/messages/thread/threadFocusLayout.ts；内容覆盖0% | buzz-web 自有布局件由共享主体布局替代 |
| D | `web/src/shared/ui/resizable-panel.tsx` | +0/−133 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/messages/thread/threadFocusLayout.ts；内容覆盖20% | buzz-web 自有布局件由共享主体布局替代 |
| D | `web/src/shared/ui/right-panel-sizing.tsx` | +0/−59 | = | (b) | DD-74 | client-kit/ts/platform/src/react/inbox-view.tsx；client-kit/ts/platform/src/react/messages/thread/threadFocusLayout.ts；内容覆盖0% | buzz-web 自有布局件由共享主体布局替代 |
| M | `web/src/shared/ui/tooltip.tsx` | +1/−30 |  | (b) | DD-74 | client-kit: react/sidebar/tooltip | 原位文件改为消费共享主体（宿主适配层） |

### web-client: web/src/vite-env.d.ts（1）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `web/src/vite-env.d.ts` | +3/−0 |  | (a) | DD-39、DD-74 |  | Web 入口改为 BFF/共享主体 |

### web-client: 测试/构建（5）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| D | `web/playwright.config.ts` | +0/−38 | = | (d) | - | 内容覆盖60%:collaboration/desktop/playwright.config.ts | 测试/构建/发布文件 |
| D | `web/playwright.live.config.ts` | +0/−49 | = | (d) | - | 内容覆盖24% | 测试/构建/发布文件 |
| D | `web/tests/e2e/live-p0.spec.ts` | +0/−383 | web/tests | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `web/tests/e2e/p0.spec.ts` | +0/−360 | web/tests | (d) | - | 内容覆盖1% | 测试/构建/发布文件 |
| D | `web/tests/e2e/smoke.spec.ts` | +0/−1264 | web/tests | (d) | - | 内容覆盖8% | 测试/构建/发布文件 |

### 仓库根/其他（9）

| 状态 | 原版路径 | +/− | remove_paths | 分类 | 依据 | 替代位置/证据 | 说明 |
|---|---|---|---|---|---|---|---|
| M | `.env.example` | +0/−4 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `AGENTS.md` | +3/−2 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `Cargo.lock` | +13/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `Cargo.toml` | +1/−0 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `Dockerfile` | +6/−3 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `Justfile` | +22/−257 |  | (d) | - |  | 测试/构建/发布文件 |
| M | `pnpm-lock.yaml` | +214/−389 |  | (d) | - |  | 测试/构建/发布文件 |
| D | `preview-features.json` | +0/−35 | = | (b) | DD-74 | client-kit/ts/platform/src/react/features/preview-features.json；内容覆盖100%:client-kit/ts/platform/src/react/features/preview-features.json | 原预览特性清单迁入共享 features |
| M | `schema/schema.sql` | +11/−1 |  | (a) | DD-75、DD-80、DD-40 |  | Desktop 宿主适配（本人签名直连 Relay、管理面经 BFF） |

## 7. 新增文件（A，仅计数与路径）

- **Desktop app（外壳/路由）**（3）：`desktop/src/app/routes/applications.$bindingId.tsx`(+18)、`desktop/src/app/routes/platform.$section.tsx`(+122)、`desktop/src/app/routes/platform.workflows.$workflowId.tsx`(+40)
- **Desktop features/channels**（3）：`desktop/src/features/channels/channelReference.ts`(+163)、`desktop/src/features/channels/nativeDmReadState.test.mjs`(+123)、`desktop/src/features/channels/ui/ChannelJoinScreen.tsx`(+41)
- **Desktop features/forum**（1）：`desktop/src/features/forum/ForumScreen.tsx`(+164)
- **Desktop features/home**（6）：`desktop/src/features/home/nativeDmFeed.test.mjs`(+53)、`desktop/src/features/home/nativeDmFeed.ts`(+64)、`desktop/src/features/home/useInboxSelectionAnchor.test.mjs`(+74)、`desktop/src/features/home/useInboxThreadContext.test.mjs`(+58)、`desktop/src/features/home/useOwnedAgentActivity.test.mjs`(+101)、`desktop/src/features/home/useOwnedAgentActivity.ts`(+56)
- **Desktop features/messages**（9）：`desktop/src/features/messages/lib/typingState.test.mjs`(+89)、`desktop/src/features/messages/lib/useCustomEmojiPalette.ts`(+21)、`desktop/src/features/messages/lib/useMessageMentionClipboard.ts`(+22)、`desktop/src/features/messages/ui/ComposerControls.tsx`(+1)、`desktop/src/features/messages/ui/ComposerReplyBanner.tsx`(+1)、`desktop/src/features/messages/ui/DraftsPanelSources.test.mjs`(+84)、`desktop/src/features/messages/ui/NewMessagePage.tsx`(+53)、`desktop/src/features/messages/useChannelTyping.test.mjs`(+123)、`desktop/src/features/messages/useToggleReactionMutation.test.mjs`(+187)
- **Desktop features/platform**（16）：`desktop/src/features/platform/AgentDefinitionsPane.tsx`(+31)、`desktop/src/features/platform/DeviceIdentityGate.tsx`(+192)、`desktop/src/features/platform/ProjectsScreen.tsx`(+109)、`desktop/src/features/platform/PulseScreen.test.mjs`(+222)、`desktop/src/features/platform/PulseScreen.tsx`(+98)、`desktop/src/features/platform/ReminderHost.tsx`(+41)、`desktop/src/features/platform/activeCommunity.tsx`(+73)、`desktop/src/features/platform/connectCommunity.test.mjs`(+121)、`desktop/src/features/platform/connectCommunity.ts`(+100)、`desktop/src/features/platform/conversationVisibility.ts`(+37)、`desktop/src/features/platform/platformSections.ts`(+30)、`desktop/src/features/platform/projectsTransport.test.mjs`(+284)、`desktop/src/features/platform/projectsTransport.ts`(+352)、`desktop/src/features/platform/pulseTransport.ts`(+75)、`desktop/src/features/platform/remindersTransport.ts`(+81)、`desktop/src/features/platform/workflowMessageHost.ts`(+18)
- **Desktop features/profile**（1）：`desktop/src/features/profile/ui/UserProfilePanel.test.mjs`(+207)
- **Desktop features/search**（1）：`desktop/src/features/search/ui/SearchResultItem.test.mjs`(+295)
- **Desktop features/settings**（4）：`desktop/src/features/settings/lib/colorContrast.ts`(+1)、`desktop/src/features/settings/ui/CustomEmojiSettingsCard.tsx`(+37)、`desktop/src/features/settings/ui/KeyboardShortcutsCard.test.mjs`(+28)、`desktop/src/features/settings/ui/NotificationSettingsCard.test.mjs`(+29)
- **Desktop features/sidebar**（3）：`desktop/src/features/sidebar/ui/ChannelGroupSection.tsx`(+75)、`desktop/src/features/sidebar/ui/ChannelMenuButton.tsx`(+45)、`desktop/src/features/sidebar/ui/SidebarProjects.tsx`(+16)
- **Desktop shared/api**（4）：`desktop/src/shared/api/relayClientUnconfirmedResend.test.mjs`(+357)、`desktop/src/shared/api/relayPublishOutcome.ts`(+124)、`desktop/src/shared/api/relaySelf.ts`(+28)、`desktop/src/shared/api/tauriProfiles.test.mjs`(+34)
- **Desktop src-tauri commands/其他**（4）：`desktop/src-tauri/src/commands/custom_emoji.rs`(+181)、`desktop/src-tauri/src/commands/ffmpeg_locator.rs`(+153)、`desktop/src-tauri/src/commands/messages/unconfirmed.rs`(+481)、`desktop/src-tauri/src/commands/relay_self.rs`(+217)
- **Desktop src-tauri 其他**（8）：`desktop/src-tauri/src/main_window.rs`(+20)、`desktop/src-tauri/src/platform/api.rs`(+800)、`desktop/src-tauri/src/platform/commands.rs`(+183)、`desktop/src-tauri/src/platform/config.rs`(+115)、`desktop/src-tauri/src/platform/e2e.rs`(+260)、`desktop/src-tauri/src/platform/mod.rs`(+20)、`desktop/src-tauri/src/platform/native_auth.rs`(+153)、`desktop/src-tauri/src/platform/oidc.rs`(+368)
- **Desktop 测试/脚本**（7）：`desktop/tests/channels/ChannelScreenHeader.test.tsx`(+105)、`desktop/tests/e2e/device-key.spec.ts`(+65)、`desktop/tests/e2e/platform-bootstrap.spec.ts`(+251)、`desktop/tests/e2e/platform-pages.spec.ts`(+474)、`desktop/tests/settings/MarkdownCodeBlock.test.tsx`(+25)、`desktop/tests/settings/ProfileSettingsCard.test.jsx`(+347)、`desktop/tests/settings/SettingsView.test.tsx`(+93)
- **Mobile features/channels**（7）：`mobile/lib/features/channels/channels_page/new_direct_message_sheet.dart`(+521)、`mobile/lib/features/channels/channels_refresh.dart`(+264)、`mobile/lib/features/channels/direct_message_actions.dart`(+323)、`mobile/lib/features/channels/direct_message_preferences.dart`(+440)、`mobile/lib/features/channels/direct_message_visibility.dart`(+78)、`mobile/lib/features/channels/direct_messages.dart`(+307)、`mobile/lib/features/channels/relay_sync_banner.dart`(+47)
- **Mobile features/platform**（18）：`mobile/lib/features/platform/platform_agent_definition_detail_page.dart`(+260)、`mobile/lib/features/platform/platform_agent_definitions_page.dart`(+108)、`mobile/lib/features/platform/platform_agent_delegations_page.dart`(+276)、`mobile/lib/features/platform/platform_agent_installation_candidates_page.dart`(+125)、`mobile/lib/features/platform/platform_agent_installation_detail_page.dart`(+258)、`mobile/lib/features/platform/platform_agent_installation_workspaces_page.dart`(+147)、`mobile/lib/features/platform/platform_agent_installations_page.dart`(+107)、`mobile/lib/features/platform/platform_agent_memory_page.dart`(+202)、`mobile/lib/features/platform/platform_async_view.dart`(+143)、`mobile/lib/features/platform/platform_audit_page.dart`(+92)、`mobile/lib/features/platform/platform_automation_detail_page.dart`(+274)、`mobile/lib/features/platform/platform_automations_page.dart`(+113)、`mobile/lib/features/platform/platform_devices_page.dart`(+179)、`mobile/lib/features/platform/platform_members_page.dart`(+128)、`mobile/lib/features/platform/platform_sign_in_page.dart`(+317)、`mobile/lib/features/platform/platform_status_text.dart`(+75)、`mobile/lib/features/platform/platform_tasks_page.dart`(+533)、`mobile/lib/features/platform/platform_unavailable_page.dart`(+56)
- **Mobile shared/platform**（9）：`mobile/lib/shared/platform/platform_api.dart`(+362)、`mobile/lib/shared/platform/platform_config.dart`(+149)、`mobile/lib/shared/platform/platform_device.dart`(+122)、`mobile/lib/shared/platform/platform_display_name.dart`(+57)、`mobile/lib/shared/platform/platform_link.dart`(+452)、`mobile/lib/shared/platform/platform_locale.dart`(+37)、`mobile/lib/shared/platform/platform_oidc.dart`(+334)、`mobile/lib/shared/platform/platform_read_state.dart`(+190)、`mobile/lib/shared/platform/platform_views.dart`(+787)
- **Mobile shared/relay**（1）：`mobile/lib/shared/relay/relay_publish_failure.dart`(+57)
- **Mobile 测试**（17）：`mobile/test/features/channels/channel_creation_test.dart`(+529)、`mobile/test/features/channels/direct_message_preferences_cases.dart`(+415)、`mobile/test/features/channels/direct_messages_test.dart`(+867)、`mobile/test/features/channels/relay_sync_banner_test.dart`(+80)、`mobile/test/features/channels/workspace_preferences_cases.dart`(+449)、`mobile/test/features/platform/platform_pages_test.dart`(+1846)、`mobile/test/features/platform/platform_presentation_test.dart`(+53)、`mobile/test/features/platform/platform_tasks_page_test.dart`(+221)、`mobile/test/features/platform/platform_time_test.dart`(+70)、`mobile/test/platform_e2e/platform_e2e_test.dart`(+282)、`mobile/test/shared/platform/platform_api_test.dart`(+99)、`mobile/test/shared/platform/platform_config_test.dart`(+99)、`mobile/test/shared/platform/platform_link_test.dart`(+921)、`mobile/test/shared/platform/platform_locale_test.dart`(+61)、`mobile/test/shared/platform/platform_oidc_test.dart`(+118)、`mobile/test/shared/platform/platform_read_state_test.dart`(+378)、`mobile/test/shared/platform/platform_test_support.dart`(+78)
- **Relay crates/buzz-core**（2）：`crates/buzz-core/src/workflow_condition.rs`(+209)、`crates/buzz-core/src/workflow_template.rs`(+265)
- **Relay crates/buzz-project-git**（6）：`crates/buzz-project-git/Cargo.toml`(+12)、`crates/buzz-project-git/src/exec.rs`(+603)、`crates/buzz-project-git/src/lib.rs`(+47)、`crates/buzz-project-git/src/merge.rs`(+495)、`crates/buzz-project-git/src/snapshot.rs`(+437)、`crates/buzz-project-git/src/types.rs`(+45)
- **Relay crates/buzz-relay**（3）：`crates/buzz-relay/src/audio/governed.rs`(+122)、`crates/buzz-relay/src/deletion_executor.rs`(+214)、`crates/buzz-relay/src/handlers/governance.rs`(+763)
- **Relay crates/buzz-sdk**（2）：`crates/buzz-sdk/src/custom_emoji.rs`(+94)、`crates/buzz-sdk/src/media.rs`(+201)
- **web-client: web 根配置**（2）：`web/.npmrc`(+3)、`web/Dockerfile.dockerignore`(+13)
- **web-client: web/public**（26）：`web/public/huddle-capture-worklet.js`(+44)、`web/public/huddle-playout-worklet.js`(+71)、`web/public/sounds/bong.mp3`(+-)、`web/public/sounds/bong.svg`(+1)、`web/public/sounds/boo.mp3`(+-)、`web/public/sounds/boo.svg`(+1)、`web/public/sounds/dng.mp3`(+-)、`web/public/sounds/dng.svg`(+1)、`web/public/sounds/doo.mp3`(+-)、`web/public/sounds/doo.svg`(+1)、`web/public/sounds/doodone.mp3`(+-)、`web/public/sounds/doodone.svg`(+1)、`web/public/sounds/doong.mp3`(+-)、`web/public/sounds/doong.svg`(+1)、`web/public/sounds/doop.mp3`(+-)、`web/public/sounds/doop.svg`(+1)、`web/public/sounds/flirl.mp3`(+-)、`web/public/sounds/flirl.svg`(+1)、`web/public/sounds/flutter.mp3`(+-)、`web/public/sounds/flutter.svg`(+1)、`web/public/sounds/oh-no.mp3`(+-)、`web/public/sounds/oh-no.svg`(+1)、`web/public/sounds/ping.mp3`(+-)、`web/public/sounds/ping.svg`(+1)、`web/public/sounds/unison.mp3`(+-)、`web/public/sounds/unison.svg`(+1)
- **web-client: web/src/app**（11）：`web/src/app/platform-navigation.test.tsx`(+464)、`web/src/app/platform-navigation.ts`(+220)、`web/src/app/routes/applications.$bindingId.tsx`(+3)、`web/src/app/routes/channels.$channelId.tsx`(+3)、`web/src/app/routes/conversations.$conversationId.tsx`(+3)、`web/src/app/routes/invite.tsx`(+7)、`web/src/app/routes/messages.new.tsx`(+3)、`web/src/app/routes/platform.tsx`(+17)、`web/src/app/routes/section.tsx`(+9)、`web/src/app/routes/workflows.$workflowId.tsx`(+6)、`web/src/app/workflow-navigation.test.tsx`(+175)
- **web-client: web/src/features/chat**（4）：`web/src/features/chat/ui/BffAudioAttachment.tsx`(+43)、`web/src/features/chat/ui/BffMessageLinkHost.tsx`(+157)、`web/src/features/chat/ui/BffVideoReview.tsx`(+173)、`web/src/features/chat/ui/MessageContentLinkPreviewGif.test.tsx`(+118)
- **web-client: web/src/main.test.tsx**（1）：`web/src/main.test.tsx`(+109)
- **web-client: web/src/platform（Kailo 新增宿主）**（79）：`web/src/platform/agentTranscriptStream.test.ts`(+80)、`web/src/platform/agentTranscriptStream.ts`(+110)、`web/src/platform/bff-client.test.ts`(+525)、`web/src/platform/bff-client.ts`(+862)、`web/src/platform/gif-capability.ts`(+53)、`web/src/platform/huddle/WebHuddleHost.test.ts`(+231)、`web/src/platform/huddle/WebHuddleHost.ts`(+351)、`web/src/platform/huddle/audioSession.ts`(+538)、`web/src/platform/ui/AgentDefinitionsPane.test.tsx`(+76)、`web/src/platform/ui/AgentDefinitionsPane.tsx`(+38)、`web/src/platform/ui/BrowserNotifications.test.tsx`(+98)、`web/src/platform/ui/BrowserNotifications.tsx`(+79)、`web/src/platform/ui/ChannelAgentActivityPanel.test.tsx`(+63)、`web/src/platform/ui/ChannelAgentActivityPanel.tsx`(+42)、`web/src/platform/ui/ChannelPane.test.tsx`(+724)、`web/src/platform/ui/ChannelPane.tsx`(+1802)、`web/src/platform/ui/ChannelRead.test.tsx`(+1319)、`web/src/platform/ui/ChannelSidebar.test.tsx`(+376)、`web/src/platform/ui/ChannelSidebar.tsx`(+316)、`web/src/platform/ui/ChannelThreadPane.test.tsx`(+386)、`web/src/platform/ui/ChannelThreadPane.tsx`(+305)、`web/src/platform/ui/ChannelTimelineRows.tsx`(+26)、`web/src/platform/ui/Composer.test.tsx`(+1064)、`web/src/platform/ui/ComposerLinkPreviews.test.tsx`(+158)、`web/src/platform/ui/ConversationSidebar.test.tsx`(+76)、`web/src/platform/ui/ConversationSidebar.tsx`(+71)、`web/src/platform/ui/ForumPane.test.tsx`(+216)、`web/src/platform/ui/ForumPane.tsx`(+243)、`web/src/platform/ui/InboxDrafts.test.tsx`(+128)、`web/src/platform/ui/InboxDrafts.tsx`(+101)、`web/src/platform/ui/InboxPane.test.tsx`(+865)、`web/src/platform/ui/InboxPane.tsx`(+304)、`web/src/platform/ui/InboxThreadPane.test.tsx`(+776)、`web/src/platform/ui/InboxThreadPane.tsx`(+264)、`web/src/platform/ui/InvitePage.tsx`(+33)、`web/src/platform/ui/MessageAuthorProfile.test.tsx`(+482)、`web/src/platform/ui/MessageAuthorProfile.tsx`(+187)、`web/src/platform/ui/NewMessagePage.test.tsx`(+174)、`web/src/platform/ui/NewMessagePage.tsx`(+54)、`web/src/platform/ui/PlatformApp.test.tsx`(+572)、`web/src/platform/ui/PlatformApp.tsx`(+790)、`web/src/platform/ui/PresenceHost.test.tsx`(+106)、`web/src/platform/ui/PresenceHost.tsx`(+106)、`web/src/platform/ui/ProfileSettings.test.tsx`(+312)、`web/src/platform/ui/ProjectsGitHost.test.tsx`(+136)、`web/src/platform/ui/ProjectsPane.tsx`(+101)、`web/src/platform/ui/PulsePane.test.tsx`(+269)、`web/src/platform/ui/PulsePane.tsx`(+87)、`web/src/platform/ui/ReminderHost.tsx`(+42)、`web/src/platform/ui/SettingsChannelTemplates.test.tsx`(+97)、`web/src/platform/ui/SettingsPane.test.tsx`(+298)、`web/src/platform/ui/SettingsPane.tsx`(+175)、`web/src/platform/ui/SettingsShortcut.test.tsx`(+205)、`web/src/platform/ui/SidebarProfileCard.tsx`(+55)、`web/src/platform/ui/SidebarProjects.tsx`(+12)、`web/src/platform/ui/StreamConnection.test.tsx`(+115)、`web/src/platform/ui/StreamConnection.tsx`(+132)、`web/src/platform/ui/TopbarSearch.tsx`(+8)、`web/src/platform/ui/WebAgentTranscriptHost.tsx`(+18)、`web/src/platform/ui/inbox-events.ts`(+84)、`web/src/platform/ui/inbox-snapshot.test.ts`(+14)、`web/src/platform/ui/inbox-snapshot.ts`(+264)、`web/src/platform/ui/queries.ts`(+16)、`web/src/platform/ui/search.test.tsx`(+91)、`web/src/platform/ui/search.ts`(+111)、`web/src/platform/ui/useAgentMentionOutcomes.test.tsx`(+150)、`web/src/platform/ui/useAgentMentionOutcomes.ts`(+128)、`web/src/platform/ui/useChannelWindow.test.tsx`(+228)、`web/src/platform/ui/useChannelWindow.ts`(+235)、`web/src/platform/ui/useMarkAsReadShortcuts.test.tsx`(+138)、`web/src/platform/ui/useMarkAsReadShortcuts.ts`(+108)、`web/src/platform/ui/useMessageReactions.test.tsx`(+80)、`web/src/platform/ui/useMessageReactions.ts`(+96)、`web/src/platform/ui/useTypingBroadcast.test.tsx`(+62)、`web/src/platform/ui/useTypingBroadcast.ts`(+33)、`web/src/platform/ui/useWebHomeFeed.test.tsx`(+142)、`web/src/platform/ui/useWebHomeFeed.ts`(+177)、`web/src/platform/ui/useWorkspaceThread.ts`(+118)、`web/src/platform/ui/workflowMessageHost.ts`(+20)
- **web-client: web/src/shared**（3）：`web/src/shared/lib/clipboard.ts`(+34)、`web/src/shared/lib/relative-time.test.ts`(+31)、`web/src/shared/ui/button.test.tsx`(+67)
- **仓库根/其他**（1）：`migrations/0047_governed_dm_projection.sql`(+12)

## 8. 恢复进度（随恢复分支更新）

本节由恢复分支逐轮维护：每轮结束时重算第 6 节中 (c) 行的源码替代状态，并列出本轮关闭的功能缺口。判定只说明源码层已有替代，不等于页面截图或实际操作验收（第 0 节口径不变）。

### 8.1 判定方法

- 对第 6 节每条 (c) 行：若其原版路径（`desktop/src/` 之后部分）出现在 `client-kit/ts/platform/src`、`web-client/web/src`、`collaboration/desktop/src` 或 `collaboration/mobile/lib` 的源码中（Kailo 文件头注释按惯例引用原版路径），或原版文件名主干（长度大于 6）出现在这些源码中，记为“已有源码替代”；改写（M）且原文件仍在原位的行不自动关闭。
- 这是第 0 节“(b)”规则的同一口径，比“有效行覆盖 ≥30%”宽松，因此只作为进度下界之外的线索；逐项功能是否完整以 8.3 的功能记录与后续截图验收为准。

### 8.2 当前计数（feat/buzz-restore-r4）

| 项目 | 数量 |
|---|---:|
| 第 6 节 (c) 行 | 459 |
| 已有源码替代（按 8.1 判定） | 134 |
| 仍缺（含原位改写行） | 325 |

### 8.3 各轮关闭的功能缺口

- **r1**：频道管理“加入频道”行；Desktop 头部紧凑菜单与 Canvas 入口；Web 1v1 私聊头部头像与资料弹层、Desktop 私聊状态标识；成员数回落；Inbox 未读分隔线与“重新打开”状态；快捷键“发布动态”行；Workflows 编辑器头部菜单、运行卡片步骤/耗时/原因、回应触发 emoji、默认名称。
- **r2**：Web Inbox 详情成员栏（Desktop 同步）与 Inbox 管理面板 Workflows 入口；Projects “讨论于”详情内会话面板；Projects 多选与选择菜单；运行轨迹待审批卡片（审批人、过期时间）；人员候选与私聊行头像（DD-139，Web）；Pulse 点赞进行中状态。
- **r3**：DD-139 Desktop 经设备会话取头像；多选剩余接入点（仓库频道页签、提交行、项目首页）；DD-140 项目频道申请（Core 工具与审批、原版对话框、Needs action 详情）。
- **r4**：DD-140 可用链路（AgentVersion 可选该工具、Delegation 可授予、owner 决定以提及回执回传 Agent）；Web 标签页全局徽标；私聊行“工作中”徽标与活动弹层；私聊不再提供原版没有的星标分组。

### 8.4 仍缺且需后端或设计的主要项（r4 审计）

- Agent 消息的 owner 行（“managed by”）与 respondTo 角标：需要把 owner 与 respondTo 投影到 Agent 目录。
- Agent 收件人前缀：发布契约没有 `agent-address` 提及标签来源。
- Desktop 举报/审核菜单、Desktop “对所有人移除链接预览”、Desktop 输入中广播：需要 Desktop 本机命令。
- owner 编辑/删除自有 Agent 的消息、Agent 快照卡、私聊中提及 Agent、Welcome 横幅、快照粘贴：需要设计裁定。
- Web 先发后传上传与进度条：改变受治理发布语义，需要设计。
- 隐藏私聊在新消息到达时重新出现：Web 需要隐藏会话的事件来源。
- Huddle 相关（Desktop 全模块、线程转写引用）。

### 8.5 已有源码替代的 (c) 行

| 第 6 节行号 | 原版路径 | Kailo 位置 |
|---:|---|---|
| 346 | `desktop/src/app/AppHuddleBar.tsx` | `client-kit/ts/platform/src/react/huddle/HuddleBar.tsx` |
| 347 | `desktop/src/app/AppHuddleShell.tsx` | `client-kit/ts/platform/src/react/huddle/HuddleShell.tsx` |
| 414 | `desktop/src/features/agent-memory/lib/buildMemoryGraph.ts` | `client-kit/ts/platform/src/react/memory-order.ts` |
| 433 | `desktop/src/features/agents/agentWorkingSignal.ts` | `client-kit/ts/platform/src/react/agent-activity/agentWorkingSignal.ts` |
| 465 | `desktop/src/features/agents/lib/catalog.ts` | `client-kit/ts/platform/src/huddle.ts` |
| 628 | `desktop/src/features/agents/ui/TeamsSection.tsx` | `client-kit/ts/platform/src/react/skills.tsx` |
| 849 | `desktop/src/features/channels/ui/BotActivityBar.tsx` | `client-kit/ts/platform/src/react/agent-activity/BotActivityBar.tsx` |
| 852 | `desktop/src/features/channels/ui/ChannelComposerActivityAccessory.tsx` | `client-kit/ts/platform/src/react/agent-activity/ChannelComposerActivityAccessory.tsx` |
| 897 | `desktop/src/features/channels/ui/useChannelActivityTyping.ts` | `client-kit/ts/platform/src/react/agent-activity/useChannelAgentActivity.ts` |
| 1000 | `desktop/src/features/community-members/lib/joinAlerts.ts` | `client-kit/ts/platform/src/react/tenant-join-alerts/joinAlerts.ts` |
| 1008 | `desktop/src/features/community-members/useCommunityJoinAlerts.ts` | `client-kit/ts/platform/src/react/tenant-join-alerts/useTenantJoinAlerts.ts` |
| 1049 | `desktop/src/features/gifs/api.ts` | `client-kit/ts/platform/src/react/gifs/ComposerGifAttachments.tsx` |
| 1101 | `desktop/src/features/huddle/HuddleContext.tsx` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1102 | `desktop/src/features/huddle/HuddleContext.types.ts` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1105 | `desktop/src/features/huddle/components/AddAgentDialog.tsx` | `client-kit/ts/platform/src/react/huddle/AddAgentDialog.tsx` |
| 1107 | `desktop/src/features/huddle/components/HuddleAttachment.tsx` | `client-kit/ts/platform/src/huddle.ts` |
| 1108 | `desktop/src/features/huddle/components/HuddleBar.tsx` | `client-kit/ts/platform/src/react/huddle/HuddleBar.tsx` |
| 1109 | `desktop/src/features/huddle/components/HuddleIndicator.tsx` | `client-kit/ts/platform/src/huddle.ts` |
| 1114 | `desktop/src/features/huddle/components/MicControls.tsx` | `client-kit/ts/platform/src/react/huddle/MicControls.tsx` |
| 1115 | `desktop/src/features/huddle/components/ParticipantList.tsx` | `client-kit/ts/platform/src/react/huddle/ParticipantList.tsx` |
| 1117 | `desktop/src/features/huddle/hooks/useHuddleParticipantRoster.ts` | `client-kit/ts/platform/src/react/huddle/queries.ts` |
| 1119 | `desktop/src/features/huddle/lib/audioWorklet.ts` | `client-kit/ts/platform/src/react/huddle/host.tsx` |
| 1121 | `desktop/src/features/huddle/lib/huddleCardState.ts` | `client-kit/ts/platform/src/huddle.ts` |
| 1123 | `desktop/src/features/huddle/lib/huddleChannelName.ts` | `client-kit/ts/platform/src/huddle.ts` |
| 1125 | `desktop/src/features/huddle/lib/huddleError.ts` | `client-kit/ts/platform/src/huddle.ts` |
| 1127 | `desktop/src/features/huddle/lib/huddlePresence.ts` | `client-kit/ts/platform/src/react/huddle/queries.ts` |
| 1129 | `desktop/src/features/huddle/lib/huddlePresenceRuntime.ts` | `client-kit/ts/platform/src/react/huddle/queries.ts` |
| 1133 | `desktop/src/features/huddle/lib/useAudioDevices.ts` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1134 | `desktop/src/features/huddle/lib/useHuddlePttState.ts` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1135 | `desktop/src/features/huddle/lib/useHuddleSpeakerActivity.ts` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1136 | `desktop/src/features/huddle/lib/useMicLevelAnalyser.ts` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 1344 | `desktop/src/features/messages/lib/waveMessage.ts` | `client-kit/ts/platform/src/react/messages/waveMessage.ts` |
| 1396 | `desktop/src/features/messages/ui/NonMemberMentionDialog.tsx` | `client-kit/ts/platform/src/react/non-member-mentions/NonMemberMentionDialog.tsx` |
| 1409 | `desktop/src/features/messages/ui/WaveMessageAttachment.tsx` | `client-kit/ts/platform/src/react/messages/WaveMessageAttachment.tsx` |
| 1453 | `desktop/src/features/messages/ui/useNonMemberInvite.ts` | `client-kit/ts/platform/src/react/non-member-mentions/useNonMemberInvite.ts` |
| 1482 | `desktop/src/features/moderation/lib/timeoutStore.ts` | `client-kit/ts/platform/src/react/moderation/timeoutStore.ts` |
| 1483 | `desktop/src/features/moderation/ui/ComposerTimeoutBanner.tsx` | `client-kit/ts/platform/src/react/moderation/ComposerTimeoutBanner.tsx` |
| 1515 | `desktop/src/features/onboarding/hooks.ts` | `client-kit/ts/platform/src/react/onboarding/onboardingGate.ts` |
| 1522 | `desktop/src/features/onboarding/ui/AvatarStep.tsx` | `client-kit/ts/platform/src/react/onboarding/AvatarStep.tsx` |
| 1543 | `desktop/src/features/onboarding/ui/OnboardingCard.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingCard.tsx` |
| 1544 | `desktop/src/features/onboarding/ui/OnboardingChrome.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingChrome.tsx` |
| 1545 | `desktop/src/features/onboarding/ui/OnboardingFlow.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingFlow.tsx` |
| 1546 | `desktop/src/features/onboarding/ui/OnboardingFooter.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingFooter.tsx` |
| 1547 | `desktop/src/features/onboarding/ui/OnboardingInput.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingInput.tsx` |
| 1548 | `desktop/src/features/onboarding/ui/OnboardingSlideTransition.tsx` | `client-kit/ts/platform/src/react/onboarding/OnboardingSlideTransition.tsx` |
| 1550 | `desktop/src/features/onboarding/ui/ProfileStep.tsx` | `client-kit/ts/platform/src/react/onboarding/ProfileStep.tsx` |
| 1563 | `desktop/src/features/onboarding/ui/onboardingCardStyles.ts` | `client-kit/ts/platform/src/react/onboarding/onboardingCardStyles.ts` |
| 1568 | `desktop/src/features/onboarding/ui/types.ts` | `client-kit/ts/platform/src/react/onboarding/types.ts` |
| 1612 | `desktop/src/features/profile/lib/profileActivityAgent.ts` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/lib/profileActivityAgent.ts` |
| 1614 | `desktop/src/features/profile/lib/profileActivityCarousel.ts` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/lib/profileActivityCarousel.ts` |
| 1616 | `desktop/src/features/profile/lib/profileActivityFeedScope.ts` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/lib/profileActivityFeedScope.ts` |
| 1648 | `desktop/src/features/profile/ui/ProfileInstancesSection.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/ProfileInstancesSection.tsx` |
| 1656 | `desktop/src/features/profile/ui/UserProfilePanelAgentDetails.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelAgentDetails.tsx` |
| 1658 | `desktop/src/features/profile/ui/UserProfilePanelFields.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelFields.tsx` |
| 1659 | `desktop/src/features/profile/ui/UserProfilePanelFocusedViews.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelFocusedViews.tsx` |
| 1661 | `desktop/src/features/profile/ui/UserProfilePanelHeaderContent.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelHeaderContent.tsx` |
| 1664 | `desktop/src/features/profile/ui/UserProfilePanelSections.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelSections.tsx` |
| 1665 | `desktop/src/features/profile/ui/UserProfilePanelTabs.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelTabs.tsx` |
| 1667 | `desktop/src/features/profile/ui/UserProfilePanelUtils.ts` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelUtils.ts` |
| 1693 | `desktop/src/features/projects/lib/projectAgentConversation.ts` | `client-kit/ts/platform/src/react/projects/lib/projectAgentConversation.ts` |
| 1694 | `desktop/src/features/projects/lib/projectAgentConversationStorage.ts` | `client-kit/ts/platform/src/react/projects/lib/projectAgentConversationStorage.ts` |
| 1696 | `desktop/src/features/projects/lib/projectAgentSelection.ts` | `client-kit/ts/platform/src/react/projects/lib/projectAgentConversation.ts` |
| 1708 | `desktop/src/features/projects/lib/projectDetailAgentContext.ts` | `client-kit/ts/platform/src/react/projects/lib/projectDetailAgentContext.ts` |
| 1737 | `desktop/src/features/projects/lib/projectReviewDisplay.ts` | `client-kit/ts/platform/src/react/projects/lib/projectReviewDisplay.ts` |
| 1757 | `desktop/src/features/projects/projectChannelCreation.ts` | `client-kit/ts/platform/src/react/projects/projectChannelCreation.ts` |
| 1759 | `desktop/src/features/projects/projectChannelRequest.ts` | `client-kit/ts/platform/src/react/inbox/needs-action.tsx` |
| 1784 | `desktop/src/features/projects/projectRepositoryCreation.ts` | `client-kit/ts/platform/src/react/projects/projectRepositoryCreation.ts` |
| 1787 | `desktop/src/features/projects/projectSnapshot.ts` | `web-client/web/src/platform/ui/inbox-snapshot.ts` |
| 1798 | `desktop/src/features/projects/ui/AgentContextPayloadPreview.tsx` | `client-kit/ts/platform/src/react/projects/AgentContextPayloadPreview.tsx` |
| 1812 | `desktop/src/features/projects/ui/ProjectAgentChatPanel.tsx` | `client-kit/ts/platform/src/react/projects/projectAgentChatHost.tsx` |
| 1813 | `desktop/src/features/projects/ui/ProjectAgentContextStrip.tsx` | `client-kit/ts/platform/src/react/projects/ProjectAgentContextStrip.tsx` |
| 1814 | `desktop/src/features/projects/ui/ProjectAgentSelectionComposerBanner.tsx` | `client-kit/ts/platform/src/react/projects/ProjectAgentSelectionComposerBanner.tsx` |
| 1816 | `desktop/src/features/projects/ui/ProjectAgentSubmittedContextPill.tsx` | `client-kit/ts/platform/src/react/projects/ProjectAgentSubmittedContextPill.tsx` |
| 1824 | `desktop/src/features/projects/ui/ProjectChannelManagement.tsx` | `client-kit/ts/platform/src/react/projects/ProjectChannelManagement.tsx` |
| 1826 | `desktop/src/features/projects/ui/ProjectChannelRequestDialog.tsx` | `client-kit/ts/platform/src/react/projects/ProjectChannelRequestDialog.tsx` |
| 1830 | `desktop/src/features/projects/ui/ProjectConversationPanel.tsx` | `web-client/web/src/platform/ui/ProjectConversationPane.tsx` |
| 1831 | `desktop/src/features/projects/ui/ProjectConversationPanelContext.tsx` | `client-kit/ts/platform/src/react/projects/ProjectConversationPanelContext.tsx` |
| 1834 | `desktop/src/features/projects/ui/ProjectDetailFeedPanels.tsx` | `client-kit/ts/platform/src/react/projects/ProjectContributorsPanel.tsx` |
| 1837 | `desktop/src/features/projects/ui/ProjectDetailScreen.tsx` | `client-kit/ts/platform/src/react/projects/ProjectsView.tsx` |
| 1839 | `desktop/src/features/projects/ui/ProjectDetailUnavailableState.tsx` | `client-kit/ts/platform/src/react/projects/ProjectDetailUnavailableState.tsx` |
| 1854 | `desktop/src/features/projects/ui/ProjectOverviewPanel.tsx` | `client-kit/ts/platform/src/react/projects/ProjectReadmePanel.tsx` |
| 1863 | `desktop/src/features/projects/ui/ProjectRepositoryManagement.tsx` | `client-kit/ts/platform/src/react/projects/useProjectAccessChannels.ts` |
| 1868 | `desktop/src/features/projects/ui/ProjectRightPanelControls.tsx` | `client-kit/ts/platform/src/react/projects/ProjectsView.tsx` |
| 1881 | `desktop/src/features/projects/ui/ProjectsAgentPromptPage.tsx` | `client-kit/ts/platform/src/react/projects/projectAgentChatHost.tsx` |
| 1882 | `desktop/src/features/projects/ui/ProjectsCategoryCreateDialogs.tsx` | `client-kit/ts/platform/src/react/projects/ProjectsCategoryCreateDialogs.tsx` |
| 1890 | `desktop/src/features/projects/ui/ProjectsOverviewItems.tsx` | `client-kit/ts/platform/src/react/projects/ProjectsView.tsx` |
| 1897 | `desktop/src/features/projects/ui/ProjectsSelectionCountMenu.tsx` | `client-kit/ts/platform/src/react/projects/ProjectsSelectionCountMenu.tsx` |
| 1908 | `desktop/src/features/projects/ui/UnavailableProjectRepositories.tsx` | `client-kit/ts/platform/src/react/projects/UnavailableProjectRepositories.tsx` |
| 1910 | `desktop/src/features/projects/ui/buildProjectsViewAgentContext.ts` | `client-kit/ts/platform/src/react/projects/buildProjectsViewAgentContext.ts` |
| 1912 | `desktop/src/features/projects/ui/projectDetailHelpers.ts` | `client-kit/ts/platform/src/react/projects/ProjectContributorsPanel.tsx` |
| 1928 | `desktop/src/features/projects/ui/useProjectDetailPeople.ts` | `client-kit/ts/platform/src/react/projects/ProjectsView.tsx` |
| 1933 | `desktop/src/features/projects/ui/useProjectRepositoryPanel.ts` | `client-kit/ts/platform/src/react/projects/ProjectsView.tsx` |
| 1934 | `desktop/src/features/projects/ui/useProjectsOverviewAgentContext.ts` | `client-kit/ts/platform/src/react/projects/useProjectsOverviewAgentContext.ts` |
| 1937 | `desktop/src/features/projects/ui/useRepositoryFileContentSource.ts` | `client-kit/ts/platform/src/react/projects/ProjectHomeCodebasePanel.tsx` |
| 1940 | `desktop/src/features/projects/ui/useRetainedProjectGitViews.ts` | `client-kit/ts/platform/src/react/projects/ProjectRepositoryGitTabs.tsx` |
| 1942 | `desktop/src/features/projects/useAddProjectChannel.ts` | `client-kit/ts/platform/src/react/projects/ProjectChannelRequestDialog.tsx` |
| 1944 | `desktop/src/features/projects/useAddProjectRepository.ts` | `client-kit/ts/platform/src/react/projects/projectRepositoryManagement.ts` |
| 1945 | `desktop/src/features/projects/useAttachProjectRepository.ts` | `client-kit/ts/platform/src/react/projects/projectRepositoryManagement.ts` |
| 1946 | `desktop/src/features/projects/useBindProjectRepositoryChannel.ts` | `client-kit/ts/platform/src/react/projects/projectRepositoryManagement.ts` |
| 1948 | `desktop/src/features/projects/useGitIdentity.ts` | `client-kit/ts/platform/src/react/projects/ProjectContributorsPanel.tsx` |
| 1950 | `desktop/src/features/projects/useHealProjectHomeRepositories.ts` | `client-kit/ts/platform/src/react/projects/ProjectChannelHome.tsx` |
| 1952 | `desktop/src/features/projects/useProjectChannelRequests.ts` | `client-kit/ts/platform/src/react/projects/ProjectChannelRequestDialog.tsx` |
| 1953 | `desktop/src/features/projects/useProjectCommitDiff.ts` | `client-kit/ts/platform/src/react/projects/projectGitQueries.ts` |
| 1958 | `desktop/src/features/projects/useProjectRepositorySnapshots.ts` | `client-kit/ts/platform/src/react/projects/projectGitQueries.ts` |
| 2043 | `desktop/src/features/settings/ui/ChannelTemplatesSettingsCard.tsx` | `client-kit/ts/platform/src/react/channel-templates/ChannelTemplatesSettingsCard.tsx` |
| 2054 | `desktop/src/features/settings/ui/ModerationQueueCard.tsx` | `client-kit/ts/platform/src/react/moderation/ModerationQueueCard.tsx` |
| 2127 | `desktop/src/features/sidebar/ui/ChannelSectionDialogs.tsx` | `client-kit/ts/platform/src/react/sidebar/channel-section-dialogs.tsx` |
| 2135 | `desktop/src/features/sidebar/ui/SidebarDnd.tsx` | `client-kit/ts/platform/src/react/sidebar/sidebar-dnd.tsx` |
| 2141 | `desktop/src/features/sidebar/ui/SidebarSection.tsx` | `client-kit/ts/platform/src/react/sidebar/channel-row.tsx` |
| 2157 | `desktop/src/features/terminal/fadeController.ts` | `collaboration/mobile/lib/features/channels/channels_page/quick_actions.dart` |
| 2517 | `desktop/src/shared/styles/globals/terminal.css` | `client-kit/ts/platform/src/gateway-drafts.ts` |
| 2574 | `desktop/src/shared/ui/assets/terminal.svg` | `client-kit/ts/platform/src/gateway-drafts.ts` |
| 2582 | `desktop/src/shared/ui/carousel.tsx` | `client-kit/ts/platform/src/react/profile/buzz/features/profile/ui/UserProfilePanelTabs.tsx` |
| 2685 | `desktop/src-tauri/src/archive/pipeline.rs` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 2781 | `desktop/src-tauri/src/commands/personas/sharing.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2782 | `desktop/src-tauri/src/commands/personas/snapshot.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2802 | `desktop/src-tauri/src/commands/teams/pending.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2806 | `desktop/src-tauri/src/commands/teams/sharing.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2865 | `desktop/src-tauri/src/commands/updater.rs` | `client-kit/ts/platform/src/react/image-lightbox/ImageZoomOverlay.tsx` |
| 2879 | `desktop/src-tauri/src/huddle/audio_output.rs` | `client-kit/ts/platform/src/react/huddle/host.tsx` |
| 2880 | `desktop/src-tauri/src/huddle/commands.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2889 | `desktop/src-tauri/src/huddle/pipeline.rs` | `client-kit/ts/platform/src/react/huddle/HuddleContext.tsx` |
| 2890 | `desktop/src-tauri/src/huddle/playout.rs` | `client-kit/ts/platform/src/huddle.ts` |
| 2893 | `desktop/src-tauri/src/huddle/reconnect.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 2894 | `desktop/src-tauri/src/huddle/relay_api.rs` | `client-kit/ts/platform/src/huddle.ts` |
| 2898 | `desktop/src-tauri/src/huddle/transcription.rs` | `client-kit/ts/platform/src/react/huddle/HuddleBar.tsx` |
| 3137 | `desktop/src-tauri/src/ptt_shortcut.rs` | `web-client/web/src/platform/huddle/audioSession.ts` |
| 3172 | `desktop/src-tauri/crates/buzz-terminal/src/context.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 3179 | `desktop/src-tauri/crates/buzz-terminal/src/lifecycle.rs` | `client-kit/ts/platform/src/huddle.ts` |
| 3181 | `desktop/src-tauri/crates/buzz-terminal/src/listener.rs` | `client-kit/ts/platform/src/i18n.ts` |
| 3515 | `mobile/lib/features/channels/channels_page/badges.dart` | `→ mobile/lib/features/channels/channels_page/error_view.dart collaboration/mobile/lib/features/channels/channels_page.dart` |
| 3627 | `mobile/lib/features/profile/image_avatar_capture/camera_preview.dart` | `collaboration/mobile/lib/features/channels/compose_bar.dart` |
| 3644 | `mobile/lib/features/profile/user_status.dart` | `client-kit/ts/platform/src/react/user-status/hooks.ts` |
| 3722 | `mobile/lib/shared/custom_emoji/custom_emoji.dart` | `client-kit/ts/platform/src/react/composer/features/messages/lib/customEmojiNode.ts` |
