DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.result_exposure_policy WHERE application_binding_id IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove immutable HUMAN exposure ownership while policies exist';
    END IF;
END $$;
DROP TRIGGER application_human_exposure_owner ON catalog.result_exposure_policy;
DROP FUNCTION catalog.guard_application_human_exposure();
ALTER TABLE catalog.result_exposure_policy
    DROP CONSTRAINT application_human_exposure_action,
    DROP CONSTRAINT application_human_exposure_generation,
    DROP CONSTRAINT application_human_exposure_tenant,
    DROP CONSTRAINT application_human_exposure_owner,
    DROP COLUMN application_binding_id,
    DROP COLUMN application_projection_generation,
    DROP COLUMN component_release_id,
    DROP COLUMN action_key,
    DROP COLUMN action_version;
