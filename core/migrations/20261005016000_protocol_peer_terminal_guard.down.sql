-- Stop downgrade once this connector has any binding: an older consumer cannot
-- account for its no-native-job UNKNOWN set, including retained history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM catalog.application_binding b
      JOIN catalog.component_release r ON r.id=b.component_release_id
      WHERE r.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER') THEN
    RAISE EXCEPTION 'protocol peer bindings prevent downgrade';
  END IF;
END $$;
DROP TRIGGER protocol_peer_drain ON catalog.application_binding;
DROP FUNCTION catalog.guard_protocol_peer_drain();
