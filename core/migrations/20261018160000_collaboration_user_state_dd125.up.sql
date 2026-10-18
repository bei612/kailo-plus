-- DD-125(1)(4)(5): original Buzz thread follow/mute, custom sidebar sections and
-- group sort, personal channel templates and Pulse follows join the same per-HUMAN
-- CollaborationUserState and version CAS (DD-40, .design/03). They replace the
-- original localStorage, NIP-44 kind:30078 (`channel-sections`/`channel-sort`),
-- Desktop-local template file and per-pubkey kind 3; none of them is a Relay event
-- and none grants a permission.
--
-- thread_preferences   thread:<root event id> -> {state FOLLOWED|MUTED, updatedAt}
-- sidebar_sections     {sections:[{id,name,icon?,order}], assignments:{channel id -> section id}, updatedAt?}
-- sidebar_sort         group key -> {mode alpha|recent, updatedAt}
-- channel_templates    template id -> {name, description?, channelType, visibility,
--                      canvasTemplate?, agentResourceIds[], updatedAt}
-- followed_principals  HUMAN principal id -> followedAt
--
-- Keys and bounds (500 threads, 100 sections, 1000 assignments, 104 groups, 200
-- templates, 64 KiB canvas) are enforced by the single Core writer; the database
-- only guarantees the shapes, so an empty loop can never pass as validation.
ALTER TABLE identity.collaboration_user_state
    ADD COLUMN thread_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN sidebar_sections jsonb NOT NULL
        DEFAULT '{"sections": [], "assignments": {}}'::jsonb,
    ADD COLUMN sidebar_sort jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN channel_templates jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN followed_principals jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT thread_preferences_is_object
        CHECK (jsonb_typeof(thread_preferences) = 'object'),
    ADD CONSTRAINT sidebar_sections_shape
        CHECK (jsonb_typeof(sidebar_sections) = 'object'
               AND jsonb_typeof(sidebar_sections -> 'sections') = 'array'
               AND jsonb_typeof(sidebar_sections -> 'assignments') = 'object'),
    ADD CONSTRAINT sidebar_sort_is_object
        CHECK (jsonb_typeof(sidebar_sort) = 'object'),
    ADD CONSTRAINT channel_templates_is_object
        CHECK (jsonb_typeof(channel_templates) = 'object'),
    ADD CONSTRAINT followed_principals_is_object
        CHECK (jsonb_typeof(followed_principals) = 'object');
