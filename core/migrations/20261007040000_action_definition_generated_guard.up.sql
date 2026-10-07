-- DD-88: generated columns are populated after BEFORE triggers. Compare the
-- complete immutable row after generation, without excluding any catalog field.
-- Deletion retains its original BEFORE guard and exact-reference error behavior.
DROP TRIGGER action_definition_immutable ON catalog.action_definition;
CREATE TRIGGER action_definition_immutable BEFORE DELETE ON catalog.action_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();
CREATE TRIGGER action_definition_immutable_update AFTER UPDATE ON catalog.action_definition
    FOR EACH ROW EXECUTE FUNCTION catalog.guard_version();
