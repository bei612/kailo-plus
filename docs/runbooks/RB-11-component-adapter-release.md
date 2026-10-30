# RB-11 组件 REMOTE_ADAPTER release 的一致性登记、批准、binding 与 adapter 部署

`07-运行与运维基线.md` §6 第 11 项。设计：`.design/02` DD-136(2)(5)(6)、DD-124、DD-138(5)；`07` §4.8.4、§8A；`13` §3。
实现：`deploy/components/component-deploy.sh`（`--conformance`、`--conformance-close`、`--adapter`）、
`tools/component-release/conformance-auto.py` 与 `conformance/auto_*.py`、`deploy/components/adapter-converge.py`、
`deploy/components/adapters.json`、`tools/component-release/flow/`。

## 适用范围

云盘（Cells，`file_storage@2`）、问数（Wren，`data_query@2`）与知识库（WeKnora，`knowledge@3`）的 `REMOTE_ADAPTER`
release 从一致性运行到 adapter 上线的全链路。生产上的改动只经发布入口（`tools/release/kailo-release.sh`）或组件部署入口
（`component-deploy.sh`）完成；release、binding 与资源只经各自的 Governed Action（flow 脚本以测试账号走产品流程）。

组件实例原生栈的镜像升级（Cells、DocumentServer、WeKnora、Wren 的产物 digest 变化）经发布入口执行（ADR-20 §12）：发布的 deploy 阶段
在平台服务之后按 `tools/release/release.yaml` 的 `components` 备份实例 env、原子改写声明的镜像键、调用
`component-deploy.sh <component> <pin commit>` 并回读，verify 阶段再次回读。本手册中的 `component-deploy.sh` 调用只用于
`--conformance`、`--conformance-close`、`--adapter` 与 `--check`，不用于替换原生栈镜像。

## 触发信号

- 某组件需要以 `searchSource=SUPPORTED` 的 `REMOTE_ADAPTER` release 接入「搜索全部」或能力契约（DD-138(5)）；
- 组件 adapter 产物 digest 变化（`*/fork/upstream.yaml`），需要新的一致性候选与 release 版本；
- `component_release.register` 因 `CAPABILITY_BLOCKED`（没有该 digest 的候选）失败。

## 判定依据

```sh
# 平台已含 DD-136(2)：两个目录键存在、旧三个文件键不存在（只看键名）
grep -oE '^COMPONENT_CONFORMANCE_[A-Z_]+' $R/.env | sort
# 候选集合现状（每个子目录一个 artifactDigest）
ls $R/data/conformance
# Catalog 现状（只读）：release 状态与 connector
bash $S/deploy/components/platform-config-check.sh   # 第 3、4 节
```

`$R` 是 CI 配置的运行目录（`/volumes/kailo/apps/deploy/local`），`$S` 是 `kailo-ci submit <commit> fetch` 准备的发布树。

## 可执行步骤

0. 前置：含 DD-136(2) 的 commit 已合并 main 并经发布入口发布（Core/Worker 为该构建，`.env` 已收敛；该发布的 verify 已回读
   组件实例运行来源记录中的 digest，`deploy.json` 的 `components` 无 FAILED）；adapter 产物不过期
   （问数 `data-query-ui` 须含 request_id 校验修复后重建）；Catalog 第二位管理员存在（`flow/catalog-approver.mjs`）。
1. 能力契约：`node $S/tools/component-release/flow/capability-contract-activate.mjs --registration contracts/adapter/<category>.v<N>/registration.json`
   （`file_storage.v2`、`data_query.v2`、`knowledge.v3`；已 ACTIVE 且摘要一致只报告）。
2. 每个组件按 云盘 → 问数 → 知识库 的顺序（知识库接收方向要求来源云盘 release 已在生产 `APPROVED`，DD-124(4)）：

   ```sh
   bash $S/deploy/components/component-deploy.sh <component> <commit> --conformance        # 无人值守隔离运行，候选与登记窗口
   bash $S/deploy/components/component-deploy.sh <component> <commit> --adapter --check    # 只推导 release 目录与 binding 计划
   node $S/tools/component-release/flow/component-register.mjs --release-dir <release 目录>
   node $S/tools/component-release/flow/component-approve.mjs --release-dir <release 目录>
   bash $S/deploy/components/component-deploy.sh <component> <commit> --conformance-close=<运行目录>
   ```

3. adapter 与 binding：

   ```sh
   python3 -I $S/deploy/components/adapter-converge.py secrets <component> --source $S --commit <commit> --runtime $R
   bash $S/deploy/components/component-deploy.sh <component> <commit> --adapter          # 投递、AppRole、Agent、adapter、交付目录条目
   node $S/tools/component-release/flow/component-bind.mjs --component <component> --release-dir <release 目录> \
     --native-page-url <adapters.json nativePageOrigin> --native-instance-ref <adapter.nativeInstanceRef> \
     --native-scope-ref <计划中的 nativeScopeRef> [--workspace-id <adapter.workspaceId>] \
     --plan-out <adapter stateDir>/plan-<commit12>.json --secret-values-file <secrets 文件>
   bash $S/deploy/components/component-deploy.sh <component> <commit> --adapter          # 声明 binding 的 adapter IdP client
   ```

   之后删除 secrets 文件；原生已有对象经 `flow/resource-register.mjs` 登记为 Resource，成员读权限经治理授予。
4. 验收（V-SCN-228）：qa-1/2/3 在「搜索全部」检索云盘文件名、知识库内容、问数的问题与看板，按呈现类别分组、点击深链到组件页；
   对某 Resource 没有 `read` 的成员看不到该来源结果。截图存 CI 节点 `~/kailo-acceptance/<日期>-adapter-search/`。

## 不可执行的动作

- 手工改 `.env` 切换或替换一致性候选，手工写 `data/conformance/` 或交付目录，替换 `PROTOCOL_PEER` 候选；
- 手工改实例 env（`/volumes/data/kailo/components/*/` 下的 `deploy.env`、`native.env`）中的镜像键，或在发布入口之外以
  不带参数的 `component-deploy.sh` 替换原生栈镜像（镜像 pin 由发布入口按来源记录改写，ADR-20 §12）；
- 人在隔离运行阶段之间生成原生凭据、做原生 onboarding，或续用失败的运行目录（重跑开新目录）；
- 在日志、命令参数、环境变量列表或生产 OpenBao 中出现隔离运行或 binding 的凭据；把生产 provider 凭据、Gateway key 或平台
  key 投递给隔离环境；
- 由部署入口创建 binding、写 binding secret、代替审批，或覆盖不一致的 AppRole/policy/IdP client。

## 完成判据

- `--conformance` 输出 `CANDIDATE_INSTALLED`，`data/conformance/<digest>/` 有四个 0644 文件且 artifactDigest 一致；
- release `APPROVED`，登记窗口已关闭（候选与 Worker 网络已撤下，隔离项目已删除）；
- binding `ACTIVE`，adapter IdP client 回读一致，交付目录有该 `adapterServiceRef`；
- 「搜索全部」验收截图齐全，无读权限成员的反例成立。

## 演练记录

- 2026-10-24（分支 `feat/adapter-conformance-auto`，CI 节点）：云盘候选 `cells@2.0.0`（adapter `79ca81f2…`）以
  `conformance-auto.py run file-storage --no-window` 在全新运行目录一次跑完第 0–6 阶段并安装到临时运行目录的候选集合
  （运行目录 `file-storage-20261024T024850Z-6d11ce`，约 12 分钟，日志中无任何凭据值）；问数 `wren@2.0.0` 隔离运行第 0–6
  阶段跑通（`data-query-20261024T015939Z-a39c5f`，validate_binding 修复以隔离补丁验证，镜像待重建）；问数生产 adapter 的
  `plan` 以只读事实在临时目录推导通过。生产登记、批准、binding、adapter 部署与业务验收待合并发布后执行，未演练。
