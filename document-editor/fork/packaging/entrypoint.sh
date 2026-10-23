#!/bin/sh
# Kailo document-editor entrypoint (DD-132(3)). Replaces the official
# run-document-server.sh: nothing is generated or downloaded at start except
# the runtime files below, all in the /run/kailo-ds tmpfs. Any missing or
# unsafe input stops the container before a service starts.
set -eu
umask 027
python3 -I /usr/local/lib/kailo-ds/runtime-config.py
nginx -t -q -c /etc/nginx/nginx.conf
exec /usr/bin/supervisord -c /etc/kailo-ds/supervisord.conf
