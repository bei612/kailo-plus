-- Mirrors native Postgres migration 000110 (Kailo DD-133(4) member directory snapshot).
CREATE TABLE kailo_member_directory (
    id                INTEGER     PRIMARY KEY CHECK (id = 1),
    binding_id        VARCHAR(36) NOT NULL,
    directory_version VARCHAR(64) NOT NULL CHECK (length(directory_version) = 64),
    snapshot          TEXT        NOT NULL,
    applied_at        DATETIME    NOT NULL
);
