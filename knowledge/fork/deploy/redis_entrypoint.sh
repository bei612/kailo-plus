#!/bin/sh
set -eu
umask 077

# Compose file-backed secrets retain host ownership. The official Redis
# entrypoint drops from root to redis, so a root-owned 0600 Agent template is
# unreadable by the final process. Copy only into a private tmpfs, not /data.
refuse() {
    echo 'knowledge redis configuration refused' >&2
    exit 78
}
[ "$#" -eq 0 ] || refuse
[ -f /run/secrets/redis_config ] || refuse
case "$(stat -c '%a' /run/secrets/redis_config)" in
    400|440|600|640) ;;
    *) refuse ;;
esac
config_size=$(wc -c < /run/secrets/redis_config)
[ "$config_size" -gt 0 ] && [ "$config_size" -le 65536 ] || refuse
cp /run/secrets/redis_config /run/kailo-redis/redis.conf
chmod 600 /run/kailo-redis/redis.conf
chown redis:redis /run/kailo-redis /run/kailo-redis/redis.conf
chmod 700 /run/kailo-redis
exec /usr/local/bin/docker-entrypoint.sh redis-server /run/kailo-redis/redis.conf
