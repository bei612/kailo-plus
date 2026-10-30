-- Reverse of the DD-168 data_source type and shared object names. Refuses while a data_source
-- object exists: its Resource, grants and audit are not removable by a schema rollback.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM catalog.resource WHERE type_key='component.shared_object' AND native_type='data_source')
   OR EXISTS (SELECT 1 FROM catalog.component_share_intent WHERE native_type='data_source') THEN
   RAISE EXCEPTION 'DD-168 data_source objects must not be discarded; stop the release instead' USING ERRCODE='55000';
 END IF;
END $$;
DROP TABLE catalog.component_shared_object_name;
ALTER TABLE catalog.component_share_intent DROP CONSTRAINT component_share_intent_native_type_check;
ALTER TABLE catalog.component_share_intent ADD CONSTRAINT component_share_intent_native_type_check
 CHECK (native_type IN ('folder','knowledge_base'));
ALTER TABLE catalog.resource DROP CONSTRAINT resource_component_shared_object_shape;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_component_shared_object_shape CHECK (
 type_key<>'component.shared_object' OR (application_binding_id IS NOT NULL
  AND native_type IN ('folder','knowledge_base') AND native_id IS NOT NULL
  AND native_id<>'' AND char_length(native_id)<=255 AND reference_provision IS NULL));
