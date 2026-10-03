-- DD-110 / SF-AGW-25：明确无提供方认证仍消费同一创建意图与原生整模型投影。
-- 入站 Gateway 认证与业务授权不变；不存在的 provider key 不写假 hash/SecretRef。
ALTER TABLE catalog.model_route_projection DROP CONSTRAINT model_route_projection_fence;
ALTER TABLE catalog.model_route_projection ADD CONSTRAINT model_route_projection_fence
    CHECK ((
        (NOT dispatch_started AND projection_hashes IS NULL AND credential_hash IS NULL)
        OR (dispatch_started AND projection_hashes IS NOT NULL
            AND jsonb_typeof(projection_hashes)='object'
            AND projection_hashes->>'llm.provider' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.model' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.virtualModel' ~ '^[0-9a-f]{64}$')
    ) IS TRUE);
ALTER TABLE catalog.model_route_projection ADD CONSTRAINT model_route_projection_provider_auth
    CHECK ((
        (source_refs->>'providerCredentialMode'='NONE'
            AND NOT (source_refs ? 'providerSecretRef') AND credential_hash IS NULL)
        OR (source_refs->>'providerCredentialMode'='SECRET_REF'
            AND jsonb_typeof(source_refs->'providerSecretRef')='object'
            AND (NOT dispatch_started OR credential_hash IS NOT NULL))
    ) IS TRUE);
