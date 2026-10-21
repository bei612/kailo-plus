-- Kailo DD-133 organisation adoption of existing native spaces.
--
-- Run only through kailo-org-adopt.sh (plan = rolled back, apply = committed).
-- Repeatable: every step checks the current state first, so a second run of
-- the same plan changes nothing and reports "unchanged".
--
--   adopt_space    the existing native space that becomes the Kailo Tenant
--                  space (kailo_scope_ref "tenant:<id>"); its knowledge
--                  bases, agents, models and chats stay where they are. Its
--                  members' roles are recomputed from Kailo at their next
--                  login; other Tenant members join it at theirs.
--   retire_spaces  personal spaces with no content: their memberships are
--                  removed, sessions revoked, home pointers cleared and the
--                  space soft-deleted. A space with any content is refused.
--   attach_spaces  spaces that keep their content in place (e.g. the service
--                  space): joined to the Kailo Tenant organisation as editor
--                  so their owners can share chosen knowledge bases to the
--                  whole Tenant through the native share dialog.
--
-- Inputs (psql variables): kailo_tenant_id, kailo_tenant_name, adopt_space,
-- retire_spaces, attach_spaces (comma-separated ids or empty), apply.
-- Conventions match internal/application/service/kailo_org.go.

\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('kailo_adopt.tenant_id', :'kailo_tenant_id', true) AS tenant_id,
       set_config('kailo_adopt.tenant_name', :'kailo_tenant_name', true) AS tenant_name,
       set_config('kailo_adopt.adopt_space', :'adopt_space', true) AS adopt_space,
       set_config('kailo_adopt.retire_spaces', :'retire_spaces', true) AS retire_spaces,
       set_config('kailo_adopt.attach_spaces', :'attach_spaces', true) AS attach_spaces;

CREATE TEMP TABLE kailo_adopt_report (seq SERIAL, step TEXT, detail TEXT) ON COMMIT DROP;

DO $$
DECLARE
    t_id      TEXT := current_setting('kailo_adopt.tenant_id');
    t_name    TEXT := btrim(regexp_replace(current_setting('kailo_adopt.tenant_name'), '\s+', ' ', 'g'));
    adopt     BIGINT := current_setting('kailo_adopt.adopt_space')::BIGINT;
    ref       TEXT;
    mapped    BIGINT;
    cur_ref   TEXT;
    cur_name  TEXT;
    s         BIGINT;
    tbl       RECORD;
    n         BIGINT;
    busy      TEXT;
    org_id    TEXT;
    owner_uid TEXT;
BEGIN
    IF t_id !~ '^[A-Za-z0-9._:-]{1,140}$' THEN
        RAISE EXCEPTION 'invalid Kailo tenant id';
    END IF;
    IF t_name = '' OR char_length(t_name) > 100 THEN
        RAISE EXCEPTION 'Kailo tenant name must be 1-100 characters';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'kailo_scope_ref') THEN
        RAISE EXCEPTION 'migration 000109 is not applied: deploy the knowledge service of this release first';
    END IF;
    ref := 'tenant:' || t_id;

    -- 1. Adopt the Tenant space.
    SELECT id INTO mapped FROM tenants WHERE kailo_scope_ref = ref;
    IF mapped IS NOT NULL AND mapped <> adopt THEN
        RAISE EXCEPTION 'Kailo tenant % is already represented by space %', t_id, mapped;
    END IF;
    SELECT kailo_scope_ref, name INTO cur_ref, cur_name FROM tenants WHERE id = adopt AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'space % does not exist', adopt;
    END IF;
    IF cur_ref IS NOT NULL AND cur_ref <> ref THEN
        RAISE EXCEPTION 'space % already represents %', adopt, cur_ref;
    END IF;
    IF cur_ref IS NULL OR cur_name <> t_name THEN
        UPDATE tenants SET kailo_scope_ref = ref, name = t_name, description = 'Kailo', updated_at = now()
        WHERE id = adopt;
        INSERT INTO kailo_adopt_report (step, detail)
        VALUES ('adopt', format('space %s "%s" -> %s "%s"', adopt, cur_name, ref, t_name));
    ELSE
        INSERT INTO kailo_adopt_report (step, detail) VALUES ('adopt', format('space %s unchanged', adopt));
    END IF;

    -- 2. Retire empty personal spaces.
    FOR s IN SELECT DISTINCT btrim(v)::BIGINT
             FROM unnest(string_to_array(nullif(current_setting('kailo_adopt.retire_spaces'), ''), ',')) AS v
    LOOP
        IF s = adopt THEN
            RAISE EXCEPTION 'space % cannot be both adopted and retired', s;
        END IF;
        IF EXISTS (SELECT 1 FROM tenants WHERE id = s AND deleted_at IS NOT NULL AND kailo_scope_ref IS NULL) THEN
            INSERT INTO kailo_adopt_report (step, detail) VALUES ('retire', format('space %s already retired', s));
            CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = s AND deleted_at IS NULL AND kailo_scope_ref IS NULL) THEN
            RAISE EXCEPTION 'space % is missing or Kailo-mapped; not retired', s;
        END IF;
        busy := NULL;
        FOR tbl IN
            SELECT c.table_name,
                   EXISTS (SELECT 1 FROM information_schema.columns d
                           WHERE d.table_schema = 'public' AND d.table_name = c.table_name
                             AND d.column_name = 'deleted_at') AS soft
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
            WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
              -- Space scaffolding and history, not content.
              AND c.table_name NOT IN ('tenant_members', 'tenant_invitations', 'storage_backends',
                                       'audit_logs', 'users', 'organization_tenant_members')
            ORDER BY c.table_name
        LOOP
            EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id::text = $1%s', tbl.table_name,
                           CASE WHEN tbl.soft THEN ' AND deleted_at IS NULL' ELSE '' END)
                INTO n USING s::text;
            IF n > 0 THEN
                busy := concat_ws(', ', busy, format('%s=%s', tbl.table_name, n));
            END IF;
        END LOOP;
        IF busy IS NOT NULL THEN
            RAISE EXCEPTION 'space % holds content (%); adopt or attach it instead of retiring', s, busy;
        END IF;
        UPDATE auth_tokens SET is_revoked = TRUE, updated_at = now()
        WHERE is_revoked = FALSE
          AND user_id IN (SELECT user_id FROM tenant_members WHERE tenant_id = s AND deleted_at IS NULL);
        UPDATE tenant_members SET deleted_at = now(), updated_at = now() WHERE tenant_id = s AND deleted_at IS NULL;
        UPDATE users SET tenant_id = NULL, updated_at = now() WHERE tenant_id = s;
        UPDATE users SET preferences = preferences - 'last_active_tenant_id', updated_at = now()
        WHERE preferences ? 'last_active_tenant_id' AND preferences->>'last_active_tenant_id' = s::text;
        UPDATE storage_backends SET deleted_at = now() WHERE tenant_id = s AND deleted_at IS NULL;
        UPDATE tenants SET deleted_at = now(), updated_at = now() WHERE id = s;
        INSERT INTO kailo_adopt_report (step, detail) VALUES ('retire', format('space %s retired', s));
    END LOOP;

    -- 3. Attach spaces that keep their content to the Tenant organisation.
    IF nullif(current_setting('kailo_adopt.attach_spaces'), '') IS NOT NULL THEN
        SELECT id INTO org_id FROM organizations WHERE kailo_tenant_ref = t_id;
        IF org_id IS NULL THEN
            SELECT user_id INTO owner_uid FROM tenant_members
            WHERE tenant_id = adopt AND deleted_at IS NULL AND status = 'active'
            ORDER BY (role = 'owner') DESC, (role = 'admin') DESC, joined_at
            LIMIT 1;
            IF owner_uid IS NULL THEN
                RAISE EXCEPTION 'adopted space % has no active member to own the Tenant organisation', adopt;
            END IF;
            org_id := uuid_generate_v4()::text;
            INSERT INTO organizations (id, name, description, owner_id, owner_tenant_id, invite_code,
                                       invite_code_expires_at, member_limit, kailo_tenant_ref,
                                       created_at, updated_at)
            VALUES (org_id, t_name, 'Kailo', owner_uid, adopt,
                    substr(md5(random()::text || clock_timestamp()::text), 1, 32),
                    now() - interval '1 second', 0, t_id, now(), now());
            INSERT INTO kailo_adopt_report (step, detail) VALUES ('organization', format('created for %s', t_id));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM organization_tenant_members WHERE organization_id = org_id AND tenant_id = adopt) THEN
            INSERT INTO organization_tenant_members (id, organization_id, tenant_id, role, representative_user_id,
                                                     joined_at, created_at, updated_at)
            VALUES (uuid_generate_v4()::text, org_id, adopt, 'admin', '', now(), now(), now());
        END IF;
        FOR s IN SELECT DISTINCT btrim(v)::BIGINT
                 FROM unnest(string_to_array(current_setting('kailo_adopt.attach_spaces'), ',')) AS v
        LOOP
            IF s = adopt OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = s AND deleted_at IS NULL AND kailo_scope_ref IS NULL) THEN
                RAISE EXCEPTION 'space % must be an existing unmapped space other than the adopted one', s;
            END IF;
            IF EXISTS (SELECT 1 FROM organization_tenant_members WHERE organization_id = org_id AND tenant_id = s) THEN
                INSERT INTO kailo_adopt_report (step, detail) VALUES ('attach', format('space %s unchanged', s));
            ELSE
                INSERT INTO organization_tenant_members (id, organization_id, tenant_id, role, representative_user_id,
                                                         joined_at, created_at, updated_at)
                VALUES (uuid_generate_v4()::text, org_id, s, 'editor', '', now(), now(), now());
                INSERT INTO kailo_adopt_report (step, detail) VALUES ('attach', format('space %s joined as editor', s));
            END IF;
        END LOOP;
    END IF;
END $$;

SELECT step, detail FROM kailo_adopt_report ORDER BY seq;

SELECT t.id AS space, t.name, t.kailo_scope_ref,
       (SELECT count(*) FROM knowledge_bases k WHERE k.tenant_id = t.id AND k.deleted_at IS NULL) AS knowledge_bases,
       (SELECT count(*) FROM tenant_members m WHERE m.tenant_id = t.id AND m.deleted_at IS NULL) AS members
FROM tenants t
WHERE t.deleted_at IS NULL
ORDER BY t.id;

\if :apply
COMMIT;
\echo 'kailo-org-adopt: applied'
\else
ROLLBACK;
\echo 'kailo-org-adopt: plan only (rolled back)'
\endif
