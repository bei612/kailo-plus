-- DD-102 / 05 §2.8. Requires the actual ApplicationBinding migration 010000.
-- The natural key remains category_key; target_id is only its stable AE locator.
DO $$ BEGIN
    IF to_regclass('catalog.application_binding') IS NULL THEN
        RAISE EXCEPTION 'category retirement requires ApplicationBinding schema';
    END IF;
END $$;
ALTER TABLE catalog.capability_category
    ADD COLUMN target_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    ADD COLUMN retired_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    ADD CONSTRAINT capability_category_retirement_source
        CHECK ((status='RETIRED') = (retired_by_action_execution_id IS NOT NULL));

-- This one actual predicate is consumed by target admission, directory facts,
-- the conditional write and the independent DB transition guard.
CREATE FUNCTION catalog.capability_category_has_binding(category text)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM catalog.application_binding b,
            jsonb_array_elements(b.capability_categories) entry
        WHERE b.state<>'DISABLED' AND entry->>'category'=category
    );
$$;

CREATE OR REPLACE FUNCTION catalog.guard_capability_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.origin<>'CATALOG_REGISTERED' OR NEW.status<>'DRAFT'
           OR NEW.retired_by_action_execution_id IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM admission.action_execution ae
            WHERE ae.id=NEW.registered_by_action_execution_id AND ae.tenant_id=NEW.catalog_tenant_id
              AND ae.action_key='capability_contract.register' AND ae.gate_state='ALLOWED'
              AND ae.dispatch_state='DISPATCHED' AND ae.workspace_id IS NULL
              AND ae.parameters#>>'{params,capabilityContractRegistration,categoryKey}'=NEW.category_key
        ) THEN RAISE EXCEPTION 'category requires Catalog registration' USING ERRCODE='23514'; END IF;
        RETURN NEW;
    END IF;
    -- Binding writers lock categories in key order and touch the same row with
    -- category_key=category_key. No domain field changes, but a stale RR snapshot
    -- must fail 40001 rather than miss a newly committed binding after lock wait.
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    IF ROW(NEW.category_key,NEW.catalog_tenant_id,NEW.type_key_namespace,NEW.origin,
           NEW.registered_by_action_execution_id,NEW.target_id)
       IS DISTINCT FROM ROW(OLD.category_key,OLD.catalog_tenant_id,OLD.type_key_namespace,OLD.origin,
           OLD.registered_by_action_execution_id,OLD.target_id) THEN
        RAISE EXCEPTION 'capability category identity is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status='DRAFT' AND NEW.status='ACTIVE'
       AND NEW.retired_by_action_execution_id IS NULL AND EXISTS (
        SELECT 1 FROM catalog.capability_contract c WHERE c.category_key=NEW.category_key
          AND c.catalog_tenant_id=NEW.catalog_tenant_id AND c.status='ACTIVE'
    ) THEN RETURN NEW; END IF;
    IF OLD.status IN ('DRAFT','ACTIVE') AND NEW.status='RETIRED'
       AND OLD.retired_by_action_execution_id IS NULL
       AND NOT catalog.capability_category_has_binding(NEW.category_key)
       AND EXISTS (
        SELECT 1 FROM admission.action_execution ae
        JOIN identity.principal p ON p.id=ae.initiator_principal_id
        JOIN identity.tenant t ON t.id=ae.tenant_id
        JOIN identity.tenant_membership tm ON tm.tenant_id=ae.tenant_id AND tm.tenant_principal_id=p.id
        WHERE ae.id=NEW.retired_by_action_execution_id AND ae.action_key='capability_category.retire'
          AND ae.tenant_id=NEW.catalog_tenant_id AND ae.workspace_id IS NULL AND ae.target_id=NEW.target_id
          AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
          AND ae.parameters->'targetVersion'='0'::jsonb
          AND ae.parameters#>>'{params,capabilityCategoryKey}'=NEW.category_key
          AND ae.parameters#>'{params,explicitConfirmation}'='true'::jsonb
          AND p.tenant_id=ae.tenant_id AND p.kind='HUMAN' AND p.status='ACTIVE'
          AND t.state='ACTIVE' AND tm.state='ACTIVE'
          AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o WHERE o.catalog_tenant_id=ae.tenant_id)
    ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'invalid capability category transition or binding reference' USING ERRCODE='23514';
END $$;

INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
VALUES ('capability_category.retire',1,'core','CAPABILITY_CATEGORY','SESSION_TENANT','TENANT_ONLY',
 'manage','tenant','SYNC','EXPLICIT',NULL,NULL,NULL,NULL,'NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE');
