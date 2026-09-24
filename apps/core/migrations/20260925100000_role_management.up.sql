-- 角色管理与部署引导（DD-82、.design/03 §5 的 RoleTemplate）。
--
-- 角色是 SpiceDB relationship，不是 Core 事实：本迁移不建任何「谁是 admin」的表。
-- 它只加三样东西——
--   1. RoleTemplate：角色名到固定 schema relation 集合的不可变版本（Catalog 数据）；
--   2. 四个同步写 SpiceDB 的角色动作及其审批策略；
--   3. ServicePrincipal 的最小实体面，供部署引导这一 SERVICE 发起方做审计归因。
--
-- 扩展一步：只加表、加可空列。旧版本 Core 不读新列，照常工作。

-- ---------------------------------------------------------------------------
-- RoleTemplate
-- ---------------------------------------------------------------------------
CREATE TABLE catalog.role_template (
    role_key    text        NOT NULL,
    version     integer     NOT NULL CHECK (version > 0),
    -- 角色只展开到同一 object type 上的关系：一次授予只落在一个对象上
    object_type text        NOT NULL CHECK (object_type IN ('tenant', 'workspace')),
    -- 取值只来自固定 schema（.design/03 §5）中该 object type 的主体为 principal 的 relation
    relations   text[]      NOT NULL CHECK (cardinality(relations) > 0),
    status      text        NOT NULL CONSTRAINT catalog_version_status_enum CHECK (status IN
                    ('ACTIVE','RETIRED')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_key, version),
    CONSTRAINT relations_in_fixed_schema CHECK (
        relations <@ ARRAY['member','admin','creator','auditor']::text[]
    )
);
CREATE UNIQUE INDEX role_template_one_active ON catalog.role_template (role_key) WHERE status = 'ACTIVE';
CREATE TRIGGER role_template_immutable BEFORE UPDATE OR DELETE ON catalog.role_template
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();

-- member 由成员生命周期投影，不是可授予的角色：角色模板不得展开出它
ALTER TABLE catalog.role_template
    ADD CONSTRAINT member_is_not_a_role CHECK (NOT ('member' = ANY (relations)));

INSERT INTO catalog.role_template (role_key, version, object_type, relations, status) VALUES
    ('TENANT_ADMIN', 1, 'tenant', ARRAY['admin'], 'ACTIVE'),
    ('WORKSPACE_ADMIN', 1, 'workspace', ARRAY['admin'], 'ACTIVE');

-- ---------------------------------------------------------------------------
-- 角色动作：ActionDefinition 引用确切版本的 RoleTemplate
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.action_definition
    ADD COLUMN role_template_key     text,
    ADD COLUMN role_template_version integer,
    ADD CONSTRAINT role_template_pair CHECK (
        (role_template_key IS NULL) = (role_template_version IS NULL)
    ),
    ADD FOREIGN KEY (role_template_key, role_template_version)
        REFERENCES catalog.role_template (role_key, version),
    -- 角色写入是一次同步的 SpiceDB 写：它不包装 Workflow（DD-09）
    ADD CONSTRAINT role_action_is_sync CHECK (
        role_template_key IS NULL OR execution_mode = 'SYNC'
    );

-- 撤 Tenant admin 需要另一位 Tenant admin 批准：它与撤 Tenant 成员同级——一人即可
-- 把其他管理员逐个移出，就等于一人接管整个 Tenant。授予不设审批：授予者自己已是
-- admin，授予不扩大他已有的权限；若授予也要另一位 admin 批准，只有一位 admin 的
-- Tenant 永远加不出第二位。
INSERT INTO catalog.approval_policy
    (id, version, action_key, target_type, role_requirements, owner_requirement, self_approval,
     expires_in_seconds, status)
VALUES
    ('0b7d6f3e-2c41-4f8a-9d15-5e6a7c8b9d02', 1, 'tenant.admin.revoke', 'TENANT_ROLE',
     '[{"selector":"TENANT_ADMIN","minDistinct":1}]', 'NONE', 'DENY', 259200, 'ACTIVE');

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status, role_template_key, role_template_version)
VALUES
    -- Tenant 级管理意图：TENANT_ONLY，检查 Tenant 的 manage（DD-54、DD-82）
    ('tenant.admin.grant', 1, 'core', 'TENANT_ROLE', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE',
     'TENANT_ADMIN', 1),
    ('tenant.admin.revoke', 1, 'core', 'TENANT_ROLE', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'APPROVAL', '0b7d6f3e-2c41-4f8a-9d15-5e6a7c8b9d02', 1, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE',
     'TENANT_ADMIN', 1),
    -- Workspace 角色：执行 Workspace 即目标 Workspace，检查其 manage（DD-46/50）
    ('workspace.admin.grant', 1, 'core', 'WORKSPACE_ROLE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE',
     'WORKSPACE_ADMIN', 1),
    ('workspace.admin.revoke', 1, 'core', 'WORKSPACE_ROLE', 'SESSION_TENANT', 'WORKSPACE_REQUIRED',
     'manage', 'workspace', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE',
     'WORKSPACE_ADMIN', 1);

-- ---------------------------------------------------------------------------
-- ServicePrincipal（.design/03 §2）：机器调用与审计归因
-- ---------------------------------------------------------------------------
-- 本迁移只为部署引导建它；component_binding_ref 两列随组件 binding 进入时使用。
CREATE TABLE identity.service_principal (
    principal_id           uuid PRIMARY KEY REFERENCES identity.principal (id),
    audience               text NOT NULL UNIQUE CHECK (audience <> ''),
    component_binding_kind text,
    component_binding_id   uuid,
    CONSTRAINT binding_ref_pair CHECK (
        (component_binding_kind IS NULL) = (component_binding_id IS NULL)
    )
);
