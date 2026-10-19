-- DD-127（07 §2.5/§6.2、03 §3）：原生页面入口 release（implements=[]、
-- FrontendDelivery NATIVE_PAGE、ExecutionConnector NONE）的 ApplicationBinding
-- 不启用任何能力类别。空类别只属于这一形态，其余 binding 仍至少启用一个类别；
-- 入口 release 的 binding 也不得启用类别。Core 在 approved_release 中先行拒绝，
-- 这里只是同一不变式的数据库守卫。不改写任何存量行（存量 binding 均非空）。
ALTER TABLE catalog.application_binding
    DROP CONSTRAINT application_binding_capability_categories_check;
ALTER TABLE catalog.application_binding
    ADD CONSTRAINT application_binding_capability_categories_check
    CHECK (jsonb_typeof(capability_categories)='array');

CREATE FUNCTION catalog.guard_application_binding_native_page() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE page_only boolean;
BEGIN
    SELECT r.manifest->'executionConnector'->>'mode'='NONE'
           AND r.manifest->'implements'='[]'::jsonb
           AND r.manifest->'frontendDelivery'->>'mode'='NATIVE_PAGE'
      INTO page_only
      FROM catalog.component_release r WHERE r.id=NEW.component_release_id;
    IF (jsonb_array_length(NEW.capability_categories)=0) IS DISTINCT FROM coalesce(page_only,false) THEN
        RAISE EXCEPTION 'binding categories do not match its release form' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER application_binding_native_page BEFORE INSERT OR UPDATE OF capability_categories,component_release_id
ON catalog.application_binding FOR EACH ROW EXECUTE FUNCTION catalog.guard_application_binding_native_page();
