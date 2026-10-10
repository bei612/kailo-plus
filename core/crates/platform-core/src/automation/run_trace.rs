//! REQ-24: evidence projection for the existing AgentTask, not a step executor.
//! Only immutable step IDs, native timer observations and already reconciled
//! external references leave this module. Templates and results remain upstream.
use contracts::TaskStateReport;
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::service_api::ServiceState;

#[derive(FromRow)]
struct Source {
    id: Uuid,
    action_execution_id: Uuid,
    action: Value,
    events: Vec<String>,
    reference_run: Option<String>,
}

/// Called at the original ProjectAgentTaskState write, before its ACK and the
/// Workflow's terminal transition. A failed observation leaves the existing
/// projection intact; the original Activity retry/convergence path owns retry.
pub(crate) async fn capture(
    state: &ServiceState,
    report: &TaskStateReport,
) -> Result<Option<Value>, String> {
    let Some(activity) = report.activity_id.as_deref() else {
        // Old workers and Describe-based repair cannot invent step evidence.
        return Ok(None);
    };
    if activity.is_empty() || Uuid::parse_str(&report.run_id).is_err() {
        return Err("Projection native association is invalid".into());
    }
    let previous: Option<i64> = sqlx::query_scalar(
        "select last_event_id from projection.task_projection where workflow_id=$1",
    )
    .bind(&report.workflow_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    if previous.is_some_and(|event| event >= report.event_id) {
        // The single writer still checks same-event report collisions. Do not
        // change an acknowledged trace just because a retry sees newer facts.
        return Ok(None);
    }
    let source: Option<Source> = sqlx::query_as(
        "select i.id,i.action_execution_id,v.action,r.run_id reference_run,
         case when v.action->'stepsVersion'='3'::jsonb then i.automation_step_event_ids
              when i.reply_event_id is not null then ARRAY[i.reply_event_id] else ARRAY[]::text[] end events
         from catalog.agent_invocation i
         join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
           and v.automation_resource_id=i.automation_resource_id
         join projection.workflow_ref r on r.workflow_id=i.workflow_id and r.workflow_type='AgentTaskWorkflow'
           and r.kind is null and r.action_execution_id=i.action_execution_id
           and r.tenant_id=i.tenant_id and r.workspace_id=i.workspace_id
         where i.workflow_id=$1",
    ).bind(&report.workflow_id).fetch_optional(&state.pool).await.map_err(|e| e.to_string())?;
    let Some(source) = source else {
        let automation: bool = sqlx::query_scalar("select exists(select 1 from catalog.agent_invocation where workflow_id=$1 and automation_resource_id is not null)")
            .bind(&report.workflow_id).fetch_one(&state.pool).await.map_err(|e| e.to_string())?;
        return if automation {
            Err("Automation projection has no matching immutable version/WorkflowRef".into())
        } else {
            Ok(None)
        };
    };
    if !super::steps::supported(&source.action) {
        return Err("Immutable AutomationVersion is not supported".into());
    }
    let Some(steps) = source.action["steps"].as_array() else {
        // Legacy single-action/AgentTurn has no invented original step ID.
        return Ok(Some(json!([])));
    };
    let observed = state
        .temporal
        .describe(&report.workflow_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Native execution is absent")?;
    if observed.run_id != report.run_id
        || observed.first_run_id.is_empty()
        || source
            .reference_run
            .as_deref()
            .is_none_or(|run| run != observed.first_run_id && run != observed.run_id)
    {
        return Err("Projection is not in the fixed native execution chain".into());
    }
    // For format 3, future zero-delay steps must not be marked skipped before
    // the preceding message has even been dispatched. The executor uses this
    // same prefix when it asks Temporal which timer it may advance.
    let message_count = steps
        .iter()
        .filter(|step| step["action"] == "send_message")
        .count();
    let delays =
        if super::steps::is_sequence(&source.action) && source.events.len() < message_count {
            super::steps::delays_through_message(&source.action, source.events.len())
        } else {
            super::steps::delays(&source.action)
        }
        .map_err(|_| "Immutable delay sequence is invalid")?;
    let (_, timers) = state
        .temporal
        .automation_step_history(
            &temporalio_common::protos::temporal::api::common::v1::WorkflowExecution {
                workflow_id: report.workflow_id.clone(),
                run_id: report.run_id.clone(),
            },
            &observed.first_run_id,
            activity,
            &source.id.to_string(),
            &delays,
            Some(report),
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut trace = Vec::with_capacity(steps.len());
    let mut effect_index = 0;
    for step in steps {
        let id = step["id"].as_str().ok_or("Immutable step ID is absent")?;
        let mut entry = json!({"stepId":id,"status":"pending","output":{}});
        match step["action"].as_str() {
            Some("delay") => {
                if let Some(timer) = timers.iter().rev().find(|timer| timer["stepId"] == id) {
                    entry = timer.clone();
                    if entry["output"].get("runId").is_some() {
                        entry["output"]["workflowId"] = report.workflow_id.clone().into();
                    }
                }
            }
            Some("request_approval") => {
                let approval: Option<(String, String, String, String, Option<String>)> = sqlx::query_as(
                    "select c.id::text,c.approval_workflow_id,c.gate_state,c.dispatch_state,p.status
                     from admission.action_execution c
                     join admission.action_execution parent on parent.id=c.parent_action_execution_id
                     join catalog.agent_invocation i on i.action_execution_id=parent.id
                     join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
                       and v.automation_resource_id=i.automation_resource_id
                     left join projection.approval_projection p on p.workflow_id=c.approval_workflow_id
                       and p.action_execution_id=c.id
                     where i.id=$1 and c.action_key='automation.run' and parent.action_key=c.action_key
                       and c.tenant_id=i.tenant_id and c.workspace_id=i.workspace_id
                       and c.target_id=i.automation_resource_id and c.operation_id=parent.operation_id
                       and c.parameters->'automationStepApproval'->>'invocationId'=i.id::text
                       and c.parameters->'automationStepApproval'->>'stepId'=$2
                       and c.parameters->'automationStepApproval'->>'policyId'=v.approval_policy_id::text
                       and c.parameters->'automationStepApproval'->>'policyVersion'=v.approval_policy_version::text
                       and c.approval_workflow_id is not null",
                ).bind(source.id).bind(id).fetch_optional(&state.pool).await.map_err(|e| e.to_string())?;
                if let Some((ae, workflow, gate, dispatch, status)) = approval {
                    entry["output"] = json!({"actionExecutionId":ae,"approvalWorkflowId":workflow});
                    entry["status"] = match (gate.as_str(), dispatch.as_str(), status.as_deref()) {
                        ("ALLOWED", "DISPATCHED", Some("CONSUMED")) => "completed",
                        ("DENIED" | "EXPIRED", _, _) | (_, _, Some("DENIED" | "EXPIRED")) => {
                            "failed"
                        }
                        ("REVOKED", _, _) | (_, _, Some("INVALIDATED" | "CANCELLED")) => {
                            "cancelled"
                        }
                        ("WAITING" | "ALLOWED", _, Some("WAITING" | "APPROVED")) => {
                            "waiting_approval"
                        }
                        _ => "unknown",
                    }
                    .into();
                }
            }
            Some("send_message" | "add_reaction" | "set_channel_topic") => {
                if let Some(event) = source.events.get(effect_index) {
                    let (accepted, rejected): (bool, bool) = sqlx::query_as(
                        "select catalog.automation_step_accepted(i.id,$2),exists(
                          select 1 from audit.audit_event e join admission.action_execution a on a.id=i.action_execution_id
                          where e.operation_id=a.operation_id and e.tenant_id=i.tenant_id and e.workspace_id=i.workspace_id
                            and e.actor_principal_id=a.actor_principal_id and e.action_key=a.action_key
                            and e.action_version=a.action_version and e.parameter_hash=a.parameter_hash
                            and e.event_type='OUTCOME' and e.result_code in ('REJECTED','NOT_DELIVERED')
                            and e.evidence_refs @> jsonb_build_array(
                              jsonb_build_object('kind','ACTION_EXECUTION_ID','value',a.id::text),
                              jsonb_build_object('kind','BUZZ_EVENT_ID','value',$2::text)))
                         from catalog.agent_invocation i where i.id=$1",
                    ).bind(source.id).bind(event).fetch_one(&state.pool).await.map_err(|e| e.to_string())?;
                    if accepted && rejected {
                        return Err("Conflicting external effect evidence".into());
                    }
                    entry["status"] = if accepted {
                        "completed"
                    } else if rejected {
                        "failed"
                    } else {
                        "unknown"
                    }
                    .into();
                    entry["output"] =
                        json!({"eventId":event,"actionExecutionId":source.action_execution_id});
                    if !accepted && !rejected {
                        entry["error"] = json!(contracts::ReasonCode::ExternalResultUnknown);
                    }
                }
                effect_index += 1;
            }
            _ => return Err("Unknown immutable step action".into()),
        }
        // Use the generated contract at the persistence boundary, not a second
        // public shape; unexpected status/reason values fail closed.
        let typed: contracts::AutomationStepTrace =
            serde_json::from_value(entry).map_err(|e| e.to_string())?;
        trace.push(typed);
    }
    let mut trace = serde_json::to_value(trace).map_err(|e| e.to_string())?;
    mark_passed_zero_delays(
        steps,
        trace.as_array_mut().ok_or("Invalid step projection")?,
    );
    Ok(Some(trace))
}

fn mark_passed_zero_delays(steps: &[Value], trace: &mut [Value]) {
    // A configured zero-duration step has no Timer. Mark that no-op skipped
    // only once a later real step is observed, not on the initial projection.
    let mut later_observed = false;
    for (step, entry) in steps.iter().rev().zip(trace.iter_mut().rev()) {
        if entry["status"] != "pending" {
            later_observed = true;
        } else if later_observed
            && step["action"] == "delay"
            && step["duration"]
                .as_str()
                .and_then(super::steps::duration_seconds)
                == Some(0)
        {
            entry["status"] = "skipped".into();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_delay_requires_later_real_observation_and_never_gets_a_fabricated_timestamp() {
        let steps = json!([
            {"id":"first-zero","action":"delay","duration":"0s"},
            {"id":"first","action":"send_message","text":"not copied"},
            {"id":"future-zero","action":"delay","duration":"0"},
            {"id":"last","action":"send_message","text":"not copied"}
        ]);
        let mut trace: Vec<Value> = steps
            .as_array()
            .unwrap()
            .iter()
            .map(|step| json!({"stepId":step["id"],"status":"pending","output":{}}))
            .collect();
        mark_passed_zero_delays(steps.as_array().unwrap(), &mut trace);
        assert!(trace.iter().all(|entry| entry["status"] == "pending"));
        trace[1]["status"] = "unknown".into();
        trace[1]["output"] = json!({"eventId":"immutable-native-reference"});
        mark_passed_zero_delays(steps.as_array().unwrap(), &mut trace);
        assert_eq!(trace[0]["status"], "skipped");
        assert_eq!(trace[2]["status"], "pending");
        assert_eq!(trace[0]["output"], json!({}));
        assert!(trace[0].get("startedAt").is_none());
        assert!(trace[0].get("completedAt").is_none());
        trace[3]["status"] = "completed".into();
        mark_passed_zero_delays(steps.as_array().unwrap(), &mut trace);
        assert_eq!(trace[2]["status"], "skipped");
    }
}
