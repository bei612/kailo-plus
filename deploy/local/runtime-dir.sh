# 运行目录（ADR-20 §3）：本拓扑的运行投递与数据（.env、secrets/、data/）所在目录。
#
# 缺省为本目录——开发机与 init-local.sh 的本地拓扑不变。CI 节点上运行目录的唯一来源是
# CI 配置（ci/config.json）的 runtime：发布入口（tools/release/node.py）与组件入口
# （deploy/components/component-deploy.sh）自行从该配置读取并导出；在节点上手工调用本目录
# 脚本时由调用方显式给出 KAILO_RUNTIME_DIR=<runtime>。代码与配置取自发布树，投递与数据取自
# 运行目录，发布树保持只读、干净，不放入任何软链接；固定发布树里没有 .env，未给出运行目录时
# 在这里当场拒绝，而不是误用发布树。
#
# 由已 cd 到 deploy/local 的脚本 source：`. ./runtime-dir.sh`，之后以 "$KAILO_RUNTIME_DIR/.env"、
# "$KAILO_RUNTIME_DIR/secrets/…" 引用。变量已导出：Compose 以它插值 compose.yaml 中的
# ${KAILO_RUNTIME_DIR:-.}；经 sudo 调用 Compose 时以 --preserve-env=KAILO_RUNTIME_DIR 保留
# （runtime_compose 即本拓扑的这一调用）。Python 消费者（native-model-delivery.py 等）只接受
# 这里解析出的规范绝对路径，不另设缺省。
runtime_dir_input=${KAILO_RUNTIME_DIR:-.}
KAILO_RUNTIME_DIR=$(realpath -e -- "$runtime_dir_input") \
  || { echo "运行目录不存在：$runtime_dir_input" >&2; exit 2; }
[ -d "$KAILO_RUNTIME_DIR" ] || { echo "运行目录不是目录：$KAILO_RUNTIME_DIR" >&2; exit 2; }
# 运行投递只能是运行目录里的真实文件与目录：软链接正是发布树冒充运行目录的方式。
for runtime_dir_name in .env secrets data; do
  [ ! -L "$KAILO_RUNTIME_DIR/$runtime_dir_name" ] \
    || { echo "运行目录中的 $runtime_dir_name 是软链接，拒绝：$KAILO_RUNTIME_DIR" >&2; exit 2; }
done
[ -f "$KAILO_RUNTIME_DIR/.env" ] || { echo "运行目录缺少 .env：$KAILO_RUNTIME_DIR" >&2; exit 2; }
export KAILO_RUNTIME_DIR
unset runtime_dir_input runtime_dir_name
# 本拓扑的 Compose：配置取自本目录的 compose.yaml，.env 与运行投递取自运行目录。
runtime_compose() {
  sudo -n --preserve-env=KAILO_RUNTIME_DIR docker compose --env-file "$KAILO_RUNTIME_DIR/.env" -f compose.yaml "$@"
}
