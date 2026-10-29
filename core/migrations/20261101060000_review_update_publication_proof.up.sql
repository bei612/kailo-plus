-- DD-81: apply the existing proof predicate to immutable review updates.
CREATE OR REPLACE FUNCTION audit.publication_absence_proven(proof jsonb, refs jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s jsonb; w jsonb; p jsonb; r jsonb; c jsonb; bound bigint;
BEGIN
  IF proof IS NULL OR jsonb_typeof(proof)<>'object' THEN RETURN false; END IF;
  s:=proof->'scope'; w:=s->'publication'; p:=w->'policy';
  r:=proof->'settlement'; c:=r->'claim';
  IF (SELECT count(*) FROM jsonb_object_keys(proof))<>2
     OR NOT proof ?& ARRAY['scope','settlement']
     OR (SELECT count(*) FROM jsonb_object_keys(s))<>9
     OR NOT s ?& ARRAY['community_id','tenant_binding_version','target_channel_id','target_binding_version',
       'event_pubkey','event_kind','event_channel_id','signer_installation_id','publication']
     OR (SELECT count(*) FROM jsonb_object_keys(w))<>3
     OR NOT w ?& ARRAY['created_at','non_expiring','policy']
     OR (SELECT count(*) FROM jsonb_object_keys(p))<>4
     OR NOT p ?& ARRAY['version','epoch','max_age_seconds','ready']
     OR (SELECT count(*) FROM jsonb_object_keys(r))<>4
     OR NOT r ?& ARRAY['claim','accepted','settled','observed_at']
     OR (SELECT count(*) FROM jsonb_object_keys(c))<>8
     OR NOT c ?& ARRAY['event_id','community_id','pubkey','kind','channel_id','created_at','non_expiring','epoch']
     THEN RETURN false; END IF;
  bound := CASE WHEN c->>'kind'='1631' THEN 900
    WHEN c->>'kind' IN ('1','5','7','9','1618','1619','1621','1630','1632','1633','9002','40003','45001','45003') THEN 960
    ELSE NULL END;
  RETURN coalesce(bound IS NOT NULL
    AND c->>'event_id' ~ '^[0-9a-f]{64}$' AND c->>'pubkey' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(c->'event_id')='string' AND jsonb_typeof(c->'pubkey')='string'
    AND jsonb_typeof(c->'community_id')='string' AND (c->>'community_id')::uuid::text=c->>'community_id'
    AND jsonb_typeof(c->'epoch')='string' AND (c->>'epoch')::uuid::text=c->>'epoch'
    AND (c->'channel_id'='null'::jsonb OR (jsonb_typeof(c->'channel_id')='string' AND (c->>'channel_id')::uuid::text=c->>'channel_id'))
    AND jsonb_typeof(c->'kind')='number' AND jsonb_typeof(c->'created_at')='number'
    AND c->>'created_at' ~ '^(0|[1-9][0-9]*)$'
    AND jsonb_typeof(r->'observed_at')='number' AND r->>'observed_at' ~ '^(0|[1-9][0-9]*)$'
    AND (r->>'observed_at')::numeric > (c->>'created_at')::numeric+bound
    AND (r->>'observed_at')::numeric <= 9223372036854775807
    AND (c->>'created_at')::numeric <= 9223372036854775807
    AND c->'non_expiring'='true'::jsonb AND w->'non_expiring'=c->'non_expiring'
    AND w->'created_at'=c->'created_at' AND p->'epoch'=c->'epoch'
    AND p->'version'='1'::jsonb AND p->'max_age_seconds'='960'::jsonb AND p->'ready'='true'::jsonb
    AND s->'community_id'=c->'community_id' AND s->'event_pubkey'=c->'pubkey'
    AND s->'event_kind'=c->'kind' AND s->'event_channel_id'=c->'channel_id'
    AND jsonb_typeof(s->'tenant_binding_version')='number' AND s->>'tenant_binding_version' ~ '^[1-9][0-9]*$'
    AND ((s->'target_channel_id'='null'::jsonb AND s->'target_binding_version'='null'::jsonb)
      OR (jsonb_typeof(s->'target_channel_id')='string' AND (s->>'target_channel_id')::uuid::text=s->>'target_channel_id'
        AND jsonb_typeof(s->'target_binding_version')='number' AND s->>'target_binding_version' ~ '^[1-9][0-9]*$'))
    AND (s->'signer_installation_id'='null'::jsonb OR (jsonb_typeof(s->'signer_installation_id')='string'
      AND (s->>'signer_installation_id')::uuid::text=s->>'signer_installation_id'))
    AND r->'accepted'='false'::jsonb AND r->'settled'='true'::jsonb
    AND refs @> jsonb_build_array(jsonb_build_object('kind','BUZZ_EVENT_ID','value',c->>'event_id')), false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
