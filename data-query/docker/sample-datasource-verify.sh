#!/usr/bin/env bash
# DD-129 / V-SCN-174：核验 Wren 示例业务库的只读角色。在部署主机运行：
#   sample-datasource-verify.sh <wren-sample-db 容器名>
# 只以 wren_reader 连接（口令取自容器内组件专属 env，不回显）；任何写入、建对象、
# 临时表或在会话内关闭只读后写入成功即失败。不修改数据。
set -euo pipefail
container=${1:?wren-sample-db container}
D=(sudo -n docker)
reader() {
  "${D[@]}" exec -i "$container" sh -c \
    'PGPASSWORD="$WREN_SAMPLE_READER_PASSWORD" exec psql -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U wren_reader -d retail' 2>&1
}
fail=0
for table in regions stores products customers orders order_items; do
  count=$(reader <<<"select count(*) from $table;")
  if [[ $count =~ ^[1-9][0-9]*$ ]]; then echo "PASS 只读查询 $table：$count 行"; else echo "FAIL 只读查询 $table：$count"; fail=1; fi
done
refused() {  # <说明> <SQL> [只认权限拒绝]
  local out pattern='permission denied|read-only transaction'
  [ -z "${3:-}" ] || pattern='permission denied'
  if out=$(reader <<<"$2"); then echo "FAIL $1 竟然成功"; fail=1; return; fi
  if grep -qE "$pattern" <<<"$out"; then
    echo "PASS $1 被拒绝：$(grep -oE 'permission denied[^"]*|cannot execute [A-Z ]+ in a read-only transaction' <<<"$out" | head -1)"
  else
    echo "FAIL $1 以非权限原因失败：$(head -1 <<<"$out")"; fail=1
  fi
}
refused 'INSERT' "insert into regions values (99,'测试');"
refused 'UPDATE' "update orders set status='已退款' where order_id=1;"
refused 'DELETE' "delete from order_items where order_id=1;"
refused 'CREATE TABLE' "create table probe(id int);"
refused 'CREATE TEMP TABLE' "create temp table probe(id int);"
refused '关闭会话只读后 INSERT' "set default_transaction_read_only=off; begin read write; insert into regions values (98,'测试'); commit;" strict
refused '关闭会话只读后 UPDATE' "begin read write; update orders set total_amount=0 where order_id=1; commit;" strict
refused 'TRUNCATE' "begin read write; truncate order_items; commit;" strict
settings=$(reader <<<"select setting from pg_settings where name in ('default_transaction_read_only','statement_timeout') order by name;" | tr '\n' ' ')
echo "会话默认：default_transaction_read_only/statement_timeout = $settings"
privileges=$(reader <<<"select rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls from pg_roles where rolname=current_user;")
[ "$privileges" = f ] && echo 'PASS 角色无超级用户/建库/建角色/复制/绕过 RLS 属性' || { echo 'FAIL 角色属性越权'; fail=1; }
exit "$fail"
