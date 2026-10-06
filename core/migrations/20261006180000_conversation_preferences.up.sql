-- DD-40: same per-HUMAN user-state/CAS, with an explicit private-conversation keyspace.
-- No Relay message, hidden_at or membership is copied here.
ALTER TABLE identity.collaboration_user_state
    ADD COLUMN conversation_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT conversation_preferences_is_object
        CHECK (jsonb_typeof(conversation_preferences) = 'object');
