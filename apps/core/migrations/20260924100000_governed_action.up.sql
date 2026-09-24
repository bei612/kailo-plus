-- Stage 2 治理内核的第一条纵向切片：ActionDefinition 目录、ApprovalPolicy、
-- ActionDecision、ApprovalProjection，以及 ActionExecution 的扩展列
-- （.design/03 §4 §6、.design/06 §4、DD-47、DD-48）。
--
-- 本迁移是「扩展」一步：只加表、加可空列、放宽一个唯一约束。Stage 1 的写入路径
-- （设备公钥登记、夹具、重跑）不写新列，仍被接受；没有「收缩」要做——没有被取代
-- 的旧列或旧读路径。

-- ---------------------------------------------------------------------------
-- Catalog：随平台发布的 ActionDefinition 与 ApprovalPolicy
-- ---------------------------------------------------------------------------
--
-- 来源选迁移种子，不做可 CRUD 的后台，也不放进部署配置：
-- - 它们是平台合同（.design/03 §4「每个 ActionDefinition 必须显式给出……」），
--   与代码同一 release train 评审、同一版本发布；部署配置是每个部署可改的事实，
--   放进去就让「这个动作要不要审批」变成运维可随手改的开关；
-- - contracts/ 是数据**类型**的权威，不是数据；
-- - 版本不可变由库里的触发器执行，缺项不得 active 由 CHECK 执行——不靠加载代码自觉。
--
-- ApprovalPolicy 的 tenant_id 不在本迁移：.design/03 §4 的 tenant_id 用于 Tenant
-- 自有的策略，而本切片只有随平台发布的策略（无 Tenant 策略管理动作）。Tenant 策略
-- 随其管理动作进入时按追加式迁移补列，与 Stage 1 对实体子集的处理相同。

CREATE TABLE catalog.approval_policy (
    id                 uuid        NOT NULL,
    version            integer     NOT NULL CHECK (version > 0),
    action_key         text        NOT NULL,
    target_type        text        NOT NULL,
    -- [{selector, minDistinct}]：每项分别满足，不以总人数替代（.design/10 §2）
    role_requirements  jsonb       NOT NULL,
    owner_requirement  text        NOT NULL CONSTRAINT approval_owner_requirement_enum CHECK (owner_requirement IN
                           ('NONE','TARGET_OWNER','ALL_AFFECTED_OWNERS')),
    self_approval      text        NOT NULL CONSTRAINT approval_self_approval_enum CHECK (self_approval IN
                           ('ALLOW','DENY')),
    -- 请求到过期的上界。它是策略的一部分，不是代码里的常量
    expires_in_seconds integer     NOT NULL CHECK (expires_in_seconds > 0),
    status             text        NOT NULL CONSTRAINT catalog_version_status_enum CHECK (status IN
                           ('ACTIVE','RETIRED')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, version),
    CONSTRAINT role_requirements_is_array CHECK (jsonb_typeof(role_requirements) = 'array'),
    -- 一个谁也不要求的审批策略就是恒真的审批：拒绝登记
    CONSTRAINT policy_requires_someone CHECK (
        jsonb_array_length(role_requirements) > 0 OR owner_requirement <> 'NONE'
    )
);
CREATE UNIQUE INDEX approval_policy_one_active ON catalog.approval_policy (id) WHERE status = 'ACTIVE';

CREATE TABLE catalog.action_definition (
    action_key                 text        NOT NULL,
    version                    integer     NOT NULL CHECK (version > 0),
    component_type_key         text        NOT NULL,
    target_type                text        NOT NULL,
    tenant_rule                text        NOT NULL CONSTRAINT action_tenant_rule_enum CHECK (tenant_rule IN
                                   ('SESSION_TENANT','TARGET_TENANT','INHERIT_PARENT')),
    workspace_rule             text        NOT NULL CONSTRAINT action_workspace_rule_enum CHECK (workspace_rule IN
                                   ('TENANT_ONLY','WORKSPACE_REQUIRED','TARGET_HOME_WORKSPACE','INHERIT_PARENT')),
    -- 规范 permission 与 Check 对象类型只取固定 SpiceDB schema 的取值（.design/03 §5）
    permission                 text        NOT NULL CONSTRAINT permission_is_canonical CHECK (permission IN
                                   ('discover','consume','read','export','create','update','delete','share',
                                    'manage','execute','approve','delegate','transfer_owner','audit')),
    permission_object_type     text        NOT NULL CONSTRAINT permission_object_is_schema_type CHECK (
                                   permission_object_type IN ('tenant','workspace','resource','asset')),
    execution_mode             text        NOT NULL CONSTRAINT action_execution_mode_enum CHECK (execution_mode IN
                                   ('SYNC','PROTOCOL','TEMPORAL')),
    confirmation_mode          text        NOT NULL CONSTRAINT action_confirmation_mode_enum CHECK (confirmation_mode IN
                                   ('NONE','EXPLICIT','APPROVAL')),
    approval_policy_id         uuid,
    approval_policy_version    integer,
    workflow_type              text,
    workflow_kind              text        CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
                                   ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
                                    'BUZZ_IDENTITY_PROJECTION')),
    capacity_policy            text        NOT NULL CONSTRAINT action_capacity_policy_enum CHECK (capacity_policy IN
                                   ('NONE','PLATFORM_SLOT','NATIVE')),
    capacity_pool_key          text,
    quota_policy               text        NOT NULL CONSTRAINT action_quota_policy_enum CHECK (quota_policy IN
                                   ('NONE','CHECK','STRICT_RESERVATION')),
    meters                     text[]      NOT NULL,
    result_exposure            text        NOT NULL CONSTRAINT result_exposure_enum CHECK (result_exposure IN ('NONE')),
    audit_policy               text        NOT NULL CONSTRAINT audit_policy_enum CHECK (audit_policy IN ('FULL_LIFECYCLE')),
    -- BusinessObservabilityPolicy（.design/03 §4）：correlation、terminal source 与
    -- redaction 不得缺失；progress/usage/cost 可显式 NONE
    obs_correlation_mode       text        NOT NULL CONSTRAINT observability_correlation_mode_enum CHECK (
                                   obs_correlation_mode IN ('OPERATION_REF','OPERATION_NATIVE_REF')),
    obs_progress_source        text        NOT NULL CONSTRAINT observability_progress_source_enum CHECK (
                                   obs_progress_source IN ('NONE','TEMPORAL','NATIVE')),
    obs_terminal_source        text        NOT NULL CONSTRAINT observability_terminal_source_enum CHECK (
                                   obs_terminal_source IN ('SYNC_RESULT','TEMPORAL','NATIVE')),
    obs_usage_source           text        NOT NULL CONSTRAINT observability_usage_source_enum CHECK (
                                   obs_usage_source IN ('NONE','DRIVER','GATEWAY_DURABLE_USAGE','OPENMETER')),
    obs_cost_source            text        NOT NULL CONSTRAINT observability_cost_source_enum CHECK (
                                   obs_cost_source IN ('NONE','GATEWAY_DURABLE_USAGE','OPENMETER')),
    obs_redaction_policy       text        NOT NULL CHECK (obs_redaction_policy <> ''),
    status                     text        NOT NULL CONSTRAINT catalog_version_status_enum CHECK (status IN
                                   ('ACTIVE','RETIRED')),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (action_key, version),
    FOREIGN KEY (approval_policy_id, approval_policy_version)
        REFERENCES catalog.approval_policy (id, version),

    -- 以下是「缺任一项不得 active」在库里的执行点（.design/03 §4）
    CONSTRAINT approval_policy_iff_approval CHECK (
        (confirmation_mode = 'APPROVAL') = (approval_policy_id IS NOT NULL AND approval_policy_version IS NOT NULL)
    ),
    CONSTRAINT temporal_requires_workflow CHECK (
        (execution_mode = 'TEMPORAL') = (workflow_type IS NOT NULL)
    ),
    CONSTRAINT component_task_requires_kind CHECK (
        (workflow_type = 'ComponentTaskWorkflow') = (workflow_kind IS NOT NULL)
    ),
    CONSTRAINT slot_requires_pool CHECK (
        (capacity_policy = 'PLATFORM_SLOT') = (capacity_pool_key IS NOT NULL)
    ),
    -- CapacityLease 与 Quota 尚未进入（Stage 2 后续切片、Stage 4）：登记需要它们的
    -- 定义只会得到一个没有执行点的策略。先在库里拒绝，随各自模块进入时放宽。
    CONSTRAINT capacity_not_yet_enforced CHECK (capacity_policy = 'NONE'),
    CONSTRAINT quota_not_yet_enforced CHECK (quota_policy = 'NONE' AND cardinality(meters) = 0),
    -- SS-AGW-USAGE 未闭合：durable Gateway usage 不得登记（.design/03 §4）
    CONSTRAINT gateway_usage_not_closed CHECK (
        obs_usage_source <> 'GATEWAY_DURABLE_USAGE' AND obs_cost_source <> 'GATEWAY_DURABLE_USAGE'
    )
);
CREATE UNIQUE INDEX action_definition_one_active ON catalog.action_definition (action_key) WHERE status = 'ACTIVE';

-- 版本内容不可变：只允许 ACTIVE 与 RETIRED 之间切换 status。删除只允许从未被任何
-- ActionExecution 引用过的版本——被引用的版本是那次动作「按什么规则被准入」的证据。
CREATE FUNCTION catalog.guard_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
            RAISE EXCEPTION '% 的版本内容不可变；改规则就登记新版本', TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'action_definition' AND EXISTS (
        SELECT 1 FROM admission.action_execution
        WHERE action_key = OLD.action_key AND action_version = OLD.version) THEN
        RAISE EXCEPTION 'ActionDefinition %@% 已被 ActionExecution 引用，不能删除', OLD.action_key, OLD.version
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER approval_policy_immutable BEFORE UPDATE OR DELETE ON catalog.approval_policy
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();
CREATE TRIGGER action_definition_immutable BEFORE UPDATE OR DELETE ON catalog.action_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();

-- 一期治理动作的定义与策略。GAP-LCM-01：Tenant delete 不登记；Workspace delete
-- 按 DD-46 不登记；Tenant 成员「建立」没有邀请/开户入口（Stage 1 不注册登录开户），
-- 不登记。设备公钥登记沿用 DD-79 的自有路径（见 core/verify/governed-action.md）。
--
-- tenant.member.revoke 需要另一位 Tenant admin 批准：撤掉一个人对整个 Tenant 的
-- 访问是不可由一人决定的高影响动作（DD-45 的撤权链会撤 session、全部 Workspace
-- scope 与 relay roster），self_approval=DENY 让发起者不能自己批准。
INSERT INTO catalog.approval_policy
    (id, version, action_key, target_type, role_requirements, owner_requirement, self_approval,
     expires_in_seconds, status)
VALUES
    ('6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01', 1, 'tenant.member.revoke', 'TENANT_MEMBERSHIP',
     '[{"selector":"TENANT_ADMIN","minDistinct":1}]', 'NONE', 'DENY', 259200, 'ACTIVE');

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    -- 建立 Workspace：尚不存在的对象不能成为 Check 对象，检查所在 Tenant 的 create
    -- （.design/03 §5）。Tenant 级管理意图，TENANT_ONLY（DD-54）。
    ('workspace.create', 1, 'core', 'WORKSPACE', 'SESSION_TENANT', 'TENANT_ONLY',
     'create', 'tenant', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'WORKSPACE_LIFECYCLE',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    -- Workspace 成员：执行 Workspace 就是目标 Workspace，检查其 manage（DD-41/46）
    ('workspace.member.add', 1, 'core', 'WORKSPACE_MEMBERSHIP', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'MEMBERSHIP_PROJECTION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('workspace.member.revoke', 1, 'core', 'WORKSPACE_MEMBERSHIP', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'TEMPORAL', 'NONE', NULL, NULL, 'ComponentTaskWorkflow', 'MEMBERSHIP_REVOCATION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('tenant.member.revoke', 1, 'core', 'TENANT_MEMBERSHIP', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'APPROVAL', '6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01', 1,
     'ComponentTaskWorkflow', 'MEMBERSHIP_REVOCATION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');

-- ---------------------------------------------------------------------------
-- ActionExecution 扩展
-- ---------------------------------------------------------------------------
ALTER TABLE admission.action_execution
    -- 规范化参数（ID、slug、显示名），parameter_hash 由它算出。重新准入要按同一
    -- 参数重算并比对摘要；只存摘要就无从「重做完整准入」
    ADD COLUMN parameters           jsonb,
    -- 调用方幂等键：同一发起者以同一键重发时回答原 operation
    ADD COLUMN idempotency_key      uuid,
    -- 一个 ActionExecution 至多绑定一个 ApprovalWorkflow（.design/03 §6）
    ADD COLUMN approval_workflow_id text UNIQUE,
    -- Core 在请求时冻结进 Workflow input 的过期时刻；按同一 ID 重新 Start 时 input 必须逐字相同
    ADD COLUMN approval_expires_at  timestamptz,
    -- 最近一次门禁结论的稳定 reason code（contracts/enums/reason_code）
    ADD COLUMN reason_code          text,
    ADD COLUMN updated_at           timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT waiting_requires_approval CHECK (gate_state <> 'WAITING' OR approval_workflow_id IS NOT NULL);
CREATE UNIQUE INDEX action_execution_idempotency
    ON admission.action_execution (tenant_id, initiator_principal_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
-- 同一目标同时只能有一个在途的准入或审批：两个并行的撤权请求各自获批，就是同一个
-- 意图被执行两次
CREATE UNIQUE INDEX action_execution_one_pending_per_target
    ON admission.action_execution (target_id)
    WHERE gate_state IN ('EVALUATING', 'WAITING');
-- 对账作业按门禁与调度状态扫描非终态动作
CREATE INDEX action_execution_open
    ON admission.action_execution (updated_at)
    WHERE gate_state IN ('EVALUATING', 'WAITING')
       OR (gate_state = 'ALLOWED' AND dispatch_state <> 'DISPATCHED');

-- ---------------------------------------------------------------------------
-- ActionDecision：每次准入与重新准入的结论（.design/03 §4），追加写入
-- ---------------------------------------------------------------------------
CREATE DOMAIN admission.decision_outcome AS text
    CONSTRAINT decision_outcome_enum CHECK (VALUE IN
        ('ALLOW','DENY','REQUIRED','SATISFIED','NOT_REQUIRED','NOT_APPLICABLE','RECORDED'));

CREATE TABLE admission.action_decision (
    id                     uuid        PRIMARY KEY,
    operation_id           uuid        NOT NULL,
    action_execution_id    uuid        NOT NULL REFERENCES admission.action_execution (id) ON DELETE CASCADE,
    phase                  text        NOT NULL CONSTRAINT action_decision_phase_enum CHECK (phase IN ('ADMISSION','RECHECK')),
    tenant_id              uuid        NOT NULL,
    workspace_id           uuid,
    authenticated_principal_id uuid    NOT NULL,
    acting_principal_id    uuid        NOT NULL,
    action_key             text        NOT NULL,
    action_version         integer     NOT NULL,
    target_id              uuid        NOT NULL,
    parameter_hash         text        NOT NULL,
    scope_decision         admission.decision_outcome NOT NULL,
    authorization_decision admission.decision_outcome NOT NULL,
    delegation_decision    admission.decision_outcome NOT NULL,
    approval_decision      admission.decision_outcome NOT NULL,
    capacity_decision      admission.decision_outcome NOT NULL,
    quota_decision         admission.decision_outcome NOT NULL,
    audit_decision         admission.decision_outcome NOT NULL,
    -- SpiceDB CheckPermission 的 checkedAt；没有到达 Check 就被拒时为空
    zed_token              text,
    reason_code            text,
    decided_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_decision_by_execution ON admission.action_decision (action_execution_id, decided_at);

CREATE FUNCTION admission.reject_decision_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'admission.action_decision 是追加式准入事实，不接受 % 操作', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
-- 删除只在其 ActionExecution 被删除时级联发生（夹具清理）；更新一律拒绝
CREATE TRIGGER action_decision_append_only BEFORE UPDATE ON admission.action_decision
    FOR EACH ROW EXECUTE FUNCTION admission.reject_decision_mutation();

-- ---------------------------------------------------------------------------
-- WorkflowRef：一个 ActionExecution 可有一个 ApprovalWorkflow 与一个业务 Workflow
-- ---------------------------------------------------------------------------
-- Stage 1 的 UNIQUE (action_execution_id) 表达的是「至多一个业务 Workflow」。审批
-- 进入后同一 ActionExecution 还有它的 ApprovalWorkflow，因此按类型唯一。
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_ref_action_execution_id_key;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_ref_one_per_type
    UNIQUE (action_execution_id, workflow_type);

-- ---------------------------------------------------------------------------
-- ApprovalProjection：只由 Temporal history 投影（DD-47）
-- ---------------------------------------------------------------------------
-- 冻结字段（target、policy/version、参数摘要、角色要求）不在这里复制：它们是 Core
-- 在请求时写进 Workflow input 的同一份事实，读时由 ActionExecution 与 Catalog 的
-- 确切版本联出。这里只放 history 才知道的东西。
CREATE TABLE projection.approval_projection (
    workflow_id         text        PRIMARY KEY REFERENCES projection.workflow_ref (workflow_id) ON DELETE CASCADE,
    action_execution_id uuid        NOT NULL UNIQUE REFERENCES admission.action_execution (id) ON DELETE CASCADE,
    tenant_id           uuid        NOT NULL,
    run_id              text        NOT NULL,
    last_event_id       bigint      NOT NULL CHECK (last_event_id > 0),
    status              text        NOT NULL CONSTRAINT approval_status_enum CHECK (status IN
                            ('REQUESTED','WAITING','APPROVED','DENIED','EXPIRED','CANCELLED','CONSUMED','INVALIDATED')),
    -- [{approverPrincipalId, decision, decidedAt, satisfiedSelectors}]
    decisions           jsonb       NOT NULL,
    expires_at          timestamptz NOT NULL,
    consume_deadline    timestamptz,
    consumed_at         timestamptz,
    reason_code         text,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT approved_has_deadline CHECK (
        status NOT IN ('APPROVED','CONSUMED') OR consume_deadline IS NOT NULL
    )
);
CREATE INDEX approval_projection_open ON projection.approval_projection (tenant_id, status)
    WHERE status IN ('REQUESTED','WAITING','APPROVED');
