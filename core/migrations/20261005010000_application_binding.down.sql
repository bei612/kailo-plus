-- A live or disabled binding is authoritative audit history, not disposable seed.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.application_binding)
       OR EXISTS (SELECT 1 FROM projection.application_runtime)
       OR EXISTS (SELECT 1 FROM projection.application_category) THEN
        RAISE EXCEPTION 'application binding facts exist; stop rollback' USING ERRCODE='23514';
    END IF;
END $$;
DROP TABLE projection.application_category;
ALTER TABLE catalog.application_binding DROP CONSTRAINT application_binding_active_generation;
DROP TABLE projection.application_runtime;
DROP TRIGGER application_binding_categories ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_binding_categories();
DROP TABLE catalog.application_binding;
