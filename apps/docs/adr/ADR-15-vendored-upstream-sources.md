# ADR-15：需要修改或自建的上游以固定 commit 的完整源码入库

- 状态：已接受（取代 ADR-06「上游 patch 的可验证性」一条及其「不改变的事」中「上游仍以 artifact 或镜像引入」的表述）
- 部分取代：目录布局（`apps/upstream/<项目>/`）与 `vendor_files` 构建时放置两部分已被 [ADR-16](ADR-16-functional-project-layout.md) 取代——二开项目改为按功能命名的目录，共用代码以本地路径依赖引用；源码入库、差异由工具生成、`source_digest` 与升级以三方合并等其余决策继续有效；各树的 `kailo/` 子目录已改名为 `fork/`，产物名改为按功能命名
- 日期：2026-09-29
- 决策者：Kailo 实施工程负责人

## 背景

用户的最高判据：不要重复造轮子，`.references` 里的项目直接拿到 `apps` 下使用、直接在 `apps` 下修改。

此前 Kailo 对需要修改的上游（Buzz 的 Relay、Desktop、Mobile，buzz-web，AgentGateway，Codex）采用 patch series：
`apps/upstream-patches/<project>/` 只存 `baseline.yaml`、补丁文件与删除清单，`tools/build-upstream.sh`
在构建时从固定 commit 取源、整块删除、按序打补丁、放入 `vendor_files`，再构建并写回 `patch_series_digest`
与 `artifact_digest`；`check.sh seam` 以 `patch_series_digest` 核对补丁字节、删除清单与 vendor 源。实际运行中
这套机制的代价是：

- **源码散在仓库外的临时树**：要改上游，先用 `--source-only` 把源树重放到 `/tmp` 之类的目录，在那里改、编译、
  测试，再把改动导出成补丁写回。开发树、补丁与仓库三者之间没有强制一致，工作树丢失即改动丢失。
- **仓库里看不到改后的代码**：代码评审只能读补丁的差异，看不到改完之后的完整函数；代码图谱、`git grep`
  与编辑器都索引不到 Kailo 真正交付的上游代码。
- **摘要漂移阻塞推送**：`patch_series_digest` 把补丁、删除清单与 vendor 源字节合成一个值，与产物实际消费了
  哪些输入无关。共享包 `web/packages/platform` 或 contracts 生成物一改，三端的摘要同时失效，全量门禁退出 1，
  而重建一端并不能说明其他端的产物输入是否真的变了。
- **摘要与产物脱钩**：门禁证明的是「补丁字节与记录的摘要一致」，不是「登记的产物由这些输入构建」。
  AgentGateway 已发生过这样的事故：admin 认证与 durable usage 的改动进入了补丁与摘要，门禁通过，
  而运行拓扑与追溯记录引用的镜像 `sha256:e1ddf6cb…` 仍是基准 commit 未改动时的构建，不含这两处改动。

约束：

- `.references` 只读，只提供固定源码证据与更新差异（`AGENTS.md` 第 2 条、`04-上游适配与升级.md` §4.1）；
- `evidence_commit` 与 `implementation_base_commit` 的关系必须显式声明并由门禁判定（`06-工程基线规范.md` §2）；
- 每个发布产物必须能追溯到源码与 digest（`AGENTS.md` 第 17 条、ADR-06）。

## 候选方案

- **维持 patch series**：上述代价都来自「改动不在仓库的源码里」这一点本身，修补工具只能缓解；排除。
- **git submodule 指向 Kailo 维护的 fork**：主仓库只存一个 commit 指针，改动仍须落在另一个仓库；评审、
  图谱与门禁要跨仓库取证，指针与产物之间的一致性仍要另建检查，与 patch series 的问题同构；排除。
- **固定 commit 的完整源码放进本仓库，直接在树里改**：改动与其余代码同仓评审、同一次提交；与上游原样的差异
  随时可由工具求出，不再作为权威保存；采用。

## 决策

1. **位置与范围**：需要修改或需要 Kailo 自行构建的上游，把 `implementation_base_commit` 的完整源码（不带上游
   `.git` 历史）放在 `apps/upstream/<项目>/`，Kailo 的改动直接在树里、随仓库提交。一个上游仓库一棵树：
   `buzz`（Relay 的 `crates/`、Desktop 的 `desktop/`、Mobile 的 `mobile/` 同在 block/buzz 一棵树）、`buzz-web`、
   `codex`、`agentgateway`。只以 Go module 引用、不改也不自建的 `temporal-sdk-go` 不搬源码，只保留来源记录，
   其 module 版本由门禁与 `worker/go.mod` 比对。
2. **Kailo 自有目录**：每棵树下的 `kailo/` 属于 Kailo：`kailo/upstream.yaml` 是来源记录（格式见 `06` §2），
   `kailo/verify/` 是接缝证据，`kailo/packaging/` 是上游没有而由 Kailo 维护的构建文件。上游在基准 commit 上
   自带 `kailo/` 时，差异工具直接失败。
3. **差异由工具生成，不作为权威保存**：`tools/upstream_manifest.py diff <项目>`（`--stat`、`--name-status`）以只读
   方式借用 `.references/<树>` 的对象库（本机缓存库经 alternates 引用，不在 `.references` 中写入或构建；没有时
   按 `upstream_url` 浅取基准 commit），输出树与上游原样之间的 Kailo 改动，`kailo/` 不在其中。评审与升级都
   读这份差异。整块删除的上游路径登记在 `remove_paths`，`diff <项目> --check` 核对登记与实际一致。
4. **产物由当前源码构建**：每个产物以 `source_include`/`source_exclude` 声明输入范围，`source_digest` 按范围内
   每个文件的路径、类型与字节、落在范围内的 `vendor_files` 以及决定构建方式的字段计算。`tools/build-upstream.sh
   <产物>` 直接从树构建，构建后由同一实现一次写回 `source_digest` 与 `artifact_digest`；`check.sh seam` 重算
   `source_digest`，与记录不符即判定「产物不是由当前源码构建」。范围外的改动不要求重建该产物。
5. **原样使用的上游不搬入**：不改源码、只靠配置即可满足接缝的上游（Temporal、SpiceDB、OpenBao、Keycloak、
   Postgres、MinIO、Redis、OTel Collector 等）继续使用按 digest 固定的官方镜像。某个上游第一次需要修改或自建时，
   才把它在固定 commit 上的完整源码搬入 `apps/upstream/<项目>/` 并建立来源记录。
6. **`.references` 的地位不变**：它仍只读，只作设计证据与对照基准；构建、测试与开发都在 `apps/upstream/` 中进行，
   不从 `.references` 构建。
7. **升级方式**：`.references` 按 `04` §4.1 刷新后，以上游旧 commit 为共同祖先、树的当前内容为一方、上游新
   commit 为另一方做三方合并：在只读借用的对象库中取旧、新 commit 之间的上游差异，三方合并进树，冲突在树里
   人工解决；随后更新 `implementation_base_commit`（`.design/02` 先行时同步 `evidence_commit`），以 `diff --check`
   核对删除清单，以 `diff` 复核 Kailo 改动仍只覆盖登记的接缝，再按 `04` §4.4、§6、§7 逐项重验接缝，
   用 `build-upstream.sh` 重建并写回摘要。中止与还原按 `RB-09`。
8. **补丁机制废止**：`apps/upstream-patches/`、`patch_series` 与 `patch_series_digest` 删除；来源记录中再出现这两个字段，
   门禁判为结构错误。

## 后果

正面：

- Kailo 交付的上游代码就在仓库里，评审、图谱、`git grep` 与编辑器看到的是实际构建的源码；改动与 Core、契约、
  共享包的改动在同一次提交里评审。
- 门禁的断言从「补丁字节与摘要一致」变为「登记的产物由当前源码构建」，AgentGateway 那类摘要写回而镜像未重建
  的情况在 `seam` 失败；共享包改动只让实际消费它的产物失效。
- 构建不再取源、裁剪、打补丁：`build-upstream.sh` 把树里可见的源码与 `vendor_files` 放进临时目录后直接构建。

负面：

- 仓库体积增加：四棵树合计约一万四千个受版本控制的文件（`codex` 约 8300、`buzz` 约 2800、`agentgateway`
  约 2700、`buzz-web` 约 90）。
- 升级从「在新 commit 上重放补丁」变为三方合并，冲突在树里解决；合并能自动完成不等于语义兼容，
  每个被触碰的 `SS-*` 仍须重验（`04` §4.4）。
- 求差异依赖上游基准 commit 可解析：`.references` 缺失且上游远端不可达时，`diff`、`seam` 与供应链扫描直接失败，
  不以「无差异」放行。

锁定：一个上游仓库一棵树、`kailo/` 目录约定与 `source_digest` 的计算口径。放弃：以补丁文件作为 Kailo 改动的权威载体。

## 替换边界

替换本方案只涉及 `apps/upstream/` 的目录布局、`tools/upstream_manifest.py`、`tools/build-upstream.sh` 与
`check.sh` 的 `seam`、`supply` 两步；产物 digest、compose 按 digest 引用的方式、追溯记录与 ADR-06 的 SBOM、
provenance 流程不受影响。某个上游接受了 Kailo 的全部改动、且其发布版覆盖固定基线所需的源码事实时，
该树按第 5 条退回官方镜像，删除树与来源记录中的产物登记。

## 重新评估条件

- 上游树的总量使克隆、CI 检出或代码索引的耗时成为实际瓶颈；
- 某个上游的升级频率或冲突规模使三方合并在一次升级周期内无法完成，需要改为长期维护的 fork 仓库；
- 同一上游需要同时维护多个 Kailo 基线（例如两个 `implementation_base_commit` 并行发布）；
- Kailo 的改动被上游接受，或上游提供了足以替代改动的配置点（按「替换边界」退回官方镜像）。
