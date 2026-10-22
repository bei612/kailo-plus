-- DD-134(3)⑥：Gateway ConfigResource 的 Core 写入证据（SF-AGW-28：Gateway 只保存当前值与
-- 递增 revision，不保存历史与写入者）。Core 每次写入并回读确认后追加一行；它是
-- ComponentProjection 与验证 route 写入的 evidence，不是新实体，也不反向授权。
-- 值在写入前已按 DD-134(4) 打码；原值只留摘要。
CREATE TABLE projection.gateway_config_revision (
    id                  uuid PRIMARY KEY,
    kind                text        NOT NULL CHECK (kind <> ''),
    resource_id         text        NOT NULL CHECK (resource_id <> ''),
    revision            bigint      NOT NULL CHECK (revision > 0),
    deleted             boolean     NOT NULL,
    masked_value        jsonb       NOT NULL,
    value_digest        text        NOT NULL CHECK (value_digest ~ '^[0-9a-f]{64}$'),
    -- 写入点以 scope 声明的 ActionExecution；未声明的写入（如 Tenant 删除链的批量退役）为空
    action_execution_id uuid,
    operation_id        uuid,
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gateway_config_revision_attribution CHECK ((action_execution_id IS NULL) = (operation_id IS NULL)),
    CONSTRAINT gateway_config_revision_unique UNIQUE (kind, resource_id, revision)
);
