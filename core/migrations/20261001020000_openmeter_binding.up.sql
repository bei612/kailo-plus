-- DD-38、.design/03 §8：一个 Tenant 的唯一原生 Customer 引用。
-- Customer ID 只有实际查证后才写入；建立前的未知结果沿原 Workflow/Operation 恢复。
CREATE TABLE projection.openmeter_binding (
    tenant_id uuid PRIMARY KEY REFERENCES identity.tenant (id),
    namespace text NOT NULL CHECK (namespace <> ''),
    customer_id text NOT NULL CHECK (customer_id <> ''),
    subject_key_prefix text NOT NULL CHECK (subject_key_prefix <> ''),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    UNIQUE (namespace, customer_id)
);
