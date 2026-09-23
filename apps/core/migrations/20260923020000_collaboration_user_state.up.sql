-- CollaborationUserState（.design/03 §2）。收藏、静音、已读的唯一权威。
--
-- 原 Buzz Web 用 NIP-44 kind:30078 同步这些状态，固定改由 Core 承载：服务端不
-- 保留用户解密私钥，那条路在 Web 上走不通（DD-40）。原生端本地持钥、自己能解密，
-- 但仍以 Core 为唯一权威——那是三端一致与可撤权的要求，不是加密能力的限制
-- （.design/09）。
--
-- 归 identity 而不是 projection：它不是任何上游的投影，Core 就是权威；而它按
-- Principal 归属，与该 schema 里其余按 Principal 归属的事实同处一层。
CREATE TABLE identity.collaboration_user_state (
    -- 只属于一个 active HUMAN Principal（.design/03 §4）。主键即该约束：
    -- 一个 Principal 至多一行，不存在"哪一行才算数"的问题。
    tenant_principal_id   uuid PRIMARY KEY REFERENCES identity.principal (id),
    -- workspace_id -> {starred, muted, updated_at}。键必须是同 Tenant 且该 HUMAN
    -- 可发现的 Workspace——这条由写入路径校验，库里只保证形状是对象。
    workspace_preferences jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- context_key -> last_read_at。键只接受该 HUMAN 当前可读 Workspace 内的
    -- Channel ID 或 `msg:<Buzz event id>`，同样由写入路径校验。
    read_contexts         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    version               integer     NOT NULL DEFAULT 1,
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- 形状必须是对象。写成数组或标量时，后续的键校验会静默跳过每一项——
    -- 一个"看起来通过了校验"的空循环。
    CONSTRAINT preferences_is_object CHECK (jsonb_typeof(workspace_preferences) = 'object'),
    CONSTRAINT read_contexts_is_object CHECK (jsonb_typeof(read_contexts) = 'object')
);
