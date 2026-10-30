ALTER TABLE kailo_member_directory DROP COLUMN receipt_failures;
DROP INDEX IF EXISTS idx_kb_shares_kailo_resource_ref;
ALTER TABLE kb_shares DROP CONSTRAINT IF EXISTS kb_shares_kailo_resource_ref_format;
ALTER TABLE kb_shares DROP COLUMN kailo_resource_ref;
DROP INDEX IF EXISTS idx_organizations_kailo_share_ref;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_kailo_share_ref_format;
ALTER TABLE organizations DROP COLUMN kailo_share_ref;
