# Sourced by b02-deploy.sh and b02-rollback.sh (G-10): the deployment's probe (kailo-probe.timer, kailo/deploy/systemd)
# stays on. A deploy or rollback pauses it while the stack changes and leaves it enabled (on boot) and active (timer
# running) when it ends, successful or not, whatever state it found the timer in. Needs log().
probe_pause() {  # stop the timer for the window (no-op when it is not running)
  if systemctl is-active -q kailo-probe.timer; then
    sudo -n systemctl stop kailo-probe.timer && log "probe timer paused"
  fi
}
probe_on() {  # enable and start the timer as needed; fails unless it is now enabled and active
  systemctl is-enabled -q kailo-probe.timer || { sudo -n systemctl enable -q kailo-probe.timer && log "probe timer enabled"; }
  systemctl is-active -q kailo-probe.timer || { sudo -n systemctl start kailo-probe.timer && log "probe timer started"; }
  systemctl is-enabled -q kailo-probe.timer && systemctl is-active -q kailo-probe.timer
}
probe_assert() {  # the last step of a deploy or rollback
  probe_on || { log "kailo-probe.timer is not enabled and active"; return 1; }
  log "  kailo-probe.timer: $(systemctl is-enabled kailo-probe.timer), $(systemctl is-active kailo-probe.timer)"
}
