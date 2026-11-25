#!/bin/bash
# Runs the M0 acceptance steps 3-7 for one account state: task, docs with mentions, channel post, backlinks.
cd /volumes/kailo/acceptance/m0
st=${1:?state file}
bash acc.sh s3-task.mjs "$st" > run-s3.log 2>&1 || { echo "s3 failed"; exit 1; }
bash acc.sh s4-docs.mjs "$st" > run-s4.log 2>&1 || { echo "s4 failed"; exit 1; }
a=$(sed -n 's/^DOC_A //p' run-s4.log); b=$(sed -n 's/^DOC_B //p' run-s4.log)
M0_CHANNEL=${M0_CHANNEL:-m0-review} bash acc.sh s5-channel.mjs "$st" > run-s5.log 2>&1 || { echo "s5 failed"; exit 1; }
M0_SHOT=40-backlinks-docA M0_DOC_URL=$a bash acc.sh s7-backlinks.mjs "$st" > run-s7a.log 2>&1 || { echo "s7a failed"; exit 1; }
M0_SHOT=41-backlinks-docB M0_DOC_URL=$b bash acc.sh s7-backlinks.mjs "$st" > run-s7b.log 2>&1 || { echo "s7b failed"; exit 1; }
echo "DOC_A $a"; echo "DOC_B $b"
grep -o "References[^|]*|[^|]*|[^|]*|[^|]*|[^|]*" run-s7a.log run-s7b.log
echo CHAIN_OK
