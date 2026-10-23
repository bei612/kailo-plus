-- Kailo DD-133(4) (07 §4.7.4): the last member directory snapshot this
-- instance applied completely. One row: the native page entry binding it was
-- read for, its directoryVersion and the snapshot itself, so roles and
-- memberships keep following the directory across restarts (a login never
-- falls back to the pre-directory member role). Written only after every
-- membership of the snapshot has been reconciled.
CREATE TABLE kailo_member_directory (
    id                SMALLINT    PRIMARY KEY CHECK (id = 1),
    binding_id        VARCHAR(36) NOT NULL,
    directory_version VARCHAR(64) NOT NULL CHECK (directory_version ~ '^[0-9a-f]{64}$'),
    snapshot          TEXT        NOT NULL,
    applied_at        TIMESTAMPTZ NOT NULL
);
