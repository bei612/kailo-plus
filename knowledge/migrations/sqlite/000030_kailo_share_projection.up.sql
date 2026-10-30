-- Mirrors native Postgres migration 000111 (Kailo DD-164(4) share projection).
ALTER TABLE organizations ADD COLUMN kailo_share_ref VARCHAR(160) CHECK (
    kailo_share_ref IS NULL OR (kailo_share_ref LIKE 'workspace:%' AND length(kailo_share_ref) = 46)
);
CREATE UNIQUE INDEX idx_organizations_kailo_share_ref ON organizations (kailo_share_ref);
ALTER TABLE kb_shares ADD COLUMN kailo_resource_ref VARCHAR(36) CHECK (
    kailo_resource_ref IS NULL OR length(kailo_resource_ref) = 36
);
CREATE INDEX idx_kb_shares_kailo_resource_ref ON kb_shares (kailo_resource_ref);
ALTER TABLE kailo_member_directory ADD COLUMN receipt_failures TEXT NOT NULL DEFAULT '[]';
