-- Restore the prior trigger timing; this also restores its generated-column
-- retirement defect. No catalog contents or historic admission references change.
DROP TRIGGER action_definition_immutable_update ON catalog.action_definition;
DROP TRIGGER action_definition_immutable ON catalog.action_definition;
CREATE TRIGGER action_definition_immutable BEFORE UPDATE OR DELETE ON catalog.action_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();
