-- DD-134(5)②：网关管理区的受控 MCP 探测。探测是只读查询，不是 Governed Action：
-- 只记录谁在何时经哪条临时验证 route 探测了交付目录中的哪个 peer，以及结果摘要。
-- ExtMcp 以本行判定探测 route 上的请求（未完成、未过期、route 一致）；不保存
-- initialize/tools/list 正文，不创建 release、Tool 或 Resource。
CREATE TABLE projection.gateway_mcp_probe (
    id                  uuid        PRIMARY KEY,
    tenant_id           uuid        NOT NULL REFERENCES identity.tenant(id),
    principal_id        uuid        NOT NULL REFERENCES identity.principal(id),
    adapter_service_ref text        NOT NULL CHECK (adapter_service_ref <> ''),
    route_id            text        NOT NULL UNIQUE CHECK (route_id = 'gateway-probe-' || id::text),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    completed_at        timestamptz,
    outcome             text        CHECK (outcome IN ('SUCCEEDED','FAILED','UNKNOWN')),
    tool_schema_digest  text        CHECK (tool_schema_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT gateway_mcp_probe_window CHECK (expires_at > created_at),
    CONSTRAINT gateway_mcp_probe_terminal CHECK ((completed_at IS NULL) = (outcome IS NULL)),
    CONSTRAINT gateway_mcp_probe_digest CHECK (tool_schema_digest IS NULL OR outcome = 'SUCCEEDED')
);
CREATE INDEX gateway_mcp_probe_open ON projection.gateway_mcp_probe (adapter_service_ref)
    WHERE completed_at IS NULL;
