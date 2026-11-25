#!/bin/bash
# full.sh <email> <state> [channel]: the whole M0 acceptance flow for a fresh account.
cd /volumes/kailo/acceptance/m0
M0_EMAIL=$1 bash acc.sh s1-signup.mjs "$2" > run-s1.log 2>&1 || { echo "s1 failed"; tail -5 run-s1.log; exit 1; }
bash acc.sh s2-onboard.mjs "$2" > run-s2.log 2>&1 || { echo "s2 failed"; tail -5 run-s2.log; exit 1; }
M0_CHANNEL=${3:-m0-review} bash chain.sh "$2"
