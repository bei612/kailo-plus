-- Stop rollback rather than erase user preferences written by the new reader/writer.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM identity.collaboration_user_state
               WHERE conversation_preferences <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'conversation preferences exist; rollback would discard user state';
    END IF;
END $$;
ALTER TABLE identity.collaboration_user_state
    DROP CONSTRAINT conversation_preferences_is_object,
    DROP COLUMN conversation_preferences;
