#!/bin/bash
# After a deploy: the post-deploy checks, then the browser steps. RERUN_ONLY (comma list) re-runs just those steps,
# whose predecessors passed in an earlier run (their state is kept); empty: 04 (90's personal documents) and every step
# from 21.
L=$1
while ! grep -qE "done\. Next|FAILED \(rc=" "$L"; do sleep 30; done
grep -q "FAILED (rc=" "$L" && { echo "deploy failed" > logs/rerun-g1-s.log; exit 1; }
cd /volumes/kailo/acceptance/traing; set -a; . state/config.env; set +a
RERUN_ONLY=${RERUN_ONLY-}
./run.sh post-deploy > logs/rerun-g1-s.log 2>&1
if [ -n "$RERUN_ONLY" ]; then ./run.sh steps --only "$RERUN_ONLY" >> logs/rerun-g1-s.log 2>&1; else ./run.sh steps --skip 00,01,02,03,05,10,20 >> logs/rerun-g1-s.log 2>&1; fi
echo "exit=$?" >> logs/rerun-g1-s.log
