-- DD-102 / 03 §3 / 05 §2.8：运行时 Catalog 内容固定，不是业务 Resource。
CREATE TABLE catalog.capability_category (
    category_key text PRIMARY KEY,
    catalog_tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    type_key_namespace text NOT NULL UNIQUE,
    origin text NOT NULL CHECK (origin IN ('PLATFORM_SEED','CATALOG_REGISTERED')),
    registered_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
    CHECK (category_key ~ '^[a-z][a-z0-9_]*$' AND type_key_namespace=category_key),
    CHECK (category_key <> 'component'),
    CHECK ((origin='CATALOG_REGISTERED') = (registered_by_action_execution_id IS NOT NULL)),
    UNIQUE (category_key,catalog_tenant_id)
);
CREATE TABLE catalog.capability_contract (
    id uuid PRIMARY KEY,
    category_key text NOT NULL,
    contract_version integer NOT NULL CHECK (contract_version>0),
    catalog_tenant_id uuid NOT NULL,
    content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
    schema_documents jsonb NOT NULL CHECK (jsonb_typeof(schema_documents)='array' AND jsonb_array_length(schema_documents)>0),
    test_vectors jsonb NOT NULL CHECK (jsonb_typeof(test_vectors)='array' AND jsonb_array_length(test_vectors)>0),
    schema_set_digest text NOT NULL CHECK (schema_set_digest ~ '^[0-9a-f]{64}$'),
    conformance_suite_digest text NOT NULL CHECK (conformance_suite_digest ~ '^[0-9a-f]{64}$'),
    origin text NOT NULL CHECK (origin='CATALOG_REGISTERED'),
    registered_by_action_execution_id uuid NOT NULL REFERENCES admission.action_execution(id),
    approved_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    deprecated_by_action_execution_id uuid REFERENCES admission.action_execution(id),
    status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','DEPRECATED','RETIRED')),
    UNIQUE (category_key,contract_version),
    FOREIGN KEY (category_key,catalog_tenant_id) REFERENCES catalog.capability_category(category_key,catalog_tenant_id),
    CHECK ((status='DRAFT') = (approved_by_action_execution_id IS NULL)),
    CHECK ((status IN ('DEPRECATED','RETIRED')) = (deprecated_by_action_execution_id IS NOT NULL))
);

-- 状态与原准入的真实 source 同事务关联；变更状态不改变已固定契约内容。
CREATE FUNCTION catalog.guard_capability_contract() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER capability_contract_source BEFORE INSERT OR UPDATE ON catalog.capability_contract
FOR EACH ROW EXECUTE FUNCTION catalog.guard_capability_contract();

CREATE FUNCTION catalog.guard_capability_category() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER capability_category_source BEFORE INSERT OR UPDATE ON catalog.capability_category
FOR EACH ROW EXECUTE FUNCTION catalog.guard_capability_category();

INSERT INTO catalog.approval_policy
 (id,version,action_key,target_type,role_requirements,owner_requirement,self_approval,expires_in_seconds,status)
VALUES ('4c0c8a5f-d70b-541d-a6af-65a0c84cbbab',1,'capability_contract.approve','CAPABILITY_CONTRACT',
 '[{"selector":"TENANT_ADMIN","minDistinct":1}]','NONE','DENY',259200,'ACTIVE');
INSERT INTO catalog.action_definition
 (action_key,version,component_type_key,target_type,tenant_rule,workspace_rule,
 permission,permission_object_type,execution_mode,confirmation_mode,approval_policy_id,approval_policy_version,
 workflow_type,workflow_kind,capacity_policy,capacity_pool_key,quota_policy,meters,result_exposure,audit_policy,
 obs_correlation_mode,obs_progress_source,obs_terminal_source,obs_usage_source,obs_cost_source,obs_redaction_policy,status)
SELECT action_key,1,'core','CAPABILITY_CONTRACT','SESSION_TENANT','TENANT_ONLY','manage','tenant','SYNC',
 CASE WHEN action_key='capability_contract.approve' THEN 'APPROVAL' ELSE 'EXPLICIT' END,
 CASE WHEN action_key='capability_contract.approve' THEN '4c0c8a5f-d70b-541d-a6af-65a0c84cbbab'::uuid ELSE NULL END,
 CASE WHEN action_key='capability_contract.approve' THEN 1 ELSE NULL END,
 NULL,NULL,'NONE',NULL,'NONE','{}'::text[],'NONE','FULL_LIFECYCLE',
 'OPERATION_REF','NONE','SYNC_RESULT','NONE','NONE','PLATFORM_METADATA_ONLY','ACTIVE'
FROM (VALUES ('capability_contract.register'),('capability_contract.approve'),('capability_contract.deprecate')) a(action_key);
