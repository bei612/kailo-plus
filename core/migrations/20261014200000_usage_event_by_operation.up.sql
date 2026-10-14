-- .design/14 §7：业务操作时间线按根 operation 读取 UsageEvent 投递事实；只加读索引，不改数据。
CREATE INDEX usage_event_by_operation ON outbox.usage_event (operation_id);
