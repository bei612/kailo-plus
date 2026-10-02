-- DD-113 / DD-115：平台自持 Nostr 私钥（SERVER HUMAN、Tenant CONTROL、
-- RelayOperatorIdentity）的写入意图、退役与孤儿收敛共用 DD-86 的意图行。意图只冻结
-- locator 与发起的 operation，不含私钥、公钥或 OpenBao metadata。

-- 1. 意图实体扩展（.design/03 ServerKeyProvisionIntent）
ALTER TABLE admission.server_key_provision_intent
    ADD COLUMN key_kind            text,
    ADD COLUMN origin              text,
    ADD COLUMN operation_id        uuid,
    ADD COLUMN commit_deadline_at  timestamptz,
    ADD COLUMN retire_operation_id uuid,
    ADD COLUMN retired_at          timestamptz;

-- 本迁移之前的意图都由 SERVER HUMAN 的 Governed Action 冻结，operation 取自原动作。
UPDATE admission.server_key_provision_intent i
   SET key_kind = 'HUMAN', origin = 'PROVISIONED', operation_id = ae.operation_id
  FROM admission.action_execution ae
 WHERE ae.id = i.action_execution_id;

-- OPERATOR 意图由部署引导或轮换命令发起，没有 ActionExecution；存量补建行两者皆无。
-- 主键改为独立 ID，action_execution_id 保持唯一（ON CONFLICT 仍以它为冲突目标）。
ALTER TABLE admission.server_key_provision_intent
    DROP CONSTRAINT server_key_provision_intent_pkey,
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
    ALTER COLUMN key_kind SET NOT NULL,
    ALTER COLUMN origin SET NOT NULL,
    ALTER COLUMN action_execution_id DROP NOT NULL,
    ALTER COLUMN principal_id DROP NOT NULL;
ALTER TABLE admission.server_key_provision_intent
    ADD CONSTRAINT server_key_provision_intent_pkey PRIMARY KEY (id),
    ADD CONSTRAINT server_key_provision_intent_action_key UNIQUE (action_execution_id),
    ADD CONSTRAINT server_key_provision_key_kind
        CHECK (key_kind IN ('HUMAN', 'CONTROL', 'OPERATOR')),
    ADD CONSTRAINT server_key_provision_origin
        CHECK (origin IN ('PROVISIONED', 'BACKFILLED')),
    -- DD-115 (1)：PROVISIONED 必有发起的 operation；BACKFILLED 如实为空，只以 BOUND
    -- 或 RETIRED 存在（不参与孤儿收敛）。
    ADD CONSTRAINT server_key_provision_origin_shape CHECK (
        (origin = 'PROVISIONED' AND operation_id IS NOT NULL)
        OR (origin = 'BACKFILLED' AND operation_id IS NULL AND action_execution_id IS NULL
            AND finished_at IS NOT NULL AND fenced_at IS NULL AND destroyed_at IS NULL)
    ),
    ADD CONSTRAINT server_key_provision_kind_shape CHECK (
        (key_kind = 'HUMAN' AND principal_id IS NOT NULL
            AND (origin = 'BACKFILLED' OR action_execution_id IS NOT NULL))
        OR (key_kind = 'CONTROL' AND principal_id IS NOT NULL
            AND source_membership_id IS NULL)
        OR (key_kind = 'OPERATOR' AND principal_id IS NULL AND action_execution_id IS NULL
            AND source_membership_id IS NULL)
    ),
    -- DD-115 (4)：PROVISIONED 的 OPERATOR 意图冻结时即带提交截止；其余类别没有。
    ADD CONSTRAINT server_key_provision_commit_deadline CHECK (
        (key_kind = 'OPERATOR' AND origin = 'PROVISIONED') = (commit_deadline_at IS NOT NULL)
    ),
    -- RETIRED 只能由 BOUND 进入，与 FENCED/DESTROYED 互斥；退役审计的 operation
    -- 在到期的同一事务冻结（DD-115 (2)），因此 RETIRED 必有它。
    ADD CONSTRAINT server_key_provision_retired_shape CHECK (
        retired_at IS NULL
        OR (finished_at IS NOT NULL AND fenced_at IS NULL AND destroyed_at IS NULL
            AND retire_operation_id IS NOT NULL)
    ),
    ADD CONSTRAINT server_key_provision_retire_operation_bound CHECK (
        retire_operation_id IS NULL
        OR (finished_at IS NOT NULL AND fenced_at IS NULL AND destroyed_at IS NULL)
    );

-- 同一 HUMAN Principal、同一 Tenant 的 CONTROL、同一 Catalog 的 OPERATOR 各至多一条
-- 未完成意图。
DROP INDEX admission.server_key_provision_one_open_principal;
CREATE UNIQUE INDEX server_key_provision_one_open_human
    ON admission.server_key_provision_intent (tenant_id, principal_id)
    WHERE finished_at IS NULL AND key_kind = 'HUMAN';
CREATE UNIQUE INDEX server_key_provision_one_open_platform_key
    ON admission.server_key_provision_intent (tenant_id, key_kind)
    WHERE finished_at IS NULL AND key_kind IN ('CONTROL', 'OPERATOR');

-- 2. binding 持有的 SecretRef 状态（.design/03：随持有实体持久，不另设表）
ALTER TABLE identity.buzz_identity_binding
    ADD COLUMN private_key_secret_status text;
UPDATE identity.buzz_identity_binding
   SET private_key_secret_status = CASE
           WHEN state IN ('PENDING_SECRET', 'RECONCILING') THEN 'PENDING'
           WHEN state IN ('ACTIVE', 'REVOKING') THEN 'ACTIVE'
           ELSE 'SUPERSEDED'
       END
 WHERE private_key_secret_ref IS NOT NULL;
ALTER TABLE identity.buzz_identity_binding
    ADD CONSTRAINT buzz_identity_secret_status_enum CHECK (
        private_key_secret_status IN ('PENDING', 'ACTIVE', 'SUPERSEDED', 'REVOKED')),
    ADD CONSTRAINT buzz_identity_secret_status_present CHECK (
        (private_key_secret_ref IS NULL) = (private_key_secret_status IS NULL)),
    -- REVOKING 期间先 delete 再转 SUPERSEDED（DD-113 (3)）；到 REVOKED 时引用
    -- 不能仍是 PENDING/ACTIVE。
    ADD CONSTRAINT buzz_identity_secret_status_revoked CHECK (
        state <> 'REVOKED'
        OR private_key_secret_status IS NULL
        OR private_key_secret_status IN ('SUPERSEDED', 'REVOKED'));

-- 3. 存量补建（DD-115 (1)）：本 DD 之前建立、没有意图行的平台自持私钥引用按当前
--    ref 补一条 BACKFILLED 的 BOUND 意图，operation 如实为空。已 REVOKED 的存量
--    binding 没有可追溯的撤销 operation，retire_operation_id 保持为空：它不满足
--    DD-115 (3) 的补做条件，由退役度量告警。
INSERT INTO admission.server_key_provision_intent
    (key_kind, origin, tenant_id, principal_id, target_locator, finished_at)
SELECT b.kind, 'BACKFILLED', b.tenant_id, b.principal_id, b.private_key_secret_ref, now()
  FROM identity.buzz_identity_binding b
 WHERE b.custody = 'SERVER' AND b.kind IN ('HUMAN', 'CONTROL')
   AND b.private_key_secret_ref IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM admission.server_key_provision_intent i
                    WHERE i.target_locator = b.private_key_secret_ref)
ON CONFLICT (target_locator) DO NOTHING;

INSERT INTO admission.server_key_provision_intent
    (key_kind, origin, tenant_id, principal_id, target_locator, finished_at)
SELECT 'OPERATOR', 'BACKFILLED', o.catalog_tenant_id, NULL, o.private_key_secret_ref, now()
  FROM identity.relay_operator_identity o
 WHERE NOT EXISTS (SELECT 1 FROM admission.server_key_provision_intent i
                    WHERE i.target_locator = o.private_key_secret_ref)
ON CONFLICT (target_locator) DO NOTHING;
