-- 旧 writer/readers 必须有 provider SecretRef；真实无认证引用存在时拒绝降级，不伪造 key。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM catalog.model_route_projection
        WHERE source_refs->>'providerCredentialMode'='NONE') THEN
        RAISE EXCEPTION '无认证 Route 引用尚存，不能回滚为强制 provider SecretRef' USING ERRCODE='check_violation';
    END IF;
END $$;
ALTER TABLE catalog.model_route_projection DROP CONSTRAINT model_route_projection_provider_auth;
ALTER TABLE catalog.model_route_projection DROP CONSTRAINT model_route_projection_fence;
ALTER TABLE catalog.model_route_projection ADD CONSTRAINT model_route_projection_fence
    CHECK ((
        (NOT dispatch_started AND projection_hashes IS NULL AND credential_hash IS NULL)
        OR (dispatch_started AND projection_hashes IS NOT NULL AND credential_hash IS NOT NULL
            AND jsonb_typeof(projection_hashes)='object'
            AND projection_hashes->>'llm.provider' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.model' ~ '^[0-9a-f]{64}$'
            AND projection_hashes->>'llm.virtualModel' ~ '^[0-9a-f]{64}$')
    ) IS TRUE);
