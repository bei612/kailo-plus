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

## 固定提交发布及实际浏览器复验

生命周期修复已随 `8a47534c96c9bf09048ee282ca4e62d5d9d73079` 合入 main 并推送。从该提交隔离导出原构建输入，以私有 index 固定跟踪文件，不使用其他脏修改。原 `tools/build-upstream.sh knowledge-native-ui` 退出 0，既有 `kailo-core-data` builder 为 8 CPU / 16 GiB，缓存 `/volumes/data/kailo/buildkit-core-state`；npm ci 命中缓存，COPY 在 Data I/O 压力下耗时 422.8 秒，Vite 6626 模块生产构建 34.60 秒，大 chunk 警告保留。

- 源码摘要：`sha256:b8909da811690461605a6ea46cdd3e93d6a5eb7450b0a0b028fa0c7210a71728`。
- 产物摘要：`sha256:bcd43618a3c6ee85e8a130b2a74e292f7210286c2239318884fa7bab70bfe01e`。Registry HEAD 返回 200 且 Docker-Content-Digest、本地 RepoDigest 一致。
- 构建日志：`/volumes/data/kailo/tmp/knowledge-ui-8a47534-release-20261011.WXV5CC/build.log`，SHA-256 `df192d00b3a5753ce2073263444b504526c1c950f491cd11401a5e16b3548bfd`。
- 原 Compose frontend-only 命令退出 0；新容器 `41c03065ac8820d2d6e74cd8ca57563503fdde5358b2bf7dd4c1a1f52aad0d7c`，启动时间 `2026-10-11T06:00:05.962505615Z`。该 frontend 没有 Docker Health 配置，Compose 的 Healthy 文案不作为业务验收依据。
- 部署回执目录 `/volumes/data/kailo/tmp/knowledge-ui-8a47534-deploy-20261011.I6vMUQ`。`deploy.log` SHA-256 `a344e800c8d3b1014771835c371dc0d63c03af1b9f5d3c48a6c39253dc9ee72b`。前后容器快照证明知识 backend、数据库及其他常驻服务 ID/StartedAt 未变；期间 Cells 队友停止三个自身验收容器，不是本次 Compose 连带操作。

独立 Data 浏览器 profile 从匿名原生登录页点击 OIDC，在现有 IdP 用普通 bootstrap 账户正常登录，未注入 session。首次回调直接显示真实原生用户 `local-administrator` 与知识库空态，未靠刷新恢复；auth/me、模型、知识库、收藏、邀请计数等原生请求返回 200，控制台 0 错误、0 警告。随后原生刷新成功，用户和页面保持正确。只跳过原有引导弹窗，未删改 UI。请求回执为同目录 `requests-after-refresh-and-chat.txt`。

截图均已实际打开视觉复核：

| 实际状态 | 文件 | SHA-256 |
| --- | --- | --- |
| 修复后全新首次 OIDC 登录 | `first-sso-fixed.png` | `c17f4d31af33df531bd2a7fa19c68d94014241258a8d18f750edf2da1e951499` |
| 刷新后完整知识库页 | `reload-fixed-ready.png` | `c17f4d31af33df531bd2a7fa19c68d94014241258a8d18f750edf2da1e951499` |
| 已有 workspace 列表 | `scope-memberships.png` | `102d6f5c3e75b5109012be510e1c7098a0df1622ab77b19d8a5f067a6585e299` |
| 原生发送被模型就绪检查拒绝 | `chat-readiness-toast.png` | `c6d0b6520bf2b3d930f7321e2502d30eaba994d4031f1302f9d33ad4848dd4b0` |

期间直接读取缺失 `.State.Health` 的 inspect 模板退出 1，改为可选索引读取确认 null；引导弹窗和模型选择器遮罩拦截的两类点击曾超时，随后通过原 UI 关闭遮罩后操作成功，未 force-click 绕过。

## 尚未成立的交付结论

当前账号仅有一个已有 workspace，未新增 membership，不能宣称跨空间切换已验收。进入原“新对话”后提交最小连接验证消息，原就绪检查明确提示“快速问答未就绪，需要配置对话模型”，没有发出 SSE，因此在线 SSE 未验收。原 auth/refresh/SSE 窄验证通过不能代替这一在线结果。全局 `./tools/check.sh --full` 未因本回执而通过；不得据此宣称完整治理接入、三组件菜单上线或生产就绪。

## 2026-10-12 原生 HUMAN 登录、刷新与跨用户拒绝实测

本次沿已运行的独立原生入口 `http://192.168.0.193:58094`，不是平台 iframe。
运行容器 `kailo-knowledge-frontend-1` 的配置与实际 image 均读回上述
`sha256:bcd43618a3c6ee85e8a130b2a74e292f7210286c2239318884fa7bab70bfe01e`。
该产物来源 `8a47534c96c9bf09048ee282ca4e62d5d9d73079` 确实包含
`76f2378fd0698ee5679bb160a5ac8cd02a3acde2`，且在下述源码修正前与本轮 HEAD 的完整
`knowledge/frontend` 输入 diff 为空，原 plan 的 source digest 仍是本节上文的
`b8909da8…`。因此没有重建。当前 Data registry 对同 digest HEAD 返回 404，
curl exit 22；本地 RepoDigest 和运行容器仍保留，不把旧 registry 200 外推到现在。

采用原 playwright-cli 和两个独立 Data 浏览器 profile，从原页面点击 OIDC，
经原 kailo realm 登录表单输入既有 HUMAN 凭据，没有注入令牌、借用组件 admin、
修改密码、成员、租户权限或平台 binding。真实 `/api/v1/auth/me` 回读分别为：

| HUMAN | native user | native tenant | 系统管理员／全部租户权限 |
| --- | --- | --- | --- |
| kailo-bootstrap-admin | 116a8d6b-c7cd-4abb-b6a4-1bd8589eda24 | 10000 | false / false |
| seam-verifier | 80a92504-e0ce-43fa-9be4-67d4f313935e | 10001 | false / false |

第一位显示名 `local-administrator` 是原 native 昵称，不能据此认定系统管理员；
两位真实 native ID 与租户不同，不是所有 HUMAN 映射同一账号。第二位是既有 IdP
HUMAN 的首次原生 OIDC，原服务自动开通其 native profile 和默认 workspace；这项
正常登录副作用真实保留，不声称零数据写入，也没有手工造模拟身份或批准结果。
这些事实不证明平台 principal 到 ApplicationBinding 的治理投影已验收。

实际浏览器结果：

1. 第一位首次回调进入知识库列表，刷新后身份不变，auth/me、models、knowledge-bases、
   sessions 等原 GET 均 200。原共享空间内部导航成功，显示没有已加入共享空间。
   仅看到此前专属空 KB，模型未初始化；点击进入原设置后取消，未保存配置或正文。
2. 原“退出”后再访问该 KB 的原 URL，回到 `/login`，旧正文不显示。随后正常 IdP
   SSO 重新登录，仍读回同一 native ID；不是通过改 localStorage 恢复身份。
3. 第二位原 KB 列表 HTTP 200 且为空。直接访问第一位既有专属空 KB
   `e37f9e96-a356-4441-bd93-efc1d5d3cc80` 的原页面：KB、knowledge、folders、tags
   原请求均 403，未显示对方 KB 标题或正文。日志是实际页面发起的 HTTP，不是 route mock。
4. **拒绝呈现仍有缺口**：403 后原页面保留通用“知识为空，拖放上传”及上传控件，
   而非明确无权访问。没有点击上传验证写入；不能把本次服务端拒绝称为完整页面通过。
   两个 HUMAN 最终都通过原“退出”回到 `/login`。没有变更会员权限来制造撤权，
   未独立验证后端 access-token 吊销、自然到期 refresh 轮换、跨 tab 同字节登录或在线 SSE。

Data 原件：`/volumes/data/kailo/tmp/knowledge-human-readback.zcW82S`。
截图均实际打开视觉复核，不以加载帧作为最终成功证据：

| 最终截图 | SHA-256 |
| --- | --- |
| human-a-refreshed-visible.png | 4e3c1cf27b3cef262c3c53cd2f5d4aca74b823a8741e8be70537e11b1e873ba8 |
| human-a-logout-old-url.png | eeef8d1408d9fcd270f401cb65256ee5c74d62d31201fa7417456fbe991a0219 |
| human-b-denied-final.png | f3a010a6807acdc8620f8449b63988444a13e99e8bf4c9ea670dab895e8a9035 |

`human-a-identity.log`、`human-b-identity-scope.log`、`refresh-readback.log`
仅包含白名单身份／路径／状态；跨用户请求日志 `human-b-cross-user-denial.log`
SHA-256 为 `01f1d79d26e6f881a98e03f46126af97570e893b3d208aacc33db2bdfb9585a7`。
原登录与读取命令最终退出 0，但 CLI 也会对页面操作错误退出 0，所以结论依据
实际页面、响应及截图，而非单独的 CLI 退出码。

失败边界保留：首次匿名 stdin 投递未填表、run-code 宿主 URL 未定义，后改匿名 FD
与浏览器内 location 读取；引导遮罩曾阻止账号菜单点击，正常跳过后再操作，未强点。
第二位回调过早快照使 CLI 工具输出出现瞬时 oidc_result URL；未将其复制到回执，
随后统一 raw 白名单并等待 fragment 清除，秘密不进入证据文件；本次会话正常退出。
这不是令牌泄露无风险的证明，也不声称退出已独立证明所有后端令牌失效。
浏览器阶段未构建、加载、部署镜像，未重跑 26 项／SDK／full，未发送模型请求、写文档内容
或激活组件。平台 iframe、真实模型/检索/SSE、完整 Cells→WeKnora 与整体治理仍未验收。

### 2026-10-13 同批 KB 拒绝呈现与上传确认修正（未部署）

四步影响核对：

1. 权威：沿 DD-89/93 的原身份、Resource 读取和原生完整页面边界，不增加权限或
   新端点。固定 WeKnora `2be7bd40631dda1dd485306038f07a62e9ee287e` 的
   `frontend/src/stores/chatResources.ts::fetchKnowledgeBaseById` 将失败转为 null；
   `frontend/src/views/knowledge/KnowledgeBase.vue::canEdit/canManage` 在缺少详情时
   仍可按本地 tenant admin 返回 true，原 empty-knowledge 无条件提示拖放。
   上述真实第二 HUMAN 的 403 页面验证了这一缺口，不是模拟登录发现。
2. 读写：仅原 KnowledgeBase.vue 接上当前 KB ID、原 auth 用户／活动租户和读取代际。
   页面进入或 scope 改变强制读取原详情，未读到／错误 ID／失败不挂载业务详情，
   清原列表、选择和详情，再沿原错误提示返回 KB 列表；没有修改共享 cache 契约。
   已授权详情的原布局、FAQ、文件列表、权限分支仍保留；只读空 KB 不提示上传。
3. 副作用：原拖放、文件、URL、手填入口复用 canEdit，上传确认返回后再次核同一
   读取代际与身份 scope，批量 URL 之间也核对，禁止旧确认写入切换后的 KB。
   原 Axios 403 分类、401 refresh、服务端授权、上传队列与模型配置均未改；
   没有把 SSO 或前端可见性当服务端写权限，没有 schema／迁移／新存储。
4. 异常：null、网络失败、错 ID、晚到身份响应及旧上传确认均关闭写入口；
   当前服务器仍运行旧 artifact，前述截图仍是缺陷证据，不是修正后浏览器验收。

复用原 App.oidc.test.ts 的 Vue SFC 编译／renderer 消费方式，新增原详情旁
`KnowledgeBase.access.test.ts`，实际编译整个原 script 与 template，mock 仅限
HTTP/store、子组件和上传队列边界，不创建真实文件或声明 HTTP 治理通过。
同一现存 `kailo-inbox-forum-r5kqbx`：image
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
2 CPU／4 GiB，memory+swap 总额等于内存，UID 1000、只读 root、network none；
source/dependencies/cache/tmp/log 均在 Data。原安全检查和 cgroup 回读退出 0，
没有新 SDK、下载或构建。实际命令为 `node --experimental-transform-types --test
src/views/knowledge/KnowledgeBase.access.test.ts`（Node v24.21.0，SFC compiler 与
TypeScript 来自已有知识库验证依赖）。

原件目录：`/volumes/data/kailo/tmp/web-tooltip-shared.zzIWe9/knowledge-kb-access.Oifqm1`。
首轮 86844 exit 1 是 fixture ESModule default 包装缺项；77679 exit 1 是 renderer
缺 v-show style 以及原 watcher 合法重复读与夹具单次数假设不符，均保留日志。
纠正后 11348 exit 0；末版 16305 exit 0，5/5 消费者覆盖拒绝、授权上传、只读分享、
身份／路由晚返回与确认、失败／错 ID。`positive-final.log` SHA-256
`d6c1e5820258a0c4d0c9bb17c0a938c64e484220f17e83c9289923323aa9e2cb`。
私有仅去掉原上传确认后的 scope/generation guard，原消费者 exit 1，确实捕获文件
被排入新 KB b；`negative.log` SHA-256
`106ff6b5986e03710678f43c96218e1717fd5a3ba9bf1a6027bf75dfa9078c88`。
apply_patch 还原、生产与验证输入两个文件 cmp 均 0 后，同命令 5/5 exit 0；
`restored.log` SHA-256
`4af41b2fbdb90246a541da3a18939cab056ab88b04dcf7fc9de602f3253367e0`。
未执行完整 type-check/full、未部署此修复，线上原生／iframe 写入和模型业务仍未验收。

### 2026-10-13 KB 拒绝修正匹配前端产物（仅构建，未部署）

沿 DD-89/93 与原发布来源登记，使用已提交
`1c3c95f397f34fad916825f67072809d75870f56`，源码树
`543c2a6e3dd9228ffdeeb00bcf6ba3403d7303d2` 的干净 Data 稀疏工作树。
固定上游仍为 `2be7bd40631dda1dd485306038f07a62e9ee287e`；
原 `knowledge/frontend/Dockerfile`、依赖锁与构建参数未改。
`package-lock.json` SHA-256：
`b5466d4ff3ffa48c452fbfdcd1600da775d1278eaacf005eddb4c01bf6c6ba91`。
本次包含上述 KB null/403、身份切换与上传确认护栏，以及此前已提交的
auth/refresh/SSE 修复；不修改 API、schema、Workflow 或权限权威。

原 `tools/upstream_manifest.py plan` 的 source/buildId 为
`sha256:6ac832434e300e899211640a8ea20ac4d293b8e8de62e440a15bbc8ede5d27b8`。
原 `tools/build-upstream.sh knowledge-native-ui` 在 90855 真实退出 0；
仅向 Data registry 推送，没有 Docker load、根盘 pull、宿主编译或部署。
原命令如下（所有输入、临时目录与证据均在 Data）：

```sh
sudo -n -H env \
  TMPDIR=/volumes/data/kailo/tmp/knowledge-ui-1c3c95-release.v5q8S9/tmp \
  REGISTRY=127.0.0.1:55000 BUILDX_BUILDER=kailo-core-data \
  bash /volumes/data/kailo/tmp/knowledge-ui-1c3c95-release.v5q8S9/apps/tools/build-upstream.sh knowledge-native-ui
```

执行前原 safety 检查退出 0：已有 builder 8 CPU／16 GiB，
memory+swap 总限额等于内存，state 位于 Data；无另一项在途镜像构建，
MemAvailable 36638004 kB、memory PSI 为 0、Data 可用 167162269696 bytes。
I/O 压力仍高；00:32 UTC 主线暂停同一自有预复制 scope 为串行发布让行，
没有将暂停或进程 D 状态当成写回排空证明，也没有重新发起复制。

成功 exporter 的顶层 OCI index（不是子 manifest/config）为
`sha256:68ef2c49ed230d2a52c83a5fdb042ea350ee140a148d7cc5b911dfa6e37dc4fe`。
00:36:47 UTC 原 registry 对该 immutable digest HEAD 返回 200，
GET 退出 0，返回正文 SHA-256 与此 digest 相同。
build ref 为 `kailo-core-data/kailo-core-data0/ws75jfk8i5o8ovcgxw51sx3o9`。
原 helper 仅在成功后记录 source/artifact 两字段；既有 blocked gate 保留，
其中旧版已部署描述仍是历史事实，不能外推本次新镜像已运行。

原件目录：`/volumes/data/kailo/tmp/knowledge-ui-1c3c95-release.v5q8S9`。

| 原件 | SHA-256 |
| --- | --- |
| build.log | ebbf9faea530fa1750c55f874a66b530aa537328e026f86e91f39a317b189571 |
| registry-head.log | 031466c927793ce80ba7d38f384770515133bb91cb33114a70eba42fcda83128 |
| registry-index.json | 68ef2c49ed230d2a52c83a5fdb042ea350ee140a148d7cc5b911dfa6e37dc4fe |
| tmp/build-knowledge-native-ui.KZ1KBk.metadata.json | f3dd2a043bec201cf570327180fabc02288bd333584ada034632a210cc460257 |

首轮稀疏 plan 缺同 manifest 的其他输入路径退出 1，补齐同 commit 的
knowledge 与 client-kit/adapter 后 plan 退出 0；没有修改构建声明。
首次非 sudo builder 查询未找到 root 注册的原 builder；改用原 sudo 身份，
没有创建第二 builder。上述失败与最终原输出保留。
npm ci 报告 14 项依赖漏洞（2 low、3 moderate、8 high、1 critical），
未运行自动修复；Vite 7.3.6 原构建转换 6626 modules、36.77 秒完成，
原 install-script／bundle 警告仍保留，不能因 exit 0 称安全门禁全部通过。

本次只闭合匹配源码的构建、推送与 registry 读回，不重跑 full/SBOM，
不代表组件 release/binding 已批准、已部署、修正后浏览器验收或业务终态。
现有两 HUMAN 旧版截图仍是前节原缺陷证据；平台 iframe、模型／检索／SSE、
完整 Cells→WeKnora 与整体治理仍未验收。
