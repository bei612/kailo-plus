-- Stop rollback rather than erase user state written by the DD-125 reader/writer.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM identity.collaboration_user_state
               WHERE thread_preferences <> '{}'::jsonb
                  OR sidebar_sections <> '{"sections": [], "assignments": {}}'::jsonb
                  OR sidebar_sort <> '{}'::jsonb
                  OR channel_templates <> '{}'::jsonb
                  OR followed_principals <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'DD-125 user state exists; rollback would discard user state';
    END IF;
END $$;
ALTER TABLE identity.collaboration_user_state
    DROP CONSTRAINT followed_principals_is_object,
    DROP CONSTRAINT channel_templates_is_object,
    DROP CONSTRAINT sidebar_sort_is_object,
    DROP CONSTRAINT sidebar_sections_shape,
    DROP CONSTRAINT thread_preferences_is_object,
    DROP COLUMN followed_principals,
    DROP COLUMN channel_templates,
    DROP COLUMN sidebar_sort,
    DROP COLUMN sidebar_sections,
    DROP COLUMN thread_preferences;
