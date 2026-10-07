-- DD-40: original Added preference, not Project content or membership authority.
ALTER TABLE identity.collaboration_user_state
    ADD COLUMN project_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT project_preferences_is_object
        CHECK (jsonb_typeof(project_preferences) = 'object');
