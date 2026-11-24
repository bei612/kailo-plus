#!/bin/bash
# post-deploy.sh — the host checks right after a deploy (train e step1.sh, parameterized): trial-account login,
# smokes upload-pdf / agent-turns (in-memory + Codex) / default-share, SpiceDB verify, authz verify, the deploy's
# model-catalog-sync job, and the M0 official run. Each check: exit code, seconds, log file; the JSON lands in
# results/$RUN_ID/00-post-deploy.json. No secret is printed; the trial password is read from its 0600 file.
set -u
D=$(cd "$(dirname "$0")" && pwd)
: "${RUN_ID:?}"; : "${KAILO_SRC:=/volumes/kailo/kailo-macro}"; : "${M0_DIR:=/volumes/kailo/acceptance/m0}"
: "${KAILO_DOCKER_HOST:=unix:///run/kailo-docker/docker.sock}"; : "${KAILO_STATE_DIR:=/volumes/kailo/deploy/kailo}"
: "${TRIAL_EMAIL:=lkdtc2012@gmail.com}"; : "${TRIAL_PW_FILE:=$KAILO_STATE_DIR/accounts/trial-user-lkdtc2012.pw}"
export DOCKER_HOST=$KAILO_DOCKER_HOST KAILO_STATE_DIR
R=$D/results/$RUN_ID; L=$R/post-deploy; mkdir -p "$L"
rows=$L/rows.tsv; : > "$rows"
t() { local n=$1; shift; local s; s=$(date +%s); echo "== $n start $(date -u +%T)"; "$@" > "$L/$n.log" 2>&1; local rc=$?
  printf '%s\t%s\t%s\n' "$n" "$rc" "$(( $(date +%s)-s ))" >> "$rows"; echo "== $n rc=$rc $(( $(date +%s)-s ))s"; }
shots=shots-traing-$RUN_ID
trial() {
  cd "$M0_DIR" && mkdir -p "$shots" && M0_EMAIL=$TRIAL_EMAIL M0_PASSWORD="$(cat "$TRIAL_PW_FILE")" M0_LOCALE=zh-CN SHOTS=/w/$shots \
    bash acc.sh trial-login.mjs "$shots/trial-state.json"
  local rc=$?; chmod 600 "$shots/trial-state.json" 2>/dev/null; return $rc
}
# The init job ran in this deploy and exited 0 (its revision is checked through the API by step 10-model-catalog).
catalog_sync() {
  cd "$KAILO_SRC" || return 2
  kailo/deploy/up.sh compose logs --no-color model-catalog-sync 2>&1 | tail -40
  kailo/deploy/up.sh compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' model-catalog-sync 2>&1 | tee /dev/stderr | grep -q 'exited 0'
}
git -C "$KAILO_SRC" log --oneline -1 > "$L/revision.txt" 2>&1
t trial-login trial
cd "$KAILO_SRC" || exit 2
t smoke-upload-pdf kailo/deploy/smoke/upload-pdf.sh
t smoke-agent-turns kailo/deploy/smoke/agent-turns.sh
t smoke-default-share kailo/deploy/smoke/default-share.sh
t spicedb-verify kailo/deploy/spicedb/verify.sh
t authz-verify kailo/deploy/authz/verify.sh
t model-catalog-sync catalog_sync
t official bash -c "cd '$M0_DIR' && bash official.sh '$shots-official'"
python3 -I - "$rows" "$R/00-post-deploy.json" "$L" "$(cat "$L/revision.txt")" <<'PY'
import json, sys, datetime
rows, out, logdir, rev = sys.argv[1:5]
checks = []
for line in open(rows, encoding='utf-8'):
    n, rc, s = line.rstrip('\n').split('\t')
    tail = open(f'{logdir}/{n}.log', encoding='utf-8', errors='replace').read()[-600:]
    checks.append({'name': n, 'ok': rc == '0', 'detail': f'rc={rc} {s}s', 'log': f'{logdir}/{n}.log', 'tail': tail})
res = {'id': '00-post-deploy', 'title': '部署后检查：试用账号登录、冒烟（含 agent-turns）、SpiceDB/authz verify、模型目录同步、official.sh',
       'revision': rev, 'status': 'pass' if checks and all(c['ok'] for c in checks) else 'fail',
       'failed': [c['name'] for c in checks if not c['ok']], 'checks': checks,
       'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
json.dump(res, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('POST_DEPLOY', res['status'], res['failed'])
sys.exit(0 if res['status'] == 'pass' else 1)
PY
