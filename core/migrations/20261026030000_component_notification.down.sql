-- 回滚 DD-138(4) ComponentNotification。条目只是收件箱提醒，不是业务权威：组件仍持有
-- 触发事件的原始事实，回滚丢弃未读提醒而不丢业务数据。回滚须与停用投递入口的 Core
-- 版本一同发布（旧 Core 不再接收投递），否则新投递会因表缺失而得到 503 并由组件退避重试。
DROP TABLE IF EXISTS identity.component_notification;
