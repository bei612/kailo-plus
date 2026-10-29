-- DD-81/117/125: filtered absence never establishes a publication failure.
-- Keep immutable profile rows and audit history. This view is only the current
-- interpretation of those same facts, not another publication ledger.
CREATE VIEW projection.agent_profile_publication_effective AS
SELECT p.*,
 CASE WHEN p.state='NOT_DELIVERED' AND NOT EXISTS (
   SELECT 1 FROM audit.audit_event e
   WHERE e.event_key=p.action_execution_id::text||':installation:profile:'||p.event_id||':outcome'
     AND e.operation_id=p.operation_id AND e.tenant_id=p.tenant_id
     AND e.event_type='OUTCOME' AND e.result_code='NOT_DELIVERED'
 ) THEN CASE WHEN EXISTS (
   SELECT 1 FROM audit.audit_event e
   WHERE e.event_key=p.action_execution_id::text||':installation:profile:'||p.event_id||':reconciled-accepted'
     AND e.operation_id=p.operation_id AND e.tenant_id=p.tenant_id
     AND e.event_type='RECONCILIATION' AND e.result_code='ACCEPTED'
 ) THEN 'ACCEPTED' ELSE 'DISPATCHED' END ELSE p.state END AS effective_state
FROM projection.agent_profile_publication p;

-- The two one-shot governed actions have an identifiable historical producer:
-- only the old empty-query branch wrote DEPENDENCY_UNAVAILABLE after dispatch.
-- Genuine pre-admission refusal, rejection, 429/413 and positive results stay put.
CREATE TEMP TABLE dd81_false_terminal ON COMMIT DROP AS
SELECT a.id, i.event_id, 'CANVAS'::text AS source
FROM admission.action_execution a
JOIN admission.workspace_canvas_intent i ON i.action_execution_id=a.id
WHERE a.action_key='workspace.canvas.set' AND a.gate_state='ALLOWED'
  AND a.dispatch_state='ABORTED' AND a.reason_code='DEPENDENCY_UNAVAILABLE'
  AND i.tenant_id=a.tenant_id AND i.workspace_id=a.workspace_id
  AND i.outcome='NOT_WRITTEN' AND i.relay_ack='UNKNOWN'
  AND EXISTS (SELECT 1 FROM audit.audit_event e
    WHERE e.event_key='canvas-set:'||a.operation_id::text||':reconcile'
      AND e.operation_id=a.operation_id AND e.tenant_id=a.tenant_id
      AND e.event_type='RECONCILIATION' AND e.result_code='NOT_DELIVERED')
UNION ALL
SELECT a.id, p.event_id, 'MODERATION'::text
FROM admission.action_execution a
JOIN admission.moderation_publication p ON p.action_execution_id=a.id
WHERE ((a.action_key='moderation.report.submit' AND p.event_kind=1984)
    OR (a.action_key='moderation.message.delete' AND p.event_kind=9005))
  AND a.parent_action_execution_id IS NULL
  AND a.gate_state='ALLOWED' AND a.dispatch_state='ABORTED'
  AND a.reason_code='DEPENDENCY_UNAVAILABLE' AND p.outcome='NOT_DELIVERED'
  AND EXISTS (SELECT 1 FROM audit.audit_event e
    WHERE e.event_key=a.operation_id::text||':outcome'
      AND e.operation_id=a.operation_id AND e.tenant_id=a.tenant_id
      AND e.event_type='OUTCOME' AND e.decision='DENY'
      AND e.result_code='DEPENDENCY_UNAVAILABLE');

UPDATE admission.workspace_canvas_intent i SET outcome=NULL, settled_at=NULL
FROM dd81_false_terminal f WHERE f.source='CANVAS' AND i.action_execution_id=f.id;
UPDATE admission.moderation_publication p SET outcome=NULL, settled_at=NULL
FROM dd81_false_terminal f WHERE f.source='MODERATION' AND p.action_execution_id=f.id;
UPDATE admission.action_execution a
SET dispatch_state='UNKNOWN', reason_code=NULL, updated_at=now(), reconcile_last_attempt_at=NULL
FROM dd81_false_terminal f WHERE a.id=f.id;

INSERT INTO audit.audit_event
 (id,event_key,tenant_id,workspace_id,operation_id,event_type,initiator_principal_id,
  actor_principal_id,action_key,action_version,component_type_key,target_type,target_id,
  parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id)
SELECT gen_random_uuid(),'dd81:absence-unproven:'||a.id::text,a.tenant_id,a.workspace_id,
 a.operation_id,'RECONCILIATION',a.initiator_principal_id,a.actor_principal_id,
 a.action_key,a.action_version,'core',
 CASE WHEN a.action_key='moderation.report.submit' THEN 'TENANT' ELSE 'WORKSPACE' END,
 a.target_id,a.parameter_hash,'ALLOW','UNKNOWN','NONE',
 jsonb_build_array(jsonb_build_object('kind','BUZZ_EVENT_ID','value',f.event_id)),a.correlation_id
FROM dd81_false_terminal f JOIN admission.action_execution a ON a.id=f.id
ON CONFLICT (event_key) DO NOTHING;

-- Profiles can have several old false negatives: resetting all to DISPATCHED
-- would violate one_open. Preserve those rows, record the correction and use
-- effective_state in every candidate/claim/observation consumer instead.
INSERT INTO audit.audit_event
 (id,event_key,tenant_id,workspace_id,operation_id,event_type,initiator_principal_id,
  actor_principal_id,action_key,action_version,component_type_key,target_type,target_id,
  parameter_hash,decision,result_code,result_exposure,evidence_refs,correlation_id)
SELECT gen_random_uuid(),p.action_execution_id::text||':installation:profile:'||p.event_id||':absence-unproven',
 p.tenant_id,a.workspace_id,p.operation_id,'RECONCILIATION',a.initiator_principal_id,
 i.agent_principal_id,a.action_key,a.action_version,'core','RESOURCE',p.installation_resource_id,
 a.parameter_hash,'ALLOW','UNKNOWN','NONE',
 jsonb_build_array(jsonb_build_object('kind','BUZZ_EVENT_ID','value',p.event_id)),a.correlation_id
FROM projection.agent_profile_publication_effective p
JOIN admission.action_execution a ON a.id=p.action_execution_id AND a.operation_id=p.operation_id
JOIN catalog.agent_installation i ON i.resource_id=p.installation_resource_id
WHERE p.state='NOT_DELIVERED' AND p.effective_state='DISPATCHED'
ON CONFLICT (event_key) DO NOTHING;
