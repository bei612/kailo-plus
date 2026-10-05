DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.external_execution) THEN
        RAISE EXCEPTION 'external execution history exists; stop rollback' USING ERRCODE='23514';
    END IF;
END $$;
DROP TRIGGER application_binding_source ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_binding_source();
DROP TRIGGER application_external_execution_source ON admission.external_execution;
DROP FUNCTION admission.guard_application_external_execution();
DROP TABLE admission.external_execution;
ALTER TABLE projection.application_runtime DROP COLUMN validation_keys;
