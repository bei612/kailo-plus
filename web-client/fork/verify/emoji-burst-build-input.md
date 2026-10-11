# Web 双宿主 Context 检查的固定构建输入

2026-10-11，固定提交 `dcd6ed4dbc97a4c910ba6d2c2514c508dccc101b`
沿原 `tools/build-upstream.sh web-client` 构建，作业 95306 实际退出 1。
原日志位于 `/volumes/data/kailo/tmp/web-main-dcd6ed4-release.UJZtl7/` 的
`build-root.log` 与 `build-web-client.f2jdvm.log`。#18 原命令为
`npm run build` → `tsc && vite build`，tsc 报：

```text
src/main.test.tsx(94,30): error TS2307: Cannot find module '../../../collaboration/desktop/src/shared/ui/EmojiBurstProvider' or its corresponding type declarations.
```

## 原因与影响面

1. 权威为 REQ-24、DD-74/75 的完整页面共源恢复。固定 Buzz
   `779af8886caae1317b4de962082429867ab61503` 的
   `desktop/src/shared/ui/EmojiBurstProvider.tsx::EmojiBurstProvider` 已迁到共享 TS，
   Desktop 原路径为八行转发。Web `main.test.tsx` 实际通过该转发验证两宿主
   `EmojiBurstProvider` 与 `useEmojiBurst` 是同一对象，不是两套 React Context。
2. 全仓检查能找到此文件，独立 Web artifact 的 inputs、Docker 同名 ignore 与
   COPY 均未投递它。转发唯一依赖是已有 `@client-kit/platform/react/emoji-burst`，
   该 export 及其原实现已经在 Web inputs 中，不需要引入整个 Desktop 工程。
3. 本次给三个既有投递点增加这个精确文件。COPY 位于 npm ci 之后，保留既有安装层。
   独立镜像只在 Web 目录安装依赖，外部 Desktop 转发不能向上找到它；构建根
   node_modules 链接至这唯一安装目录，让两宿主解析同一包，不安装第二份依赖。
   保留真实双宿主断言，不排除测试、
   不调整 tsconfig、依赖锁或 React Context，不改变页面、权限、传输和外部动作。
   该文件参与来源摘要；生产 Vite 入口不导入它，不新增浏览器运行期 Desktop IPC。
4. 缺输入继续构建失败，不降级返回假成功。没有协议、数据库、状态机、迁移、
   新错误码或历史数据兼容变化；六类运行期错误边界不受本次构建输入修正影响。

原空闲 SDK `kailo-web-thread-tooltip-sdk`（4 CPU、8 GiB 内存与 swap、network none）
用已安装 TypeScript 6.0.3 的 `resolveModuleName` 实测：仅 Web 目录 node_modules
时，外部转发的包解析为 null；添加构建根到同一安装目录的相对链接后，两宿主
均解析到同一 `@client-kit/platform/src/react/profile/buzz/shared/ui/EmojiBurstProvider.tsx`，
两次检查均 exit 0。独立输入位于 Data 的
`web-tooltip-shared.zzIWe9/web-module-resolution.NCHAKT`；这仅证明解析闭合，不替代完整构建。

首轮固定构建保留失败且未产出新 artifact，未部署。修正后的正式构建在本批提交后
沿同一受限 builder 与 Data 缓存运行；本回执不提前宣称构建、视觉或生产验收通过。

## 固定修正版本构建与限定部署回读

2026-10-11，修正提交 `9d718234b74b688d9b81816f9b67470d4fc80440`
已普通 push。原 `tools/build-upstream.sh web-client` 使用既有
`kailo-core-data` builder（8 CPU、16 GiB 内存及同额 memory+swap），
缓存和固定提交导出树均位于 Data。npm ci 命中缓存；原 tsc 与 Vite 完成，
Vite 输出 `built in 1m 4s`，没有删双宿主检查或扩大忽略范围。

原构建调用仍退出 1：调用方重复拼接 registry 端口，构建与导入成功后 tag
报 `invalid reference format`。改用原完整 REGISTRY_HOST，只续 tag/push/record；
第一次续尾推送成功，但 record 缺 project 参数退出 1。随后仅补原
`upstream_manifest.py record web-client` 并独立回读 registry，退出 0。
两次失败均保留，不将整条构建命令改记为一次通过，不重复编译或推送。

- artifact：`sha256:964d3a6ae8535138b2f0cc736f9622e10ba03a7d047365b88a5f04ca5396e123`。
- source/buildId：`sha256:1fe5c137da245352680e90626a67aef906cd4bee1bb9b7964b2c080964c0653e`。
- registry HEAD 200、原 builder manifest 与本机镜像 manifest 一致；config
  `a2bfbad2…` 是另一对象，不作为 artifact digest。
- 固定 9d718 的原 `tools/check-docs.sh`，2 CPU / 4 GiB、network none、Data
  check-cache，退出 0；不替代完整检查。

实际限定部署命令（在 apps 根目录）：

```sh
sudo docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml \
  up -d --no-deps --no-build --pull never --wait buzz-web
```

命令退出 0，输出 `Container platform-local-buzz-web-1 Healthy`。新容器
`ebba2f3fd6cb` 的 `/srv/app/platform-build-info.json` 读回上述 buildId，
reportedAt 为 `2026-10-11T15:40:21.954Z`。24 个 platform-local 容器中仅 Web
由 `9c15024d9ca5` 替换，其余 23 项 ID 和镜像不变。部署前核对该服务的三项
环境值、app 网络及无宿主端口/卷的边界不变；未替换 Core、Worker 或两个原生端。
同批只更新既有 Web 来源、Compose pin 和引用同一 artifact 的追溯项，
不改变 schema、授权、状态机或数据迁移；旧镜像保留，回退只影响静态 Web。

构建、续尾及文档日志原件位于
`/volumes/data/kailo/tmp/web-main-9d71823-release.fddJRC/`。
原 builder 日志 SHA-256 为
`12c2269d969327b29e77e14a4dda8c54deefc2033db1b41cb05ab80d90d0e54f`。
当时新版本浏览器操作与截图仍在进行，不能把旧版本截图计入新版本验收。
最近完整检查仍退出 1（11 个源码/制品摘要差异），数据库演练及部署配置预检
有跳过项；此处不声明全量门禁通过、完整原版还原、三组件完整接入或生产就绪。
