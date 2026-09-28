# Core 数据库连接串的唯一编码点。调用方已载入部署配置；口令只从同一受控文件读取。
# authority 区分容器入口与宿主迁移入口，不接受另一份口令或数据库配置。
core_database_url() {
  local secret_dir
  secret_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/secrets" || return 2
  python3 - "${1:?需要数据库 authority}" "${CORE_DB_USER:?}" "${CORE_DB_NAME:?}" \
    "$secret_dir/core_db_password" <<'PY'
import pathlib
import sys
from urllib.parse import quote, urlsplit

authority, user, database, password_file = sys.argv[1:]
try:
    endpoint = urlsplit("postgres://" + authority)
    port = endpoint.port
except ValueError:
    raise SystemExit("数据库 authority 的主机或端口无效") from None
if (not endpoint.hostname or not port or endpoint.netloc != authority or endpoint.username is not None
        or endpoint.password is not None or endpoint.path or endpoint.query
        or endpoint.fragment or any(c.isspace() for c in authority)):
    raise SystemExit("数据库 authority 必须只包含主机和端口")
password = pathlib.Path(password_file).read_text(encoding="utf-8").rstrip("\n")
if not password:
    raise SystemExit("Core 数据库密码为空")
print("postgres://" + quote(user, safe="") + ":" + quote(password, safe="")
      + "@" + authority + "/" + quote(database, safe=""))
PY
}
