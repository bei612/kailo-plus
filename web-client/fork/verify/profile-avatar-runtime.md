# 本人头像运行配置修复与浏览器实测（2026-10-07）

## Web 显示名原版回退恢复

1. 权威：同一固定 Buzz commit 的 `desktop/src/features/sidebar/ui/AppSidebar.tsx::AppSidebar` 使用 `profile?.displayName?.trim() || fallbackDisplayName?.trim()`。本轮实际截图 `16-emoji-before-style-restore.png` 中左下角姓名空白；Playwright 读取请求 251 的 profile 响应确认 `displayName:""`，不是头像上传失败。Web 的 `??` 只处理 null，误将合法的空昵称覆盖已认证会话中的显示名。
2. 影响：`WebSidebarProfileCard` 恢复原 trim/非空回退，保留现有受信 Session 显示名来源，继续复用两端共享 SidebarProfileCard/头像/弹层。资料读取仍按 session/principal 隔离；不写回昵称，不修改账号、授权、契约、数据库或 Mobile。
3. 副作用：这是显示名，不是认证回退；不会凭昵称授予权限、替换 principal 或回退默认租户。原 profile 失败时仍不暴露其旧头像，昵称可显示当前认证 Session 已知的本人名称。
4. 边界：空字符串、全空白与有前后空白的有效昵称分别恢复原行为；真实 shared 侧栏文本及头像按钮可访问名称同时验证，零资料写入。原上传、保存事件读回和会话切换检查不删除。

实现后在既有 4 CPU/8 GiB SDK 执行 `vitest run src/platform/ui/ProfileSettings.test.tsx`：10 passed、退出 0。私有验证输入把 trim/非空回退故意改回 `??`，执行相同文件 `-t 'original display-name fallback'`：3 failed / 7 skipped、退出 1；首个原文 `expected '' to be 'Signed-in human'`。apply_patch 还原后完整文件再跑 10 passed、退出 0。jsdom 仍报告既有 `HTMLCanvasElement.getContext` 不支持警告，未以此声称真实 Canvas/Windows 验收。本修复尚未部署；线上截图证明修复前问题，不冒充修复后截图。

## 权威、影响与边界

1. 权威：`.design/09` §3、DD-39/75/80/81 与 SS-WEB-RELAY。本人资料使用原生 kind 0，由本人签署；Web 经 BFF SERVER 身份，原生端本机身份直连。固定 Buzz `779af8886caae1317b4de962082429867ab61503` 的 `crates/buzz-relay/src/handlers/ingest.rs::ingest_event_inner` 是原发布链；本仓库 `collaboration/crates/buzz-relay/src/handlers/governance.rs::check_event_kind` 额外消费运行配置的成员事件列表。
2. 影响：原头像编辑器 → `POST /api/v1/profile/media` → `PUT /api/v1/profile` → `web_profile.rs::publish_prepared` → Relay kind 0 → 本人资料读回 → BFF 同源媒体读取。只修正未入库的 `deploy/local/.env` 中既有 `BUZZ_MEMBER_EVENT_KINDS`，加入已交付的本人资料 kind 0；保留此前全部值。没有新增开关、源码/契约/迁移、第二资料数据库或页面替代品。
3. 副作用：本人资料属于社区读面，不是工作区私密资料。保持 `BUZZ_REQUIRE_AUTH_TOKEN=true`、`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`、`BUZZ_ALLOW_NIP_OA_AUTH=false`；没有开放管理 kind、解除签名约束或改用 CONTROL 作者。现有 dispatch/outcome、幂等及 UNKNOWN 处理没有变化。配置变更重建仅 Relay 容器，短暂断开现有连接，不重建 Core、数据库或镜像。
4. 异常：修复前上传成功不能视为资料保存成功，实际保存 403 后重新 GET 仍为空。修复后必须保存、Relay 接受、资料读回和刷新后真实图片加载同时成立。未登录请求仍被认证边缘重定向，不能据此声称已实测跨用户冒签或原生端；那些范围本次未验证。

## 实际失败、修复及结果

使用 `playwright-cli -s=kailo-collab-b911-seam`，通过正常 SSO 登录独立测试用户 `seam-verifier`，没有注入 session 或向浏览器提供私钥。

- 修复前：请求 144 上传返回 200；请求 147 保存返回 403。Relay 20:38:01 UTC 原始原因：`restricted: kind 0 is reserved to the community owner`。本人资料重新读取为空，确认不是图片上传或渲染故障。
- 唯一配置增量：成员事件列表加入 `0`。执行 `docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml up -d --no-deps --no-build --pull never buzz-relay`，退出 0。实际镜像保持 `sha256:c5a484b74e75d24de8f65cab625aa76b3319434bf5d34ffca6821dd39ca5ca30`，健康状态 `healthy`；没有下载或编译。
- 修复后：请求 178 上传 200、181 保存 200、182 本人资料读回 200；页面显示“已保存，并从社区读回确认。”。Relay 20:43:43 UTC 记录 `kind:0 profile synced to users table` 与 `accepted:true`，事件 `5c83ae3514d623be2e40da9576cdd0b5cdeac99434bb5364222299a309fecd21`。
- 浏览器刷新后原头像 img 仍存在，`complete && naturalWidth > 0` 为 true，图片由 `/api/v1/profile/media/90241e1dd33c637aae1555cb53d68a425ee1cf73deb7432121e7e5eaa606b095` 返回。测试账号使用仓库原有图标作为头像，未改其他用户资料。
- 无 Cookie 的 `PUT /api/v1/profile` 返回 302 认证重定向，不是业务成功。此项不替代已登录跨用户拒绝验证。

截图实际保存且打开作视觉复核：`/volumes/data/kailo/tmp/buzz-visible-pages-20261007.KFQi8t/14-avatar-saved.png`、同目录 `15-avatar-reloaded.png`。同目录的 Inbox、Pulse、Projects、成员、Agents、Workflows、任务、审批、审计、设备截图仅为当前在线版本检查；首次 Pulse/Agents 的 loading 截图不计完成，后续补拍 loaded 状态。云盘、知识库、问数入口在此次登录中仍未出现，不宣称三组件已经可用。

Web 实际 buildId 为 `sha256:a484ceeba47f06e572461060c2b12353cd4646654d02fd45c04308558ebd7642`，reportedAt `2026-10-07T18:25:13.928Z`。本记录不是后续 main 源码的 Web 发布验收，更不是 Windows/Mobile 实机验收、全量 diff 分类完成或 100% 原版一致性证明。

本次没有新增检查脚本；真实失败发生在修复前的同一产品链，未再次破坏共享在线配置。全量检查的上一轮源码导出因磁盘压力终止（退出 143，`Terminated`），当前 `/volumes/data` 只余 3.3 GiB，不重复执行大体积全量导出；不能标记全量检查通过。

`./tools/check-docs.sh` 在原检查镜像 `sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82` 内直接只读挂载当前 apps 与设计目录执行，沿已有 4 CPU/4 GiB、等额 memory+swap 配置，复用 npm 缓存且禁止网络；退出 0，原文 `全部通过。`。未复制全仓，未安装或编译。全工作树 `git diff --check` 退出 2，报告四个继承变更文件末尾多余空行（InlineEmojiPopover.tsx、emoji.ts、editAttachments.ts、parseImeta.ts）；没有把他人变更混入本次提交，本文定向检查退出 0。
