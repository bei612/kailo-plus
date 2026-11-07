#!/usr/bin/env bash
# Install / update the Kailo CI service on the CI node (idempotent). Run as root from a checkout of the repo:
#   tools/ci/service/install.sh
# Writes only Kailo paths: /volumes/kailo/ci, /var/lib/kailo-ci, kailo-ci-* systemd units, the kailo-ci-control
# container on the Kailo dockerd. Never touches the system dockerd or other projects.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CI=/volumes/kailo/ci
USER_NAME=${KAILO_CI_USER:-ubuntu}
export DOCKER_HOST=unix:///run/kailo-docker/docker.sock
install -d -o "$USER_NAME" -g "$USER_NAME" $CI $CI/sources /var/lib/kailo-ci /var/lib/kailo-ci/{queue,artifacts,release-proofs,tmp,check-cache,retention}
install -d -o "$USER_NAME" -g "$USER_NAME" $CI/service
install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$HERE"/kci.py "$HERE"/client.py "$HERE"/worker.py $CI/service/
[ -f $CI/config.json ] || install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$HERE"/config.template.json $CI/config.json
if [ ! -d /var/lib/kailo-ci/repo/.git ]; then
  sudo -u "$USER_NAME" git clone --no-checkout "${KAILO_CI_ORIGIN:-git@github.com:bei612/kailo-plus.git}" /var/lib/kailo-ci/repo \
    || echo "WARNING: GitHub clone failed (add the CI deploy key); jobs will fail at fetch until it succeeds" >&2
fi
for lane in release feedback; do
  unit=kailo-ci-worker; [ $lane = feedback ] && unit=kailo-ci-feedback
  dir=/var/lib/kailo-ci/queue/pending; [ $lane = feedback ] && dir=/var/lib/kailo-ci/queue/pending/feedback
  install -d -o "$USER_NAME" -g "$USER_NAME" $dir
  cat > /etc/systemd/system/$unit.service <<UNIT
[Unit]
Description=Kailo CI $lane lane (GitHub source only)
After=kailo-docker.service network-online.target
Requires=kailo-docker.service
[Service]
Type=oneshot
Slice=kailo-ci.slice
User=$USER_NAME
Group=$USER_NAME
SupplementaryGroups=docker
WorkingDirectory=$CI
Environment=KAILO_CI_CONFIG=$CI/config.json
Environment=KAILO_CI_LANE=$lane
Environment=DOCKER_HOST=unix:///run/kailo-docker/docker.sock
ExecStart=/usr/bin/python3 $CI/service/worker.py
UMask=0077
TimeoutStartSec=infinity
TimeoutStopSec=90
KillMode=control-group
UNIT
  cat > /etc/systemd/system/$unit.path <<UNIT
[Unit]
Description=Watch Kailo CI $lane requests
[Path]
PathExistsGlob=$dir/*.json
Unit=$unit.service
[Install]
WantedBy=multi-user.target
UNIT
done
systemctl daemon-reload
systemctl enable --now kailo-ci-worker.path kailo-ci-feedback.path
docker compose -f "$HERE"/control.compose.yaml up -d
docker exec kailo-ci-control python3 /ci/client.py list >/dev/null && echo "kailo-ci service installed"
