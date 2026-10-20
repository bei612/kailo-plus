# DD-129(2): Wren 只拿到这个角色：只有 CONNECT、public USAGE 与表 SELECT。
# 由原 docker-entrypoint 在首次初始化时 source；口令来自组件专属 secret env。
if [ -z "${WREN_SAMPLE_READER_PASSWORD:-}" ] || [ "${#WREN_SAMPLE_READER_PASSWORD}" -lt 24 ]; then
  echo 'WREN_SAMPLE_READER_PASSWORD 缺失或过短（至少 24 字符）' >&2
  exit 1
fi
psql -v ON_ERROR_STOP=1 -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v reader_password="$WREN_SAMPLE_READER_PASSWORD" <<'SQL'
REVOKE ALL ON DATABASE retail FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE ROLE wren_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 20 PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE retail TO wren_reader;
GRANT USAGE ON SCHEMA public TO wren_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wren_reader;
ALTER ROLE wren_reader SET default_transaction_read_only = on;
ALTER ROLE wren_reader SET statement_timeout = '30s';
ALTER ROLE wren_reader SET idle_in_transaction_session_timeout = '60s';
SQL
