-- DD-125(2)：原版社区审核经 Core 治理（05 §2.11，V-SCN-126..130）。
--
-- 七个动作键只接受 HUMAN 会话发起：SYNC、EXPLICIT、无审批、quota NONE、FULL_LIFECYCLE。
-- 原 Community owner/admin 对应 Tenant manage，原 Channel owner/admin 的删除对应
-- Workspace manage；举报只要求 active Tenant 成员（tenant discover）。9040–9044 与 9005
-- 由 Tenant CONTROL 签名，CONTROL 只是签名者，initiator 与 actor 是已准入的 HUMAN。
-- 踢出频道复用 workspace.member.revoke（DD-119），不另登记。
--
-- 扩展一步：只加 Catalog 行与发送前的事件引用表。旧版本 Core 没有这些 key 的语义，
-- 按 BLOCKED 拒绝。本次不登记它们的取消与重跑控制定义。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core',k.target_type,'SESSION_TENANT',k.workspace_rule,k.permission,k.object_type,'SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','IDS_ONLY','ACTIVE'
FROM (VALUES
 ('moderation.report.submit','TENANT','TENANT_ONLY','discover','tenant'),
 ('moderation.ban','PRINCIPAL','TENANT_ONLY','manage','tenant'),
 ('moderation.unban','PRINCIPAL','TENANT_ONLY','manage','tenant'),
 ('moderation.timeout','PRINCIPAL','TENANT_ONLY','manage','tenant'),
 ('moderation.untimeout','PRINCIPAL','TENANT_ONLY','manage','tenant'),
 ('moderation.report.resolve','TENANT','TENANT_ONLY','manage','tenant'),
 ('moderation.message.delete','WORKSPACE','WORKSPACE_REQUIRED','manage','workspace')
) k(action_key,target_type,workspace_rule,permission,object_type);

-- 举报（本人签 1984）与删除（CONTROL 签 9005）的唯一事件：签名后、发送前随 ALLOWED 与
-- DISPATCH 同事务落库（DD-81）。结果不明只按这里的事件 ID 只读查证——1984 读 Relay
-- 举报队列、9005 读事件——绝不重签重发。只存 ID 与签名时间：举报说明与消息正文不进 Core。
-- 状态型命令（9040–9044）不在此：冻结参数即目标状态，按 Relay 限制或举报状态回读。
CREATE TABLE admission.moderation_publication (
    action_execution_id uuid        PRIMARY KEY
        REFERENCES admission.action_execution (id) ON DELETE CASCADE,
    event_kind          integer     NOT NULL CHECK (event_kind IN (1984, 9005)),
    event_id            text        NOT NULL UNIQUE CHECK (event_id ~ '^[0-9a-f]{64}$'),
    signer_pubkey       text        NOT NULL CHECK (signer_pubkey ~ '^[0-9a-f]{64}$'),
    event_created_at    bigint      NOT NULL CHECK (event_created_at >= 0),
    outcome             text        CHECK (outcome IN ('VERIFIED', 'REJECTED', 'NOT_DELIVERED')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    settled_at          timestamptz,
    CHECK ((outcome IS NULL) = (settled_at IS NULL))
);
