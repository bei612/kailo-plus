-- AuditEvent（.design/03 §9）。追加式审计事实，不授予 UPDATE/DELETE。
--
-- 字段是实体定义的子集：component binding、release、generation、approval 相关
-- 的引用还没有产出方，随各自能力进入时追加。
--
-- **这些 ID 列都不加外键**，这是有意的。审计要比它记录的对象活得久：`.design/07`
-- 规定恢复不得删除历史 Audit，那么审计就不能反过来卡住这些对象的删除。加了外键
-- 会得到一个死结——审计不可删，于是被审计的实体也永远删不掉。实测过：加了外键
-- 之后核验夹具的 Tenant 清理被静默挡住，库里攒下一堆删不掉的租户。
--
-- 代价是审计里的 ID 会指向已不存在的行。那正是审计该有的样子：它记的是当时
-- 发生过什么，不是现在还剩什么。

CREATE TABLE audit.audit_event (
    id                     uuid PRIMARY KEY,
    -- 同一 operation/阶段/native attempt 上稳定。唯一约束就是「重试不得复制同一
    -- 审计事实」的执行点——靠调用方自觉去重，第一次重试就会写出两条。
    event_key              text        NOT NULL UNIQUE,
    tenant_id              uuid,
    workspace_id           uuid,
    operation_id           uuid        NOT NULL,
    action_execution_id    uuid,
    event_type             text        NOT NULL CONSTRAINT audit_event_type_enum CHECK (event_type IN
                               ('AUTHENTICATION','SESSION','INTENT','DECISION','APPROVAL','DISPATCH',
                                'OUTCOME','REVOCATION','RECONCILIATION','ACCESS')),
    human_identity_id      uuid,
    -- 提出业务意图的人或服务
    initiator_principal_id uuid,
    -- 实际执行身份。用户委托 Agent 时两者不同；只记 Agent 会丢掉用户责任链
    actor_principal_id     uuid,
    action_key             text        NOT NULL,
    action_version         integer     NOT NULL,
    component_type_key     text        NOT NULL,
    target_type            text,
    target_id              uuid,
    parameter_hash         text        NOT NULL,
    decision               text        NOT NULL,
    result_code            text        NOT NULL,
    result_exposure        text        NOT NULL,
    -- 只保存源码权威中的稳定 ID、version/digest 与敏感级别；不保存原始 payload、
    -- 临时 URL、cookie、ActionToken、WOPI PAT、Nostr 私钥或 SecretRef locator
    evidence_refs          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    correlation_id         uuid        NOT NULL,
    occurred_at            timestamptz NOT NULL DEFAULT now(),

    -- 全部 Governed Action 的 AuditEvent 必有 tenant_id。为空只允许两种类型，
    -- 且仅限 OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的边界。
    CONSTRAINT tenant_required_except_auth_boundary CHECK (
        tenant_id IS NOT NULL OR event_type IN ('AUTHENTICATION', 'SESSION')
    ),
    -- 那段边界上没有 Principal 也没有业务 target，但必须能指回某个人：
    -- human_identity_id 或不可逆外部 subject hash 的 EvidenceRef 至少有一个。
    -- 否则就是一条谁也归属不到的审计记录（DD-52/54）。
    CONSTRAINT auth_boundary_has_no_principal CHECK (
        tenant_id IS NOT NULL
        OR (initiator_principal_id IS NULL AND actor_principal_id IS NULL
            AND target_id IS NULL
            AND (human_identity_id IS NOT NULL OR jsonb_array_length(evidence_refs) > 0))
    ),
    -- workspace 必须属于同一 tenant。跨 Tenant 的审计归属会让「按 Tenant 取证」
    -- 漏掉或多出记录，而审计恰恰是用来回答归属问题的
    CONSTRAINT workspace_matches_tenant CHECK (workspace_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX audit_event_by_tenant_time ON audit.audit_event (tenant_id, occurred_at DESC);
CREATE INDEX audit_event_by_operation ON audit.audit_event (operation_id);

-- 追加写入：UPDATE 与 DELETE 在库里直接**报错**，不是静默忽略。
--
-- 用触发器而不是 `RULE ... DO INSTEAD NOTHING`：后者让调用方收到「UPDATE 0」
-- 并当成成功，一个以为自己清理过审计的作业会一路安静地跑下去——那正是
-- 「成功但不可核验」。报错让这类调用当场暴露。
--
-- 也不只靠权限：迁移与应用共用同一个数据库角色，REVOKE 挡不住拥有者自己。
-- 触发器对任何角色、任何路径都生效，包括一次手滑的 psql。
CREATE FUNCTION audit.reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit.audit_event 是追加式审计事实，不接受 % 操作', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
    BEFORE UPDATE OR DELETE ON audit.audit_event
    FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
