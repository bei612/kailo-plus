-- DD-169(5)：ComponentSecret（.design/03 §3，07 §4.8.11）。组件自有业务配置中的凭据（一期
-- 为问数数据源连接的口令与密钥）经 Core 写入该 Tenant 的 OpenBao，组件只持有本表的 id。
--
-- 归 catalog：与 mcp_connection 的凭据引用同理，它按 binding 归属、Core 即权威。它不是
-- Resource：没有 owner、不写 SpiceDB 关系、不授予权限。值从不入库；locator 只在本表，
-- 不进审计 evidence。
CREATE TABLE catalog.component_secret (
    id                      uuid        PRIMARY KEY,
    tenant_id               uuid        NOT NULL REFERENCES identity.tenant (id),
    application_binding_id  uuid        NOT NULL REFERENCES catalog.application_binding (id),
    purpose                 text        NOT NULL,
    -- SecretRef：每个 secret 独占一个 CAS=0 locator，版本恒为 1。
    secret_locator          text        NOT NULL UNIQUE,
    secret_version          integer     NOT NULL,
    secret_audience         text        NOT NULL,
    state                   text        NOT NULL DEFAULT 'ACTIVE',
    created_by_principal_id uuid        NOT NULL REFERENCES identity.principal (id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    retired_by_principal_id uuid        REFERENCES identity.principal (id),
    retired_at              timestamptz,

    CONSTRAINT component_secret_purpose_enum CHECK (purpose IN ('DATA_SOURCE_CONNECTION')),
    CONSTRAINT component_secret_state_enum CHECK (state IN ('ACTIVE','RETIRED')),
    CONSTRAINT component_secret_version_one CHECK (secret_version = 1),
    CONSTRAINT component_secret_locator_shape CHECK (secret_locator LIKE '%/component-secret/%'),
    -- 撤销人只在 Tenant 删除时为空（随 namespace 销毁，没有发起人）。
    CONSTRAINT component_secret_retired_shape CHECK (
        (state = 'ACTIVE' AND retired_at IS NULL AND retired_by_principal_id IS NULL)
        OR (state = 'RETIRED' AND retired_at IS NOT NULL AND retired_at >= created_at)
    )
);

-- 每个 binding 的 ACTIVE 计数上限（200）与按 binding 查找。
CREATE INDEX component_secret_binding_active
    ON catalog.component_secret (application_binding_id)
    WHERE state = 'ACTIVE';
CREATE INDEX component_secret_tenant
    ON catalog.component_secret (tenant_id);
