DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM projection.application_runtime WHERE model_delivery_receipt IS NOT NULL
    OR model_projection ? 'serviceSecretRef') THEN
  RAISE EXCEPTION 'application model delivery facts prevent downgrade' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER application_model_delivery_guard ON projection.application_runtime;
DROP FUNCTION projection.guard_application_model_delivery();
ALTER TABLE projection.application_runtime DROP CONSTRAINT application_model_delivered;
ALTER TABLE projection.application_runtime DROP COLUMN model_delivery_receipt;
