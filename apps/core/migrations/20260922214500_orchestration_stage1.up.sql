-- Stage 1 的编排事实：ActionExecution、WorkflowRef、TaskProjection
-- （.design/03 §6、.design/06 §3.1）。
--
-- schema 归属按 ADR-01 的既有划分：准入事实进 admission，投影进 projection。
-- 不新建 schema——模块边界已经表达过一次，再表达一次就是第二份划分。
--
-- 字段是 .design/03 实体定义的**子集**：只建 Stage 1 成员生命周期链用得到的列。
-- component binding、delegation、approval、usage/asset/audit 引用都还没有产出方，
-- 提前建列就是预建未用结构；它们随各自能力进入时按追加式迁移补上。

-- 一次受治理动作的门禁与调度状态。
-- gate_state 与 dispatch_state 是两台独立状态机，不合并成一个 state：
-- 「准入已允许」与「副作用已派发」是两件事，合并后就无法表达
-- ALLOWED + UNKNOWN——准入通过但派发结果不明，而那正是 DD-48 的核心情形。
CREATE TABLE admission.action_execution (
    id                     uuid PRIMARY KEY,
    -- operation_id 是跨组件关联键，全局唯一；同一 operation 的重试不换 ID
    operation_id           uuid        NOT NULL UNIQUE,
    tenant_id              uuid        NOT NULL REFERENCES identity.tenant (id),
    workspace_id           uuid        REFERENCES identity.workspace (id),
    action_key             text        NOT NULL,
    action_version         integer     NOT NULL,
    initiator_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    actor_principal_id     uuid        NOT NULL REFERENCES identity.principal (id),
    -- 成员生命周期动作的 target 是 membership 行本身；它跨两张表，
    -- 因此不加外键，由发起方按 action_key 决定解释方式
    target_id              uuid        NOT NULL,
    -- 冻结的参数摘要。Workflow 运行中不得更换（06 §3）
    parameter_hash         text        NOT NULL,
    temporal_workflow_id   text,
    gate_state             text        NOT NULL CONSTRAINT action_gate_state_enum CHECK (gate_state IN
                               ('EVALUATING','WAITING','ALLOWED','DENIED','REVOKED','EXPIRED')),
    dispatch_state         text        NOT NULL CONSTRAINT action_dispatch_state_enum CHECK (dispatch_state IN
                               ('NOT_DISPATCHED','DISPATCHED','ABORTED','UNKNOWN')),
    correlation_id         uuid        NOT NULL,
    version                integer     NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    -- 未准入即不得派发。这一条写在库里而不是只写在代码里：绕过服务层的
    -- 任何写入路径都不能造出「没通过准入却已派发」的行（DD-48）
    CONSTRAINT dispatch_requires_allowed CHECK (
        dispatch_state = 'NOT_DISPATCHED' OR gate_state = 'ALLOWED'
    )
);

-- Core 在调用 Temporal Start 前持久化的唯一引用。
-- workflow_id 是主键而不是代理主键：06 §3.1 固定它为
-- kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>，
-- 「不分配第二个业务 workflow ID」因此由主键机械保证，不靠代码自觉。
CREATE TABLE projection.workflow_ref (
    workflow_id         text PRIMARY KEY,
    -- run_id 只从 Temporal observation 回填，Start 返回不明时保持为空
    run_id              text,
    workflow_type       text        NOT NULL,
    workflow_version    integer     NOT NULL,
    kind                text        CONSTRAINT workflow_kind_enum CHECK (kind IN
                            ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION')),
    tenant_id           uuid        NOT NULL REFERENCES identity.tenant (id),
    workspace_id        uuid        REFERENCES identity.workspace (id),
    operation_id        uuid        NOT NULL,
    -- 一个 ActionExecution 至多一个业务 Workflow（.design/03 §6）
    action_execution_id uuid        NOT NULL UNIQUE REFERENCES admission.action_execution (id),
    parent_workflow_id  text        REFERENCES projection.workflow_ref (workflow_id),
    projection_state    text        NOT NULL CONSTRAINT workflow_projection_state_enum CHECK (projection_state IN
                            ('PENDING_START','RUNNING','TERMINAL','UNKNOWN')),
    version             integer     NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Temporal 不向 Core 推送状态，Nexus 按 DD-10 排除，因此投影由 Workflow 自己
-- 经 ProjectTaskState Activity 写回（06 §3.1）。
--
-- 按 workflow_id 聚合而不是 run_id：continue-as-new 保留同一 workflow ID，
-- 按 run_id 聚合会让一次长任务在工作台上碎成多条。
CREATE TABLE projection.task_projection (
    workflow_id      text PRIMARY KEY REFERENCES projection.workflow_ref (workflow_id),
    run_id           text,
    -- 按 event_id 单调去重：Activity 会重试、乱序到达，旧事件不得覆盖新状态
    last_event_id    bigint      NOT NULL,
    status           text        NOT NULL,
    waiting_reason   text,
    progress         text,
    -- 观测缺口：兜底对账发现投影落后时置真，工作台据此显示 PROJECTION_DELAYED
    -- 而不是伪造完成（06 §3.1）
    observation_gap  boolean     NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_id_is_monotonic CHECK (last_event_id > 0)
);
