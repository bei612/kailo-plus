//! Per-step timing of one AdvanceAgentTask call before the model request.
//!
//! The Worker Activity deadline is 30 s and a normal trigger must reach the
//! model request within 10 s. Every pre-dispatch call of a still-CREATED
//! invocation leaves one line naming each step and its elapsed milliseconds,
//! so a slow dependency is identified by step instead of being folded into
//! "result unknown". Steps that already reached a native runtime RPC are never
//! cancelled here: an abandoned stdio RPC or turn/start receipt cannot be
//! proven absent. The native RPCs keep their own configured bound.
use std::fmt::Write as _;
use std::time::{Duration, Instant};

use uuid::Uuid;

/// One step or the whole call at or above this is logged at WARN.
const SLOW_STEP: Duration = Duration::from_secs(5);
const SLOW_CALL: Duration = Duration::from_secs(10);

pub(super) struct PrepareTiming {
    invocation: Uuid,
    attempt: i64,
    enabled: bool,
    started: Instant,
    last: Instant,
    steps: Vec<(&'static str, u128)>,
    outcome: &'static str,
}

impl PrepareTiming {
    pub(super) fn new(invocation: Uuid, attempt: i64, enabled: bool) -> Self {
        let now = Instant::now();
        Self {
            invocation,
            attempt,
            enabled,
            started: now,
            last: now,
            steps: Vec::new(),
            outcome: "RETURNED",
        }
    }

    /// Close the step that just finished, measured from the previous step.
    pub(super) fn step(&mut self, name: &'static str) {
        let now = Instant::now();
        self.steps
            .push((name, now.duration_since(self.last).as_millis()));
        self.last = now;
    }

    pub(super) fn outcome(&mut self, outcome: &'static str) {
        self.outcome = outcome;
    }

    fn render(&self) -> (String, bool) {
        let mut rendered = String::new();
        let mut slow = false;
        for (name, ms) in &self.steps {
            slow |= *ms >= SLOW_STEP.as_millis();
            if !rendered.is_empty() {
                rendered.push(' ');
            }
            let _ = write!(rendered, "{name}={ms}");
        }
        (rendered, slow)
    }
}

impl Drop for PrepareTiming {
    fn drop(&mut self) {
        if !self.enabled {
            return;
        }
        let total = self.started.elapsed();
        let (steps, slow_step) = self.render();
        let total_ms = total.as_millis();
        if slow_step || total >= SLOW_CALL {
            tracing::warn!(invocation_id = %self.invocation, attempt = self.attempt,
                total_ms, steps = %steps, outcome = self.outcome,
                "agent_task dispatch preparation slow");
        } else {
            tracing::info!(invocation_id = %self.invocation, attempt = self.attempt,
                total_ms, steps = %steps, outcome = self.outcome,
                "agent_task dispatch preparation");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_each_step_in_order_and_flags_slow_steps() {
        let mut timing = PrepareTiming::new(Uuid::nil(), 1, false);
        timing.steps = vec![("capacity", 3), ("session_resume", 5_000)];
        let (rendered, slow) = timing.render();
        assert_eq!(rendered, "capacity=3 session_resume=5000");
        assert!(slow);
        timing.steps = vec![("capacity", 3), ("turn_start", 4_999)];
        assert!(!timing.render().1);
    }
}
