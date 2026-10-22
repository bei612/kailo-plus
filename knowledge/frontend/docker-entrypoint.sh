#!/bin/sh

# The complete native SPA may be hosted in Kailo's content pane. Its own
# authentication and API authorization are unchanged; only named parent origins
# may frame it. Empty configuration retains the original same-origin policy.
NATIVE_FRAME_CSP="frame-ancestors 'self'"
NATIVE_FRAME_OPTIONS=SAMEORIGIN

# validate_origin <setting name> <origin>: exact http(s)/tauri origin only.
validate_origin() {
  case "$2" in
    https://*|http://*|tauri://*) origin_authority=${2#*://} ;;
    *) echo "Invalid $1 origin" >&2; exit 78 ;;
  esac
  if ! printf '%s\n' "$origin_authority" |
    grep -Eq '^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(:[0-9]+)?$'; then
    echo "Invalid $1 origin" >&2
    exit 78
  fi
  case "$origin_authority" in
    *\]:*|[!\[]*:*) origin_port=${origin_authority##*:} ;;
    *) origin_port= ;;
  esac
  if [ -n "$origin_port" ] && ! { [ "$origin_port" -gt 0 ] && [ "$origin_port" -le 65535 ]; } 2>/dev/null; then
    echo "Invalid $1 port" >&2
    exit 78
  fi
}

set -f
for frame_origin in ${KAILO_FRAME_ANCESTORS:-}; do
  validate_origin KAILO_FRAME_ANCESTORS "$frame_origin"
  NATIVE_FRAME_CSP="$NATIVE_FRAME_CSP $frame_origin"
  NATIVE_FRAME_OPTIONS=
done
set +f
export NATIVE_FRAME_CSP NATIVE_FRAME_OPTIONS

# Kailo integration (DD-133). KAILO_ORIGINS are the exact Kailo origins the
# page exchanges postMessage with; they default to the framing origins.
RUNTIME_KAILO_MODE=false
case "${KAILO_MODE:-}" in
  true) RUNTIME_KAILO_MODE=true ;;
  ''|false) ;;
  *) echo 'Invalid KAILO_MODE (true|false)' >&2; exit 78 ;;
esac
RUNTIME_KAILO_ORIGINS=""
set -f
for kailo_origin in ${KAILO_ORIGINS:-${KAILO_FRAME_ANCESTORS:-}}; do
  validate_origin KAILO_ORIGINS "$kailo_origin"
  RUNTIME_KAILO_ORIGINS="${RUNTIME_KAILO_ORIGINS:+$RUNTIME_KAILO_ORIGINS }$kailo_origin"
done
set +f
RUNTIME_KAILO_LOGOUT_URL=""
if [ -n "${KAILO_LOGOUT_URL:-}" ]; then
  case "$KAILO_LOGOUT_URL" in
    https://*|http://*) ;;
    *) echo 'Invalid KAILO_LOGOUT_URL' >&2; exit 78 ;;
  esac
  if [ "${#KAILO_LOGOUT_URL}" -gt 2048 ] ||
    printf '%s' "$KAILO_LOGOUT_URL" | grep -q '[[:space:][:cntrl:]"<>\\`]'; then
    echo 'Invalid KAILO_LOGOUT_URL' >&2
    exit 78
  fi
  RUNTIME_KAILO_LOGOUT_URL=$KAILO_LOGOUT_URL
fi
# Display name: printable text only, escaped for a JS string literal.
RUNTIME_DISPLAY_NAME=""
if [ -n "${PLATFORM_DISPLAY_NAME:-}" ]; then
  if [ "${#PLATFORM_DISPLAY_NAME}" -gt 240 ] ||
    printf '%s' "$PLATFORM_DISPLAY_NAME" | grep -q '[[:cntrl:]]'; then
    echo 'Invalid PLATFORM_DISPLAY_NAME' >&2
    exit 78
  fi
  RUNTIME_DISPLAY_NAME=$(printf '%s' "$PLATFORM_DISPLAY_NAME" |
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g' -e 's/>/\\u003e/g')
fi

# Only emit whitelisted locale tags to avoid config.js injection from env values.
RUNTIME_DEFAULT_LOCALE=""
case "${DEFAULT_LOCALE:-}" in
  zh-CN|en-US|ru-RU|ko-KR|ja-JP) RUNTIME_DEFAULT_LOCALE="${DEFAULT_LOCALE}" ;;
esac

# 生成运行时配置文件，注入环境变量到前端
FILE_MB=${MAX_FILE_SIZE_MB:-50}
SKILL_MB=${MAX_SKILL_BUNDLE_SIZE_MB:-256}
if [ "$SKILL_MB" -lt "$FILE_MB" ] 2>/dev/null; then
  SKILL_MB=$FILE_MB
fi
if [ "$SKILL_MB" -gt 512 ] 2>/dev/null; then
  SKILL_MB=512
fi

cat > /usr/share/nginx/html/config.js << EOF
window.__RUNTIME_CONFIG__ = {
  MAX_FILE_SIZE_MB: ${FILE_MB},
  MAX_SKILL_BUNDLE_SIZE_MB: ${SKILL_MB},
  DEFAULT_LOCALE: "${RUNTIME_DEFAULT_LOCALE}",
  KAILO_MODE: ${RUNTIME_KAILO_MODE},
  PLATFORM_DISPLAY_NAME: "${RUNTIME_DISPLAY_NAME}",
  KAILO_ORIGINS: "${RUNTIME_KAILO_ORIGINS}",
  KAILO_LOGOUT_URL: "${RUNTIME_KAILO_LOGOUT_URL}"
};
EOF

# 处理 nginx 配置。
# 两个上限分开注入：全站保持知识库的 MAX_FILE_SIZE，只有技能 zip 上传的两条
# 集合路由放宽到 MAX_SKILL_BUNDLE_SIZE（不含 /install、PATCH 等子路径）。
# 合成一个全站上限会让每个上传端点都能收到技能包那么大的 body。
export MAX_FILE_SIZE=${FILE_MB}M
export MAX_SKILL_BUNDLE_SIZE=${SKILL_MB}M
export APP_HOST=${APP_HOST:-app}
export APP_PORT=${APP_PORT:-8080}
export APP_SCHEME=${APP_SCHEME:-http}
envsubst '${MAX_FILE_SIZE} ${MAX_SKILL_BUNDLE_SIZE} ${APP_HOST} ${APP_PORT} ${APP_SCHEME} ${NATIVE_FRAME_CSP} ${NATIVE_FRAME_OPTIONS}' \
  < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# 启动 nginx
exec nginx -g 'daemon off;'
