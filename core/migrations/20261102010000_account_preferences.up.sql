-- AccountPreferences（.design/03 §2、DD-164(7)）：主题、语言与组件偏好是账号偏好，
-- 每个 HumanIdentity 一份，跨 Tenant 与设备；各端本机存储只作缓存。
-- 归 identity：Core 就是权威，按 HumanIdentity 归属，不是任何上游的投影。
-- Tenant 删除不删除它：它不属于任一 Tenant。
CREATE TABLE identity.account_preferences (
    human_identity_id     uuid        PRIMARY KEY REFERENCES identity.human_identity (id),
    theme                 text,
    accent                text,
    follow_system         boolean,
    locale                text,
    -- 07 §4.8.2 声明键 -> 布尔或封闭选项值；键与值由写入路径校验。
    component_preferences jsonb       NOT NULL DEFAULT {}::jsonb,
    version               integer     NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT account_preferences_theme CHECK (theme IS NULL OR theme ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    CONSTRAINT account_preferences_accent CHECK (accent IS NULL OR accent IN ('neutral', 'kailo-brand') OR accent ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT account_preferences_locale CHECK (locale IS NULL OR locale IN ('zh-CN', 'en')),
    CONSTRAINT account_preferences_component_is_object CHECK (jsonb_typeof(component_preferences) = 'object')
);
