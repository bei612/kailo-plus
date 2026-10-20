-- 恢复 20261005022000 的投递守卫。已存在的原生页面入口模型投影在旧守卫下无法
-- 再被吊销（其回执不是逐路由原生证明），因此存在时拒绝回退。
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM projection.application_runtime
    WHERE model_projection->>'deliveryMode'='NATIVE_PAGE') THEN
  RAISE EXCEPTION 'native page model facts prevent downgrade' USING ERRCODE='23514';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION projection.guard_application_model_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; challenge jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.model_delivery_receipt IS NOT NULL
    AND NEW.model_delivery_receipt IS DISTINCT FROM OLD.model_delivery_receipt THEN
  RAISE EXCEPTION 'application model delivery receipt is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.model_delivery_receipt IS NULL THEN RETURN NEW; END IF;
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
