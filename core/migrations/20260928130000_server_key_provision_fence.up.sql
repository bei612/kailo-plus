-- DD-86：先持久封堵旧、新 Core 对同一意图的绑定，再处理 OpenBao 的孤儿版本。
ALTER TABLE admission.server_key_provision_intent
    ADD COLUMN fenced_at timestamptz,
    ADD COLUMN destroyed_at timestamptz,
    ADD CONSTRAINT server_key_provision_terminal_shape CHECK (
        (fenced_at IS NULL AND destroyed_at IS NULL)
        OR (fenced_at IS NOT NULL AND finished_at IS NULL AND destroyed_at IS NULL)
        OR (fenced_at IS NOT NULL AND finished_at IS NOT NULL AND destroyed_at IS NOT NULL)
    );

-- 旧 Core 在 fence 之后仍尝试同事务插入 binding、标记 finished_at 时，
-- 此约束拒绝整笔事务；因此混合版本窗口也不能提交一个已封堵的私钥引用。
