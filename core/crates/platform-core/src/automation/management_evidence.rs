//! 实现后证据：调用真实参数解析/校验与 RUN SQL，不创建生产业务对象。
//! 原生 SpiceDB/Relay/Temporal 的正向链不由这些检查替代。

use super::{
    governance, management_content, validate_management_params, ACTION, FROZEN_INVOCATION_SQL, RUN,
};
use governance::{Params, Semantic};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires an isolated migrated schedule_dispatch_verify_* PostgreSQL database"]
async fn schedule_intent_keeps_the_original_admission_dispatchable() {
    let pool = sqlx::PgPool::connect(
        &std::env::var("SCHEDULE_DISPATCH_TEST_DATABASE_URL").expect("isolated test database"),
    )
    .await
    .unwrap();
    let database: String = sqlx::query_scalar("select current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(database.starts_with("schedule_dispatch_verify_"));
    let mut tx = pool.begin().await.unwrap();
    let tenant = Uuid::new_v4();
    let principal = Uuid::new_v4();
    sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'Schedule dispatch evidence','ACTIVE')")
        .bind(tenant).bind(format!("schedule-dispatch-{tenant}")).execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')",
    )
    .bind(principal)
    .bind(tenant)
    .execute(&mut *tx)
    .await
    .unwrap();
    for action in [
        "automation.enable",
        "automation.pause",
        "automation.disable",
    ] {
        for intent in [
            None,
            Some(json!({"scheduleIntent":{"id":"native-schedule","started":false}})),
        ] {
            let id = Uuid::new_v4();
            // Exactly the original SYNC admission state before management
            // prewrite returns; all real migrated constraints remain enabled.
            sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
                initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,parameters)
                values($1,$1,$2,$3,1,$4,$4,$4,'isolated-schedule-intent','ALLOWED','DISPATCHED',$1,$5)")
                .bind(id).bind(tenant).bind(action).bind(principal).bind(&intent).execute(&mut *tx).await.unwrap();
            let deferred = super::defer_schedule_dispatch(&mut tx, id).await.unwrap();
            let (actual_id,state,parameters):(Uuid,String,Option<serde_json::Value>) = sqlx::query_as(
                "select id,dispatch_state,parameters from admission.action_execution where id=$1")
                .bind(id).fetch_one(&mut *tx).await.unwrap();
            assert_eq!(actual_id, id);
            assert_eq!(
                parameters, intent,
                "intent must remain the native authority reference"
            );
            assert_eq!(deferred, intent.is_some());
            assert_eq!(
                state,
                if intent.is_some() {
                    "NOT_DISPATCHED"
                } else {
                    "DISPATCHED"
                },
                "{action}"
            );
            if intent.is_some() {
                sqlx::query(
                    "update admission.action_execution set dispatch_state='UNKNOWN' where id=$1",
                )
                .bind(id)
                .execute(&mut *tx)
                .await
                .unwrap();
                assert!(
                    super::defer_schedule_dispatch(&mut tx, id).await.is_err(),
                    "recovery must not reset an UNKNOWN native write"
                );
                let state: String = sqlx::query_scalar(
                    "select dispatch_state from admission.action_execution where id=$1",
                )
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
                assert_eq!(state, "UNKNOWN");
            }
        }
    }
    tx.rollback().await.unwrap();
    pool.close().await;
}

#[test]
fn step_approval_reference_is_explicit_and_changes_the_frozen_version_hash() {
    let plain = json!({"trigger":{"kind":"CHANNEL_MESSAGE"},"action":{"kind":"POST_MESSAGE","template":"literal"},"resultTarget":"TRIGGER_THREAD"});
    let old = management_content(&plain).unwrap();
    assert_eq!(
        old,
        json!({"trigger":{"kind":"CHANNEL_MESSAGE"},"action":{"kind":"POST_MESSAGE","template":"literal"},"resultTarget":"TRIGGER_THREAD","approvalPolicyId":null})
    );
    let mut requested = plain.clone();
    let policy = Uuid::new_v4();
    requested["approvalPolicy"] = json!({"id":policy,"version":2});
    let frozen = management_content(&requested).unwrap();
    assert_eq!(frozen["approvalPolicyId"], json!(policy));
    assert_eq!(frozen["approvalPolicyVersion"], json!(2));
    assert_ne!(
        collab_bridge::limits::canonical_digest(&old),
        collab_bridge::limits::canonical_digest(&frozen)
    );
    for invalid in [
        json!(null),
        json!({"id":policy}),
        json!({"id":policy,"version":0}),
        json!({"id":Uuid::nil(),"version":2}),
        json!({"id":policy,"version":2,"selfApproval":"ALLOW"}),
    ] {
        requested["approvalPolicy"] = invalid;
        assert!(management_content(&requested).is_err());
    }
}

#[test]
fn five_management_commands_require_their_exact_fields() {
    let workspace = Uuid::new_v4();
    let installation = Uuid::new_v4();
    let resource = Uuid::new_v4();
    let asset = Uuid::new_v4();
    let grant = Uuid::new_v4();
    let content = json!({
        "trigger": {"kind": "CHANNEL_MESSAGE", "textPrefix": "!"},
        "action": {"kind": "AGENT_TURN", "template": "Summarize the source message."},
        "resultTarget": "TRIGGER_THREAD"
    });
    for (semantic, command) in [
        (
            Semantic::AutomationCreate,
            json!({"workspaceId":workspace,
            "executorInstallationResourceId":installation,"explicitConfirmation":true,
            "automationVersionContent":content}),
        ),
        (
            Semantic::AutomationPublish,
            json!({"resourceId":resource,"resourceVersion":1,
            "explicitConfirmation":true,"automationVersionContent":content}),
        ),
        (
            Semantic::AutomationEnable,
            json!({"resourceId":resource,"resourceVersion":1,
            "explicitConfirmation":true,"assetId":asset,"assetVersion":1,
            "delegationId":grant,"delegationVersion":1}),
        ),
        (
            Semantic::AutomationPause,
            json!({"resourceId":resource,"resourceVersion":1,
            "explicitConfirmation":true}),
        ),
        (
            Semantic::AutomationDisable,
            json!({"resourceId":resource,"resourceVersion":1,
            "explicitConfirmation":true}),
        ),
    ] {
        let params = Params::from_json(&command).expect("真实 Params 解析");
        assert!(validate_management_params(semantic, &params).is_ok());
        for confirmation in [serde_json::Value::Null, json!(false)] {
            let mut invalid = command.clone();
            invalid["explicitConfirmation"] = confirmation;
            let params = Params::from_json(&invalid).expect("真实 Params 解析");
            assert!(validate_management_params(semantic, &params).is_err());
        }
        for foreign_field in [
            "tenantId",
            "principalId",
            "invitationId",
            "originalActionExecutionId",
        ] {
            let mut invalid = command.clone();
            invalid[foreign_field] = json!(Uuid::new_v4());
            let params = Params::from_json(&invalid).expect("真实 Params 解析");
            assert!(
                validate_management_params(semantic, &params).is_err(),
                "{foreign_field}"
            );
        }
    }
}

#[test]
fn enable_does_not_admit_missing_nil_or_nonpositive_pins() {
    let command = json!({"resourceId":Uuid::new_v4(),"resourceVersion":1,
        "explicitConfirmation":true,"assetId":Uuid::new_v4(),"assetVersion":1,
        "delegationId":Uuid::new_v4(),"delegationVersion":1});
    for key in ["resourceId", "assetId", "delegationId"] {
        for invalid_value in [
            serde_json::Value::Null,
            json!(Uuid::nil()),
            json!("not-a-uuid"),
        ] {
            let mut invalid = command.clone();
            invalid[key] = invalid_value;
            let params = Params::from_json(&invalid).expect("真实 Params 解析");
            assert!(
                validate_management_params(Semantic::AutomationEnable, &params).is_err(),
                "{key}"
            );
        }
    }
    for key in ["resourceVersion", "assetVersion", "delegationVersion"] {
        for invalid_value in [
            serde_json::Value::Null,
            json!(0),
            json!(-1),
            json!(i64::MAX),
        ] {
            let mut invalid = command.clone();
            invalid[key] = invalid_value;
            let params = Params::from_json(&invalid).expect("真实 Params 解析");
            assert!(
                validate_management_params(Semantic::AutomationEnable, &params).is_err(),
                "{key}"
            );
        }
    }
}

#[test]
fn management_content_rejects_unimplemented_or_ambiguous_policy() {
    let content = json!({"trigger":{"kind":"CHANNEL_MESSAGE"},
        "action":{"kind":"AGENT_TURN","template":"Summarize."},"resultTarget":"TRIGGER_THREAD"});
    assert!(management_content(&content).is_ok());
    for kind in ["SCHEDULE", "WEBHOOK", "UNKNOWN", ""] {
        let mut invalid = content.clone();
        invalid["trigger"]["kind"] = json!(kind);
        assert!(management_content(&invalid).is_err());
    }
    for (field, value) in [
        ("approvalPolicyId", serde_json::Value::Null),
        ("replyPolicy", json!("THREAD")),
        ("resultTarget", json!("UNKNOWN")),
        ("resultTarget", json!("CHANNEL")),
    ] {
        let mut invalid = content.clone();
        invalid[field] = value;
        assert!(management_content(&invalid).is_err(), "{field}");
    }
    for template in [serde_json::Value::Null, json!(""), json!(" \n\t"), json!(1)] {
        let mut invalid = content.clone();
        invalid["action"]["template"] = template;
        assert!(management_content(&invalid).is_err());
    }
    let mut message = content.clone();
    message["action"]["kind"] = json!("POST_MESSAGE");
    assert_eq!(
        management_content(&message).unwrap()["action"],
        message["action"]
    );
    for kind in [json!("FUTURE_ACTION"), serde_json::Value::Null] {
        message["action"]["kind"] = kind;
        assert!(management_content(&message).is_err());
    }
    for prefix in [serde_json::Value::Null, json!(""), json!(1)] {
        let mut invalid = content.clone();
        invalid["trigger"]["textPrefix"] = prefix;
        assert!(management_content(&invalid).is_err());
    }
    let mut invalid = content;
    invalid["trigger"]["mentionPrincipalId"] = serde_json::Value::Null;
    assert!(management_content(&invalid).is_err());
}

#[test]
fn schedule_requires_explicit_native_interval_and_channel_result() {
    let content = json!({"trigger":{"kind":"SCHEDULE","scheduleSpec":{
        "everySeconds":60,"offsetSeconds":5,"catchupWindowSeconds":10}},
        "action":{"kind":"AGENT_TURN","template":"literal ${source}"},"resultTarget":"CHANNEL"});
    let normalized = management_content(&content).expect("原 Schedule producer");
    assert_eq!(
        normalized["trigger"]["schedule_spec"],
        content["trigger"]["scheduleSpec"]
    );
    assert_eq!(
        normalized["action"]["template"],
        content["action"]["template"]
    );
    for spec in [
        json!({}),
        json!({"everySeconds":0,"offsetSeconds":0,"catchupWindowSeconds":10}),
        json!({"everySeconds":60,"offsetSeconds":60,"catchupWindowSeconds":10}),
        json!({"everySeconds":60,"offsetSeconds":-1,"catchupWindowSeconds":10}),
        json!({"everySeconds":60,"offsetSeconds":0,"catchupWindowSeconds":9}),
        json!({"everySeconds":60,"offsetSeconds":0,"catchupWindowSeconds":10,"cron":"*"}),
        json!({"everySeconds":"60","offsetSeconds":0,"catchupWindowSeconds":10}),
    ] {
        let mut invalid = content.clone();
        invalid["trigger"]["scheduleSpec"] = spec;
        assert!(management_content(&invalid).is_err());
    }
    for (key, value) in [
        ("textPrefix", json!("!")),
        ("mentionPrincipalId", json!(Uuid::new_v4())),
    ] {
        let mut invalid = content.clone();
        invalid["trigger"][key] = value;
        assert!(management_content(&invalid).is_err());
    }
    let mut invalid = content;
    invalid["resultTarget"] = json!("TRIGGER_THREAD");
    assert!(management_content(&invalid).is_err());
}

#[test]
fn mention_is_explicit_and_normalization_preserves_literal_template() {
    let agent = Uuid::new_v4();
    let content = json!({"trigger":{"kind":"MENTION","mentionPrincipalId":agent,"textPrefix":"!"},
        "action":{"kind":"AGENT_TURN","template":"literal ${source}\n"},
        "resultTarget":"TRIGGER_THREAD"});
    assert_eq!(
        management_content(&content).expect("已实现的 MENTION"),
        json!({"trigger":{"kind":"MENTION","mention_principal_id":agent,"text_prefix":"!"},
            "action":{"kind":"AGENT_TURN","template":"literal ${source}\n"},
            "approvalPolicyId":null,"resultTarget":"TRIGGER_THREAD"})
    );
    for principal in [
        serde_json::Value::Null,
        json!(Uuid::nil()),
        json!("not-a-uuid"),
    ] {
        let mut invalid = content.clone();
        invalid["trigger"]["mentionPrincipalId"] = principal;
        assert!(management_content(&invalid).is_err());
    }
}

#[tokio::test]
async fn real_run_query_and_pause_predicate_remain_valid_in_empty_database() {
    let Some(database_url) = std::env::var("DATABASE_URL").ok() else {
        eprintln!("SKIP Automation SQL证据：未投递独立空库 DATABASE_URL");
        return;
    };
    let pool = sqlx::PgPool::connect(&database_url)
        .await
        .expect("独立迁移空库");
    let resource = Uuid::new_v4();
    for invocation in [None, Some(Uuid::new_v4())] {
        // 原 SQL 和原锁目标一起交给 PostgreSQL 解析/规划，零业务行不算运行验收。
        sqlx::query(&format!(
            "EXPLAIN {RUN} for update of r,d,a,v,w,owner,tm,version_owner,version_tm,ir,i,agent,p"
        ))
        .bind(resource)
        .bind(invocation)
        .fetch_all(&pool)
        .await
        .expect("真实 RUN SQL");
    }
    // 测的不是另一套手写策略：仅抽取 RUN 自身的准入/在途 state 谓词。
    let predicate = RUN
        .split_once("and (($2::uuid is null")
        .expect("原 RUN 状态谓词")
        .1
        .split_once("\n      and t.state=")
        .expect("原 RUN 状态谓词末端")
        .0;
    let sql = format!("with d as(select $1::text state), invocation as(select $2::uuid id,$3::text status,$4::boolean cancel_pending)
        select (($2::uuid is null{predicate} from d cross join invocation");
    for state in ["ENABLED", "PAUSED", "DISABLED", "DRAFT", "UNKNOWN"] {
        for invocation in [None, Some(Uuid::new_v4())] {
            for status in [
                "CREATED",
                "DISPATCHING",
                "RUNNING",
                "UNKNOWN",
                "COMPLETED",
                "FAILED",
            ] {
                for cancel_pending in [false, true] {
                    let allowed: bool = sqlx::query_scalar(&sql)
                        .bind(state)
                        .bind(invocation)
                        .bind(status)
                        .bind(cancel_pending)
                        .fetch_one(&pool)
                        .await
                        .expect("原 RUN 状态谓词");
                    let expected = match invocation {
                        None => state == "ENABLED",
                        Some(_) => {
                            matches!(state, "ENABLED" | "PAUSED" | "DISABLED")
                                && matches!(
                                    status,
                                    "CREATED" | "DISPATCHING" | "RUNNING" | "UNKNOWN"
                                )
                                && !cancel_pending
                        }
                    };
                    assert_eq!(
                        allowed, expected,
                        "{state}/{status}/cancel={cancel_pending}/invocation={invocation:?}"
                    );
                }
            }
        }
    }
    pool.close().await;
}
#[test]
fn relay_inspect_admits_post_message_and_agent_turn_for_both_native_triggers() {
    for kind in ["AGENT_TURN", "POST_MESSAGE"] {
        for trigger in ["CHANNEL_MESSAGE", "MENTION"] {
            assert!(
                super::relay_trigger_supported(
                    &serde_json::json!({"kind":kind}),
                    &serde_json::json!({"kind":trigger})
                ),
                "{kind}/{trigger}"
            );
        }
    }
    for action in [
        serde_json::json!({}),
        serde_json::json!({"kind":"UNKNOWN"}),
        serde_json::json!({"kind":null}),
    ] {
        assert!(!super::relay_trigger_supported(
            &action,
            &serde_json::json!({"kind":"MENTION"})
        ));
    }
    for trigger in ["SCHEDULE", "WEBHOOK", "UNKNOWN"] {
        assert!(!super::relay_trigger_supported(
            &serde_json::json!({"kind":"POST_MESSAGE"}),
            &serde_json::json!({"kind":trigger})
        ));
    }
}

#[tokio::test]
async fn first_turn_and_completed_reply_have_disjoint_native_fences() {
    let Some(database_url) = std::env::var("DATABASE_URL").ok() else {
        eprintln!("SKIP Automation阶段SQL证据：未投递独立空库 DATABASE_URL");
        return;
    };
    let pool = sqlx::PgPool::connect(&database_url)
        .await
        .expect("独立迁移空库");
    for turn in [None, Some("native-turn")] {
        sqlx::query(&format!("EXPLAIN {FROZEN_INVOCATION_SQL}"))
            .bind(Uuid::new_v4())
            .bind(ACTION)
            .bind(turn)
            .bind(Option::<&str>::None)
            .bind(false)
            .bind(false)
            .fetch_all(&pool)
            .await
            .expect("真实冻结Invocation SQL");
    }
    let predicate = FROZEN_INVOCATION_SQL
        .split_once("and ((")
        .expect("原首turn/回复阶段谓词")
        .1
        .split_once("\n           and a.action_key=")
        .expect("原阶段谓词末端")
        .0;
    let sql = format!(
        "select coalesce(not i.cancel_pending and (({predicate},false)
        from (select $1::text status,$2::text native_status,$7::text runtime_turn_id,
          $8::text reply_event_id,$9::boolean cancel_pending,
          null::uuid automation_version_asset_id,null::uuid automation_resource_id) i"
    );
    for status in [
        "CREATED",
        "DISPATCHING",
        "RUNNING",
        "UNKNOWN",
        "COMPLETED",
        "FAILED",
    ] {
        for native in ["inProgress", "completed"] {
            for completed_turn in [None, Some("native-turn")] {
                for runtime_turn in [None, Some("native-turn"), Some("other-turn")] {
                    for (expected_reply, reply) in [
                        (None, None),
                        (None, Some("persisted-reply")),
                        (Some("persisted-reply"), None),
                        (Some("persisted-reply"), Some("persisted-reply")),
                        (Some("persisted-reply"), Some("other-reply")),
                    ] {
                        for cancel_pending in [false, true] {
                            let allowed: bool = sqlx::query_scalar(&sql)
                                .bind(status)
                                .bind(native)
                                .bind(completed_turn)
                                .bind(expected_reply)
                                .bind(false)
                                .bind(false)
                                .bind(runtime_turn)
                                .bind(reply)
                                .bind(cancel_pending)
                                .fetch_one(&pool)
                                .await
                                .expect("原阶段谓词");
                            let expected = !cancel_pending
                                && match completed_turn {
                                    None => {
                                        matches!(status, "CREATED" | "DISPATCHING")
                                            && runtime_turn.is_none()
                                            && expected_reply.is_none()
                                    }
                                    Some(turn) => {
                                        matches!(status, "RUNNING" | "UNKNOWN")
                                            && native == "completed"
                                            && runtime_turn == Some(turn)
                                            && reply == expected_reply
                                    }
                                };
                            assert_eq!(allowed,expected,"{status}/{native}/{completed_turn:?}/{runtime_turn:?}/{expected_reply:?}/{reply:?}/{cancel_pending}");
                        }
                    }
                }
            }
        }
    }
    pool.close().await;
}
