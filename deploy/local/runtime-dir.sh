# 运行目录（ADR-20 §3）：本拓扑的运行投递与数据（.env、secrets/、data/）所在目录。
#
# 缺省为本目录——开发机与 init-local.sh 的本地拓扑不变。发布入口（tools/release）以
# KAILO_RUNTIME_DIR 指向固定发布树之外的运行目录：代码与配置取自发布树，投递与数据取自
# 运行目录，发布树保持只读、干净，不再放入软链接。
#
# 由已 cd 到 deploy/local 的脚本 source：`. ./runtime-dir.sh`，之后以 "$KAILO_RUNTIME_DIR/.env"、
# "$KAILO_RUNTIME_DIR/secrets/…" 引用。变量已导出：Compose 以它插值 compose.yaml 中的
# ${KAILO_RUNTIME_DIR:-.}；经 sudo 调用 Compose 时以 --preserve-env=KAILO_RUNTIME_DIR 保留。
runtime_dir_input=${KAILO_RUNTIME_DIR:-.}
KAILO_RUNTIME_DIR=$(realpath -e -- "$runtime_dir_input") \
  || { echo "运行目录不存在：$runtime_dir_input" >&2; exit 2; }
[ -f "$KAILO_RUNTIME_DIR/.env" ] || { echo "运行目录缺少 .env：$KAILO_RUNTIME_DIR" >&2; exit 2; }
export KAILO_RUNTIME_DIR
unset runtime_dir_input
