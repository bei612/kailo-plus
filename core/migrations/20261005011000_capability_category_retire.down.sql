-- Stop instead of deleting retirements, admissions, or historical binding data.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.capability_category WHERE status='RETIRED')
       OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='capability_category.retire')
       OR EXISTS (SELECT 1 FROM catalog.application_binding) THEN
        RAISE EXCEPTION 'cannot remove category retirement with admissions, retirements or ApplicationBindings';
    END IF;
END $$;
DELETE FROM catalog.action_definition WHERE action_key='capability_category.retire';
CREATE OR REPLACE FUNCTION catalog.guard_capability_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.origin<>'CATALOG_REGISTERED' OR NEW.status<>'DRAFT' OR NOT EXISTS (
            SELECT 1 FROM admission.action_execution ae
            WHERE ae.id=NEW.registered_by_action_execution_id AND ae.tenant_id=NEW.catalog_tenant_id
              AND ae.action_key='capability_contract.register' AND ae.gate_state='ALLOWED'
              AND ae.dispatch_state='DISPATCHED' AND ae.workspace_id IS NULL
              AND ae.parameters#>>'{params,capabilityContractRegistration,categoryKey}'=NEW.category_key
        ) THEN RAISE EXCEPTION 'category requires Catalog registration' USING ERRCODE='23514'; END IF;
    ELSE
        IF ROW(NEW.category_key,NEW.catalog_tenant_id,NEW.type_key_namespace,NEW.origin,NEW.registered_by_action_execution_id)
          IS DISTINCT FROM ROW(OLD.category_key,OLD.catalog_tenant_id,OLD.type_key_namespace,OLD.origin,OLD.registered_by_action_execution_id)
          OR OLD.status<>'DRAFT' OR NEW.status<>'ACTIVE' OR NOT EXISTS (
            SELECT 1 FROM catalog.capability_contract c WHERE c.category_key=NEW.category_key
              AND c.catalog_tenant_id=NEW.catalog_tenant_id AND c.status='ACTIVE'
        ) THEN RAISE EXCEPTION 'invalid capability category transition' USING ERRCODE='23514'; END IF;
    END IF;
    RETURN NEW;
END $$;
DROP FUNCTION catalog.capability_category_has_binding(text);
ALTER TABLE catalog.capability_category
    DROP CONSTRAINT capability_category_retirement_source,
    DROP COLUMN retired_by_action_execution_id,
    DROP COLUMN target_id;
