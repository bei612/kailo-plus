-- REQ-24 / DD-107: original WorkflowDef.description is immutable version content.
-- NULL preserves historical absence and its config_hash; never backfill text.
ALTER TABLE catalog.automation_version ADD COLUMN description text;
-- Existing guard_automation_scope compares the full row on published versions,
-- so this column inherits the same immutable Asset/version fence.
