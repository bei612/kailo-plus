-- DD-21/38/51、03 §8：因果引用和短期投递事实，不保存余额、账单或模型正文。
CREATE TABLE projection.agent_model_trace (
    invocation_id uuid PRIMARY KEY REFERENCES catalog.agent_invocation(id),
    trace_id text NOT NULL UNIQUE CHECK (trace_id ~ '^[0-9a-f]{32}$' AND trace_id <> repeat('0',32)),
    span_id text NOT NULL CHECK (span_id ~ '^[0-9a-f]{16}$' AND span_id <> repeat('0',16)),
    operation_id uuid NOT NULL UNIQUE REFERENCES admission.action_execution(operation_id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    gateway_principal_id uuid NOT NULL REFERENCES identity.principal(id),
    openmeter_customer_id text NOT NULL CHECK (openmeter_customer_id <> ''),
    openmeter_namespace text NOT NULL CHECK (openmeter_namespace <> ''),
    subject_key text NOT NULL CHECK (subject_key <> ''),
    binding_version integer NOT NULL CHECK (binding_version > 0),
    meter_projection jsonb NOT NULL CHECK (jsonb_typeof(meter_projection)='array' AND jsonb_array_length(meter_projection)>0),
    invocation_meter_projection jsonb NOT NULL CHECK ((jsonb_typeof(invocation_meter_projection)='object'
        AND invocation_meter_projection->>'key'='automation.run') IS TRUE),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox.usage_event (
    id uuid PRIMARY KEY,
    invocation_id uuid NOT NULL REFERENCES projection.agent_model_trace(invocation_id),
    operation_id uuid NOT NULL REFERENCES admission.action_execution(operation_id),
    tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
    workspace_id uuid NOT NULL REFERENCES identity.workspace(id),
    openmeter_customer_id text NOT NULL CHECK (openmeter_customer_id <> ''),
    agent_installation_resource_id uuid NOT NULL REFERENCES catalog.agent_installation(resource_id),
    source_type text NOT NULL CHECK (source_type IN ('GATEWAY_DURABLE_USAGE','AGENT_INVOCATION')),
    source_id uuid NOT NULL,
    native_seq bigint CHECK (native_seq > 0),
    native_turn_id text CHECK (native_turn_id <> ''),
    meter_key text NOT NULL CHECK (meter_key <> ''),
    subject_key text NOT NULL CHECK (subject_key <> ''),
    quantity bigint NOT NULL CHECK (quantity >= 0),
    occurred_at timestamptz NOT NULL,
    dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions)='object'),
    openmeter_event_id uuid NOT NULL UNIQUE,
    event jsonb NOT NULL CHECK (jsonb_typeof(event)='object'),
    settlement_status text NOT NULL CHECK (settlement_status IN ('PENDING_PUBLISH','ACCEPTED','COMMITTED','FAILED','UNKNOWN')),
    stored_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id,source_type,source_id,meter_key),
    CHECK ((source_type='GATEWAY_DURABLE_USAGE' AND native_seq IS NOT NULL AND native_turn_id IS NULL)
        OR (source_type='AGENT_INVOCATION' AND native_seq IS NULL AND native_turn_id IS NOT NULL
            AND source_id=invocation_id AND meter_key='automation.run' AND quantity=1)),
    CHECK ((settlement_status='COMMITTED') = (stored_at IS NOT NULL))
);
CREATE FUNCTION projection.guard_agent_model_usage() RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME='agent_model_trace' THEN
        IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '已派发模型的 trace/归属/meter 事实不可替换' USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM catalog.agent_invocation i
        JOIN admission.action_execution a ON a.id=i.action_execution_id
        JOIN catalog.agent_model_binding b ON b.installation_resource_id=i.installation_resource_id
          AND b.projection_generation=i.projection_generation
        JOIN identity.principal p ON p.id=b.gateway_principal_id AND p.tenant_id=i.tenant_id AND p.kind='SERVICE'
        JOIN projection.openmeter_binding o ON o.tenant_id=i.tenant_id
        WHERE i.id=NEW.invocation_id AND a.operation_id=NEW.operation_id
          AND i.tenant_id=NEW.tenant_id AND i.workspace_id=NEW.workspace_id
          AND a.tenant_id=i.tenant_id AND a.workspace_id=i.workspace_id
          AND b.gateway_principal_id=NEW.gateway_principal_id
          AND o.customer_id=NEW.openmeter_customer_id AND o.namespace=NEW.openmeter_namespace
          AND o.version=NEW.binding_version AND NEW.subject_key=o.subject_key_prefix || i.installation_resource_id::text;
    ELSE
        IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['settlement_status','stored_at','updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['settlement_status','stored_at','updated_at']) THEN
            RAISE EXCEPTION 'UsageEvent 已冻结的身份/quantity/CloudEvent 不可替换' USING ERRCODE='check_violation';
        END IF;
        IF TG_OP='UPDATE' AND OLD.settlement_status='COMMITTED' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '已查证 stored_at 的事件不得回退或重判' USING ERRCODE='check_violation';
        END IF;
        PERFORM 1 FROM projection.agent_model_trace t JOIN catalog.agent_invocation i ON i.id=t.invocation_id
        JOIN LATERAL (
            SELECT value FROM jsonb_array_elements(t.meter_projection) WHERE NEW.source_type='GATEWAY_DURABLE_USAGE'
            UNION ALL SELECT t.invocation_meter_projection WHERE NEW.source_type='AGENT_INVOCATION'
        ) m(value) ON true
        WHERE t.invocation_id=NEW.invocation_id AND t.operation_id=NEW.operation_id
          AND t.tenant_id=NEW.tenant_id AND t.workspace_id=NEW.workspace_id
          AND t.openmeter_customer_id=NEW.openmeter_customer_id AND t.subject_key=NEW.subject_key
          AND i.installation_resource_id=NEW.agent_installation_resource_id
          AND NEW.openmeter_event_id=NEW.id AND NEW.event->>'id'=NEW.openmeter_event_id::text
          AND NEW.event->>'source'='urn:platform:core:usage' AND NEW.event->>'specversion'='1.0'
          AND (NEW.event->>'time')::timestamptz=NEW.occurred_at
          AND NEW.event->>'subject'=NEW.subject_key AND NEW.event->>'type'=m.value->>'event_type'
          AND NEW.meter_key=m.value->>'key'
          AND NEW.dimensions @> jsonb_build_object('tenant_id',NEW.tenant_id,'workspace_id',NEW.workspace_id,
              'operation_id',NEW.operation_id,'agent_installation_resource_id',NEW.agent_installation_resource_id,
              'agent_version_asset_id',i.agent_version_asset_id)
          AND ((NEW.source_type='GATEWAY_DURABLE_USAGE'
            AND ((NEW.event->'data')-ARRAY['inputTokens','outputTokens','totalTokens'])=NEW.dimensions
            AND CASE m.value->>'value_property'
              WHEN '$.inputTokens' THEN (NEW.event->'data'->>'inputTokens')::bigint
              WHEN '$.outputTokens' THEN (NEW.event->'data'->>'outputTokens')::bigint
              WHEN '$.totalTokens' THEN (NEW.event->'data'->>'totalTokens')::bigint
              ELSE NULL END = NEW.quantity)
            OR (NEW.source_type='AGENT_INVOCATION' AND NEW.native_turn_id=i.runtime_turn_id
                AND NEW.quantity=1 AND NEW.event->'data'=NEW.dimensions
                AND NEW.dimensions->>'automation_resource_id'=i.automation_resource_id::text));
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION '模型 trace/usage 必须引用同 scope 的 Invocation/Action/受控 binding' USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER agent_model_trace_scope_guard BEFORE INSERT OR UPDATE ON projection.agent_model_trace
    FOR EACH ROW EXECUTE FUNCTION projection.guard_agent_model_usage();
CREATE TRIGGER usage_event_scope_guard BEFORE INSERT OR UPDATE ON outbox.usage_event
    FOR EACH ROW EXECUTE FUNCTION projection.guard_agent_model_usage();
