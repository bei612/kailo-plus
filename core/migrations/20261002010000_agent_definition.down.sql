DELETE FROM catalog.action_definition WHERE action_key IN
    ('agent.definition.create','agent.definition.update','resource.transfer_owner');
DELETE FROM catalog.approval_policy WHERE action_key='resource.transfer_owner';
DROP TABLE catalog.agent_definition;
DROP TABLE catalog.resource;
DROP FUNCTION catalog.guard_agent_resource_owner();
DROP TABLE catalog.resource_type_definition;
