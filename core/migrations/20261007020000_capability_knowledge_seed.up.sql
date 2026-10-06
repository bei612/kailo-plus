-- DD-108: deployment-only, audited zero-to-one seed. No network action or human approval bypass.
ALTER TABLE catalog.capability_category
    ADD COLUMN bootstrap_action_execution_id uuid REFERENCES admission.action_execution(id),
    ADD CONSTRAINT capability_category_seed_source CHECK (
        (origin='PLATFORM_SEED')=(bootstrap_action_execution_id IS NOT NULL));
ALTER TABLE catalog.capability_contract
    ADD COLUMN bootstrap_action_execution_id uuid REFERENCES admission.action_execution(id),
    ALTER COLUMN registered_by_action_execution_id DROP NOT NULL,
    DROP CONSTRAINT capability_contract_origin_check,
    DROP CONSTRAINT capability_contract_check;
ALTER TABLE catalog.capability_contract
    ADD CONSTRAINT capability_contract_registration_source CHECK (
        (origin='PLATFORM_SEED' AND registered_by_action_execution_id IS NULL AND bootstrap_action_execution_id IS NOT NULL)
        OR (origin='CATALOG_REGISTERED' AND registered_by_action_execution_id IS NOT NULL AND bootstrap_action_execution_id IS NULL)),
    ADD CONSTRAINT capability_contract_origin_check CHECK (origin IN ('PLATFORM_SEED','CATALOG_REGISTERED')),
    ADD CONSTRAINT capability_contract_approval_source CHECK (
        (origin='PLATFORM_SEED' AND approved_by_action_execution_id IS NULL AND status<>'DRAFT')
        OR (origin='CATALOG_REGISTERED' AND ((status='DRAFT')=(approved_by_action_execution_id IS NULL))));

CREATE FUNCTION catalog.valid_capability_seed_bootstrap(source_id uuid, tenant uuid,
    category text, version integer, target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT $3='knowledge' AND $4=1 AND EXISTS (
        SELECT 1 FROM admission.action_execution ae
        JOIN identity.principal p ON p.id=ae.initiator_principal_id
        JOIN identity.service_principal sp ON sp.principal_id=p.id
        JOIN identity.tenant t ON t.id=p.tenant_id
        WHERE ae.id=$1 AND ae.action_key='capability_contract.bootstrap'
          AND ae.action_version=1 AND ae.tenant_id=$2 AND ae.workspace_id IS NULL
          AND ae.target_id=$5 AND ae.gate_state='ALLOWED' AND ae.dispatch_state='DISPATCHED'
          AND ae.actor_principal_id=p.id AND p.kind='SERVICE' AND p.status='ACTIVE'
          AND p.tenant_id=$2 AND sp.audience='platform-deployment-bootstrap'
          AND t.state IN ('PROVISIONING','ACTIVE')
          AND ae.parameters->>'categoryKey'=$3
          AND ae.parameters->'contractVersion'=to_jsonb($4)
          AND EXISTS (SELECT 1 FROM identity.relay_operator_identity o
                      WHERE o.catalog_tenant_id=$2 AND o.state='ACTIVE')
    );
$$;

CREATE OR REPLACE FUNCTION catalog.guard_capability_contract() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; expected_action text;
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.origin='PLATFORM_SEED' THEN
            IF NEW.status<>'ACTIVE' OR NEW.approved_by_action_execution_id IS NOT NULL
               OR NEW.deprecated_by_action_execution_id IS NOT NULL OR NOT
               catalog.valid_capability_seed_bootstrap(NEW.bootstrap_action_execution_id,
                   NEW.catalog_tenant_id,NEW.category_key,NEW.contract_version,NEW.id)
               OR NOT EXISTS (SELECT 1 FROM admission.action_execution ae
                  JOIN catalog.capability_category c ON c.bootstrap_action_execution_id=ae.id
                  WHERE ae.id=NEW.bootstrap_action_execution_id
                    AND c.category_key=NEW.category_key AND c.catalog_tenant_id=NEW.catalog_tenant_id
                    AND ae.parameters->>'schemaSetDigest'=NEW.schema_set_digest
                    AND ae.parameters->>'conformanceSuiteDigest'=NEW.conformance_suite_digest)
            THEN RAISE EXCEPTION 'seed contract requires exact deployment bootstrap' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END IF;
        IF NEW.status<>'DRAFT' OR NEW.origin<>'CATALOG_REGISTERED' THEN
            RAISE EXCEPTION 'contract must be registered as DRAFT' USING ERRCODE='23514';
        END IF;
        source_id := NEW.registered_by_action_execution_id;
        expected_action := 'capability_contract.register';
    ELSE
        IF ROW(NEW.id,NEW.category_key,NEW.contract_version,NEW.catalog_tenant_id,NEW.content,
               NEW.schema_documents,NEW.test_vectors,NEW.schema_set_digest,NEW.conformance_suite_digest,
               NEW.origin,NEW.registered_by_action_execution_id,NEW.bootstrap_action_execution_id)
           IS DISTINCT FROM ROW(OLD.id,OLD.category_key,OLD.contract_version,OLD.catalog_tenant_id,OLD.content,
               OLD.schema_documents,OLD.test_vectors,OLD.schema_set_digest,OLD.conformance_suite_digest,
               OLD.origin,OLD.registered_by_action_execution_id,OLD.bootstrap_action_execution_id) THEN
            RAISE EXCEPTION 'registered contract content is immutable' USING ERRCODE='23514';
        END IF;
        IF OLD.status='DRAFT' AND NEW.status='ACTIVE'
           AND NEW.deprecated_by_action_execution_id IS NULL THEN
            source_id := NEW.approved_by_action_execution_id;
            expected_action := 'capability_contract.approve';
        ELSIF OLD.status='ACTIVE' AND NEW.status='DEPRECATED'
           AND NEW.approved_by_action_execution_id IS NOT DISTINCT FROM OLD.approved_by_action_execution_id THEN
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
        IF NEW.origin='PLATFORM_SEED' THEN
            IF NEW.status<>'ACTIVE' OR NEW.registered_by_action_execution_id IS NOT NULL
               OR NEW.retired_by_action_execution_id IS NOT NULL OR NOT EXISTS (
                SELECT 1 FROM admission.action_execution ae
                WHERE ae.id=NEW.bootstrap_action_execution_id AND
                  catalog.valid_capability_seed_bootstrap(ae.id,NEW.catalog_tenant_id,
                    NEW.category_key,1,ae.target_id))
            THEN RAISE EXCEPTION 'seed category requires exact deployment bootstrap' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END IF;
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
           NEW.registered_by_action_execution_id,NEW.target_id,NEW.bootstrap_action_execution_id)
       IS DISTINCT FROM ROW(OLD.category_key,OLD.catalog_tenant_id,OLD.type_key_namespace,OLD.origin,
           OLD.registered_by_action_execution_id,OLD.target_id,OLD.bootstrap_action_execution_id) THEN
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
