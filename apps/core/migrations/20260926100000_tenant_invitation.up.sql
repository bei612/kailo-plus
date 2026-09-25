-- Tenant 成员邀请（DD-83，GAP-IDN-01 闭合）。
--
-- 扩展一步：只加一张表与三个 Catalog 定义。旧版本 Core 不读新表、目录里多出的
-- 定义在旧版本的语义表里没有对应项，按其既有规则回 CAPABILITY_BLOCKED，不会被
-- 误执行；没有被取代的旧列或旧读路径。

-- ---------------------------------------------------------------------------
-- TenantInvitation（.design/03 §2）
-- ---------------------------------------------------------------------------
-- 只存一次性凭据的摘要。明文凭据只在签发动作的首次回应里出现一次，不属于任何
-- 实体：库、日志、审计与 Workflow history 里都没有它。
--
-- 状态只存 ISSUED/REDEEMED/REVOKED。过期按查询时判定（DD-83）：expires_at 已过的
-- ISSUED 即过期，兑换与撤回都在同一条带时刻比较的 UPDATE 里判定，不设回收作业，
-- 于是也没有「作业落后时过期邀请仍可兑换」的窗口。约束因此不按 <枚举名>_enum
-- 命名：视图枚举 TenantInvitationStatus 多一个 EXPIRED，二者本来就不逐值相等。
CREATE TABLE identity.tenant_invitation (
    id                         uuid PRIMARY KEY,
    tenant_id                  uuid        NOT NULL REFERENCES identity.tenant (id),
    inviter_principal_id       uuid        NOT NULL REFERENCES identity.principal (id),
    -- 签发它的 ActionExecution（tenant.member.invite），其 target_id 即本行 id
    issue_action_execution_id  uuid        NOT NULL UNIQUE REFERENCES admission.action_execution (id),
    invitee_label              text        NOT NULL CHECK (btrim(invitee_label) <> ''),
    -- SHA-256(凭据) 的十六进制；兑换以它定位并加行锁
    credential_digest          text        NOT NULL UNIQUE CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
    expires_at                 timestamptz NOT NULL,
    state                      text        NOT NULL CONSTRAINT tenant_invitation_stored_state CHECK (state IN
                                   ('ISSUED','REDEEMED','REVOKED')),
    redeemed_human_identity_id uuid        REFERENCES identity.human_identity (id),
    tenant_membership_id       uuid        REFERENCES identity.tenant_membership (id),
    redeemed_at                timestamptz,
    -- 兑换同事务创建的 tenant.member.admit
    admit_action_execution_id  uuid        UNIQUE REFERENCES admission.action_execution (id),
    revoked_at                 timestamptz,
    version                    integer     NOT NULL DEFAULT 1,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    -- 兑换的四项事实同时出现、同时缺席：不存在「已兑换但不知道是谁」的邀请
    CONSTRAINT redeemed_is_complete CHECK (
        (state = 'REDEEMED') = (redeemed_human_identity_id IS NOT NULL AND tenant_membership_id IS NOT NULL
                                AND redeemed_at IS NOT NULL AND admit_action_execution_id IS NOT NULL)
    ),
    CONSTRAINT revoked_has_time CHECK ((state = 'REVOKED') = (revoked_at IS NOT NULL)),
    CONSTRAINT expires_after_issue CHECK (expires_at > created_at)
);
CREATE INDEX tenant_invitation_by_tenant ON identity.tenant_invitation (tenant_id, created_at DESC);
CREATE INDEX tenant_invitation_by_redeemer ON identity.tenant_invitation (redeemed_human_identity_id)
    WHERE redeemed_human_identity_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 三个动作（DD-83）
-- ---------------------------------------------------------------------------
-- tenant.member.admit 由兑换发起、以邀请人为发起者，确认「兑换者就是被邀请的人」：
-- 凭据持有即用、可被转发，兑换本身不能开通成员。需要一位 Tenant admin，允许邀请人
-- 本人确认——self_approval=DENY 会让只有一位 admin 的 Tenant 永远加不进第二个人，
-- 而邀请人本就持有 tenant manage，自己确认不扩大他已有的权限。
INSERT INTO catalog.approval_policy
    (id, version, action_key, target_type, role_requirements, owner_requirement, self_approval,
     expires_in_seconds, status)
VALUES
    ('3c9e7a41-5d2b-4f60-8e17-9a4b6c2d0e03', 1, 'tenant.member.admit', 'TENANT_MEMBERSHIP',
     '[{"selector":"TENANT_ADMIN","minDistinct":1}]', 'NONE', 'ALLOW', 259200, 'ACTIVE');

INSERT INTO catalog.action_definition
    (action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, execution_mode, confirmation_mode,
     approval_policy_id, approval_policy_version, workflow_type, workflow_kind,
     capacity_policy, capacity_pool_key, quota_policy, meters, result_exposure, audit_policy,
     obs_correlation_mode, obs_progress_source, obs_terminal_source, obs_usage_source,
     obs_cost_source, obs_redaction_policy, status)
VALUES
    -- 签发与撤回是 Core 内的一次写入，没有外部副作用：SYNC，结果即终态
    ('tenant.member.invite', 1, 'core', 'TENANT_INVITATION', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    ('tenant.member.invite.revoke', 1, 'core', 'TENANT_INVITATION', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'SYNC', 'NONE', NULL, NULL, NULL, NULL,
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'NONE', 'SYNC_RESULT', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE'),
    -- 开通走既有的成员生命周期 Workflow（.design/09 §4「新 Tenant member」）
    ('tenant.member.admit', 1, 'core', 'TENANT_MEMBERSHIP', 'SESSION_TENANT', 'TENANT_ONLY',
     'manage', 'tenant', 'TEMPORAL', 'APPROVAL', '3c9e7a41-5d2b-4f60-8e17-9a4b6c2d0e03', 1,
     'ComponentTaskWorkflow', 'MEMBERSHIP_PROJECTION',
     'NONE', NULL, 'NONE', '{}', 'NONE', 'FULL_LIFECYCLE',
     'OPERATION_REF', 'TEMPORAL', 'TEMPORAL', 'NONE', 'NONE', 'IDS_ONLY', 'ACTIVE');
