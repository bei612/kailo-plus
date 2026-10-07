//! DD-107：原生 Schedule 与其首次启动 history。无本地时钟触发器。
use super::*;
use serde_json::Value;
use temporalio_common::protos::temporal::api::{
    enums::v1::{ScheduleOverlapPolicy, TaskQueueKind},
    schedule::v1::{
        schedule_action::Action, IntervalSpec, Schedule, ScheduleAction, SchedulePolicies,
        ScheduleSpec, ScheduleState,
    },
    workflow::v1::NewWorkflowExecutionInfo,
    workflowservice::v1::{
        CreateScheduleRequest, DeleteScheduleRequest, DescribeScheduleRequest,
        UpdateScheduleRequest,
    },
};

pub(crate) fn automation_schedule_spec(
    value: &Value,
) -> Result<(ScheduleSpec, i64), TemporalError> {
    let invalid = || TemporalError::Encode("Schedule spec 不成立".into());
    let object = value.as_object().ok_or_else(invalid)?;
    let catchup = value["catchupWindowSeconds"]
        .as_i64()
        .filter(|v| *v >= 10)
        .ok_or_else(invalid)?;
    if value["kind"] == "CRON" {
        if object.len() != 3 {
            return Err(invalid());
        }
        let cron = object.get("cron").ok_or_else(invalid)?;
        return Ok((
            ScheduleSpec {
                structured_calendar: vec![super::schedule_calendar::calendar(
                    cron.as_str().ok_or_else(invalid)?,
                )?],
                ..Default::default()
            },
            catchup,
        ));
    }
    if object
        .get("kind")
        .is_some_and(|kind| kind.as_str() != Some("INTERVAL"))
    {
        return Err(invalid());
    }
    if object.len() != if object.contains_key("kind") { 4 } else { 3 } {
        return Err(invalid());
    }
    let every = value["everySeconds"]
        .as_i64()
        .filter(|v| *v > 0)
        .ok_or_else(invalid)?;
    let offset = value["offsetSeconds"]
        .as_i64()
        .filter(|v| *v >= 0 && *v < every)
        .ok_or_else(invalid)?;
    Ok((
        ScheduleSpec {
            interval: vec![IntervalSpec {
                interval: Some(
                    std::time::Duration::from_secs(every as u64)
                        .try_into()
                        .map_err(|_| invalid())?,
                ),
                phase: Some(
                    std::time::Duration::from_secs(offset as u64)
                        .try_into()
                        .map_err(|_| invalid())?,
                ),
            }],
            ..Default::default()
        },
        catchup,
    ))
}

impl TemporalClient {
    pub(crate) fn automation_schedule(
        &self,
        workflow_id: &str,
        input: &impl serde::Serialize,
        scope: (&str, &str),
        schedule: (ScheduleSpec, i64),
        paused: bool,
    ) -> Result<Schedule, TemporalError> {
        let (spec, catchup) = schedule;
        Ok(Schedule {
            spec: Some(spec),
            action: Some(schedule_action(
                &self.task_queue,
                workflow_id,
                input,
                scope,
            )?),
            policies: Some(SchedulePolicies {
                overlap_policy: ScheduleOverlapPolicy::Skip as i32,
                catchup_window: Some(
                    std::time::Duration::from_secs(catchup as u64)
                        .try_into()
                        .map_err(|_| {
                            TemporalError::Encode("Schedule catchup 超出 native duration".into())
                        })?,
                ),
                pause_on_failure: false,
                keep_original_workflow_id: false,
            }),
            state: Some(ScheduleState {
                paused,
                ..Default::default()
            }),
        })
    }

    pub(crate) async fn describe_schedule(
        &self,
        id: &str,
    ) -> Result<Option<Schedule>, TemporalError> {
        self.refresh_token().await?;
        let request = DescribeScheduleRequest {
            namespace: self.namespace.clone(),
            schedule_id: id.into(),
        };
        match self
            .with_auth_retry(|mut svc| {
                let r = request.clone();
                async move { svc.describe_schedule(tonic::Request::new(r)).await }
            })
            .await
        {
            Ok(r) => r
                .schedule
                .map(Some)
                .ok_or_else(|| TemporalError::Unknown("Schedule Describe 缺内容".into())),
            Err(s) if s.code() == tonic::Code::NotFound => Ok(None),
            Err(_) => Err(TemporalError::Unknown("Schedule Describe 不可核验".into())),
        }
    }

    // 调用者必须先持久化单次派发意图；错误不授权再次 create/update/delete。
    pub(crate) async fn create_schedule(
        &self,
        id: &str,
        operation: uuid::Uuid,
        schedule: Schedule,
    ) -> Result<(), TemporalError> {
        self.refresh_token().await?;
        let request = CreateScheduleRequest {
            namespace: self.namespace.clone(),
            schedule_id: id.into(),
            schedule: Some(schedule),
            identity: IDENTITY.into(),
            request_id: operation.to_string(),
            ..Default::default()
        };
        self.with_auth_retry(|mut svc| {
            let r = request.clone();
            async move { svc.create_schedule(tonic::Request::new(r)).await }
        })
        .await
        .map(|_| ())
        .map_err(|_| {
            TemporalError::Unknown("Schedule create 结果不明，须 exact-ID Describe".into())
        })
    }

    pub(crate) async fn pause_schedule(
        &self,
        id: &str,
        operation: uuid::Uuid,
    ) -> Result<(), TemporalError> {
        self.set_schedule_paused(id, operation, true).await
    }

    pub(crate) async fn set_schedule_paused(
        &self,
        id: &str,
        operation: uuid::Uuid,
        paused: bool,
    ) -> Result<(), TemporalError> {
        self.refresh_token().await?;
        let request = DescribeScheduleRequest {
            namespace: self.namespace.clone(),
            schedule_id: id.into(),
        };
        let observed = self
            .with_auth_retry(|mut svc| {
                let r = request.clone();
                async move { svc.describe_schedule(tonic::Request::new(r)).await }
            })
            .await
            .map_err(|_| TemporalError::Unknown("Schedule pause 缺 native CAS".into()))?;
        let mut schedule = observed
            .schedule
            .ok_or_else(|| TemporalError::Unknown("Schedule pause 缺内容".into()))?;
        let state = schedule
            .state
            .as_mut()
            .ok_or_else(|| TemporalError::Unknown("Schedule pause 缺 state".into()))?;
        if state.paused == paused {
            return Ok(());
        }
        state.paused = paused;
        if observed.conflict_token.is_empty() {
            return Err(TemporalError::Unknown(
                "Schedule pause 缺 conflict token".into(),
            ));
        }
        let request = UpdateScheduleRequest {
            namespace: self.namespace.clone(),
            schedule_id: id.into(),
            schedule: Some(schedule),
            conflict_token: observed.conflict_token,
            identity: IDENTITY.into(),
            request_id: operation.to_string(),
            ..Default::default()
        };
        self.with_auth_retry(|mut svc| {
            let r = request.clone();
            async move { svc.update_schedule(tonic::Request::new(r)).await }
        })
        .await
        .map(|_| ())
        .map_err(|_| TemporalError::Unknown("Schedule pause 结果不明".into()))
    }

    pub(crate) async fn delete_schedule(&self, id: &str) -> Result<(), TemporalError> {
        self.refresh_token().await?;
        let request = DeleteScheduleRequest {
            namespace: self.namespace.clone(),
            schedule_id: id.into(),
            identity: IDENTITY.into(),
        };
        match self
            .with_auth_retry(|mut svc| {
                let r = request.clone();
                async move { svc.delete_schedule(tonic::Request::new(r)).await }
            })
            .await
        {
            Ok(_) => Ok(()),
            Err(s) if s.code() == tonic::Code::NotFound => Ok(()),
            Err(_) => Err(TemporalError::Unknown("Schedule delete 结果不明".into())),
        }
    }

    /// 不相信 Activity 自报时间：读取原 native start 的 scheduler identity、SA、input。
    pub(crate) async fn scheduled_start(
        &self,
        id: &str,
        workflow: &str,
        run: &str,
        input: &impl serde::Serialize,
    ) -> Result<String, TemporalError> {
        self.refresh_token().await?;
        let mut request = GetWorkflowExecutionHistoryRequest {
            namespace: self.namespace.clone(),
            execution: Some(WorkflowExecution {
                workflow_id: workflow.into(),
                run_id: run.into(),
            }),
            maximum_page_size: 1,
            ..Default::default()
        };
        let response = self
            .with_auth_retry(|mut svc| {
                let r = request.clone();
                async move {
                    svc.get_workflow_execution_history(tonic::Request::new(r))
                        .await
                }
            })
            .await
            .map_err(|_| TemporalError::Unknown("Schedule run history 不可核验".into()))?;
        let event = response
            .history
            .and_then(|h| h.events.into_iter().next())
            .filter(|e| e.event_id == 1)
            .ok_or_else(|| TemporalError::Unknown("Schedule run 缺 start".into()))?;
        let Some(Attributes::WorkflowExecutionStartedEventAttributes(mut start)) = event.attributes
        else {
            return Err(TemporalError::Unknown("Schedule run 首事件类型不符".into()));
        };
        let expected = serde_json::to_value(input)
            .map_err(|_| TemporalError::Encode("Schedule input 不成立".into()))?;
        let mut current_input = start
            .input
            .as_ref()
            .and_then(|p| (p.payloads.len() == 1).then(|| &p.payloads[0]))
            .and_then(|p| serde_json::from_slice::<serde_json::Value>(&p.data).ok());
        let continued =
            !start.first_execution_run_id.is_empty() && start.first_execution_run_id != run;
        let preserved_cancel = current_input
            .as_mut()
            .and_then(Value::as_object_mut)
            .and_then(|fields| fields.remove("cancelPending"));
        if preserved_cancel.is_some() && (!continued || preserved_cancel != Some(Value::Bool(true)))
        {
            return Err(TemporalError::Rejected(
                "Schedule cancelPending 非原续跑 true".into(),
            ));
        }
        if current_input.as_ref() != Some(&expected)
            || start.workflow_type.as_ref().map(|t| t.name.as_str())
                != Some(crate::agent_task::WORKFLOW_TYPE)
        {
            return Err(TemporalError::Rejected(
                "Schedule 当前 run 不属于原输入".into(),
            ));
        }
        if continued {
            if start.continued_execution_run_id.is_empty() {
                return Err(TemporalError::Rejected(
                    "Schedule run 缺 continue-as-new 原生链".into(),
                ));
            }
            let first = start.first_execution_run_id.clone();
            if preserved_cancel != Some(Value::Bool(true))
                && self
                    .cancel_history(workflow, &first, None, Some(run))
                    .await?
            {
                return Err(TemporalError::Rejected("Schedule 续跑丢失原生取消".into()));
            }
            request.execution = Some(WorkflowExecution {
                workflow_id: workflow.into(),
                run_id: first.clone(),
            });
            let response = self
                .with_auth_retry(|mut svc| {
                    let r = request.clone();
                    async move {
                        svc.get_workflow_execution_history(tonic::Request::new(r))
                            .await
                    }
                })
                .await
                .map_err(|_| {
                    TemporalError::Unknown("Schedule first-run history 不可核验".into())
                })?;
            let event = response
                .history
                .and_then(|h| h.events.into_iter().next())
                .filter(|e| e.event_id == 1)
                .ok_or_else(|| TemporalError::Unknown("Schedule first run 缺 start".into()))?;
            let Some(Attributes::WorkflowExecutionStartedEventAttributes(original)) =
                event.attributes
            else {
                return Err(TemporalError::Unknown("Schedule first run 类型不符".into()));
            };
            if !original.continued_execution_run_id.is_empty()
                || (!original.first_execution_run_id.is_empty()
                    && original.first_execution_run_id != first)
            {
                return Err(TemporalError::Rejected(
                    "Schedule first run 不是原 scheduler start".into(),
                ));
            }
            start = original;
        }
        let native_input = start
            .input
            .and_then(|p| (p.payloads.len() == 1).then(|| p.payloads[0].clone()))
            .and_then(|p| serde_json::from_slice::<serde_json::Value>(&p.data).ok());
        let attributes = start
            .search_attributes
            .ok_or_else(|| TemporalError::Unknown("Schedule run 缺 native SA".into()))?;
        let field = |key: &str| {
            attributes
                .indexed_fields
                .get(key)
                .and_then(|p| serde_json::from_slice::<String>(&p.data).ok())
        };
        let planned = field("TemporalScheduledStartTime")
            .ok_or_else(|| TemporalError::Unknown("Schedule run 缺计划时间".into()))?;
        let at = chrono::DateTime::parse_from_rfc3339(&planned)
            .map_err(|_| TemporalError::Unknown("Schedule 时间未知".into()))?;
        let nominal = at
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        if native_input.as_ref() != Some(&expected)
            || start.workflow_type.as_ref().map(|t| t.name.as_str())
                != Some(crate::agent_task::WORKFLOW_TYPE)
            || start.identity != format!("temporal-scheduler-{}-{id}", self.namespace)
            || field("TemporalScheduledById").as_deref() != Some(id)
            || !workflow.ends_with(&format!("-{nominal}"))
            || at.timestamp_subsec_nanos() != 0
        {
            return Err(TemporalError::Rejected("非确切 Schedule 启动".into()));
        }
        Ok(nominal)
    }
}

fn schedule_action(
    task_queue: &str,
    workflow_id: &str,
    input: &impl serde::Serialize,
    scope: (&str, &str),
) -> Result<ScheduleAction, TemporalError> {
    // Temporal d94e34a1… workflow_handler::validateStartWorkflowArgsForSchedule
    // normalizes TaskQueueKind; Describe::annotateSearchAttributesOfScheduledWorkflow
    // adds sadefs::SetMetadataType. Emit those exact native values before persistence
    // so exact action equality remains valid; unknown metadata is never discarded.
    let indexed_fields = [(SA_TENANT, scope.0), ("PlatformWorkspaceId", scope.1)]
        .into_iter()
        .map(|(key, value)| {
            let mut payload = json_payload(value);
            payload.metadata.insert("type".into(), b"Keyword".to_vec());
            (key.to_owned(), payload)
        })
        .collect();
    Ok(ScheduleAction {
        action: Some(Action::StartWorkflow(NewWorkflowExecutionInfo {
            workflow_id: workflow_id.into(),
            workflow_type: Some(WorkflowType {
                name: crate::agent_task::WORKFLOW_TYPE.into(),
            }),
            task_queue: Some(TaskQueue {
                name: task_queue.into(),
                kind: TaskQueueKind::Normal as i32,
                ..Default::default()
            }),
            input: Some(Payloads {
                payloads: vec![raw_json_payload(serde_json::to_vec(input).map_err(
                    |_| TemporalError::Encode("Schedule input 不可编码".into()),
                )?)],
            }),
            search_attributes: Some(SearchAttributes { indexed_fields }),
            ..Default::default()
        })),
    })
}

#[cfg(test)]
mod native_shape_tests {
    use super::*;

    #[test]
    fn exact_action_matches_native_describe_annotations_without_ignoring_metadata() {
        let expected = schedule_action(
            "platform-worker",
            "original-workflow",
            &serde_json::json!({"scheduleId":"original-schedule"}),
            ("tenant", "workspace"),
        )
        .expect("actual Schedule action producer");
        let mut described = expected.clone();
        let Some(Action::StartWorkflow(start)) = described.action.as_mut() else {
            panic!("StartWorkflow");
        };
        // Fixed native normalization, independently applied to the observed action.
        start.task_queue.as_mut().expect("queue").kind = TaskQueueKind::Normal as i32;
        for payload in start
            .search_attributes
            .as_mut()
            .expect("scope")
            .indexed_fields
            .values_mut()
        {
            payload.metadata.insert("type".into(), b"Keyword".to_vec());
        }
        assert_eq!(
            described, expected,
            "same exact equality used by enable and lifecycle readback"
        );
        let Some(Action::StartWorkflow(start)) = described.action.as_mut() else {
            panic!("StartWorkflow");
        };
        start
            .search_attributes
            .as_mut()
            .expect("scope")
            .indexed_fields
            .get_mut(SA_TENANT)
            .expect("tenant")
            .metadata
            .insert("type".into(), b"Text".to_vec());
        assert_ne!(
            described, expected,
            "foreign metadata must remain unverified"
        );
        let mut unknown = expected.clone();
        let Some(Action::StartWorkflow(start)) = unknown.action.as_mut() else {
            panic!("StartWorkflow");
        };
        start.task_queue.as_mut().expect("queue").kind = TaskQueueKind::Unspecified as i32;
        assert_ne!(
            unknown, expected,
            "unknown queue kind must remain unverified"
        );
    }
}
