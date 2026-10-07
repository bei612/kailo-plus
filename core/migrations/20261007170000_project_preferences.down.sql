DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM identity.collaboration_user_state
               WHERE project_preferences <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'project preferences exist; rollback would discard user state';
    END IF;
END $$;
ALTER TABLE identity.collaboration_user_state
    DROP CONSTRAINT project_preferences_is_object,
    DROP COLUMN project_preferences;
