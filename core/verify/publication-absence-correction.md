# 普通空读的历史结论纠正

关联 DD-81、DD-117、DD-125；V-SCN-88、V-SCN-126、V-SCN-135。
设计依据是独立提交 `bf05092a78b20f02fe2acc71eadfc2d85d1e5d7e`，已被后续设计版本保留。
本批只修复错误终态与原消费者，不代表普通投递的权威缺失查证已经闭合。

## 实际行为

- Agent kind:0 普通查询隐藏被替换或删除的旧资料。空读与过窗保持原发布未决。
  原不可变 publication 行、原审计都保留；有效状态视图只解释这些原事实。
  原 OUTCOME 的明确限流仍是确定未处理；没有该证据的历史 NOT_DELIVERED
  阻止候选发现和事务内再次认领。游标逐页轮转全部旧未知，不让最新资料遮住旧行。
  验证到原事件后，原 operation 追加独立的肯定纠正键；相同纠正仍幂等。
- Canvas 40100 普通事件空读与读取失败保持 UNKNOWN。迁移只恢复同时具备原
  `canvas-set:<operation>:reconcile` / NOT_DELIVERED、DEPENDENCY_UNAVAILABLE、
  UNKNOWN ACK 与 NOT_WRITTEN 意图的旧分支。真正 REJECTED／LIMIT 不变。
- 审核举报 1984 的有界队列空，以及删除 9005 的普通事件空读，不再产生 ABORTED。
  迁移只恢复原单次发布分支的精确 OUTCOME / DEPENDENCY_UNAVAILABLE 与
  NOT_DELIVERED 意图；状态型 ban/unban/timeout/untimeout/report.resolve 不改变。
  肯定观察追加独立 verified-outcome，避免旧 outcome 键吞掉纠正。

恢复的是原 ActionExecution 与 intent 的待对账状态，原审计追加 UNKNOWN 而不覆写。
因此既有幂等重放、reconcile 扫描、未决计量和 ActionSubmission 重新看到 UNKNOWN；
没有另造用户动作、账本或外部副作用。代码中没有这些意图的 TTL 删除消费者；
历史缺少上述精确事实的 Canvas／审核终态不作批量改写。
新迁移存在纠正证据时明确拒绝向下回退，防止重新激活已知错误终态；
上线须将旧空读 writer 换为修正后的源码，不能混用旧 writer 声称已修复。

## 固定来源与验证

产品实现固定 GitHub `a05502296`，来源为 CI 直接 fetch 后从该对象归档。
SDK 为 `sha256:3007729eb192341a4f004a88e42e1e66c94fc67d763acfc96568bd7311116018`。
SDK 实际 4 CPU / 16 GiB，独立 PostgreSQL 实际 1 CPU / 2 GiB，swap 上限分别等于内存；
原 Data 缓存复用，未调用宿主工具链，未启动真实 receiver 或变更生产服务。

[固定回执](publication-absence-correction-receipt.json)保存源 SHA、限额、终态和原日志摘要。
回执 SHA-256：`2588d5ef30de4c92e59342a5de6a6b341f8cc11785355869ac10f5c2899bc920`。
原件目录：`/volumes/data/kailo/conformance/checks/publication-absence-a05502296`。

| 实际检查 | 结果 |
| --- | --- |
| Agent 原模块含历史 PG | 5 通过、0 ignored |
| Canvas 原模块含历史 PG | 4 通过、0 ignored |
| Moderation 原模块含历史 PG | 6 通过、0 ignored |
| 移除 Agent 旧未知候选守卫 | 原 PG assert FAIL，exit 101；逐字恢复 1 通过 |
| Canvas 将普通空读作为肯定证据 | 原 PG assert FAIL，exit 101；逐字恢复 1 通过 |
| 审核普通空读改回 Aborted | 原 PG assert FAIL，exit 101；逐字恢复 1 通过 |
| platform-core all-target Clippy -D warnings、最终 fmt | exit 0 |
| SDK／PG 清理 | 容器与网络匹配均为空，OOM false |

初次格式预检因专用 TMPDIR 尚不存在退出 2，SDK 未启动；建立目录后格式退出 0。
该失败保留，不能记作格式执行成功。正常与反向均调用原三个模块消费者，
PG 用例显式要求 `PUBLICATION_ABSENCE_TEST_DATABASE_URL`，没有缺环境早返。
全新数据库迁移前进、新迁移回退再前进已实际执行。
隔离 fixture 保持原 FK、scope、ACTIVE generation、owner 与不可变行触发器启用。
没有重复之前的 86 项 bridge 或 835 项 Core 全模块检查。

## 保留边界

普通查询缺失仍不具备 writer 屏障和同范围权威缺失证明；这批 UNKNOWN 是保留真实未决，
不是业务完成。未接入新 Relay observation HTTP；缺历史 Community、Channel 或作者元事实
不得从当前 binding 回填，404 与无肯定字段不得转成未送达。
既有删除、替换后仅 including-deleted 可见的对象，以及有界举报队列之外的对象，
仍须后续受限权威查证链才能收敛。本批没有新镜像、产物登记、部署或三端业务验收。
