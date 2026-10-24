# RB-11 组件 REMOTE_ADAPTER release 的一致性登记、批准、binding 与 adapter 部署

设计：`.design/02` DD-136(2)(5)(6)、DD-124、DD-138(5)；`07` §4.8.4、§8A；`13` §3。实现：`deploy/components/component-deploy.sh`
（`--conformance`、`--conformance-close`、`--adapter`）、`tools/component-release/conformance-auto.py`、
`deploy/components/adapter-converge.py`、`deploy/components/adapters.json`、`tools/component-release/flow/`。

本 runbook 只编排已有入口。生产上的改动只经发布入口（`tools/release/kailo-release.sh`）或组件部署入口
（`component-deploy.sh`）完成；release、binding 与资源只经各自的 Governed Action（flow 脚本以测试账号走产品流程）。
每一步之前由入口自身备份；flow 脚本幂等，退出码 3 表示仍在收敛，原样重跑。

## 0. 前置（一次）

1. 含 DD-136(2) 的 commit 已合并到 main，并经发布入口发布：`.env` 有 `COMPONENT_CONFORMANCE_DIR`、
   `COMPONENT_CONFORMANCE_WORKER_DIR`，旧三个 `COMPONENT_CONFORMANCE_*_FILE` 已删除；Core/Worker 为该 commit 的构建；
   `data/conformance/<peer digest>/environment.json` 存在（`platform-config-check.sh` 第 3、4 节可核对）。
2. 组件产物与 commit 一致：`*/fork/upstream.yaml` 的 adapter 产物 `source_digest` 不过期（发布入口 plan 列出）。
   问数的 `data-query-ui` 须含 `nativeBindingService.ts` 的 request_id 修复后重建。
3. CI 节点：`kailo-ci submit <commit> fetch`，发布树在 `/volumes/kailo/ci/sources/<commit>/apps`（下文 `$S`）。
4. Catalog 第二位管理员已存在（`flow/catalog-approver.mjs`，账号 `kailo-platform-approver`）。

## 1. 能力契约

```sh
cd $S && node tools/component-release/flow/capability-contract-activate.mjs --registration contracts/adapter/file_storage.v2/registration.json
node tools/component-release/flow/capability-contract-activate.mjs --registration contracts/adapter/data_query.v2/registration.json
node tools/component-release/flow/capability-contract-activate.mjs --registration contracts/adapter/knowledge.v3/registration.json
```

已 ACTIVE 且摘要一致的只报告；不一致即停止（不批准不同的行）。

## 2. 每个组件：一致性运行 → 登记 → 批准 → 关闭窗口

顺序：云盘 → 问数 → 知识库（知识库的接收方向 case 要求来源云盘 release 已在生产 `APPROVED`，DD-124(4)）。

```sh
bash $S/deploy/components/component-deploy.sh file-storage <commit> --conformance
#   → {"step":"done","state":"CANDIDATE_INSTALLED","artifactDigest":…,"run":"<运行目录>"}
bash $S/deploy/components/component-deploy.sh file-storage <commit> --adapter --check
#   → {"step":"plan",…}；release 目录 /volumes/data/kailo/components/cells/binding/release-<commit12>
node $S/tools/component-release/flow/component-register.mjs --release-dir <release 目录>
node $S/tools/component-release/flow/component-approve.mjs --release-dir <release 目录>
bash $S/deploy/components/component-deploy.sh file-storage <commit> --conformance-close=<运行目录>
```

- `--conformance` 全程无人值守：隔离原生实例、原生凭据（运行器经原生 API/CLI 生成，只在运行目录 0600 文件或隔离 OpenBao）、
  种子、隔离 OpenBao/Agent、adapter、观察、输入组装与 suite PEP provider；候选写入 `data/conformance/<digest>/`，Core 按次读取，
  不重建；生产 Worker 接入运行网络作为登记窗口。失败即停在原阶段，运行目录保留日志；重跑开新目录。
- 登记由平台管理员（Catalog）提交 `component_release.register`，Core 冻结候选并经原 Workflow 执行全部套件步骤；批准由
  第二位 Catalog 管理员决定。窗口在 register 到达终态后关闭。

## 3. adapter 部署与 binding

```sh
# 运行目录 R = CI 配置的 runtime（/volumes/kailo/apps/deploy/local）
python3 -I $S/deploy/components/adapter-converge.py secrets file-storage --source $S --commit <commit> --runtime $R
bash $S/deploy/components/component-deploy.sh file-storage <commit> --adapter
node $S/tools/component-release/flow/component-bind.mjs --component file-storage --release-dir <release 目录> \
  --native-page-url http://192.168.0.193:58092 --native-instance-ref kailo-cells-native \
  --native-scope-ref <CELLS_BINDING_FACTS_FILE 的 nativeScopeRef> \
  --plan-out /volumes/data/kailo/components/cells/binding/plan-<commit12>.json \
  --secret-values-file /volumes/data/kailo/components/cells/binding/binding-secrets-<bindingId 前 8 位>.json
bash $S/deploy/components/component-deploy.sh file-storage <commit> --adapter   # Agent 重新取 secret-id、声明 adapter IdP client
```

- `--adapter` 由 `adapters.json` 推导与治理 create 同一确定性的 binding 计划（`component-bind.mjs --plan-only --tenant-id`），
  渲染 adapter 配置、在 Tenant namespace 建只读 policy/AppRole 与一次性 wrapped secret-id、写交付目录条目（Core 按次读取）、
  启动组件专属 Agent 与 adapter；binding 存在且 Agent 渲染凭据后声明 binding 的 adapter IdP client，否则报告 PENDING。
- `component-bind.mjs` 以 Tenant 管理员提交 `application_binding.create`；它与 `--adapter` 写同一计划文件，内容不同即拒绝。
  binding secret 只经该次 create 一次性进入 Core（Core 写 OpenBao）；之后删除 secrets 文件。
- binding `ACTIVE` 后，原生已有对象经 `flow/resource-register.mjs` 登记为 Resource；成员的读权限经治理授予（`resource`
  的 `reader` 关系），没有读权限的成员搜不到该来源（`07` §4.8.4）。

## 4. 验收（DD-138(5)、V-SCN-228）

qa-1/2/3 在「搜索全部」检索云盘文件名、知识库内容、问数的问题与看板；结果按呈现类别分组，点击深链到对应组件页；对某个
Resource 没有 `read` 的成员看不到该来源的结果。截图存 CI 节点 `~/kailo-acceptance/<日期>-adapter-search/`。

## 5. 回滚

- 候选：`--conformance-close=<运行目录>`（只删 `REMOTE_ADAPTER` 候选，peer 候选不动）。
- adapter：停 adapter 与 Agent 容器、从交付目录删除该 `adapterServiceRef` 条目（Core 下次读取即生效）；binding 经
  `application_binding.disable`。AppRole/policy/IdP client 不自动删除，按 RB-02 轮换与撤销。
