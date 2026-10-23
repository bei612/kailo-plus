-- Reverse of DD-131(1)(6) teams and catalog sharing. Refuses while any team or team/share action
-- record exists: their Resources, SpiceDB grants and audit chains are not removable by a schema
-- rollback; roll back by stopping the release instead.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.resource WHERE type_key='agent.team')
   OR EXISTS (SELECT 1 FROM catalog.agent_team)
   OR EXISTS (SELECT 1 FROM admission.action_execution WHERE action_key IN
      ('agent.team.create','agent.team.update','agent.team.delete','agent.team.share','agent.team.unshare',
       'agent.definition.share','agent.definition.unshare')) THEN
   RAISE EXCEPTION 'DD-131 team/catalog history must not be discarded; stop the release instead'
     USING ERRCODE='55000';
 END IF;
END $$;

DELETE FROM catalog.action_definition WHERE action_key IN
 ('agent.team.create','agent.team.update','agent.team.delete','agent.team.share','agent.team.unshare',
  'agent.definition.share','agent.definition.unshare');

DROP TRIGGER agent_team_guard ON catalog.agent_team;
DROP FUNCTION catalog.guard_agent_team();
DROP TABLE catalog.agent_team;

ALTER TABLE catalog.resource DROP CONSTRAINT resource_type_key_check;
ALTER TABLE catalog.resource DROP CONSTRAINT resource_home_workspace_check;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_type_key_check CHECK
 (application_binding_id IS NOT NULL OR type_key IN
  ('agent.definition','agent.installation','llm_route','automation','tool.definition','skill.definition',
   'mcp.connection'));
ALTER TABLE catalog.resource ADD CONSTRAINT resource_home_workspace_check CHECK
 (application_binding_id IS NOT NULL OR
  (type_key IN ('agent.definition','skill.definition') AND home_workspace_id IS NULL) OR
  (type_key IN ('agent.installation','automation') AND home_workspace_id IS NOT NULL) OR
  type_key IN ('llm_route','tool.definition','mcp.connection'));

DELETE FROM catalog.resource_type_definition WHERE type_key='agent.team';
