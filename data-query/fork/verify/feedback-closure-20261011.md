# 原 SQL 调整链当前候选核验（2026-10-11）

本记录属于 `SS-WRN-IDENTITY` / `SS-WRN-GOVERNANCE`、DD-76/87 的原生
SQL 调整接入；不是新增工作流、界面或执行权威。依据 `.design/03` §6、
`.design/07` §5.2：跨进程身份保持私有，副作用沿既有执行引用对账，结果
不明不得渲染为成功或失败，也不得直接再发一次 SQL。

固定官方来源为 Wren `c5f02a0391c87420dba78632dcd86073710deb72`：
`wren-ui/src/apollo/server/adaptors/wrenAIAdaptor.ts::createAskFeedback`、
`wren-ai-service/src/web/v1/routers/ask_feedbacks.py::ask_feedback`、
`wren-ai-service/src/web/v1/services/ask_feedback.py::AskFeedbackService.ask_feedback`。
分类为已授权治理改造；保留原 SQL 调整产品及任务，不据此宣称全量原样还原。

## 当前实现及影响边界

候选以 `beacab8ca6585d489037e6951b3fe380ceda654a` 为基准，10 个源码/检查
文件 `+461/-54`，冻结树 `860ecf66c09bc71ee35e83450766cd8a23d99d45`。
在实际 SQLite 检查后补齐下述四行夹具，最终代码候选基于已推送的
`0516282e15ab1b1c4c0c3ee6de31e157bc7acc13` 重建，树为
`f5eb1c9b72f073c10e3099ed907b9d842f2af6b8`，10 文件 `+465/-54`。
两代码树的本批差异仅这四行检查输入，没有混入其他 Wren 未提交改动。
收口时同一十文件差异重放到已推送的
`653f07887467982bda6beb37592a02d9139d567f`，代码树为
`f7cc1e01708a321d8fda617e4ad83441a7533417`；本批源码字节不变，保留其间
已合并的 Cells 和 Web 变更。后续调整页面缓存修复不在此十文件内。
Web 服务端 adaptor 把可信 HUMAN 上下文传入原 AI 调整后台任务，仅通过
私有头传递 bearer；不写入业务请求、任务结果或日志。原后台任务消费该
上下文并在退出时清除。未知 SQL 结果使 AI 作业停止并携带
`NATIVE_EXECUTION_UNKNOWN`，不冒充 SQL 失败或取消完成。

原调整 tracker/resolver 观察同任务的 SQL 子执行；重试前锁定原 project、
binding、任务及子查询集合并重新检查权限。只观察的 GET 不重发 SQL；未知
子结果、迟到子查询和并发任务变化拒绝重新派发。模型 resolver 消费原任务
类型及 scope，不采信客户端自报类型。没有数据库迁移、新契约、公共状态机、
平台正文副本或 Mobile 组件宿主变化；原 `GAP-WRN-01` 取消限制未解除。

## 实际核验

输入与日志目录：
`/volumes/data/kailo/tmp/wren-native-conformance-runtime.pawCOZ/feedback-closure.UwZffq`。
冻结树的 AI 服务目录由 Git 导出，未从 `.references` 构建或执行。

镜像 `sha256:721fd2fd5c4b1501303d17b13fdec67e7a978ac24187bb9d26d2436ef18792b4`，
容器实际回读 4 CPU / 4 GiB / 等额 memory+swap，网络关闭、源码只读、
非 root 执行；临时目录位于 Data，不安装依赖、不接真实模型/Core。

```text
/app/.venv/bin/python -m unittest discover \
  -s tests/pytest/providers -p test_native_human_asking.py -v
初次：exit 1；导入 Haystack 时写 /.haystack 被只读根目录拒绝，未跑业务断言。
纠正执行配置后：Ran 5 tests，OK，容器 exited exit=0。
私有反证：Ran 5 tests，FAILED (failures=1, errors=1)，exit 1。
恢复后：Ran 5 tests，OK，容器 exited exit=0。
```

配置纠正仅设置镜像原有 `HAYSTACK_TELEMETRY_ENABLED=false`，已读取镜像内
`haystack/telemetry/_telemetry.py` 的真实消费者；不改变生产配置。首次失败
保留。配置文件缺席和 Langfuse disabled 警告亦保留，不作为生产启动证明。

反证只修改私有输入：去掉 `run_native_ask` 上下文包装，以及把 pending SQL
错误改为 `generating`。原 HTTP/BackgroundTasks 检查因上下文变成 None 报错，
原 AskFeedbackService 检查因 generating 不等于 stopped 失败。恢复两处后
与正式源码 `cmp` 均为 0，再运行同一命令通过。未破坏工作树生产文件。

日志 SHA-256：

- 初次 `current-ai-positive.log`：`ad4259a9469b21436a43ed50765021d6fa06ed7a727923116e0841c6182e6d64`
- 正向 `current-ai-checked.log`：`9b092c4df8675314ea84cae56ff39223bece0db7e7abf589da6f98e71cf86bc4`
- 反证 `current-ai-negative.log`：`5c4a3a96c990a5ea4959a43d22422ed29c77ff4be4adf397dc9834f2ceb9928a`
- 恢复 `current-ai-restored.log`：`7a38f2536cb9b8de8bf5ae201bc1247d7fe009c4240947d9a2eda3e17212ad9a`

初始十文件输入的 UI `tsc --noEmit --incremental false` 已退出 0；以 `&&` 启动的原
Jest 两套件已退出 1：39 项通过、3 项失败，调整 scope 套件通过，三个
SQLite 仓库检查因 `/deps/node_modules/better-sqlite3` 缺少原生 binding
而未完成。原输出为 `Could not locate the bindings file`；SDK 使用
Node 24.21.0，不能把这一结果算成数据库检查通过。

执行输入纠正复用现有 Wren UI 镜像
`sha256:608f7fabd0ac30ffbd0176d41caa2a535197b908da7ad5f2f2dcb34a48a9d1d3`
内的 Node 18.20.8 与其已构建的原 `better-sqlite3`。只在命令行 Jest
moduleNameMapper 将该依赖指向镜像 `/app/node_modules/better-sqlite3`，
保留两条原源码 alias；不替换数据库、不修改生产依赖或业务断言。容器
`kailo-wren-feedback-native-uwzffq` 回读为非 root、4 CPU / 4 GiB / 等额
memory+swap、网络关闭、根目录只读；原依赖只读，冻结输入与检查缓存在
Data。镜像实际回读 `better-sqlite3` 为 9.4.3，与原依赖一致。
`current-ui-native-positive.log` 退出 1，41 项通过、1 项失败。三个 SQLite
用例已真实执行，其中“另一项目”用例遗漏目标 project 行，原先就已存在的
`registerNativeQuery -> lockNativeBinding` 先报
`NATIVE_BINDING_PROVENANCE_UNAVAILABLE`，不能用 null 代表该前提缺失。
只修正夹具：插入另一个真实项目并仍断言不能改写原任务，同时另断言不存在
项目必须抛上述拒绝。未修改生产权限/锁或移除拒绝断言；同容器同两套件的
`current-ui-native-fixture.log` 最终退出 0，2 suites / 42 tests passed，
耗时 1467.687 秒。末版四行夹具没有单独重跑全量 tsc；本次仍使用原 ts-jest
转换与类型诊断，不能把初始 tsc 记录改写为末版全工程静态验证。

实际 UI 命令（容器原工作目录为本快照的 `data-query/wren-ui`）：

```text
node /deps/node_modules/jest/bin/jest.js --runInBand --testTimeout=60000 \
  --cacheDirectory=/runtime/feedback-closure.UwZffq/jest-node18-cache \
  --moduleNameMapper '{"^@/(.*)$":"<rootDir>/src/$1","^@server/(.*)$":"<rootDir>/src/apollo/server/$1","^better-sqlite3$":"/app/node_modules/better-sqlite3"}' \
  --runTestsByPath src/nativeAskingQuery.test.ts src/nativeAdjustmentScope.test.ts
```

在正向进程退出后，仅私有输入去掉原任务锁内 `nativeQueries` 与观察集合
的相等检查，保留其他权限、状态与 scope 判断。同命令的
`current-ui-native-negative.log` 退出 1：41 passed / 1 failed；原
`new child SQL registered after observation prevents adjustment query replacement
under the original row lock` 明确捕获 Promise 错误地 resolved、新 queryId 被派发，
不是环境或编译失败。apply_patch 恢复生产原字节、cmp 退出 0 后，
`current-ui-native-restored.log` 同命令退出 0，42/42 恢复通过（9.607 秒）。
正式源码、私有 Git 候选均未写入反证故障。

| UI 日志 | SHA-256 | 结果 |
| --- | --- | --- |
| `current-ui-native-fixture.log` | `6045b753467cd83002c11fcc9e7bdfdb1dd61204e878ea2d8e90123bc78f0701` | 正向 exit 0 |
| `current-ui-native-negative.log` | `c3bdf9a7b5ad7d54a7f90a087729e421acdfbf09adb424371e3cdbe5abfaf47d` | 反证 exit 1 |
| `current-ui-native-restored.log` | `255ded5f7277d9180f6e593a15506e9ddef028b2643c7e8383dd041d59e3dacc` | 还原 exit 0 |

全量门禁也未取得通过结果。本记录不证明 PostgreSQL 跨进程互斥、真实模型/SQL
调用、浏览器截图、三用户协作或组件可上架；本批未构建发布或部署。
