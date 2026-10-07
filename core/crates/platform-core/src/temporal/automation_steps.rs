//! Read the original AgentTask history; TimerFired is the Delay authority.
use super::*;
use temporalio_common::protos::temporal::api::history::v1::HistoryEvent;

struct DelayHistory<'a> {
    invocation: &'a str,
    steps: &'a [(String, i64)],
    completed: usize,
    started: Option<(i64, String)>,
}

impl DelayHistory<'_> {
    fn observe(&mut self, event: &HistoryEvent) -> Result<(), TemporalError> {
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
                }
            }
            Some(Attributes::TimerFiredEventAttributes(timer))
                if self.started.as_ref().is_some_and(|(id, key)| {
                    *id == timer.started_event_id && *key == timer.timer_id
                }) =>
            {
                self.completed += 1;
                self.started = None;
            }
            Some(Attributes::TimerCanceledEventAttributes(timer))
                if self.started.as_ref().is_some_and(|(id, key)| {
                    *id == timer.started_event_id && *key == timer.timer_id
                }) =>
            {
                self.started = None;
            }
            _ => (),
        }
        Ok(())
    }
}

impl TemporalClient {
    pub(crate) async fn automation_delay_progress(
        &self,
        workflow: &str,
        first_run: &str,
        current_run: &str,
        activity: &str,
        invocation: &str,
        steps: &[(String, i64)],
    ) -> Result<usize, TemporalError> {
        self.refresh_token().await?;
        let mut run = first_run.to_owned();
        let mut runs = HashSet::new();
        let mut progress = DelayHistory {
            invocation,
            steps,
            completed: 0,
            started: None,
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
                        workflow_id: workflow.to_owned(),
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
                    progress.observe(&event)?;
                    match event.attributes {
                        Some(Attributes::ActivityTaskScheduledEventAttributes(scheduled))
                            if run == current_run && scheduled.activity_id == activity =>
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
                            if scheduled
                                .activity_type
                                .as_ref()
                                .map(|kind| kind.name.as_str())
                                != Some("AdvanceAgentTask")
                                || input
                                    .as_ref()
                                    .and_then(|input| input["invocationId"].as_str())
                                    != Some(invocation)
                            {
                                return Err(TemporalError::Unknown(
                                    "Delay Activity 原引用不一致".into(),
                                ));
                            }
                            return Ok(progress.completed);
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
            attributes: Some(Attributes::TimerFiredEventAttributes(
                TimerFiredEventAttributes {
                    started_event_id: id,
                    timer_id: format!("timer-{id}"),
                    ..Default::default()
                },
            )),
            ..Default::default()
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
        };
        progress.observe(&fire(3)).unwrap();
        assert_eq!(progress.completed, 0);
        progress.observe(&start(3, "wait", 62)).unwrap();
        progress.observe(&fire(4)).unwrap();
        assert_eq!(progress.completed, 0);
        progress.observe(&fire(3)).unwrap();
        assert_eq!(progress.completed, 1);
        progress.observe(&start(7, "next", 5)).unwrap();
        progress.observe(&fire(7)).unwrap();
        assert_eq!(progress.completed, 2);
    }

    #[test]
    fn canceled_or_wrong_duration_timer_is_not_a_completion_receipt() {
        let steps = vec![("wait".into(), 62)];
        let mut progress = DelayHistory {
            invocation: "invocation",
            steps: &steps,
            completed: 0,
            started: None,
        };
        assert!(progress.observe(&start(3, "wait", 1)).is_err());
        progress.observe(&start(3, "wait", 62)).unwrap();
        progress
            .observe(&HistoryEvent {
                attributes: Some(Attributes::TimerCanceledEventAttributes(
                    TimerCanceledEventAttributes {
                        started_event_id: 3,
                        timer_id: "timer-3".into(),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            })
            .unwrap();
        progress.observe(&fire(3)).unwrap();
        assert_eq!(progress.completed, 0);
        assert!(progress.started.is_none());
    }
}
