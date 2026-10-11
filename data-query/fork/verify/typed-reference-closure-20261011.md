# Wren 原生类型化引用闭包：2026-10-11

本批是已授权治理接缝的源码与窄验证，不是完整组件上架或生产验收。
固定官方版本 `c5f02a0391c87420dba78632dcd86073710deb72`；本次用 `git grep`
重新核验 `wren-ui/src/apollo/server/services/queryService.ts::QueryService.preview`
及 `wren-ui/src/apollo/server/repositories/apiHistoryRepository.ts::ApiHistoryRepository`。
原查询与历史继续由 Wren 消费，SQL 与结果正文没有进入 Core。

## 实际变更与影响

1. 权威沿 DD-94/98/102 与已入库 `contracts/adapter/data_query.v1/registration.json`。
   NativeQueryService 与原 `/api/platform-adapter/[operation]` 共用登记的 describe
   输入形状；显式正整数 limit 才返回类型化 ContentReference，空输入仍仅描述元数据。
   不从 resultJson 反推引用，不产生默认额度或查询权限。
2. 引用包含原资源、原生模型选择、冻结 deployment、连接与 SQL 指纹；原 GET_MODELS
   历史 requestPayload 保存它，复用请求返回同一引用。重放读取原历史捕获的 deployment，
   不跟随新的 current deployment。原 query/dry_run 消费并返回同一已验证引用。
   没有新平台实体、表、迁移或注册表；契约文件本批未变。
3. 模型列、归属、连接、revision 或 fresh 授权变化仍拒绝；描述准入不替代执行准入。
   既有无引用历史仅支持原元数据语义，不为旧记录合成新引用。未知结果保留原 UNKNOWN，
   并发、幂等与结果终态继续消费原历史约束。错误仍沿原 INVALID_QUERY_PARAMETERS、
   QUERY_SCOPE_DENIED、QUERY_REFERENCE_CHANGED 及原不可查证映射，无新增错误分类。
4. Web/Desktop 的原服务页面及 Mobile 非组件宿主边界均未改；没有新增菜单。
   输入零/负数/小数/字符串/null 在历史预留前拒绝。原响应大小、HTTP 请求期限与
   查询 source 授权不变；没有扩大 binding 或 secret 的权限范围。

事后检查直接读取已登记向量与 schema digest，并使用原 MCP SDK 的 Ajv 校验器；
完整三步经原 HTTP handler、NativeQueryService、真实隔离 PostgreSQL 历史与原
QueryService 执行。Core PEP/原数据源响应由既有 fixture 提供，不能算线上授权验收。
既有 native-answer fixture 的独立未提交改动不属于本批；候选保留 HEAD 的原片段，
不把这些改动随类型化引用一起提交。

## 实际命令与结果

复用 `kailo-wren-query-sdk-itgs2n`，固定镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
4 CPU/4 GiB、memory+swap 同值、用户 1000:1000。源码、缓存、临时目录在 Data。
只恢复原隔离 PostgreSQL 容器，确认库 `wren_query_itgs2n` 无其他会话后执行原迁移，
`20261011000000_native_binding_fence.js` 应用退出 0，未修改业务库。

在冻结副本 `data-query/wren-ui` 执行：

```sh
node node_modules/jest/bin/jest.js src/nativeQuery.test.ts --runInBand \
  --testTimeout=30000 --testNamePattern='typed-reference conformance' \
  --globals='{"ts-jest":{"isolatedModules":true}}'
```

修正夹具未采用登记部署 hash/查询列类型的问题后，实际 1 passed/132 skipped，
16.086 s、exit 0。逐步比对登记 expectedOutputJson、真实持久引用、三步引用传递、
重放同 nativeId，实际仅两次原生查询调用。没有把期望值改成错误的旧夹具输出。

事后仅在私有服务副本移除描述的 contentReference 返回；同命令改用验证等待预算
`--testTimeout=120000`，实际 1 failed/132 skipped、19.277 s、exit 1，
明确失败为 `Expected: ContentReference; Received: undefined`，不是超时或编译错误。
该破坏已还原，正式源码从未套反证。

本轮原始失败全部保留：首次副本漏带原共享 protocol.mjs，0 tests、exit 1；
补齐后 beforeAll 30 秒超时；原 5 秒单例/afterAll 超时；30 秒集中批为
9 passed/2 failed（夹具部署 hash 不一致与重放超时）；第一次反证也因测试及
清理超时退出 1，不计捕获成功。实查 PostgreSQL 在 WALWrite 等待。
验证命令的等待预算不改产品 requestTimeoutMs，也不证明延迟指标合格。
两次全工程 tsc 无结果后显式取消，exit 143，不计类型通过；原 Prettier 三文件检查 exit 0。
还原后集中批的类型化引用、SQL-editor 与元数据描述 14 项通过，但四项独立
native-answer fixture 因 NATIVE_BINDING_PROVENANCE_UNAVAILABLE 失败，整次 exit 1；
未放宽原绑定校验来掩盖它们。四项不在本批实现范围，其独立改动未纳入候选。

候选去除上述无关片段，保留 HEAD 的 native-answer 原测试后，再对本批全部实际
消费点集中运行，14 passed/119 skipped，127.669 s、exit 0：

```sh
node node_modules/jest/bin/jest.js src/nativeQuery.test.ts --runInBand \
  --testTimeout=120000 \
  --testNamePattern='typed-reference conformance|invalid describe reference limit|keeps a typed describe reference|produced typed reference|same original SQL-editor history row|describes exactly the Core-authorized' \
  --globals='{"ts-jest":{"isolatedModules":true}}'
```

本批为两生产文件与上述精确测试片段，基于 main
`4c535291c6a8c11ab5c5e132c02625cd312be8e3`；原工作区独立 native-answer 改动保留，
不纳入此提交。实际输入由私有 Git index 选择，反证服务文件已 cmp 还原。

日志根目录：
`/volumes/data/kailo/tmp/codex-wren-genbi-native-20261005.vUC6UO/governance-Itgs2N/reference-closure-20261011.DLKuRK/`。

| 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| typed-sequence-fixture-corrected.log | `fd0de5d08bf81e01db89502b6ddb826590a40c8125a23356b69ca7dc4beac8d3` | 1 passed，exit 0 |
| typed-sequence-no-reference-io-budget.log | `f996467084337baccbedea15ecc086335bda443c9db2aca2f3ef76de9c9f0d96` | 引用断言失败，exit 1 |
| typed-reference-scoped-restored.log | `e2b416a4e59ed7d2ed964026ef33a445ff26b5b6c4fb6fd97bac847a1cbc708b` | 14 passed，exit 0 |

本批没有重建镜像、部署、激活 Release/ApplicationBinding、浏览器截图或 Windows/Mobile
安装验收。线上模型、用户权限、iframe、完整 release conformance 和全量门禁均不能据此
记为通过；此前失败记录不被这些窄检查覆盖。
