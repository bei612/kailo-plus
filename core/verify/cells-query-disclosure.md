# Adapter 当前 revision 披露接线

本增量对应 DD-90/95、03 §3、07 §5.2 与 18 §5。基于联合树
`027a837f6acefea9c7708ce8b52050a696dfacb4`，不包含下一批 peer SecretRef 改动。
它不是完整 Cells FILE_STORAGE、历史引用、WOPI 或已部署 binding 的验收。

## 四步影响与兼容

1. 权威仍是原 ActionExecution/Delegation/Resource/Asset、批准 release、binding generation
   和 ResultExposurePolicy；不新增 Action、Workflow、ProtocolSession 或内容台账。
2. 原 `application_tool::disclose` 的 typed ContentReference 经
   `application_binding::native::Adapter::call(query_revision)` 调用原端点；原
   `action_token::issue_query_revision` 与 `application_binding::pep::check` 都重新检查同一
   child 五引用、在途 turn、双主体目标 read、原内容策略和 ACTIVE binding。
   query 不能借用 NONE 管理或 DISABLING 系统观察豁免；不持 parent 锁跨 HTTP/PEP 回调。
3. child ID 是稳定幂等键；签名摘要包含 operation 和实际 arguments，发送原 canonical JSON。
   只接受引用与实际授权 Resource.native_id/Asset.native_ref 精确一致，原生 current revision
   与冻结引用逐值相等。观察/计量仍先保留；失败不重发 execute、不替换引用或披露正文。
4. 只新增两份原 Adapter Protocol 机器编码及四侧生成类型；旧字段、枚举、Workflow payload、
   数据库结构与锁文件不变。旧 Core 不支持此 query PEP 时仍拒绝，不以 HTTP 200 当业务通过。

## 实现后原入口结果

受限 SDK 为 `kailo-installation-scope-sdk-e4agxd`，镜像
`sha256:10ad51a279b8d0ff8dd308f5a76021b5160444d3ca23399c8555eab05a787f82`，
UID:GID 1000:1000、4 CPU/8 GiB、无额外 swap，Data 缓存，Cargo 并行 16。
开始前实际检查 SDK 工具进程/资源；未安装依赖、更新锁、构建产品或执行 references。

原件目录：
`/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-query-u3Kylc/`。

- 原 `tools/gen.sh` 首次 1：runner 使用错误 npm 缓存且遗漏原 i18n generator；保留 `gen.log`。
  补齐选树原文件并按原入口投递 `/cache/npm`，未改脚本；`gen-corrected.log`、`gen-check.log`
  均 0，四侧及同源 i18n一致；i18n输出与基树 cmp 0。
- 原 Core `cargo test --manifest-path core/Cargo.toml -p platform-core --bin platform-core
  --locked --offline` 的三个过滤目标：`revision_read_tests` 5、`revision_pep_tests` 1、
  `application_tool_tests` 4，均 0；逐字恢复后同 10 项再次 0，Clippy `--all-targets -- -D warnings` 0。
- 私有生产变异删除 Resource 精确匹配/current revision 等值守卫，并允许 DISABLING query：
  `read-mutation.log` 3 passed/2 failed、`pep-mutation.log` 1 failed，两原目标均 101。
  apply_patch 恢复后与保存原件 cmp 0；`read-restored.log`、`pep-restored.log`、
  `output-restored.log` 和 `clippy.log` 通过。不是仅让测试断言自毁。
- 原 Cells adapter HTTP 入口 `node --test test/query-revision.test.mjs`，`native-http.log` 21/21，0。
  固定 Cells `c57f02f4962835447df694c63bd0fd8c22bd7baf` 的 REST v2 NodeVersions/VersionId
  调用由既有适配器消费；Core PEP、OIDC 和 native service 在此 HTTP 目标中仍是隔离 fixture。
- 新生产 SELECT 在原隔离 `resource_assembly_2co1ge` 执行
  `BEGIN READ ONLY/PREPARE/DEALLOCATE/ROLLBACK`，0，无数据/迁移写入。
  原件在 `/volumes/data/kailo/tmp/codex-cells-query-disclosure-20261005.u3Kylc/query-prepare.{sql,log}`。

## 明确未闭合

这些目标编译实际四个消费者并测试其生产映射/守卫，不是带真实 OpenBao、SpiceDB、
Gateway、Cells 的业务 E2E；没有运行真实服务、开通权限、模型请求、提交或部署。
一般子节点的后续代码与隔离目标见下节；原生 Node UUID/ContextWorkspace/Path 仍须证明
目标归属，只有 binding-root 包含检查不足以替代该 Resource 的授权根。
历史版本需原 NodeVersions 的确切 VersionId 存在及固定版本内容读取证据；当前 query
仅返回唯一 IsHead，不能证明历史内容或改写 citation/审批 reference。
完整 binding handshake/validate/原生 scope、MCP 工具与在线编辑接缝尚未共同验收。

## 受权一般子节点当前版本增量

独立候选 `/volumes/data/kailo/tmp/codex-cells-subnode-version-20261005.rotRhP/apps`，
继承上述冻结 head-query 切片，不修改旧原件；仍只返回当前唯一 IsHead，不证明历史版本。

1. 依据 `03` Resource/Asset 授权目标、`07` §5.2 当前 query、`18` §2/§5.3 原生 UUID 与
   VersionId；没有新增权限、Action、Workflow 或内容权威。
2. Core 从实际已准入 Resource.native_id / Asset.native_ref 生成可选
   `authorizationTargetNativeRef`，与请求一起纳入原 ActionToken 参数摘要。
   两字段旧请求仍只能 exact native target；旧 adapter 拒绝新字段而不是隐式放宽范围。
3. Cells adapter 在原 HTTP consumer 中查询该授权根和具体节点的 UUID、ContextWorkspace、
   Path、类型与回收事实，先核 binding 根，再核 Resource 的确切原生子树边界。
   Asset 永远只读同一叶节点；跨 Workspace、前缀近似、回收、歧义与未知均拒绝。
4. 原 child/双主体 read/内容策略/fresh PEP 和前后检查保持；响应仍为原两字段。
   无数据库变更、历史结果重放、权限/额度调整、正文缓存、模型调用、产品构建或部署。

原目标使用相同固定 SDK、4 CPU/8 GiB/无额外 swap、Cargo 16 与 Data 缓存。
原件 `/volumes/data/kailo/tmp/codex-installation-runtime-rootcause-20261003.e4agxD/cells-subnode-rotRhP/`：

| 原件 | 实际退出/结果 | SHA-256 |
|---|---|---|
| native-baseline.log | 0，29 passed | `64fa55ada07f9b04ab37120386110626b26a25335e0a1c5a26f1403a96fbda17` |
| core-mutation.log | 101，5 passed/1 failed | `5cc213695bcefbc67e07e5d6c7334aa64bbf00e3fe5d75601fa47dcc37cd2c0b` |
| native-mutation.log | 1，26 passed/3 failed | `a68f5f01a6bf27e54f1efd62fa2f34eec317302337e4162c512ebc63f2d92376` |
| core-restored.log | 0，6 passed | `a950fadbdf98a1b59f452a294a99e48ae73dc8dc56642a6b10ef80e8fc5d0461` |
| native-restored.log | 0，29 passed | `7ba22ba08419f5eeb5414a53d502689bdc054362189e865db6dc524355bb9479` |
| clippy.log | 0，all-targets -D warnings | `e41760211e7aab12163d78f48db4bf48921c0243c4df670a638b329eafeec870` |
| gen-check.log | 0，原四侧/同源 i18n一致 | `e4f0fe74c3ed4493881f06f68e24c100aa7ccf811e925991008ed7a448a18975` |

私有变异删除 Core 原生授权根/Asset 精确守卫和 adapter 授权子树守卫，原生产消费目标分别
抓住错误准入和越界 200；apply_patch 恢复后两生产文件与保存原件 cmp 0，再运行上述目标。
原生 HTTP 下游仍为隔离 Cells/OIDC/PEP fixture；Core 目标编译真实消费者，但未进行真实
binding/Gateway/Cells 共同业务 E2E。历史版本/ProtocolSession/在线编辑不据本节宣称完成。
