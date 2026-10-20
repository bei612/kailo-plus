-- DD-128（07 §6.2/§8.3、03 §3）：原生页面入口 binding 选定 PLATFORM_LLM_ROUTE 时，
-- 激活回执是 Core 以该 generation 的 key 完成的模型发现与原生 key 身份，不是原生
-- 加载证明；reader 是由 binding 身份派生的部署侧 OpenBao 角色。带 adapter 的 release
-- 仍按 20261005022000 的原生证明逐路由核验，条件逐字不变。不改写任何存量行。
CREATE OR REPLACE FUNCTION projection.guard_application_model_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; challenge jsonb; page boolean;
BEGIN
 IF TG_OP='UPDATE' AND OLD.model_delivery_receipt IS NOT NULL
    AND NEW.model_delivery_receipt IS DISTINCT FROM OLD.model_delivery_receipt THEN
  RAISE EXCEPTION 'application model delivery receipt is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.model_delivery_receipt IS NULL THEN RETURN NEW; END IF;
 SELECT r.manifest->'executionConnector'->>'mode'='NONE' AND r.manifest->'implements'='[]'::jsonb
        AND r.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'
   INTO page FROM catalog.component_release r WHERE r.id=NEW.component_release_id;
 IF coalesce(page,false) THEN
  -- DD-128(4)(5): the activation evidence is Core's discovery with this exact
  -- native key; the reader is the binding's own deployment role, never the
  -- Core reader, and no native challenge or proof exists for a page entry.
  IF NEW.model_delivery_receipt IS DISTINCT FROM jsonb_build_object(
       'deliveryMode','NATIVE_PAGE','verification','GATEWAY_MODEL_DISCOVERY',
       'bindingId',NEW.binding_id,'generation',NEW.generation,
       'gatewayPrincipalId',NEW.model_projection->'gatewayPrincipalId',
       'nativeModels',NEW.model_projection->'nativeModels',
       'nativeKeyId',NEW.model_native_key_id,'nativeKeyRevision',NEW.model_native_key_revision)
     OR NEW.model_native_key_id IS NULL
     OR NEW.model_projection->>'deliveryMode' IS DISTINCT FROM 'NATIVE_PAGE'
     OR NEW.model_projection->'deliveryChallenges' IS DISTINCT FROM '[]'::jsonb
     OR jsonb_typeof(NEW.model_projection->'nativeModels') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.model_projection->'nativeModels')
        IS DISTINCT FROM jsonb_array_length(NEW.model_projection->'routeResourceIds')
     OR NOT EXISTS(SELECT 1 FROM catalog.application_binding b
       JOIN identity.service_principal s ON s.principal_id=b.service_principal_id
       WHERE b.id=NEW.binding_id AND s.component_binding_kind='APPLICATION'
         AND s.component_binding_id=b.id
         AND NEW.model_projection->'secretReader'->>'servicePrincipalId'=s.principal_id::text
         AND NEW.model_projection->'secretReader'->>'roleName'='application-model-'||replace(b.id::text,'-','')
         AND NEW.model_projection->'secretReader'->>'audience'=NEW.model_projection->'secretReader'->>'roleName'
         AND NEW.model_projection->'serviceSecretRef'->>'audience'=
             NEW.model_projection->'secretReader'->>'audience'
         AND NEW.model_projection->'serviceSecretRef'->>'audience'<>
             NEW.model_projection->'secretRef'->>'audience'
         AND NEW.model_projection->'serviceSecretRef'->'locator'=
             NEW.model_projection->'secretRef'->'locator'
         AND NEW.model_projection->'serviceSecretRef'->'version'=
             NEW.model_projection->'secretRef'->'version') THEN
   RAISE EXCEPTION 'native page model activation differs from frozen generation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.model_projection ? 'deliveryMode' THEN
  RAISE EXCEPTION 'native page model delivery on an adapter release' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(NEW.model_delivery_receipt) IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW.model_projection->'deliveryChallenges') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.model_delivery_receipt)=0
    OR jsonb_array_length(NEW.model_delivery_receipt) IS DISTINCT FROM
       jsonb_array_length(NEW.model_projection->'routeResourceIds')
    OR jsonb_array_length(NEW.model_delivery_receipt) IS DISTINCT FROM
       jsonb_array_length(NEW.model_projection->'deliveryChallenges')
    OR NOT EXISTS(SELECT 1 FROM catalog.application_binding b
       JOIN identity.service_principal s ON s.principal_id=b.service_principal_id
       WHERE b.id=NEW.binding_id AND s.component_binding_kind='APPLICATION'
         AND s.component_binding_id=b.id
         AND NEW.model_projection->'serviceSecretRef'->>'audience'=s.audience
         AND NEW.model_projection->'secretReader'->>'audience'=s.audience
         AND NEW.model_projection->'secretReader'->>'servicePrincipalId'=s.principal_id::text
         AND NEW.model_projection->'serviceSecretRef'->>'audience'<>
             NEW.model_projection->'secretRef'->>'audience'
         AND NEW.model_projection->'serviceSecretRef'->'locator'=
             NEW.model_projection->'secretRef'->'locator'
         AND NEW.model_projection->'serviceSecretRef'->'version'=
             NEW.model_projection->'secretRef'->'version') THEN
  RAISE EXCEPTION 'application model delivery lacks exact service reference' USING ERRCODE='23514';
 END IF;
 FOR challenge IN SELECT value FROM jsonb_array_elements(NEW.model_projection->'deliveryChallenges') LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(NEW.model_delivery_receipt) r
      WHERE r->'routeResourceId'=challenge->'routeResourceId')<>1
     OR NOT (NEW.model_projection->'routeResourceIds' @> jsonb_build_array(challenge->'routeResourceId')) THEN
   RAISE EXCEPTION 'application model route delivery is incomplete' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF (SELECT count(DISTINCT r->>'nativeModelRef') FROM jsonb_array_elements(NEW.model_delivery_receipt) r)
       <>jsonb_array_length(NEW.model_delivery_receipt) THEN
  RAISE EXCEPTION 'application model delivery aliases native models' USING ERRCODE='23514';
 END IF;
 FOR receipt IN SELECT value FROM jsonb_array_elements(NEW.model_delivery_receipt) LOOP
  IF receipt->>'bindingId' IS DISTINCT FROM NEW.binding_id::text
     OR receipt->'generation' IS DISTINCT FROM to_jsonb(NEW.generation)
     OR receipt->'configDigest' IS DISTINCT FROM NEW.model_projection->'configDigest'
     OR receipt->'servicePrincipalId' IS DISTINCT FROM NEW.model_projection->'gatewayPrincipalId'
     OR receipt->'nativeScopeRef' IS DISTINCT FROM NEW.model_projection->'nativeScopeRef'
     OR receipt->'secretRef' IS DISTINCT FROM NEW.model_projection->'serviceSecretRef'
     OR coalesce(receipt->>'nativeModelRef','')=''
     OR coalesce(receipt->>'requestId','') !~ '^[0-9a-f-]{36}$'
     OR coalesce(receipt->>'nativeProof','') !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.model_projection->'deliveryChallenges') c
       WHERE c->'routeResourceId'=receipt->'routeResourceId'
         AND c->'verificationNonce'=receipt->'verificationNonce'
         AND c->>'verificationNonce' ~ '^[0-9a-f]{64}$') THEN
   RAISE EXCEPTION 'application model delivery differs from frozen generation' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
