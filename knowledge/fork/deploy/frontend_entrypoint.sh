#!/bin/sh
set -eu
umask 077

# The original native callback derives its URI from Host/X-Forwarded-Proto.
# Its nginx API proxy otherwise overwrites HTTPS ingress with internal HTTP.
# Use one configured native origin, never arbitrary forwarded request headers.
refuse() {
    echo 'knowledge frontend configuration refused' >&2
    exit 78
}
[ "$#" -eq 0 ] || refuse
case "${KNOWLEDGE_NATIVE_ORIGIN:-}" in
    https://*) native_scheme=https; native_authority=${KNOWLEDGE_NATIVE_ORIGIN#https://} ;;
    http://*) native_scheme=http; native_authority=${KNOWLEDGE_NATIVE_ORIGIN#http://} ;;
    *) refuse ;;
esac
native_authority=${native_authority%/}
printf '%s\n' "$native_authority" |
    grep -Eq '^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$' || refuse

proxy_tmp=$(mktemp /etc/nginx/api-proxy.XXXXXX)
trap 'rm -f "$proxy_tmp"' EXIT HUP INT TERM
awk -v authority="$native_authority" -v scheme="$native_scheme" \
    -f /opt/kailo-knowledge/render_proxy.awk \
    /opt/kailo-knowledge/native-api-proxy.conf > "$proxy_tmp" || refuse
mv "$proxy_tmp" /etc/nginx/api-proxy.conf
trap - EXIT HUP INT TERM
exec /docker-entrypoint.sh
