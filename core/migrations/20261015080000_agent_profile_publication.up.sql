-- DD-117 / SF-BUZ-48：Agent kind:0 资料发布的外部副作用意图与结果（DD-81 纪律）。
-- 不保存资料正文，只保存签名事件 ID、内容摘要与归属；资料权威仍是 pinned
-- AgentVersion 的 personaIdentity 与 Relay 上的 kind:0。审计归属激活当前 generation 的
-- 原 agent.installation.create/upgrade operation，本表不是第二份审计或资料目录。
CREATE TABLE projection.agent_profile_publication(
 event_id text PRIMARY KEY CHECK(event_id ~ '^[0-9a-f]{64}$'),
 tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
 installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
 agent_pubkey text NOT NULL REFERENCES identity.buzz_identity_binding(pubkey),
 agent_version_asset_id uuid NOT NULL REFERENCES catalog.agent_version(asset_id),
 action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
 operation_id uuid NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 signed_at bigint NOT NULL CHECK(signed_at>0),
 state text NOT NULL CHECK(state IN ('DISPATCHED','ACCEPTED','REJECTED','NOT_DELIVERED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 CHECK((state='DISPATCHED')=(settled_at IS NULL))
);
-- 结果不明期间不另签：每个 Installation 至多一条 DISPATCHED。
CREATE UNIQUE INDEX agent_profile_publication_one_open
 ON projection.agent_profile_publication(installation_resource_id) WHERE state='DISPATCHED';
CREATE INDEX agent_profile_publication_latest
 ON projection.agent_profile_publication(installation_resource_id,signed_at DESC,created_at DESC);

CREATE FUNCTION projection.guard_agent_profile_publication() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['state','settled_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','settled_at'])
   OR OLD.state<>'DISPATCHED') THEN
  RAISE EXCEPTION 'Agent profile publication intent or settled result cannot be replaced' USING ERRCODE='check_violation';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM catalog.agent_installation i
  JOIN catalog.resource r ON r.id=i.resource_id AND r.tenant_id=NEW.tenant_id
  JOIN catalog.agent_memory_binding m ON m.installation_resource_id=i.resource_id
  JOIN identity.buzz_identity_binding b ON b.pubkey=m.agent_buzz_identity_binding_id
   AND b.tenant_id=NEW.tenant_id AND b.principal_id=i.agent_principal_id AND b.kind='AGENT'
   AND b.custody='SERVER' AND b.state='ACTIVE'
  JOIN admission.action_execution a ON a.id=NEW.action_execution_id AND a.operation_id=NEW.operation_id
   AND a.tenant_id=NEW.tenant_id AND a.workspace_id=i.workspace_id AND a.target_id=i.resource_id
   AND a.action_key IN ('agent.installation.create','agent.installation.upgrade')
   AND a.gate_state='ALLOWED' AND a.parameters->'params'->>'assetId'=NEW.agent_version_asset_id::text
  WHERE i.resource_id=NEW.installation_resource_id AND i.state='ACTIVE' AND r.state='ACTIVE'
   AND i.pinned_version_asset_id=NEW.agent_version_asset_id AND b.pubkey=NEW.agent_pubkey
   AND NEW.state='DISPATCHED';
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Agent profile publication lacks ACTIVE Installation, AGENT identity or admitting action' USING ERRCODE='check_violation';
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_profile_publication_guard BEFORE INSERT OR UPDATE ON projection.agent_profile_publication
 FOR EACH ROW EXECUTE FUNCTION projection.guard_agent_profile_publication();
