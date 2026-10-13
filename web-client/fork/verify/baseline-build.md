# buzz-web 基线可构建性

改造上游之前先证明未改的基线在本机构建得出来——否则第一个 patch 失败时分不清
是 patch 的问题还是基线本来就不通。

## 实测（2026-09-23）

从 `https://github.com/hardy4yooz/buzz-web.git` 取
`a6766c482533d028582d0efcfd3740769f86217c`（`.design/02` §1 固定的那个），
在仓库之外的工作目录里：

| 步骤 | 结果 |
|---|---|
| `npm ci` | 338 个包，成功 |
| `npm run typecheck`（`tsc --noEmit`） | 通过 |
| `npm run build` | 通过，产出 `dist/assets/*` |

取源用上游仓库本身，不用 `.references`——那里是只读证据，不在其中开发或构建。

## 九个改造点在该 commit 上仍可解析

`SS-WEB-RELAY` 点名的源码点逐个核对（`git cat-file -e`），九个全部存在：

```text
web/src/features/chat/ui/BuzzWebApp.tsx
web/src/shared/api/relay-client.ts
web/src/features/chat/lib/use-buzz-session.ts
web/src/features/chat/lib/use-session-mutations.ts
web/src/features/chat/lib/use-relay-user-state.ts
web/src/features/agents/use-relay-agents.ts
web/src/features/inbox/use-inbox.ts
web/src/features/community/invite-api.ts
web/src/shared/api/media-client.ts
```

## 为什么用 patch series 而不是把源码搬进来

上游仍在演进。130 个源文件搬进本仓库之后，每次升级都变成手工比对；而 patch 能在
新 commit 上直接重放，冲突会当场暴露在 `git apply` 上，而不是变成一次沉默的
「看起来还能编译」。

`build_context: web` 是新增的 manifest 字段：这个上游的 Dockerfile 与构建上下文
都在 `web/` 子目录下，不在仓库根。

## 基线产物先不进运行拓扑

镜像已按 ADR-06 入本地 registry 并按 digest 记回 manifest，但**不加进 compose**。

未改的 buzz-web 会让 Browser 直连 Relay 并在本地持有 signer——那正是 `DD-39` 要
移除的东西。把它放进运行拓扑等于先引入一条设计禁止的路径，再指望后续 patch 把它
去掉；中间那段时间里，拓扑与设计是矛盾的。

因此顺序固定为：先落 `SS-WEB-RELAY` 的 transport patch，再让 Web 面进拓扑。

## 2026-10-09 已提交共享 Profile 修复的实际发布

本节是当前共享页面的发布证据，不把前述 2026-09 基线记录中的 patch-series
做法作为现行开发方式。当前沿 ADR-15/16 在 apps 原工程维护源码；Web/Desktop
共源页面沿 SS-WEB-PRESENTATION，Browser 凭据和协作调用仍沿 SS-WEB-RELAY。

冻结输入为 apps `4c099a5f9b508f7df47b9fc923fe37ab7375aa70`，实际工作树
`/volumes/data/kailo/tmp/web-shared-9edf-20261009.cyN2cz/apps`。
使用原 `tools/build-upstream.sh web-client`、已有限额 BuildKit 和 Data 缓存，
没有在 `.references` 中构建，也没有重启同一构建。原构建句柄 86766 退出 0；
日志 `/volumes/data/kailo/tmp/build-web-client.JqeAqq.log` 记录 TypeScript 与
Vite 构建成功（3943 modules）、OCI 导出及实际 registry 产物。
构建包含依赖下载，不声称完全离线；缓存命中也不等于零网络。

- source/build ID：`sha256:9e1bd3032cefb32ac76fc5e64e9ed0fa7d8b45091acfe2e5556d990b407e1761`。
- artifact：`sha256:7ea0c5fa4cf0897ae1c762fa7b42bcc5b087b26950106bc0de2604be5137e07f`。
- 原 Compose 仅执行 `up -d --no-deps --pull never --wait buzz-web`，句柄 18913
  退出 0。实际容器 `6ffe6fe762d1f632d07ab20f6e61b96da4627f48a7f434a49d22fe9838a54830`
  于 `2026-10-09T15:43:39.764556373Z` 启动，状态 healthy；容器内
  `/srv/app/platform-build-info.json` 的 build ID 与上述值一致。
- 前后逐项核对 platform-local 容器 ID，除 buzz-web 外均未改变；未重启 Core、
  Worker、Relay、Gateway、数据库或身份服务，未迁移数据或更改认证凭据。

本次只发布已提交的 Profile 可访问性、默认头像及中英文等修复；当前工作树中的
成员目录字段、成员卡及邀请交互改动不在该镜像中。页面实际截图与操作边界见
[本版实拍记录](screenshots-20261009-4c099-profile.md)，healthy 和构建成功
不证明页面全量还原。
对应冻结输入的原 `tools/check.sh --full` 句柄 22988 退出 2，日志
`/volumes/data/kailo/tmp/tmp.1FOvLFPjbi.check.log`：
`Got socket error trying to find package test at https://pub.dev.`
依赖准备阶段失败，产品门禁没有执行，不能声明全量检查通过或生产就绪。

## 2026-10-12 54306 Web 匹配产物：已构建、未部署

本批唯一构建固定已提交并推送的源码
`54306bc7d4af23495a4c318427e025df6850df1c`，tree
`4ea6c577e73e36a1fe1d7e25e18819989b4f0e0a`。原生 Git 在 Data
建立干净稀疏输入，旧 4cdf 构建证据保留；没有纳入正式工作树历史 dirty。
固定上游为 `a6766c482533d028582d0efcfd3740769f86217c`，原
`upstream_manifest.py plan web-client` 实际 exit 0，无 build secret 或额外参数。
原 source/buildId：
`sha256:8e15cb9a315fc99e9911122c58a57d6892ce758cb6f2c76fed7ef186448fb73e`。

原入口在 23:32 UTC 启动，句柄 `75030` 真实 exit 0：

```sh
sudo -n -H env \
  TMPDIR=/volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-54306.JCwvlt/tmp \
  REGISTRY=127.0.0.1:55000 BUILDX_BUILDER=kailo-core-data \
  bash /volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-54306.JCwvlt/apps/tools/build-upstream.sh web-client
```

既有 Data BuildKit 实际 8 CPU / 16 GiB、memory+swap 总限额 16 GiB，
parent cgroup 读回一致；启动前只有永久 init/buildkitd，memory PSI 为 0。
源码、缓存、临时目录及 registry 均在 Data。原 tsc/Vite 通过，4101 modules；
原大分块警告保留，没有放宽断言或升级依赖。原入口仅 `--push`，没有
`--load`、根盘镜像导入或新 SDK；运行服务与已有迁移复制未被本批修改。

产物为 `127.0.0.1:55000/web-client` 的顶层 OCI index：
`sha256:3df0d5bb0017d447be6edcebdbb3119c3a1a8f5fc7ab9b884436f2878910cde1`。
23:37:57 UTC 原 registry HEAD HTTP 200 返回相同 Docker-Content-Digest，
GET 索引字节 SHA256 也精确一致；不是平台子 manifest 或 image config 摘要。
原 exporter metadata 与成功后 record 的 source/artifact 两字段一致。

证据目录 `/volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-54306.JCwvlt`：
`web-release.log` SHA256
`8d96870e6f86771fc1585a71d48b2bccd801f6429b00f48119396f35b4aea549`；
`registry-head.log`、`web-index.json`、`source-plan.env` 与原
`tmp/build-web-client.u4s8Ku.metadata.json` 保留；命令、资源及完整哈希见该目录
`receipt.md`。本批文档检查结果另留同目录，不在本文追加自引用。

该产物包含固定树的 Tasks/Reviews、共享 Inbox 列表和详情主体；
**不包含主线随后验证的晚到回复 owner 小修**。此处只有已构建并推送产物，
没有部署、浏览器/设备验收、新 SBOM 扫描或 `--full`，不重写历史失败，
不宣称整个 Inbox/Composer、三组件绑定或生产门禁已经完成。Core/Worker、
Windows/Mobile 产物及其部署未随本次 Web 构建改变。

## 2026-10-13 ec89ae Web 稳定批产物：已构建、未部署

本次唯一 Web 构建固定已推送的
`ec89ae72ab91c447b987b31b1dee9170c9d4770f`，tree
`0b8f81d7f6a8ce9359c496eb18d93b50662e49f4`。Data 干净稀疏输入未混入
正式工作树 dirty；沿原 manifest、Dockerfile 和 lock，未修改依赖／recipe。
固定上游仍为 `a6766c482533d028582d0efcfd3740769f86217c`；
原 plan 无 build secret／额外参数，source/buildId 为
`sha256:c787ce0c8c4cf3a147292f292ebd7311bf8aef5ae066cc220960a6e8c36873bd`。
相比上节 54306 的输入，实际变化为 InboxThreadPane 原实现／消费者和共享
i18n；包含随后提交的晚到回复 owner、原 Copy link 修复和四个共享词条。
不把旧 54306 镜像算作已包含这些修正。

原入口 `36849` 真实 exit 0，命令为：

```sh
sudo -n -H env \
  TMPDIR=/volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-ec89ae.g8d515/tmp \
  REGISTRY=127.0.0.1:55000 BUILDX_BUILDER=kailo-core-data \
  bash /volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-ec89ae.g8d515/apps/tools/build-upstream.sh web-client
```

00:53 UTC 原 safety 预检退出 0：builder 仅永久 init/buildkitd，无另一个
在途镜像构建；8 CPU／16 GiB，memory+swap 总限额等于内存，
实际 state 为 `/volumes/data/kailo/buildkit-core-state`。
MemAvailable 36422028 kB、memory PSI 0、Data 可用 167138586624 bytes；
I/O full avg10 5.44。沿已有 Data registry/cache/tmp 执行，不另建 SDK。
主线拥有原预复制 scope 的暂停与恢复，本次没有启动第二份复制或停业务服务。

原 tsc/Vite 通过，4101 modules，Vite 8.04 秒；原大分块警告保留，
没有改阈值或据此宣称漏洞、安全／全量门禁通过。原入口只使用 buildx
`--push`，没有 `--load`、根盘镜像导入、宿主编译或更换运行实例。
顶层 OCI index 为
`sha256:3ad69b4288d4ac75389e617ee4c496206e18e6f43620aac246adbb513a076b02`，
不是子 manifest 或 image config。00:55:32 UTC registry 对此 immutable
digest HEAD 返回 200 与同一 Docker-Content-Digest，GET exit 0，
正文 SHA-256 同样为该 digest；成功后原 helper 才登记 source/artifact。
build ref：`kailo-core-data/kailo-core-data0/b0c5vggl9pex6ma8yehizjr4z`。

原件目录：`/volumes/data/kailo/tmp/task-batch-release.zThtjJ/web-ec89ae.g8d515`。

| 原件 | SHA-256 |
| --- | --- |
| build.log | 674da08001c3ae6bf710a64ab289fff451f546a42af0b1cd92d5a03eeb0e7f77 |
| source-plan.env | 776ce864d572a385d6e9d9afb2918576fd5edae9c3b6603bfb890c429b431ed1 |
| registry-head.log | 6107ec29ca99d1791fbca611ff857e69bbcf64f1a23f3d52b87ad8fdd6ba7543 |
| registry-index.json | 3ad69b4288d4ac75389e617ee4c496206e18e6f43620aac246adbb513a076b02 |
| tmp/build-web-client.0Vfvit.metadata.json | eace4692656a0529ed521930329713bef3b5046533130ca7069b5415c39b7462 |

首次新建 `--no-checkout` 稀疏工作树未物化，plan exit 2；
经原 `read-tree -mu HEAD` 物化同一固定输入后 clean 与 plan 均为 0，
才启动这一次构建。未修改产品、发布脚本或公共 index 来迁就输入错误。
本逻辑批已有原 docs 七节通过；本次只对精确候选本文做 selected lint，
真实结果保留在原件目录，不重复 full 或新 SBOM，也不重写历史失败。

该产物保留此前 Tasks/Reviews 与共享 Inbox 列表／详情主体，
但产物构建不等于部署、修正后浏览器／设备验收、三组件 binding、
完整 Inbox/Composer 或生产就绪。Core/Worker、Windows/Mobile 产物与运行实例
未随本次 Web 构建改变；后续部署仍须沿原受控入口另行验收。
