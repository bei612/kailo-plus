-- DD-168 (design-authority 54ffc13f5) on DD-164(4)⑧: share adoptions also register component
-- top-level containers. Adds the native type data_source (data_query) and keeps the component's
-- display name of each component.shared_object, refreshed by later adoptions and share intents.
ALTER TABLE catalog.resource DROP CONSTRAINT resource_component_shared_object_shape;
ALTER TABLE catalog.resource ADD CONSTRAINT resource_component_shared_object_shape CHECK (
 type_key<>'component.shared_object' OR (application_binding_id IS NOT NULL
  AND native_type IN ('folder','knowledge_base','data_source') AND native_id IS NOT NULL
  AND native_id<>'' AND char_length(native_id)<=255 AND reference_provision IS NULL));
ALTER TABLE catalog.component_share_intent DROP CONSTRAINT component_share_intent_native_type_check;
ALTER TABLE catalog.component_share_intent ADD CONSTRAINT component_share_intent_native_type_check
 CHECK (native_type IN ('folder','knowledge_base','data_source'));
CREATE TABLE catalog.component_shared_object_name (
    resource_id uuid PRIMARY KEY REFERENCES catalog.resource(id),
    display_name text NOT NULL CHECK (btrim(display_name)<>'' AND char_length(display_name)<=200),
    updated_at timestamptz NOT NULL DEFAULT now()
);
