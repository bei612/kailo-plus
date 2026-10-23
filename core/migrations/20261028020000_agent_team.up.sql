-- DD-131(1)(6)(8)、05 §2.12、03 §5/§7：原版 Agents 页的团队与目录分享。
-- 平台核心 ResourceType agent.team（Tenant 级、HUMAN owner、application_binding_id=NONE）与
-- AgentTeam 扩展；团队与定义的目录分享只写 discoverer/reader 的 tenant#member relationship。
-- 不新增运行时、Agent 注册权威或 Workflow kind；全部动作 SYNC、HUMAN-only、EXPLICIT、无审批。

-- 1. agent.team：与其他平台核心 ResourceType 同经 tenant.delete 销毁链删除（DD-99）。
--    TransferFormat buzz-team-snapshot@1 须同时绑定导出与导入两端（03 §4），随团队快照登记。
INSERT INTO catalog.resource_type_definition
 (type_key,capability_category,capability_contract_version,incremental_contracts,llm_gateway_contract,
  transfer_formats,tenant_delete_action_key,status)
VALUES ('agent.team',NULL,NULL,
 '[{"contract_key":"agent.team@v1","role":"NATIVE_INTERNAL","engine":"NATIVE","stable_key_rule":"catalog.resource.id","revision_rule":"catalog.resource.version","delete_semantics":"agent.team.delete writes the AgentTeam DELETED tombstone and removes its tenant#member grants; Tenant frozen inventory -> SpiceDB relationship deletion -> Core DELETED tombstone","reconciliation_trigger":"governance_reconcile resumes the same ActionExecution projection intent","readiness_semantics":"Resource ACTIVE with no pending projection; FullyConsistent SpiceDB relationships match Tenant and HUMAN owner"}]',
 'NOT_USED','[]','tenant.delete','ACTIVE');

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','skill.definition',
   'mcp.connection','agent.team'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','skill.definition','agent.team') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR
  type_key IN ('llm_route','tool.definition','mcp.connection'));

-- 2. AgentTeam（03 §7）：名称、说明与有序去重成员（同 Tenant AgentDefinition 引用，≤64）。
--    不含原版团队 instructions；DELETED 是墓碑，不级联删除成员。
CREATE TABLE catalog.agent_team (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    name text NOT NULL CHECK (btrim(name) <> '' AND name = btrim(name) AND char_length(name) <= 200),
    description text CHECK (description IS NULL OR (btrim(description) <> '' AND description = btrim(description)
        AND char_length(description) <= 2000)),
    member_agent_resource_ids uuid[] NOT NULL CHECK (cardinality(member_agent_resource_ids) <= 64
        AND array_position(member_agent_resource_ids, NULL) IS NULL),
    state text NOT NULL CONSTRAINT agent_team_state_enum CHECK (state IN ('ACTIVE','DELETED'))
);
CREATE FUNCTION catalog.guard_agent_team() RETURNS trigger AS $$
DECLARE team_tenant uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
        RAISE EXCEPTION 'AgentTeam 的 Resource 不可替换' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.state = 'DELETED' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION '已删除的 AgentTeam 是墓碑，不可改写' USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.tenant_id INTO team_tenant FROM catalog.resource r
    WHERE r.id = NEW.resource_id AND r.type_key = 'agent.team' AND r.home_workspace_id IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AgentTeam 必须扩展 Tenant 级 agent.team Resource' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT count(DISTINCT m) FROM unnest(NEW.member_agent_resource_ids) m)
        <> cardinality(NEW.member_agent_resource_ids) THEN
        RAISE EXCEPTION 'AgentTeam 成员不得重复' USING ERRCODE = 'check_violation';
    END IF;
    -- 只在成员集合变化时核对引用：成员 Definition 之后被删除不改写团队（03 §7）。
    IF (TG_OP = 'INSERT' OR NEW.member_agent_resource_ids IS DISTINCT FROM OLD.member_agent_resource_ids)
        AND EXISTS (SELECT 1 FROM unnest(NEW.member_agent_resource_ids) m
               WHERE NOT EXISTS (SELECT 1 FROM catalog.resource d
                   JOIN catalog.agent_definition a ON a.resource_id = d.id
                   WHERE d.id = m AND d.tenant_id = team_tenant AND d.type_key = 'agent.definition')) THEN
        RAISE EXCEPTION 'AgentTeam 成员必须是同 Tenant 的 AgentDefinition' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_team_guard BEFORE INSERT OR UPDATE ON catalog.agent_team
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_agent_team();

-- 3. 05 §2.12 的唯一 ActionDefinition 策略：TENANT_ONLY、SYNC、EXPLICIT、无审批，quota NONE、
--    meters 空、ResultExposure NONE、FULL_LIFECYCLE。分享不授予任何 Installation 使用权（05 §2.10）。
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT k.action_key,1,'core','RESOURCE','SESSION_TENANT','TENANT_ONLY',k.permission,k.object_type,'SYNC',
 'EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('agent.team.create','create','tenant'),
             ('agent.team.update','update','resource'),
             ('agent.team.delete','manage','resource'),
             ('agent.team.share','share','resource'),
             ('agent.team.unshare','share','resource'),
             ('agent.definition.share','share','resource'),
             ('agent.definition.unshare','share','resource')) k(action_key,permission,object_type);
