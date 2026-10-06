-- Never discard already-installed seed or audit history to make an older binary start.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.capability_contract WHERE origin='PLATFORM_SEED')
       OR EXISTS(SELECT 1 FROM catalog.capability_category WHERE origin='PLATFORM_SEED') THEN
        RAISE EXCEPTION 'capability seed rollback would discard immutable deployment evidence' USING ERRCODE='23514';
    END IF;
END $$;
CREATE OR REPLACE FUNCTION catalog.guard_capability_contract() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; expected_action text;
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.status<>'DRAFT' OR NEW.origin<>'CATALOG_REGISTERED' THEN
            RAISE EXCEPTION 'contract must be registered as DRAFT' USING ERRCODE='23514';
        END IF;
        source_id := NEW.registered_by_action_execution_id;
        expected_action := 'capability_contract.register';
    ELSE
        IF ROW(NEW.id,NEW.category_key,NEW.contract_version,NEW.catalog_tenant_id,NEW.content,
               NEW.schema_documents,NEW.test_vectors,NEW.schema_set_digest,NEW.conformance_suite_digest,
               NEW.origin,NEW.registered_by_action_execution_id)
           IS DISTINCT FROM ROW(OLD.id,OLD.category_key,OLD.contract_version,OLD.catalog_tenant_id,OLD.content,
               OLD.schema_documents,OLD.test_vectors,OLD.schema_set_digest,OLD.conformance_suite_digest,
               OLD.origin,OLD.registered_by_action_execution_id) THEN
            RAISE EXCEPTION 'registered contract content is immutable' USING ERRCODE='23514';
        END IF;
        IF OLD.status='DRAFT' AND NEW.status='ACTIVE'
           AND NEW.deprecated_by_action_execution_id IS NULL THEN
            source_id := NEW.approved_by_action_execution_id;
            expected_action := 'capability_contract.approve';
        ELSIF OLD.status='ACTIVE' AND NEW.status='DEPRECATED'
           AND NEW.approved_by_action_execution_id=OLD.approved_by_action_execution_id THEN
            source_id := NEW.deprecated_by_action_execution_id;
            expected_action := 'capability_contract.deprecate';
        ELSE
            RAISE EXCEPTION 'invalid capability contract transition' USING ERRCODE='23514';
        END IF;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM admission.action_execution ae
        JOIN identity.principal p ON p.id=ae.initiator_principal_id
        WHERE ae.id=source_id AND ae.action_key=expected_action
          AND ae.tenant_id=NEW.catalog_tenant_id AND ae.workspace_id IS NULL
          AND ae.target_id=NEW.id AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
          AND ae.parameters->'targetVersion'=to_jsonb(NEW.contract_version)
          AND p.tenant_id=ae.tenant_id AND p.kind='HUMAN'
          AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o WHERE o.catalog_tenant_id=ae.tenant_id)
    ) THEN
        RAISE EXCEPTION 'contract state requires original Catalog admission' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;

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

DROP FUNCTION catalog.valid_capability_seed_bootstrap(uuid,uuid,text,integer,uuid);
ALTER TABLE catalog.capability_category DROP COLUMN bootstrap_action_execution_id;
ALTER TABLE catalog.capability_contract
    DROP COLUMN bootstrap_action_execution_id,
    ALTER COLUMN registered_by_action_execution_id SET NOT NULL,
    DROP CONSTRAINT capability_contract_origin_check,
    DROP CONSTRAINT capability_contract_approval_source,
    ADD CONSTRAINT capability_contract_origin_check CHECK (origin='CATALOG_REGISTERED'),
    ADD CONSTRAINT capability_contract_check CHECK ((status='DRAFT')=(approved_by_action_execution_id IS NULL));
