-- Service delivery is a receipt on the original generation, not a model/key store.
ALTER TABLE projection.application_runtime ADD COLUMN model_delivery_receipt jsonb;
ALTER TABLE projection.application_runtime ADD CONSTRAINT application_model_delivered
 CHECK (model_state IS DISTINCT FROM 'ACTIVE' OR model_delivery_receipt IS NOT NULL) NOT VALID;

CREATE FUNCTION projection.guard_application_model_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER application_model_delivery_guard BEFORE INSERT OR UPDATE ON projection.application_runtime
 FOR EACH ROW EXECUTE FUNCTION projection.guard_application_model_delivery();
