-- 上行迁移只把有执行证据的存量行从 NOT_DISPATCHED 推进到 DISPATCHED，原状态
-- 没有留存；退回 NOT_DISPATCHED 就是把已发生的派发重新渲染为「尚未开始」，
-- 并让对账作业对已执行的 Workflow 再驱动一次。回滚不改数据。
SELECT 1;
