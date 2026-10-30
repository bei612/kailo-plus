-- Kailo DD-164(4) (07 §4.7.4 schema 2): knowledge base shares are a
-- projection of Kailo authorization, delivered in the member directory's
-- shares[] and converged by the directory sync.
--
-- A Workspace grantee is represented by a Kailo-managed organisation whose
-- only member space is that Workspace's space; its reference is set once.
ALTER TABLE organizations ADD COLUMN kailo_share_ref VARCHAR(160);
ALTER TABLE organizations ADD CONSTRAINT organizations_kailo_share_ref_format CHECK (
    kailo_share_ref IS NULL OR kailo_share_ref ~ '^workspace:[0-9a-f-]{36}$'
);
CREATE UNIQUE INDEX idx_organizations_kailo_share_ref ON organizations (kailo_share_ref);

-- A share row written by the projection carries the Kailo Resource
-- (component.shared_object) it projects; rows without it are native.
ALTER TABLE kb_shares ADD COLUMN kailo_resource_ref VARCHAR(36);
ALTER TABLE kb_shares ADD CONSTRAINT kb_shares_kailo_resource_ref_format CHECK (
    kailo_resource_ref IS NULL OR kailo_resource_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
CREATE INDEX idx_kb_shares_kailo_resource_ref ON kb_shares (kailo_resource_ref);

-- The convergence failures of the recorded snapshot, reported to Core in the
-- receipt (DD-164(4)⑥); a JSON array of {kind, ref, reasonCode}.
ALTER TABLE kailo_member_directory ADD COLUMN receipt_failures TEXT NOT NULL DEFAULT '[]';
