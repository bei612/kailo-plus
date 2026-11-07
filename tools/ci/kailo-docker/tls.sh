#!/usr/bin/env bash
# Generate the mTLS CA, server and client certificates for the Kailo dockerd (idempotent: keeps an existing CA).
# 用法：tls.sh <out 目录> <server IP>...   输出 ca.pem ca-key.pem server-cert.pem server-key.pem cert.pem key.pem
set -euo pipefail
OUT=${1:?out}; shift; [ $# -gt 0 ] || { echo "need server IPs" >&2; exit 2; }
umask 077; mkdir -p "$OUT"; cd "$OUT"
[ -f ca-key.pem ] || { openssl genrsa -out ca-key.pem 4096 2>/dev/null; openssl req -new -x509 -days 3650 -key ca-key.pem -sha256 -subj "/CN=kailo-docker-ca" -out ca.pem; }
san=$(printf 'IP:%s,' "$@"); san=${san%,}
openssl genrsa -out server-key.pem 4096 2>/dev/null
openssl req -new -key server-key.pem -subj "/CN=kailo-ci-docker" -out server.csr
printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$san" > server.ext
openssl x509 -req -days 1825 -sha256 -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -extfile server.ext 2>/dev/null
openssl genrsa -out key.pem 4096 2>/dev/null
openssl req -new -key key.pem -subj "/CN=kailo-dev" -out client.csr
printf 'extendedKeyUsage=clientAuth\n' > client.ext
openssl x509 -req -days 1825 -sha256 -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out cert.pem -extfile client.ext 2>/dev/null
rm -f server.csr client.csr server.ext client.ext
echo "tls ready in $OUT"
