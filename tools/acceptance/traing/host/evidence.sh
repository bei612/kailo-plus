#!/bin/bash
# evidence.sh: read-only evidence for ring ⑤ (Temporal schedules, RoutineRun workflows, routine run records) and
# TE-08 (SpiceDB check of the researcher Agent on alice's private document) into results/$RUN_ID/evidence/.
set -u
D=$(cd "$(dirname "$0")/.." && pwd); : "${RUN_ID:?}"
E=$D/results/$RUN_ID/evidence; mkdir -p "$E"
"$D/host/tq.sh" "$E/temporal-schedules.txt" schedule list
"$D/host/tq.sh" "$E/temporal-routine-runs.txt" workflow list --query "WorkflowType='RoutineRun'" --limit 50
"$D/host/sql.sh" > "$E/routine-runs.txt" 2>&1 <<'SQL'
SELECT r.scheduled_action_id, a.name, r.started_at, r.ended_at, r.is_success, r.started_by
FROM action_execution_record r JOIN scheduled_action a ON a.id = r.scheduled_action_id
WHERE a.name LIKE 'TG %' ORDER BY r.started_at DESC LIMIT 20;
SQL
st=$D/state/run.json
if [ -r "$st" ]; then
  doc=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('privateDoc') or '')" "$st")
  bot=$(python3 -I -c "import json,sys;print((json.load(open(sys.argv[1])).get('bots') or {}).get('research') or '')" "$st")
  if [ -n "$doc" ] && [ -n "$bot" ]; then "$D/host/az.sh" "document:$doc" view "bot:$bot" > "$E/te08-spicedb.txt" 2>&1; fi
fi
ls -la "$E"
