-- Tenant/Workspace 到 Buzz Community/Channel 的绑定（.design/03 §2）。
--
-- 归 projection：它们是「Buzz/SpiceDB/Gateway/Web/Task 投影与 generation」，
-- 与 identity 里的业务事实不是一回事（ADR-01）。BuzzIdentityBinding 在
-- Stage 1 的 identity 迁移里已建，迁移只能追加，不在此移动它。

CREATE TABLE projection.tenant_buzz_binding (
    tenant_id                   uuid PRIMARY KEY REFERENCES identity.tenant (id),
    community_id                uuid        NOT NULL UNIQUE,
    -- Relay 按请求 Host 绑定 Community，且该 Host 参与 NIP-98 签名
    -- （SF-BUZ-32）。它是签名权威，不是网络地址，因此单独存。
    normalized_host             text        NOT NULL UNIQUE,
    control_service_principal_id uuid       NOT NULL REFERENCES identity.principal (id),
    -- 部署侧三个开关的观测值。Core 记录它们不是为了配置 Relay，而是为了
    -- 在 binding 进入 ACTIVE 前证明协作面确实有准入执行点。
    require_relay_membership    boolean     NOT NULL,
    allow_nip_oa_auth           boolean     NOT NULL,
    pubkey_allowlist_enabled    boolean     NOT NULL,
    nip11_snapshot_digest       text,
    nip11_observed_at           timestamptz,
    state                       text        NOT NULL CONSTRAINT buzz_binding_state_enum CHECK (state IN
                                    ('UNBOUND','PROVISIONING','RECONCILING','ACTIVE','DISABLED')),
    version                     integer     NOT NULL DEFAULT 1,
    created_at                  timestamptz NOT NULL DEFAULT now(),

    -- ACTIVE 必须带 NIP-11 快照：运行连接不得使用超出该快照声明值的订阅、
    -- filter、limit 或 frame 合同（.design/03 §2）。没有快照就没有上界可比。
    CONSTRAINT active_requires_nip11_snapshot CHECK (
        state <> 'ACTIVE' OR (nip11_snapshot_digest IS NOT NULL AND nip11_observed_at IS NOT NULL)
    ),
    -- require_relay_membership=false 时 check_relay_membership 立即返回
    -- OpenRelay，所有已认证调用方一律放行（SF-BUZ-26）。原生端本机持钥直连
    -- Relay，Core 不在其发布路径上——roster 校验是协作数据平面唯一的准入
    -- 执行点（DD-75）。它为假而 binding 为 ACTIVE，等于协作面无准入。
    CONSTRAINT active_requires_membership_enforced CHECK (
        state <> 'ACTIVE' OR require_relay_membership
    ),
    -- allow_nip_oa_auth 开启时，不在 roster 中的 pubkey 可凭 owner
    -- attestation 通过（SF-BUZ-26）。那会让撤权在 Relay 侧失效。
    CONSTRAINT active_forbids_owner_attestation_bypass CHECK (
        state <> 'ACTIVE' OR NOT allow_nip_oa_auth
    )
);

-- 一个 Workspace 绑定一个 Channel（DD-01）。
CREATE TABLE projection.workspace_buzz_binding (
    workspace_id uuid PRIMARY KEY REFERENCES identity.workspace (id),
    -- Channel 的标识是 Relay 分配的 UUID，不是创建事件 id（SF-BUZ-33）
    channel_id   uuid        NOT NULL UNIQUE,
    state        text        NOT NULL CONSTRAINT workspace_buzz_binding_state_enum CHECK (state IN
                     ('UNBOUND','PROVISIONING','RECONCILING','ACTIVE','DISABLED')),
    version      integer     NOT NULL DEFAULT 1,
    created_at   timestamptz NOT NULL DEFAULT now()
);
