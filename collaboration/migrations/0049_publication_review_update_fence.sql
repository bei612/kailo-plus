-- DD-81: fence review-update writers before enabling their publication proof.
-- Drain old inserts and rotate every Community epoch within this migration.
LOCK TABLE public.events IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.events_publication_guard() RETURNS trigger
LANGUAGE plpgsql AS $publication_guard$
DECLARE
    max_age integer;
    lock_prefix text;
    current_epoch uuid;
    epoch_tags jsonb;
    original record;
    observed_seconds numeric;
BEGIN
    IF NEW.kind = 1631 THEN
        max_age := 900;
        lock_prefix := 'kailo:1631:';
    ELSIF NEW.kind IN (1,5,7,9,1618,1619,1621,1630,1632,1633,9002,40003,45001,45003) THEN
        max_age := 960;
        lock_prefix := 'kailo:publication:';
    ELSE
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        lock_prefix || NEW.community_id::text || ':' || encode(NEW.id,'hex'), 0));

    -- Preserve the original ON CONFLICT path, including soft-deleted rows and
    -- alternate valid Schnorr signatures of the same canonical event.
    SELECT * INTO original FROM public.events
      WHERE community_id=NEW.community_id AND id=NEW.id
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
        IF original.pubkey=NEW.pubkey AND original.created_at=NEW.created_at
          AND original.kind=NEW.kind AND original.tags=NEW.tags
          AND original.content=NEW.content
          AND original.channel_id IS NOT DISTINCT FROM NEW.channel_id THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'publication identity mismatch' USING ERRCODE='check_violation';
    END IF;

    -- No session GUC or channel-NULL exemption. The epoch row lock prevents
    -- rotation overtaking a newly checked insert before it commits.
    SELECT publication_epoch INTO current_epoch FROM public.communities
      WHERE id=NEW.community_id FOR SHARE;
    SELECT coalesce(jsonb_agg(tag),'[]'::jsonb) INTO epoch_tags
      FROM jsonb_array_elements(NEW.tags) tag WHERE tag->>0='kailo:publication';
    IF jsonb_array_length(epoch_tags)>0 AND (
       jsonb_array_length(epoch_tags)<>1
       OR jsonb_typeof(epoch_tags->0)<>'array'
       OR jsonb_array_length(epoch_tags->0)<>2
       OR jsonb_typeof(epoch_tags->0->1)<>'string'
       OR epoch_tags->0->>1 IS DISTINCT FROM current_epoch::text) THEN
        RAISE EXCEPTION 'publication epoch mismatch' USING ERRCODE='check_violation';
    END IF;
    observed_seconds := floor(extract(epoch FROM clock_timestamp()));
    IF abs(extract(epoch FROM NEW.created_at)-observed_seconds)>max_age THEN
        RAISE EXCEPTION 'publication outside storage window' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END
$publication_guard$;


UPDATE public.communities SET publication_epoch = gen_random_uuid();
