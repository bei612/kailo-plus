-- Reverse of DD-164(3)(4)⑧ storage. Refuses once a policy action or an adoption exists:
-- their SpiceDB writes and audit chains are not removable by a schema rollback.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key='tenant.member_create_policy.set')
   OR EXISTS (SELECT 1 FROM catalog.component_share_adoption)
   OR EXISTS (SELECT 1 FROM identity.tenant WHERE member_create_policy<>'MEMBERS_CREATE') THEN
   RAISE EXCEPTION 'DD-164 member create policy history must not be discarded; stop the release instead'
     USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE catalog.component_share_adoption;
DELETE FROM catalog.action_definition WHERE action_key='tenant.member_create_policy.set';
ALTER TABLE identity.tenant DROP COLUMN member_create_policy;
