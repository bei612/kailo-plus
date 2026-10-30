-- 回滚 DD-168(5) ComponentSecret。表只登记引用；凭据值在 OpenBao，不随本表删除。
-- 回滚前必须先回滚组件（问数）到不使用组件凭据托管的版本：表一旦删除，组件持有的
-- secretId 全部读不到（404），已迁移的数据源无法连接。已写入的 OpenBao 版本留在该 Tenant
-- namespace，随 Tenant 删除销毁。
DROP TABLE IF EXISTS catalog.component_secret;
