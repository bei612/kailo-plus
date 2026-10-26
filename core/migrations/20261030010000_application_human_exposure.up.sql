-- HUMAN component actions consume the approved release's maximum exposure.
-- Ownership stays in the existing policy table, fixed to the original binding
-- projection; no new policy registry or authorization service is introduced.
ALTER TABLE catalog.result_exposure_policy
    ADD COLUMN application_binding_id uuid,
    ADD COLUMN application_projection_generation bigint,
    ADD COLUMN component_release_id uuid REFERENCES catalog.component_release(id),
    ADD COLUMN action_key text,
    ADD COLUMN action_version integer,
    ADD CONSTRAINT application_human_exposure_owner CHECK (
        (application_binding_id IS NULL AND application_projection_generation IS NULL
            AND component_release_id IS NULL AND action_key IS NULL AND action_version IS NULL)
        OR (num_nonnulls(application_binding_id,application_projection_generation,component_release_id,action_key,action_version)=5
            AND application_projection_generation > 0 AND length(action_key) > 0 AND action_version > 0)),
    ADD CONSTRAINT application_human_exposure_tenant
        FOREIGN KEY (tenant_id,application_binding_id) REFERENCES catalog.application_binding(tenant_id,id),
    ADD CONSTRAINT application_human_exposure_generation
        FOREIGN KEY (application_binding_id,application_projection_generation,component_release_id)
        REFERENCES projection.application_runtime(binding_id,generation,component_release_id),
    ADD CONSTRAINT application_human_exposure_action
        UNIQUE (application_binding_id,application_projection_generation,action_key,action_version);
-- The existing immutable-content trigger covers these ownership fields too.
-- Existing delegation policies retain NULL ownership; HUMAN callers cannot
-- borrow them merely because they have the same output schema or exposure.

CREATE FUNCTION catalog.guard_application_human_exposure() RETURNS trigger AS $$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF OLD.application_binding_id IS NOT NULL AND OLD.status='RETIRED' AND NEW.status<>'RETIRED' THEN
            RAISE EXCEPTION 'Retired HUMAN exposure cannot be reactivated' USING ERRCODE='check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.application_binding_id IS NULL THEN RETURN NEW; END IF;
    -- Original TEMPORAL admission prewrites here, then sets its AE ALLOWED in
    -- the same transaction. Do not require that later write before prewrite.
    -- This guard freezes ownership/boundary; it does not replace admission.
    IF NEW.version<>1 OR NEW.status<>'ACTIVE' OR NOT EXISTS (
        SELECT 1 FROM catalog.application_binding b
        JOIN projection.application_runtime runtime ON runtime.binding_id=b.id
          AND runtime.generation=NEW.application_projection_generation
          AND runtime.component_release_id=NEW.component_release_id AND runtime.state='PENDING'
        JOIN catalog.component_release release ON release.id=runtime.component_release_id AND release.status='APPROVED'
          AND runtime.normalized_manifest_digest=release.manifest_digest
        JOIN admission.action_execution ae ON ae.id=runtime.action_execution_id AND ae.tenant_id=b.tenant_id
          AND ae.target_id=b.id
        JOIN LATERAL jsonb_array_elements(release.manifest->'actionDefinitions') action ON true
        WHERE b.id=NEW.application_binding_id AND b.tenant_id=NEW.tenant_id AND b.state='PROVISIONING'
          AND b.component_release_id=release.id AND b.projection_action_execution_id=ae.id
          AND action->>'actionKey'=NEW.action_key AND (action->>'version')::integer=NEW.action_version
          AND action->>'outputSchemaDigest'=NEW.output_schema_hash
          AND action#>>'{resultExposurePolicy,mode}'=NEW.mode
          AND action#>>'{resultExposurePolicy,outputSchemaHash}'=NEW.output_schema_hash
          AND action#>>'{resultExposurePolicy,redactionPolicy}'=NEW.redaction_policy
          AND NEW.redaction_policy='PLATFORM_METADATA_ONLY'
    ) THEN
        RAISE EXCEPTION 'HUMAN exposure must freeze the admitted binding approved declaration' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER application_human_exposure_owner BEFORE INSERT OR UPDATE ON catalog.result_exposure_policy
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_human_exposure();
