-- Stage 1 的身份与作用域实体（.design/03-领域模型与权限模型.md）。
--
-- 字段与状态机以 .design/03 为准，本迁移不引入任何新语义。
-- 状态取值同时定义在 contracts/enums/。约束显式命名为 <枚举名>_enum，
-- tools/check.sh 的迁移步骤按该名字精确对应 contracts/enums/<枚举名>.schema.json
-- 并逐值比对；两处漂移即门禁失败——迁移是时间点快照，契约是当前权威。
--
-- version 列承载乐观并发（01 §7）：写入方带上读到的版本，不匹配即 CONFLICT。

-- identity schema 在此创建而不是补进 init 迁移：迁移一经应用即不可变，
-- 改写已应用的迁移会让 checksum 失配、历史不可信。迁移只能追加。
CREATE SCHEMA identity;
COMMENT ON SCHEMA identity IS 'IdentityProvider、HumanIdentity、Tenant/Workspace、membership、session、Buzz 身份绑定';

CREATE TABLE identity.identity_provider (
    id                    uuid PRIMARY KEY,
    issuer                text        NOT NULL,
    client_id             text        NOT NULL,
    claim_mapping_version integer     NOT NULL,
    status                text        NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, client_id)
);

CREATE TABLE identity.human_identity (
    id           uuid PRIMARY KEY,
    display_name text        NOT NULL,
    status       text        NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- 外部身份到平台身份的映射。(issuer, subject) 是 Gateway 投影进来的唯一事实，
-- 因此必须全局唯一——同一 subject 不得挂到两个 HumanIdentity 上。
CREATE TABLE identity.external_identity (
    id                uuid PRIMARY KEY,
    provider_id       uuid        NOT NULL REFERENCES identity.identity_provider (id),
    issuer            text        NOT NULL,
    subject           text        NOT NULL,
    human_identity_id uuid        NOT NULL REFERENCES identity.human_identity (id),
    status            text        NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (issuer, subject)
);

CREATE TABLE identity.tenant (
    id         uuid PRIMARY KEY,
    slug       text        NOT NULL UNIQUE,
    name       text        NOT NULL,
    state      text        NOT NULL CONSTRAINT tenant_state_enum CHECK (state IN
                   ('PROVISIONING','ACTIVE','SUSPENDING','SUSPENDED','RESTORING','DELETING','DELETED','ERROR')),
    version    integer     NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.workspace (
    id         uuid PRIMARY KEY,
    tenant_id  uuid        NOT NULL REFERENCES identity.tenant (id),
    slug       text        NOT NULL,
    name       text        NOT NULL,
    state      text        NOT NULL CONSTRAINT workspace_state_enum CHECK (state IN
                   ('PROVISIONING','ACTIVE','SUSPENDING','SUSPENDED','RESTORING','ERROR')),
    version    integer     NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE identity.principal (
    id         uuid PRIMARY KEY,
    tenant_id  uuid        NOT NULL REFERENCES identity.tenant (id),
    kind       text        NOT NULL CHECK (kind IN ('HUMAN', 'AGENT', 'SERVICE')),
    status     text        NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 一个 HumanIdentity 在一个 Tenant 内只有一条 membership；
-- 重新授权创建新 version 而不是插第二行（.design/10 §4）。
CREATE TABLE identity.tenant_membership (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid        NOT NULL REFERENCES identity.tenant (id),
    human_identity_id   uuid        NOT NULL REFERENCES identity.human_identity (id),
    tenant_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    state               text        NOT NULL CONSTRAINT tenant_membership_state_enum CHECK (state IN
                            ('INVITED','PROVISIONING','ACTIVE','REVOKING','REVOKED','ERROR')),
    version             integer     NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, human_identity_id)
);

CREATE TABLE identity.workspace_membership (
    id                  uuid PRIMARY KEY,
    workspace_id        uuid        NOT NULL REFERENCES identity.workspace (id),
    tenant_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    state               text        NOT NULL CONSTRAINT workspace_membership_state_enum CHECK (state IN
                            ('PROVISIONING','ACTIVE','REVOKING','REVOKED','ERROR')),
    version             integer     NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, tenant_principal_id)
);

-- PlatformSession 撤销必须立即对新请求与 stream 生效（03 §4.1），
-- 因此 status 与 expires_at 都要可索引。
CREATE TABLE identity.platform_session (
    id                   uuid PRIMARY KEY,
    human_identity_id    uuid        NOT NULL REFERENCES identity.human_identity (id),
    tenant_membership_id uuid        NOT NULL REFERENCES identity.tenant_membership (id),
    current_workspace_id uuid        REFERENCES identity.workspace (id),
    issued_at            timestamptz NOT NULL,
    expires_at           timestamptz NOT NULL,
    status               text        NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
);

CREATE INDEX platform_session_active
    ON identity.platform_session (human_identity_id, expires_at)
    WHERE status = 'ACTIVE';

-- custody=SERVER 时 private_key_secret_ref 必须非空（Core 代签）；
-- custody=CLIENT 时必须为空（原生端本机持钥）。该约束就是 DD-75 的落点，
-- 写反会让平台以为自己能停止某个 pubkey 的签名。
CREATE TABLE identity.buzz_identity_binding (
    tenant_id              uuid        NOT NULL REFERENCES identity.tenant (id),
    principal_id           uuid        NOT NULL REFERENCES identity.principal (id),
    pubkey                 text        NOT NULL,
    custody                text        NOT NULL CONSTRAINT buzz_identity_custody_enum CHECK (custody IN ('SERVER', 'CLIENT')),
    private_key_secret_ref text,
    kind                   text        NOT NULL CHECK (kind IN ('HUMAN', 'AGENT', 'CONTROL')),
    state                  text        NOT NULL CONSTRAINT buzz_identity_state_enum CHECK (state IN
                               ('PENDING_SECRET','RECONCILING','ACTIVE','REVOKING','REVOKED')),
    version                integer     NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, principal_id),
    UNIQUE (pubkey),
    CONSTRAINT custody_matches_secret_ref CHECK (
        (custody = 'SERVER' AND private_key_secret_ref IS NOT NULL) OR
        (custody = 'CLIENT' AND private_key_secret_ref IS NULL)
    )
);

CREATE TABLE identity.relay_operator_identity (
    catalog_tenant_id        uuid PRIMARY KEY REFERENCES identity.tenant (id),
    pubkey                   text        NOT NULL UNIQUE,
    private_key_secret_ref   text        NOT NULL,
    audience                 text        NOT NULL,
    relay_operator_api_origin text       NOT NULL,
    state                    text        NOT NULL CHECK (state IN ('PENDING_SECRET','ACTIVE','REVOKED')),
    version                  integer     NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now()
);
