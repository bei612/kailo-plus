DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM admission.protocol_session)
        OR EXISTS(SELECT 1 FROM projection.workflow_ref WHERE kind='PROTOCOL_SESSION_RECONCILE') THEN
        RAISE EXCEPTION 'ProtocolSession facts must be preserved; rollback requires an empty table' USING ERRCODE='23514';
    END IF;
END $$;
DROP TRIGGER application_binding_protocol_drain ON catalog.application_binding;
DROP FUNCTION catalog.guard_application_binding_protocol_drain();
DROP TABLE admission.protocol_session;
DROP FUNCTION admission.guard_protocol_session();
ALTER TABLE projection.workflow_ref DROP CONSTRAINT workflow_kind_enum;
ALTER TABLE projection.workflow_ref ADD CONSTRAINT workflow_kind_enum CHECK (kind IN
 ('TENANT_LIFECYCLE','WORKSPACE_LIFECYCLE','MEMBERSHIP_PROJECTION','MEMBERSHIP_REVOCATION',
 'BUZZ_IDENTITY_PROJECTION','SECRET_REF_REHOME','AGENT_INSTALLATION','COMPONENT_RELEASE',
 'COMPONENT_BINDING','COMPONENT_DISABLE','RESOURCE_PROVISION'));
