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
install -d -o "$USER_NAME" -g "$USER_NAME" $CI/service $CI/handoff
# `kailo-ci handoff` reads $CI/handoff/handoff.json (ops-maintained JSON list; see the CI-CD 手册)
[ -f $CI/handoff/handoff.json ] || { echo '[]' > $CI/handoff/handoff.json; chown "$USER_NAME:$USER_NAME" $CI/handoff/handoff.json; }
# Host tools the build entries need (tools/release.sh generates SBOMs with syft, ADR-06). Pinned version, official
# release, verified against the published checksums; downloaded directly (the node has no proxy; egress is the
# router's transparent proxy, OPS-02).
SYFT_VERSION=${KAILO_SYFT_VERSION:-1.57.0}
if ! syft version 2>/dev/null | grep -q "Version: *$SYFT_VERSION$"; then
  tmp=$(mktemp -d); base=https://github.com/anchore/syft/releases/download/v$SYFT_VERSION
  curl -sSfL --retry 5 --retry-all-errors -o "$tmp/syft_${SYFT_VERSION}_linux_amd64.tar.gz" "$base/syft_${SYFT_VERSION}_linux_amd64.tar.gz"
  curl -sSfL --retry 5 --retry-all-errors -o "$tmp/checksums.txt" "$base/syft_${SYFT_VERSION}_checksums.txt"
  (cd "$tmp" && grep " syft_${SYFT_VERSION}_linux_amd64.tar.gz$" checksums.txt | sha256sum -c -)
  tar -xzf "$tmp/syft_${SYFT_VERSION}_linux_amd64.tar.gz" -C "$tmp" syft
  install -m 0755 "$tmp/syft" /usr/local/bin/syft; rm -rf "$tmp"
fi
install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$HERE"/kci.py "$HERE"/client.py "$HERE"/worker.py $CI/service/
[ -f $CI/config.json ] || install -o "$USER_NAME" -g "$USER_NAME" -m 0644 "$HERE"/config.template.json $CI/config.json
if [ ! -d /var/lib/kailo-ci/repo/.git ]; then
  sudo -u "$USER_NAME" git clone --no-checkout "${KAILO_CI_ORIGIN:-git@github.com:bei612/kailo-plus.git}" /var/lib/kailo-ci/repo \
    || echo "WARNING: GitHub clone failed (add the CI deploy key); jobs will fail at fetch until it succeeds" >&2
fi
# Additional repositories (config.repositories.<name>): one full GitHub mirror each (origin is usually an
# ~/.ssh/config Host alias bound to that repository's read-only deploy key) and, optionally, their own lane.
REPOS_PY='import json,sys
for n,r in (json.load(open(sys.argv[1])).get("repositories") or {}).items(): print(n, r["origin"], r["source_repository"])'
python3 -c "$REPOS_PY" $CI/config.json | while read -r name origin mirror; do
  if [ ! -f "$mirror/HEAD" ] && [ ! -d "$mirror/.git" ]; then
    install -d -o "$USER_NAME" -g "$USER_NAME" "$(dirname "$mirror")"
    sudo -u "$USER_NAME" git clone --no-checkout "$origin" "$mirror" \
      || echo "WARNING: clone of $name failed (deploy key / ssh alias); its jobs fail at fetch" >&2
  fi
done
# One line per lane: "<lane> <slots>". A repository's `concurrency` (default 1) is the number of workers on its lane; slot 1
# keeps the historical unit name, slot N>1 is <unit>-N. Each slot has its own .path unit on the same pending directory.
LANES_PY='import json,sys
c=json.load(open(sys.argv[1]))
lanes={"release":1,"feedback":1}
for r in (c.get("repositories") or {}).values():
    lane=r.get("lane","feedback"); lanes[lane]=max(lanes.get(lane,1), int(r.get("concurrency",1)))
for lane,n in sorted(lanes.items()): print(lane, n)'
LANE_SLOTS=$(python3 -c "$LANES_PY" $CI/config.json)
PATH_UNITS=()
while read -r lane slots; do
 for slot in $(seq 1 "$slots"); do
  unit=kailo-ci-worker; [ $lane = release ] || unit=kailo-ci-$lane
  [ "$slot" = 1 ] || unit=$unit-$slot
  dir=/var/lib/kailo-ci/queue/pending; [ $lane = release ] || dir=/var/lib/kailo-ci/queue/pending/$lane
  install -d -o "$USER_NAME" -g "$USER_NAME" $dir
  PATH_UNITS+=("$unit.path")
  cat > /etc/systemd/system/$unit.service <<UNIT
[Unit]
Description=Kailo CI $lane lane, slot $slot (GitHub source only)
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
Environment=KAILO_CI_SLOT=$slot
Environment=DOCKER_HOST=unix:///run/kailo-docker/docker.sock
ExecStart=/usr/bin/python3 $CI/service/worker.py
UMask=0077
TimeoutStartSec=infinity
TimeoutStopSec=90
KillMode=control-group
UNIT
  cat > /etc/systemd/system/$unit.path <<UNIT
[Unit]
Description=Watch Kailo CI $lane requests (slot $slot)
[Path]
PathExistsGlob=$dir/*.json
Unit=$unit.service
[Install]
WantedBy=multi-user.target
UNIT
 done
done <<< "$LANE_SLOTS"
systemctl daemon-reload
systemctl enable --now "${PATH_UNITS[@]}"
docker compose -f "$HERE"/control.compose.yaml up -d
docker exec kailo-ci-control python3 /ci/client.py list >/dev/null && echo "kailo-ci service installed"
