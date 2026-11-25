#!/usr/bin/env bash
# One full acceptance round on the current deploy: post-deploy checks, then every browser step after setup (10 model
# catalog included). The round's log, results and screenshots are archived on the 4T disk under its own name, so
# consecutive rounds keep their own evidence (the suite's shots/ and results/ dirs are per run, not per round).
R=${1:?usage: fullround.sh <round>}
L=/volumes/kailo/acceptance/traing/logs/$R.log
cd /volumes/kailo/acceptance/traing; set -a; . state/config.env; set +a
./run.sh post-deploy > $L 2>&1
./run.sh steps --skip 00,01,02,03,05,20 >> $L 2>&1
rc=$?
echo "exit=$rc" >> $L
D=/volumes/data/kailo/capacity/acceptance-evidence/$(date -u +%Y%m%d)-$R
mkdir -p $D && cp -a shots/g1 $D/shots && cp -a results/g1 $D/results && { [ -d "$M0_DIR/shots-traing-$RUN_ID" ] && cp -a "$M0_DIR/shots-traing-$RUN_ID" $D/post-deploy-shots; true; } && cp $L $D/ && git -C /volumes/kailo/kailo-macro rev-parse HEAD > $D/deployed-commit.txt
echo "archived=$D" >> $L
