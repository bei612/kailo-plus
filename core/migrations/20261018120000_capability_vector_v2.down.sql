-- Keep immutable Catalog evidence: stop rather than erase a V2 contract or a
-- deprecated DRAFT that the previous Core cannot represent.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.capability_contract
               WHERE test_vectors->>'formatVersion'<>'V1'
                  OR (origin='CATALOG_REGISTERED' AND status='DEPRECATED'
                      AND approved_by_action_execution_id IS NULL)) THEN
        RAISE EXCEPTION 'capability vector V2 rollback would discard immutable Catalog evidence'
            USING ERRCODE='23514';
    END IF;
END $$;
ALTER TABLE catalog.capability_contract
    DROP CONSTRAINT capability_contract_approval_source;
ALTER TABLE catalog.capability_contract
    ADD CONSTRAINT capability_contract_approval_source CHECK (
        (origin='PLATFORM_SEED' AND approved_by_action_execution_id IS NULL AND status<>'DRAFT')
        OR (origin='CATALOG_REGISTERED' AND ((status='DRAFT')=(approved_by_action_execution_id IS NULL))));
ALTER TABLE catalog.capability_contract
    DROP CONSTRAINT capability_contract_test_vectors_check;
ALTER TABLE catalog.capability_contract
    ADD CONSTRAINT capability_contract_test_vectors_check CHECK ((
        jsonb_typeof(test_vectors)='object'
        AND test_vectors->>'formatVersion'='V1'
        AND jsonb_typeof(test_vectors->'cases')='array'
        AND jsonb_array_length(test_vectors->'cases')>0
    ) IS TRUE);

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
