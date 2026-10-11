# 原生前端首次 OIDC 初始化竞态修复回执

## 权威、原因与范围

依据一期原版一致性要求与既有原生身份接入边界：保留原版页面与业务权限，允许修复认证接缝，不绕过资源授权。固定上游为 `2be7bd40631dda1dd485306038f07a62e9ee287e`，路径 `frontend/src/App.vue`，符号 `persistOIDCLoginResponse`、`handleGlobalOIDCCallback`、`startInvitationPolling`。修复前该文件与固定上游一致。

`76f2378fd0698ee5679bb160a5ac8cd02a3acde2` 的请求所有权检查使旧会话响应不再被采用，但暴露原根组件的初始化顺序：Vue 子组件先于父组件的 mounted 回调挂载，业务请求先捕获匿名身份，随后父组件才接收 OIDC token、读取当前用户并选定 scope。首次登录出现 401 与“请重新登录”，刷新后正常。同一普通平台账号在旧镜像的全新浏览器会话首次登录正常，确认本批上线存在回归，已回滚。

修复限于根组件生命周期：等待原 OIDC 用户与 scope 同步、原路由切换完成后，挂载原有 RouterView 和三个全局资源宿主；邀请轮询的原登录监听也等待同一初始化完成。后续正常登录/退出的监听保留。没有新增 DOM 容器、菜单、权限、数据库状态、账号或重试降级；无契约和旧数据迁移。失败仍沿原 logout 与登录路由处理，不把 SSO 成功等同于业务授权。

## 已构建、部署及回滚事实

- 原入口 `tools/build-upstream.sh knowledge-native-ui` 从上述已提交版本的隔离导出构建，退出 0；Vue 生产构建 6626 个模块。依赖层缓存命中，大 chunk 警告保留。
- 产物 `sha256:cc8d8253d3a38079c25e453e382ee9fc6dae14f47630f5892d001d1329aee04e` 已经 registry HEAD 与本地 RepoDigest 核验；这不是当前修复后的产物。
- 原 Compose 使用 `up -d --no-build --pull never --wait --no-deps frontend`，只替换 frontend，未重建 backend、数据库或平台 binding。
- 发现首次登录回归后回滚到 `sha256:0d6f4235a9beebccb8167f851ca749d332852fcf4b45800680c0d55a4186671b`。首次回滚因本地缺旧镜像退出 1；registry 核验后拉取旧 digest，再次原入口回滚退出 0。当前 frontend 容器为 `c11a5282788ed9da1368547218c5f989d9aecab2f52fbf3e7328ce8912d20c08`。
- 部署与回滚原始回执目录：`/volumes/data/kailo/tmp/knowledge-ui-76f2378-deploy-20261011.rUbyyr`。`native.env.before` 是受控配置备份，不公开内容。
- 全新原生 OIDC 登录失败截图 `post-oidc-errors.png`（SHA-256 `7107fef1f99b2514c2aede85332b16ed7b54fc469c032c4561273beca5265941`）与回滚后全新登录正常截图 `old-baseline-first-sso.png`（`bc10924b18c9da8694ae1750a28bda66f01138e9135c768afa1f20c2907a3ba1`）均已实际打开视觉复核。账号经 IdP 正常登录，未注入 session、未新增 membership。

## 实现后验证与反证

复用 Data 上的受限 SDK `kailo-wren-native-sdk-vuc6uo`（4 CPU / 4 GiB），编译并执行实际 `App.vue` 的 script 与 template，使用原 Vue renderer 验证真实父子挂载顺序；API、路由、存储为边界替身，不将其视为在线验收。

命令：`node --experimental-transform-types --test src/utils/authRefresh.test.ts src/App.oidc.test.ts`。输出：

```text
tests 30
pass 30
fail 0
cancelled 0
skipped 0
todo 0
```

退出 0。其中新增生命周期 4 项，原请求所有权、scope、refresh、SSE 验证 26 项。覆盖身份与 scope 未完成、路由尚未完成、读取当前用户失败、IdP 错误、非 OIDC 启动、后续退出/登录监听。

在隔离验证副本中主动破坏并还原：

| 破坏对象 | 结果 | 日志 SHA-256 |
| --- | --- | --- |
| 去掉业务组件初始化门禁 | 3 失败 / 1 通过，退出 1 | `8996a74823807c6822651c33621f21ddec8cfdf1000f0a962d5cb427d19cbf68` |
| 去掉邀请轮询初始化门禁 | 1 失败 / 3 通过，退出 1 | `07fd6c76e422560cbaccc3cae8f2c865e15fcb9ee8532740198a8f87fe9eb962` |
| 恢复两处并重跑全部 30 项 | 30 通过，退出 0 | `17815a88038302917d9f6cdc9601245c53e7511d921fa0830e38f75e8927c732` |

日志目录 `/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/knowledge-refresh.vd01QO`，依次为 `oidc-root-negative-mount.log`、`oidc-root-negative-polling.log`、`oidc-root-and-refresh-restored.log`。还原后的 App.vue 已与交付候选逐字比较一致。SDK 已停止释放资源。

验证过程中离线依赖安装因 ENOTCACHED 失败，随后在同一受限 SDK 按原锁版本补齐最小依赖；未修改正式依赖清单。初版验证 renderer 的不完整树操作导致挂起，已停止所属进程并修正验证宿主。浏览器 response 监听脚本曾出现 Session closed，不能计作业务验收；过早截取的空白刷新截图也不计作通过。

## 尚未成立的交付结论

本回执只证明当前生命周期修复的窄验收。修复尚未按固定提交生产构建、部署，也尚未完成修复后全新普通用户首次 OIDC、刷新、有效 membership 内 scope 切换与在线 SSE 的浏览器复验。全局 `./tools/check.sh --full` 未因本回执而通过。不得据此宣称完整治理接入、三组件菜单上线或生产就绪。
