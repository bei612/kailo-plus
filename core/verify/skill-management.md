# Skills 管理核验记录（DD-135、SF-COD-18、V-SCN-210–217）

本记录说明 `agent.skill_management` 的实现边界与已运行的检查。设计权威为
`.design` `5e413d5e3e87d4b7a5e36af69cbd79ae0dc3cb70`（`02` DD-135/SF-COD-18、
`03` §7、`05` §2.14、`17` §3–§10、`16` V-SCN-210–217）。

## 领域规则

- `skill.definition` 是 Tenant 级平台核心 ResourceType；`catalog.skill_definition`
  的 slug 与 Codex skill 名同一规则，`DISABLED` 不可逆（库触发器同样拒绝）。
- `skill.version` 是 Asset 扩展；artifact、digest、元数据与能力需求创建即冻结，
  状态只沿 `DRAFT→PUBLISHED→RETIRED` 前进。
- artifact `kailo-skill@1` 恰为一个规范 `SKILL.md`。`skill_artifact.rs` 是唯一编解码：
  裸 `SKILL.md`、ustar/pax/GNU 长名 tar 与 gzip；链接、设备、可执行位、多余文件、
  越界路径、zip 一律拒绝并逐项给出违规码与路径。
- 七个动作（`05` §2.14）全部 SYNC、TENANT_ONLY、HUMAN-only、EXPLICIT、无审批与
  计量；创建与上传版本以同一 ActionExecution 为 SpiceDB 投影意图，分享沿 DD-131(6)
  的 `tenant#member` discoverer/reader。

## 安全边界

- 上传只暂存本 PlatformSession、本人、本定义的一次性输入（30 分钟），
  `skill.version.create` 在 BFF 先核会话，准入事务内重算 digest 并消费。
- AgentVersion 作者侧（创建、编辑、发布）严格校验 Skill 引用；运行侧（Installation
  就绪、自动化执行者）不因单个 Skill 失效阻断整个安装。
- Installation 每个 generation 固定 `skill_root_ref=kailo-skills/g<generation>`；
  runtime 以 digest 核对后物化只读根，`skills/extraRoots/set` 后要求
  `skills/list(forceReload)` 恰为被引集合，不引 Skill 时必须为空集合。
- `skills.include_instructions=false`；Session 首个 turn 以 `UserInput::Skill`
  显式注入有效 Skill；每次 `turn/start` 前 fresh 判定并以 `skills/config/write`
  停用或恢复，派发意图之前完成。

## 呈现

- Web/Desktop 共用 `client-kit/ts/platform/src/react/skills.tsx`：Agents 页内的
  Skills 区、定义详情（版本、上传、发布、退役、分享、停用、正文查看）、
  AgentVersion 编辑器的 Skill 选择与 Installation 详情的 Skill 投影状态。
- 文案进入同一 `i18n.ts`（en/zh-CN），Dart 由 `tools/gen-platform-i18n.py` 生成。

## 已运行的检查

见同目录提交记录与 CI 节点分支检查日志；业务验收（上传 → 发布 → 引用 → 安装 →
Codex 发现 → 频道使用 → 审计回读）在合并发布后执行，本文件届时追加实际回执。
