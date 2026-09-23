-- 发布结果对账只扫「有 DISPATCH 而没有结果」的动作（DD-81）。DISPATCH 只增不减，
-- 不加部分索引时每一轮都要走全表。
CREATE INDEX audit_event_dispatch ON audit.audit_event (occurred_at)
    WHERE event_type = 'DISPATCH';
