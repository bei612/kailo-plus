//! Read the original AgentTask history; TimerFired is the Delay authority.
use super::*;
use temporalio_common::protos::temporal::api::history::v1::HistoryEvent;

struct DelayHistory<'a> {
    invocation: &'a str,
    steps: &'a [(String, i64)],
    completed: usize,
    started: Option<(i64, String)>,
    records: Vec<serde_json::Value>,
    timeouts: &'a std::collections::HashMap<String, i64>,
    deadlines: std::collections::HashMap<String, (String, i64, String, Option<bool>)>,
    cancel_requested: bool,
}

impl DelayHistory<'_> {
    fn observe(&mut self, event: &HistoryEvent, run: &str) -> Result<(), TemporalError> {
        if matches!(
            &event.attributes,
            Some(Attributes::WorkflowExecutionCancelRequestedEventAttributes(
                _
            ))
        ) {
            self.cancel_requested = true;
        }
        // The independent deadline is not a shorter Delay. Preserve both native
        // timer identities and require the losing timer to have a terminal event.
        match &event.attributes {
            Some(Attributes::TimerStartedEventAttributes(timer)) => {
                let summary = event
                    .user_metadata
                    .as_ref()
                    .and_then(|metadata| metadata.summary.as_ref())
                    .and_then(|payload| serde_json::from_slice::<String>(&payload.data).ok());
                if let Some(step) = summary.as_deref().and_then(|summary| {
                    summary.strip_prefix(&format!("automation-delay-timeout:{}:", self.invocation))
                }) {
                    let seconds = self.timeouts.get(step).ok_or_else(|| {
                        TemporalError::Unknown("Unconfigured Delay deadline".into())
                    })?;
                    if self.deadlines.contains_key(step)
                        || event.event_id <= 0
                        || timer.timer_id.is_empty()
                        || timer.start_to_fire_timeout.as_ref().is_none_or(|duration| {
                            duration.seconds != *seconds || duration.nanos != 0
                        })
                    {
                        return Err(TemporalError::Unknown(
                            "Delay deadline TimerStarted mismatch".into(),
                        ));
                    }
                    self.deadlines.insert(
                        step.to_owned(),
                        (run.to_owned(), event.event_id, timer.timer_id.clone(), None),
                    );
                    return Ok(());
                }
            }
            Some(Attributes::TimerFiredEventAttributes(timer)) => {
                if let Some((_, _, _, terminal)) =
                    self.deadlines
                        .values_mut()
                        .find(|(started_run, id, key, _)| {
                            started_run == run
                                && *id == timer.started_event_id
                                && *key == timer.timer_id
                        })
                {
                    if terminal.is_some() {
                        return Err(TemporalError::Unknown(
                            "Conflicting Delay deadline terminal".into(),
                        ));
                    }
                    *terminal = Some(true);
                    return Ok(());
                }
            }
            Some(Attributes::TimerCanceledEventAttributes(timer)) => {
                if let Some((_, _, _, terminal)) =
                    self.deadlines
                        .values_mut()
                        .find(|(started_run, id, key, _)| {
                            started_run == run
                                && *id == timer.started_event_id
                                && *key == timer.timer_id
                        })
                {
                    if terminal.is_some() {
                        return Err(TemporalError::Unknown(
                            "Conflicting Delay deadline terminal".into(),
                        ));
                    }
                    *terminal = Some(false);
                    return Ok(());
                }
            }
            _ => (),
        }
        // A zero-duration original Delay is a no-op, not an invented timer receipt.
        while self
            .steps
            .get(self.completed)
            .is_some_and(|(_, seconds)| *seconds == 0)
        {
            self.completed += 1;
        }
        let Some((step, seconds)) = self.steps.get(self.completed) else {
            return Ok(());
        };
        match &event.attributes {
            Some(Attributes::TimerStartedEventAttributes(timer)) => {
                let summary = event
                    .user_metadata
                    .as_ref()
                    .and_then(|metadata| metadata.summary.as_ref())
                    .and_then(|payload| serde_json::from_slice::<String>(&payload.data).ok());
                if summary.as_deref()
                    == Some(format!("automation-delay:{}:{step}", self.invocation).as_str())
                {
                    if self.started.is_some()
                        || event.event_id <= 0
                        || timer.timer_id.is_empty()
                        || timer.start_to_fire_timeout.as_ref().is_none_or(|duration| {
                            duration.seconds != *seconds || duration.nanos != 0
                        })
                    {
                        return Err(TemporalError::Unknown(
                            "Delay TimerStarted 不匹配原步骤".into(),
                        ));
                    }
                    self.started = Some((event.event_id, timer.timer_id.clone()));
                    let mut record = serde_json::json!({"stepId":step,"status":"running",
                        "output":{"runId":run,"historyEventId":event.event_id}});
                    if let Some(time) = event_timestamp(event) {
                        record["startedAt"] = time.into();
                    }
                    self.records.push(record);
                }
            }
            Some(Attributes::TimerFiredEventAttributes(timer))
                if self.started.as_ref().is_some_and(|(id, key)| {
                    *id == timer.started_event_id && *key == timer.timer_id
                }) =>
            {
                if let Some(record) = self.records.last_mut() {
                    record["status"] = "completed".into();
                    record["output"]["historyEventId"] = event.event_id.into();
                    if let Some(time) = event_timestamp(event) {
                        record["completedAt"] = time.into();
                    }
                }
                self.completed += 1;
                self.started = None;
            }
            Some(Attributes::TimerCanceledEventAttributes(timer))
                if self.started.as_ref().is_some_and(|(id, key)| {
                    *id == timer.started_event_id && *key == timer.timer_id
                }) =>
            {
                if let Some(record) = self.records.last_mut() {
                    record["status"] = "cancelled".into();
                    record["output"]["historyEventId"] = event.event_id.into();
                    if let Some(time) = event_timestamp(event) {
                        record["completedAt"] = time.into();
                    }
                }
                self.started = None;
            }
            _ => (),
        }
        Ok(())
    }

    fn finish(mut self) -> Result<(usize, Vec<serde_json::Value>), TemporalError> {
        for record in &mut self.records {
            let step = record["stepId"]
                .as_str()
                .ok_or_else(|| TemporalError::Unknown("Delay step missing".into()))?;
            if !self.timeouts.contains_key(step) {
                continue;
            }
            let Some((_, _, _, terminal)) = self.deadlines.get(step) else {
                return Err(TemporalError::Unknown(
                    "Delay deadline timer missing".into(),
                ));
            };
            match (record["status"].as_str(), terminal) {
                // Worker checks the delay first when both Futures are ready.
                (Some("completed"), Some(_)) => (),
                (Some("cancelled"), Some(true)) if !self.cancel_requested => {
                    record["status"] = "failed".into();
                    record["error"] = serde_json::json!(contracts::ReasonCode::StepTimeout);
                }
                (Some("cancelled"), Some(_)) if self.cancel_requested => (),
                (Some("running"), None) => (),
                _ => {
                    return Err(TemporalError::Unknown(
                        "Delay losing timer is not reconciled".into(),
                    ))
                }
            }
        }
        Ok((self.completed, self.records))
    }
}

fn event_timestamp(event: &HistoryEvent) -> Option<String> {
    let time = event.event_time.as_ref()?;
    chrono::DateTime::from_timestamp(time.seconds, u32::try_from(time.nanos).ok()?)
        .map(|time| time.to_rfc3339())
}

fn projection_payload_matches(
    input: &serde_json::Value,
    report: &contracts::TaskStateReport,
) -> bool {
    input["workflowId"] == report.workflow_id
        && input["runId"] == report.run_id
        && input["eventId"] == report.event_id
        && input["status"] == serde_json::json!(report.status)
        && input
            .get("waitingReason")
            .and_then(serde_json::Value::as_str)
            == report.waiting_reason.as_deref()
        && input.get("progress").and_then(serde_json::Value::as_str) == report.progress.as_deref()
}

impl TemporalClient {
    pub(crate) async fn automation_delay_progress(
        &self,
        workflow: &str,
        first_run: &str,
        current_run: &str,
        activity: &str,
        invocation: &str,
        delays: crate::automation::steps::DelayTimings<'_>,
    ) -> Result<(usize, Option<String>), TemporalError> {
        self.automation_step_history(
            &WorkflowExecution {
                workflow_id: workflow.to_owned(),
                run_id: current_run.to_owned(),
            },
            first_run,
            activity,
            invocation,
            delays,
            None,
        )
        .await
        .map(|(completed, records)| {
            let timed_out = records
                .iter()
                .find(|record| record["error"] == "STEP_TIMEOUT")
                .and_then(|record| record["stepId"].as_str())
                .map(str::to_owned);
            (completed, timed_out)
        })
    }

    /// The existing history walker also anchors the read projection at the
    /// actual ProjectAgentTaskState schedule; it never exposes raw history.
    pub(crate) async fn automation_step_history(
        &self,
        execution: &WorkflowExecution,
        first_run: &str,
        activity: &str,
        invocation: &str,
        delays: crate::automation::steps::DelayTimings<'_>,
        report: Option<&contracts::TaskStateReport>,
    ) -> Result<(usize, Vec<serde_json::Value>), TemporalError> {
        self.refresh_token().await?;
        let mut run = first_run.to_owned();
        let mut runs = HashSet::new();
        let mut progress = DelayHistory {
            invocation,
            steps: delays.steps,
            completed: 0,
            started: None,
            records: Vec::new(),
            timeouts: delays.timeouts,
            deadlines: Default::default(),
            cancel_requested: false,
        };
        loop {
            if uuid::Uuid::parse_str(&run).is_err() || !runs.insert(run.clone()) {
                return Err(TemporalError::Unknown(
                    "Delay execution chain 不成立".into(),
                ));
            }
            let mut token = Vec::new();
            let mut pages = HashSet::new();
            let mut next = None;
            let mut last_event = 0;
            loop {
                let request = GetWorkflowExecutionHistoryRequest {
                    namespace: self.namespace.clone(),
                    execution: Some(WorkflowExecution {
                        workflow_id: execution.workflow_id.clone(),
                        run_id: run.clone(),
                    }),
                    next_page_token: token.clone(),
                    ..Default::default()
                };
                let response = self
                    .with_auth_retry(|mut svc| {
                        let request = request.clone();
                        async move {
                            svc.get_workflow_execution_history(tonic::Request::new(request))
                                .await
                        }
                    })
                    .await
                    .map_err(|_| TemporalError::Unknown("Delay history 不可读".into()))?;
                if !response.raw_history.is_empty() {
                    return Err(TemporalError::Unknown("Delay history 未解码".into()));
                }
                let history = response
                    .history
                    .ok_or_else(|| TemporalError::Unknown("Delay history 缺事件集".into()))?;
                if token.is_empty() && history.events.is_empty() {
                    return Err(TemporalError::Unknown("Delay history 为空".into()));
                }
                for event in history.events {
                    if event.event_id != last_event + 1 {
                        return Err(TemporalError::Unknown("Delay history 不连续".into()));
                    }
                    last_event = event.event_id;
                    progress.observe(&event, &run)?;
                    match event.attributes {
                        Some(Attributes::ActivityTaskScheduledEventAttributes(scheduled))
                            if run == execution.run_id && scheduled.activity_id == activity =>
                        {
                            let input = scheduled
                                .input
                                .filter(|input| input.payloads.len() == 1)
                                .and_then(|input| {
                                    serde_json::from_slice::<serde_json::Value>(
                                        &input.payloads[0].data,
                                    )
                                    .ok()
                                });
                            let kind = scheduled
                                .activity_type
                                .as_ref()
                                .map(|kind| kind.name.as_str());
                            let valid = if let Some(report) = report {
                                kind == Some("ProjectAgentTaskState")
                                    && input.as_ref().is_some_and(|input| {
                                        projection_payload_matches(input, report)
                                    })
                            } else {
                                kind == Some("AdvanceAgentTask")
                                    && input
                                        .as_ref()
                                        .and_then(|input| input["invocationId"].as_str())
                                        == Some(invocation)
                            };
                            if !valid {
                                return Err(TemporalError::Unknown(
                                    "Delay Activity 原引用不一致".into(),
                                ));
                            }
                            return progress.finish();
                        }
                        Some(Attributes::WorkflowExecutionContinuedAsNewEventAttributes(
                            continued,
                        )) => {
                            if progress.started.is_some() {
                                return Err(TemporalError::Unknown(
                                    "Delay 在途计时被续跑截断".into(),
                                ));
                            }
                            next = Some(continued.new_execution_run_id);
                        }
                        _ => (),
                    }
                }
                if response.next_page_token.is_empty() {
                    break;
                }
                if !pages.insert(response.next_page_token.clone()) {
                    return Err(TemporalError::Unknown("Delay history 分页循环".into()));
                }
                token = response.next_page_token;
            }
            run = next.ok_or_else(|| {
                TemporalError::Unknown("Delay current Activity 不属于原 execution chain".into())
            })?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use temporalio_common::protos::temporal::api::history::v1::{
        TimerCanceledEventAttributes, TimerFiredEventAttributes, TimerStartedEventAttributes,
    };

    #[test]
    fn native_projection_boundary_requires_the_exact_scheduled_report() {
        let input = serde_json::json!({"workflowId":"fixed-workflow", "runId":"fixed-run",
            "eventId":18, "status":"RUNNING", "waitingReason":"WAITING_TIMER", "progress":"native delay"});
        let mut report: contracts::TaskStateReport = serde_json::from_value(input.clone()).unwrap();
        report.activity_id = Some("native-activity-id".into());
        assert!(projection_payload_matches(&input, &report));
        for (field, changed) in [
            ("workflowId", serde_json::json!("another-workflow")),
            ("runId", serde_json::json!("another-run")),
            ("eventId", serde_json::json!(19)),
            ("status", serde_json::json!("COMPLETED")),
            ("waitingReason", serde_json::json!("WAITING_APPROVAL")),
            ("progress", serde_json::json!("later fact")),
        ] {
            let mut wrong = input.clone();
            wrong[field] = changed;
            assert!(!projection_payload_matches(&wrong, &report), "{field}");
        }
        let mut missing = input;
        missing.as_object_mut().unwrap().remove("waitingReason");
        assert!(!projection_payload_matches(&missing, &report));
    }

    fn start(id: i64, step: &str, seconds: i64) -> HistoryEvent {
        let mut timer = TimerStartedEventAttributes {
            timer_id: format!("timer-{id}"),
            ..Default::default()
        };
        timer
            .start_to_fire_timeout
            .get_or_insert_with(Default::default)
            .seconds = seconds;
        let mut event = HistoryEvent {
            event_id: id,
            attributes: Some(Attributes::TimerStartedEventAttributes(timer)),
            ..Default::default()
        };
        event
            .user_metadata
            .get_or_insert_with(Default::default)
            .summary = Some(Payload {
            data: serde_json::to_vec(&format!("automation-delay:invocation:{step}")).unwrap(),
            ..Default::default()
        });
        event
    }

    fn fire(id: i64) -> HistoryEvent {
        HistoryEvent {
            event_id: id + 1,
            attributes: Some(Attributes::TimerFiredEventAttributes(
                TimerFiredEventAttributes {
                    started_event_id: id,
                    timer_id: format!("timer-{id}"),
                },
            )),
            ..Default::default()
        }
    }

    #[test]
    fn delay_deadline_requires_both_native_terminals_and_cancel_wins() {
        fn deadline() -> HistoryEvent {
            let mut event = start(5, "wait", 5);
            event
                .user_metadata
                .as_mut()
                .unwrap()
                .summary
                .as_mut()
                .unwrap()
                .data = serde_json::to_vec("automation-delay-timeout:invocation:wait").unwrap();
            event
        }
        fn cancel(id: i64) -> HistoryEvent {
            HistoryEvent {
                event_id: id + 10,
                attributes: Some(Attributes::TimerCanceledEventAttributes(
                    TimerCanceledEventAttributes {
                        started_event_id: id,
                        timer_id: format!("timer-{id}"),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            }
        }
        let steps = vec![("wait".into(), 62)];
        let timeouts = std::collections::HashMap::from([("wait".into(), 5)]);
        for (completion, external_cancel, expected) in [
            (false, false, "failed"),
            (true, false, "completed"),
            (false, true, "cancelled"),
        ] {
            let mut progress = DelayHistory {
                invocation: "invocation",
                steps: &steps,
                completed: 0,
                started: None,
                records: Vec::new(),
                timeouts: &timeouts,
                deadlines: Default::default(),
                cancel_requested: false,
            };
            progress.observe(&start(3, "wait", 62), "run").unwrap();
            progress.observe(&deadline(), "run").unwrap();
            if external_cancel {
                progress
                    .observe(
                        &HistoryEvent {
                            attributes: Some(
                                Attributes::WorkflowExecutionCancelRequestedEventAttributes(
                                    Default::default(),
                                ),
                            ),
                            ..Default::default()
                        },
                        "run",
                    )
                    .unwrap();
            }
            progress.observe(&fire(5), "run").unwrap();
            progress
                .observe(&if completion { fire(3) } else { cancel(3) }, "run")
                .unwrap();
            let (completed, records) = progress.finish().unwrap();
            assert_eq!(records[0]["status"], expected);
            assert_eq!(completed, usize::from(completion));
            assert_eq!(records[0].get("error").is_some(), expected == "failed");
        }
        // No terminal for the losing timer cannot be called success/failure,
        // nor used to start the same Delay a second time.
        for deadline_started in [false, true] {
            let mut progress = DelayHistory {
                invocation: "invocation",
                steps: &steps,
                completed: 0,
                started: None,
                records: Vec::new(),
                timeouts: &timeouts,
                deadlines: Default::default(),
                cancel_requested: false,
            };
            progress.observe(&start(3, "wait", 62), "run").unwrap();
            if deadline_started {
                progress.observe(&deadline(), "run").unwrap();
                progress.observe(&fire(5), "run").unwrap();
            }
            assert!(progress.finish().is_err());
        }
        // Readback of a partial prefix must converge from the SAME timer IDs
        // when the next observation sees their terminals; no replacement start.
        let history = [start(3, "wait", 62), deadline(), fire(5), cancel(3)];
        for prefix in 1..=history.len() {
            let mut progress = DelayHistory {
                invocation: "invocation",
                steps: &steps,
                completed: 0,
                started: None,
                records: Vec::new(),
                timeouts: &timeouts,
                deadlines: Default::default(),
                cancel_requested: false,
            };
            for event in &history[..prefix] {
                progress.observe(event, "run").unwrap();
            }
            match prefix {
                2 => assert_eq!(progress.finish().unwrap().1[0]["status"], "running"),
                4 => assert_eq!(progress.finish().unwrap().1[0]["error"], "STEP_TIMEOUT"),
                _ => assert!(progress.finish().is_err()),
            }
        }
    }

    #[test]
    fn only_matching_native_fired_events_advance_the_ordered_step() {
        let steps = vec![("wait".into(), 62), ("next".into(), 5)];
        let mut progress = DelayHistory {
            invocation: "invocation",
            steps: &steps,
            completed: 0,
            started: None,
            records: Vec::new(),
            timeouts: &Default::default(),
            deadlines: Default::default(),
            cancel_requested: false,
        };
        progress.observe(&fire(3), "run").unwrap();
        assert_eq!(progress.completed, 0);
        progress.observe(&start(3, "wait", 62), "run").unwrap();
        progress.observe(&fire(4), "run").unwrap();
        assert_eq!(progress.completed, 0);
        progress.observe(&fire(3), "run").unwrap();
        assert_eq!(progress.completed, 1);
        progress.observe(&start(7, "next", 5), "run").unwrap();
        progress.observe(&fire(7), "run").unwrap();
        assert_eq!(progress.completed, 2);
        assert_eq!(progress.records[0]["status"], "completed");
        assert_eq!(progress.records[0]["output"]["historyEventId"], 4);
        assert!(progress.records[0].get("startedAt").is_none());
        assert!(progress.records[0].get("completedAt").is_none());
    }

    #[test]
    fn canceled_or_wrong_duration_timer_is_not_a_completion_receipt() {
        let steps = vec![("wait".into(), 62)];
        let mut progress = DelayHistory {
            invocation: "invocation",
            steps: &steps,
            completed: 0,
            started: None,
            records: Vec::new(),
            timeouts: &Default::default(),
            deadlines: Default::default(),
            cancel_requested: false,
        };
        assert!(progress.observe(&start(3, "wait", 1), "run").is_err());
        progress.observe(&start(3, "wait", 62), "run").unwrap();
        progress
            .observe(
                &HistoryEvent {
                    attributes: Some(Attributes::TimerCanceledEventAttributes(
                        TimerCanceledEventAttributes {
                            started_event_id: 3,
                            timer_id: "timer-3".into(),
                            ..Default::default()
                        },
                    )),
                    ..Default::default()
                },
                "run",
            )
            .unwrap();
        progress.observe(&fire(3), "run").unwrap();
        assert_eq!(progress.completed, 0);
        assert!(progress.started.is_none());
        assert_eq!(progress.records[0]["status"], "cancelled");
    }

    #[test]
    fn trace_uses_original_timer_timestamps_and_keeps_running_until_matching_fire() {
        let steps = vec![("wait".into(), 62)];
        let mut progress = DelayHistory {
            invocation: "invocation",
            steps: &steps,
            completed: 0,
            started: None,
            records: Vec::new(),
            timeouts: &Default::default(),
            deadlines: Default::default(),
            cancel_requested: false,
        };
        let mut started = start(3, "wait", 62);
        started
            .event_time
            .get_or_insert_with(Default::default)
            .seconds = 1_700_000_000;
        progress.observe(&started, "original-run").unwrap();
        assert_eq!(progress.records[0]["status"], "running");
        assert!(progress.records[0].get("completedAt").is_none());
        let mut fired = fire(3);
        fired
            .event_time
            .get_or_insert_with(Default::default)
            .seconds = 1_700_000_062;
        progress.observe(&fired, "original-run").unwrap();
        assert_eq!(progress.records[0]["status"], "completed");
        assert_eq!(progress.records[0]["output"]["runId"], "original-run");
        let start = chrono::DateTime::parse_from_rfc3339(
            progress.records[0]["startedAt"].as_str().unwrap(),
        )
        .unwrap();
        let end = chrono::DateTime::parse_from_rfc3339(
            progress.records[0]["completedAt"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!((end - start).num_seconds(), 62);
    }
}
