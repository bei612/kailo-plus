-- Reintroducing a known false terminal would authorize another external effect.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM audit.audit_event
   WHERE event_key LIKE 'dd81:absence-unproven:%'
      OR event_key LIKE '%:installation:profile:%:absence-unproven'
      OR event_key LIKE '%:installation:profile:%:reconciled-accepted') THEN
  RAISE EXCEPTION 'Cannot roll back publication absence correction with retained evidence';
 END IF;
END $$;
DROP VIEW projection.agent_profile_publication_effective;
