-- REQ-24: original workflow names belong to the immutable version, not a new directory.
alter table catalog.automation_version
    add column name text check (name is null or name !~ '^[[:space:]]*$');

-- Existing rows remain NULL and retain their original configuration digest.
