-- REQ-24: governance references only; original Relay owns DM channels and content.
CREATE TABLE projection.conversation_buzz_binding (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    channel_id uuid NOT NULL UNIQUE,
    participant_principal_ids uuid[] NOT NULL,
    creator_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    creator_pubkey text NOT NULL REFERENCES identity.buzz_identity_binding(pubkey),
    operation_id uuid NOT NULL,
    projection_generation bigint NOT NULL DEFAULT 1 CHECK (projection_generation > 0),
    projected_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(projected_keys) = 'array'),
    state text NOT NULL CHECK (state IN ('PROVISIONING','RECONCILING','ACTIVE','DISABLED')),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, participant_principal_ids),
    CHECK (cardinality(participant_principal_ids) BETWEEN 2 AND 9),
    CHECK (creator_principal_id = ANY(participant_principal_ids))
);
CREATE INDEX conversation_buzz_participants ON projection.conversation_buzz_binding
    USING gin(participant_principal_ids);

ALTER TABLE catalog.action_definition DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE catalog.action_definition ADD CONSTRAINT workflow_kind_enum CHECK (workflow_kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','COMPONENT_ACTION','CONVERSATION_PROJECTION'));
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION','PROTOCOL_SESSION_RECONCILE','COMPONENT_ACTION','CONVERSATION_PROJECTION'));

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,permission,permission_object_type,
 execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,workflow_type,workflow_kind,
 capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,obs_correlation_mode,
 obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('conversation.open',1,'core','CONVERSATION','SESSION_TENANT','TENANT_ONLY','discover','tenant',
 'TEMPORAL','NONE',NULL,NULL,'ComponentTaskWorkflow','CONVERSATION_PROJECTION',
 'NONE',NULL,'NONE','{}','NONE','FULL_LIFECYCLE','OPERATION_REF','TEMPORAL','TEMPORAL','NONE','NONE','IDS_ONLY','ACTIVE');
