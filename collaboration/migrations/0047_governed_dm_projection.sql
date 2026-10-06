-- Core participant references identify the native DM across device key changes.
-- Message/channel authority remains the existing channels/channel_members store.
ALTER TABLE channels ADD COLUMN platform_dm_principals UUID[];
ALTER TABLE channels ADD COLUMN platform_dm_generation BIGINT;
ALTER TABLE channels ADD COLUMN platform_dm_digest BYTEA;
ALTER TABLE channels ADD CONSTRAINT channels_platform_dm_projection CHECK (
    (platform_dm_principals IS NULL AND platform_dm_generation IS NULL AND platform_dm_digest IS NULL)
    OR (platform_dm_principals IS NOT NULL AND platform_dm_generation IS NOT NULL AND platform_dm_digest IS NOT NULL
        AND channel_type = 'dm' AND visibility = 'private'
        AND cardinality(platform_dm_principals) BETWEEN 2 AND 9
        AND platform_dm_generation > 0 AND octet_length(platform_dm_digest) = 32)
);
