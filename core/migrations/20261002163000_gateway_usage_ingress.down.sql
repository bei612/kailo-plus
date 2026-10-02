-- 停止 consumer 后只允许撤回未推进的初始恢复位置；不能抹掉实际消费进度。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM projection.ingress_checkpoint
               WHERE source_key <> 'agentgateway-durable-usage-tail'
                  OR tenant_id IS NOT NULL OR cursor <> '0') THEN
        RAISE EXCEPTION 'IngressCheckpoint 已推进或存在其他持久流，停止回滚'
            USING ERRCODE='restrict_violation';
    END IF;
END;
$$ LANGUAGE plpgsql;
DROP TABLE projection.ingress_checkpoint;
