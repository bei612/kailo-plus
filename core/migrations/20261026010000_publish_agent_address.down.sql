-- 有发布意图冻结了 Agent 收件人时停止回滚：旧版本 Core 读不到该字段，同一幂等键的重发会被
-- 当成另一次意图，NOT_DELIVERED 重签也会丢掉 agent-address 标签。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM admission.publish_attempt
               WHERE cardinality(addressed_installation_ids) <> 0) THEN
        RAISE EXCEPTION 'Agent address publication intents exist; keep additive schema until original reconciliation retires them';
    END IF;
END $$;
ALTER TABLE admission.publish_attempt
    DROP CONSTRAINT publish_agent_address_shape,
    DROP COLUMN addressed_installation_ids;
