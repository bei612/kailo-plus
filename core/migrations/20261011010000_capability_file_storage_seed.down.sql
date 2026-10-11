-- Preserve immutable seed and its audit trail; never erase it to permit rollback.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM catalog.capability_category
              WHERE category_key='file_storage' AND origin='PLATFORM_SEED')
       OR EXISTS(SELECT 1 FROM catalog.capability_contract
                 WHERE category_key='file_storage' AND origin='PLATFORM_SEED') THEN
        RAISE EXCEPTION 'file-storage seed rollback would orphan immutable deployment evidence'
            USING ERRCODE='23514';
    END IF;
END $$;
CREATE OR REPLACE FUNCTION catalog.valid_capability_seed_bootstrap(source_id uuid, tenant uuid,
    category text, version integer, target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT $3 IN ('knowledge','data_query') AND $4=1 AND EXISTS (
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
