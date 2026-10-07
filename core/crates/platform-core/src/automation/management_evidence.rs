//! 实现后证据：调用真实参数解析/校验与 RUN SQL，不创建生产业务对象。
//! 原生 SpiceDB/Relay/Temporal 的正向链不由这些检查替代。

use super::{
    governance, management_content, validate_management_params, ACTION, FROZEN_INVOCATION_SQL, RUN,
};
use governance::{Params, Semantic};
use serde_json::json;
use uuid::Uuid;

#[test]
fn trigger_filter_is_frozen_without_rewriting_legacy_prefix_or_version() {
    let legacy = json!({"trigger":{"kind":"CHANNEL_MESSAGE","textPrefix":" release "},
        "action":{"kind":"POST_MESSAGE","template":"literal"},"resultTarget":"TRIGGER_THREAD"});
    let old = management_content(&legacy).unwrap();
    assert_eq!(
        old["trigger"],
        json!({"kind":"CHANNEL_MESSAGE","text_prefix":" release "})
    );
    assert!(old["trigger"].get("filter").is_none());
    let mut filtered = legacy.clone();
    filtered["trigger"]["filter"] =
        json!("!trigger_is_reply && str_contains(trigger_text, \"部署\")");
    let frozen = management_content(&filtered).unwrap();
    assert_eq!(frozen["trigger"]["filter"], filtered["trigger"]["filter"]);
    assert_eq!(
        frozen["trigger"]["text_prefix"],
        old["trigger"]["text_prefix"]
    );
    assert_ne!(
        collab_bridge::limits::canonical_digest(&frozen),
        collab_bridge::limits::canonical_digest(&old)
    );
    assert_eq!(management_content(&legacy).unwrap(), old);
    filtered["trigger"]["kind"] = json!("MENTION");
    filtered["trigger"]["mentionPrincipalId"] = json!(Uuid::new_v4());
    assert!(management_content(&filtered).is_ok());
    filtered["trigger"] = json!({"kind":"SCHEDULE","filter":"true","scheduleSpec":{
        "everySeconds":60,"offsetSeconds":0,"catchupWindowSeconds":10}});
    filtered["resultTarget"] = json!("CHANNEL");
    assert!(
        management_content(&filtered).is_err(),
        "timer has no message condition context"
    );
}

#[test]
fn reaction_requires_real_message_trigger_and_keeps_emoji_in_immutable_version() {
    let mut value = json!({"formatVersion":2,"trigger":{"kind":"CHANNEL_MESSAGE"},
        "resultTarget":"TRIGGER_THREAD","steps":[{"id":"reaction","action":"add_reaction","emoji":"👍"}]});
    let normalized = management_content(&value).unwrap();
    assert_eq!(normalized["action"]["kind"], "ADD_REACTION_STEPS");
    assert_eq!(normalized["action"]["emoji"], "👍");
    value["trigger"] = json!({"kind":"SCHEDULE","scheduleSpec":{"everySeconds":60,"offsetSeconds":0,"catchupWindowSeconds":60}});
    value["resultTarget"] = json!("CHANNEL");
    assert!(
        management_content(&value).is_err(),
        "timer is not a message target"
    );
}

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
        "automation.delete",
        "automation.rotate_webhook_secret",
    ] {
        for intent in [
            None,
            Some(json!({"scheduleIntent":{"id":"native-schedule","started":false}})),
            Some(json!({"webhookSecretIntent":{"newStatus":"PENDING"}})),
            Some(
                json!({"scheduleIntent":{"started":false},"webhookSecretIntent":{"newStatus":"PENDING"}}),
            ),
        ] {
            let id = Uuid::new_v4();
            // Exactly the original SYNC admission state before management
            // prewrite returns; all real migrated constraints remain enabled.
            sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,action_key,action_version,
                initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,parameters)
                values($1,$1,$2,$3,1,$4,$4,$4,'isolated-schedule-intent','ALLOWED','DISPATCHED',$1,$5)")
                .bind(id).bind(tenant).bind(action).bind(principal).bind(&intent).execute(&mut *tx).await.unwrap();
            let deferred = super::defer_management_dispatch(&mut tx, id).await.unwrap();
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
                    super::defer_management_dispatch(&mut tx, id).await.is_err(),
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
fn native_intents_require_every_receipt_before_the_same_ae_can_complete() {
    for first in ["scheduleIntent", "webhookSecretIntent"] {
        let other = if first == "scheduleIntent" {
            "webhookSecretIntent"
        } else {
            "scheduleIntent"
        };
        let mut parameters =
            json!({"scheduleIntent":{"started":true},"webhookSecretIntent":{"writeStarted":true}});
        assert!(!super::management_intents_complete(&parameters));
        parameters[first]["complete"] = json!(true);
        assert!(
            !super::management_intents_complete(&parameters),
            "the first native receipt is not the AE terminal"
        );
        parameters[other]["complete"] = json!(true);
        assert!(super::management_intents_complete(&parameters));
        for unknown in [json!(null), json!("true"), json!(false), json!({})] {
            parameters[other]["complete"] = unknown;
            assert!(!super::management_intents_complete(&parameters));
        }
    }
    assert!(!super::management_intents_complete(&json!({})));
    assert!(super::management_intents_complete(
        &json!({"scheduleIntent":{"complete":true}})
    ));
    assert!(super::management_intents_complete(
        &json!({"webhookSecretIntent":{"complete":true}})
    ));
}

#[tokio::test]
#[ignore = "requires WORKFLOW_MANUAL_TEST_DATABASE_URL pointing at an isolated schedule_dispatch_verify_manual_* database"]
async fn delete_uses_original_local_and_native_receipt_writers_without_erasing_history() {
    let pool = sqlx::PgPool::connect(&std::env::var("WORKFLOW_MANUAL_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let database: String = sqlx::query_scalar("select current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(database.starts_with("schedule_dispatch_verify_manual_"));
    let def = governance::exact_definition(&pool, "automation.delete", 1)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let tenant = crate::agent_task::receipt_tests::fixture(&mut tx).await;
    let (owner,workspace,installation):(Uuid,Uuid,Uuid) = sqlx::query_as("select r.owner_principal_id,i.workspace_id,i.resource_id
        from catalog.agent_installation i join catalog.resource r on r.id=i.resource_id where r.tenant_id=$1 order by i.resource_id limit 1")
        .bind(tenant).fetch_one(&mut *tx).await.unwrap();
    let original_invocations: i64 =
        sqlx::query_scalar("select count(*) from catalog.agent_invocation where tenant_id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    for native_receipts in [false, true] {
        let id = Uuid::new_v4();
        let resource = Uuid::new_v4();
        let asset = Uuid::new_v4();
        let mut parameters = json!({"targetVersion":1});
        if native_receipts {
            parameters["scheduleIntent"] = json!({"started":true});
            parameters["webhookSecretIntent"] = json!({"writeStarted":true});
        }
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,parameters)
            values($1,$1,$2,$3,'automation.delete',1,$4,$4,$5,'delete-receipt-fixture','ALLOWED',$6,$1,$7)")
            .bind(id).bind(tenant).bind(workspace).bind(owner).bind(resource)
            .bind(if native_receipts{"UNKNOWN"}else{"DISPATCHED"}).bind(parameters).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
            native_type,native_id,state,version,projection_action_execution_id)
            values($1,$2,'automation',$3,$4,'core','automation',$1::text,'ACTIVE',2,$5)")
            .bind(resource).bind(tenant).bind(workspace).bind(owner).bind(native_receipts.then_some(id)).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.automation_definition(resource_id,workspace_id,executor_installation_resource_id,state,version)
            values($1,$2,$3,'DISABLED',1)").bind(resource).bind(workspace).bind(installation).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.asset(id,tenant_id,resource_id,type_key,owner_principal_id,native_ref,state,version)
            values($1,$2,$3,'automation.version',$4,$1::text,'DRAFT',1)")
            .bind(asset).bind(tenant).bind(resource).bind(owner).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.automation_version(asset_id,automation_resource_id,ordinal,trigger,action,result_target,config_hash,state)
            values($1,$2,1,'{\"kind\":\"CHANNEL_MESSAGE\"}','{\"kind\":\"POST_MESSAGE\",\"template\":\"fixture\"}','TRIGGER_THREAD',repeat('a',64),'DRAFT')")
            .bind(asset).bind(resource).execute(&mut *tx).await.unwrap();
        let ae = governance::lock_execution(&mut tx, id).await.unwrap();
        if native_receipts {
            // Native evidence is injected only at the original receipt boundary;
            // this check does not exercise Temporal/OpenBao RPCs or E2E deletion.
            super::complete_management_intent(&mut tx, &ae, &def, "scheduleIntent")
                .await
                .unwrap();
            let partial:(String,Option<Uuid>) = sqlx::query_as("select d.state,r.projection_action_execution_id
                from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id where r.id=$1")
                .bind(resource).fetch_one(&mut *tx).await.unwrap();
            assert_eq!(partial, ("DISABLED".into(), Some(id)));
            super::complete_management_intent(&mut tx, &ae, &def, "scheduleIntent")
                .await
                .unwrap();
            super::complete_management_intent(&mut tx, &ae, &def, "webhookSecretIntent")
                .await
                .unwrap();
        } else {
            super::tombstone(&mut tx, &ae).await.unwrap();
        }
        let final_state:(String,i32,String,Option<Uuid>) = sqlx::query_as("select d.state,d.version,r.state,r.projection_action_execution_id
            from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id where r.id=$1")
            .bind(resource).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(final_state, ("DELETED".into(), 2, "ACTIVE".into(), None));
        let retained: bool = sqlx::query_scalar("select exists(select 1 from catalog.automation_version where asset_id=$1 and automation_resource_id=$2)")
            .bind(asset).bind(resource).fetch_one(&mut *tx).await.unwrap();
        assert!(retained);
        for sql in ["update catalog.automation_definition set state='ENABLED',version=version+1 where resource_id=$1",
            "delete from catalog.automation_definition where resource_id=$1"] {
            sqlx::query("savepoint tombstone_guard").execute(&mut *tx).await.unwrap();
            assert!(sqlx::query(sql).bind(resource).execute(&mut *tx).await.is_err());
            sqlx::query("rollback to savepoint tombstone_guard").execute(&mut *tx).await.unwrap();
            sqlx::query("release savepoint tombstone_guard").execute(&mut *tx).await.unwrap();
        }
    }
    let after: i64 =
        sqlx::query_scalar("select count(*) from catalog.agent_invocation where tenant_id=$1")
            .bind(tenant)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(after, original_invocations);
    tx.rollback().await.unwrap();
    pool.close().await;
}

#[tokio::test]
#[ignore = "requires an isolated migrated schedule_dispatch_verify_* PostgreSQL database"]
async fn joint_native_receipts_keep_the_projection_fenced_until_both_are_confirmed() {
    let pool =
        sqlx::PgPool::connect(&std::env::var("SCHEDULE_DISPATCH_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
    let database: String = sqlx::query_scalar("select current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(database.starts_with("schedule_dispatch_verify_"));
    let def = governance::exact_definition(&pool, "automation.disable", 1)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let tenant = Uuid::new_v4();
    let human = Uuid::new_v4();
    let workspace = Uuid::new_v4();
    sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$1::text,'Joint native evidence','ACTIVE')").bind(tenant).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'Joint native evidence','ACTIVE')").bind(human).execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')",
    )
    .bind(human)
    .bind(tenant)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$1,$1,'ACTIVE')").bind(human).bind(tenant).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.workspace(id,tenant_id,slug,name,state) values($1,$2,$1::text,'Joint native evidence','ACTIVE')").bind(workspace).bind(tenant).execute(&mut *tx).await.unwrap();
    for first in ["scheduleIntent", "webhookSecretIntent"] {
        let other = if first == "scheduleIntent" {
            "webhookSecretIntent"
        } else {
            "scheduleIntent"
        };
        let id = Uuid::new_v4();
        let resource = Uuid::new_v4();
        sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,workspace_id,action_key,action_version,
            initiator_principal_id,actor_principal_id,target_id,parameter_hash,gate_state,dispatch_state,correlation_id,parameters)
            values($1,$1,$2,$3,'automation.disable',1,$4,$4,$5,'isolated-joint-native','ALLOWED','UNKNOWN',$1,$6)")
            .bind(id).bind(tenant).bind(workspace).bind(human).bind(resource)
            .bind(json!({"scheduleIntent":{"started":true},"webhookSecretIntent":{"writeStarted":true}}))
            .execute(&mut *tx).await.unwrap();
        sqlx::query("insert into catalog.resource(id,tenant_id,type_key,home_workspace_id,owner_principal_id,component_type_key,
            native_type,native_id,state,version,projection_action_execution_id)
            values($1,$2,'automation',$3,$4,'core','automation',$1::text,'ACTIVE',2,$5)")
            .bind(resource).bind(tenant).bind(workspace).bind(human).bind(id).execute(&mut *tx).await.unwrap();
        let ae = governance::lock_execution(&mut tx, id).await.unwrap();
        super::complete_management_intent(&mut tx, &ae, &def, first)
            .await
            .unwrap();
        let partial:(String,Option<Uuid>) = sqlx::query_as("select a.dispatch_state,r.projection_action_execution_id
            from admission.action_execution a join catalog.resource r on r.id=a.target_id where a.id=$1")
            .bind(id).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(
            partial,
            ("UNKNOWN".into(), Some(id)),
            "{first} cannot complete the joint AE"
        );
        // Reentry after a lost response reads the original receipt, not a new
        // operation; repeated receipt must not unlock the unfinished sibling.
        let resumed = governance::lock_execution(&mut tx, id).await.unwrap();
        super::complete_management_intent(&mut tx, &resumed, &def, first)
            .await
            .unwrap();
        let still_fenced: Option<Uuid> = sqlx::query_scalar(
            "select projection_action_execution_id from catalog.resource where id=$1",
        )
        .bind(resource)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        assert_eq!(still_fenced, Some(id));
        super::complete_management_intent(&mut tx, &resumed, &def, other)
            .await
            .unwrap();
        let complete:(String,Option<Uuid>) = sqlx::query_as("select a.dispatch_state,r.projection_action_execution_id
            from admission.action_execution a join catalog.resource r on r.id=a.target_id where a.id=$1")
            .bind(id).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(complete, ("DISPATCHED".into(), None));
    }
    tx.rollback().await.unwrap();
    pool.close().await;
}

#[test]
fn version_name_is_frozen_without_rewriting_unnamed_history() {
    let legacy = json!({"trigger":{"kind":"CHANNEL_MESSAGE"},"action":{"kind":"POST_MESSAGE","template":"literal"},"resultTarget":"TRIGGER_THREAD"});
    let old = management_content(&legacy).unwrap();
    assert_eq!(
        old,
        json!({"trigger":{"kind":"CHANNEL_MESSAGE"},"action":{"kind":"POST_MESSAGE","template":"literal"},"resultTarget":"TRIGGER_THREAD","approvalPolicyId":null})
    );
    let mut named = legacy;
    named["name"] = json!("协作播报");
    let frozen = management_content(&named).unwrap();
    assert_eq!(frozen["name"], "协作播报");
    assert_ne!(
        collab_bridge::limits::canonical_digest(&old),
        collab_bridge::limits::canonical_digest(&frozen)
    );
    assert_eq!(
        frozen,
        super::version_content(
            old["trigger"].clone(),
            old["action"].clone(),
            None,
            None,
            "TRIGGER_THREAD",
            Some("协作播报")
        )
    );
    for invalid in [
        json!(null),
        json!(""),
        json!(" \n\t"),
        json!(123),
        json!({}),
    ] {
        named["name"] = invalid;
        assert!(management_content(&named).is_err());
    }
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
fn ordered_approval_uses_the_same_pinned_policy_and_rejects_a_second_header_policy() {
    let policy = json!({"id":Uuid::new_v4(),"version":2});
    let mut content = json!({"trigger":{"kind":"CHANNEL_MESSAGE"},"resultTarget":"TRIGGER_THREAD",
        "formatVersion":2,"steps":[
            {"id":"review","action":"request_approval","approvalPolicy":policy,"message":"Review reply"},
            {"id":"reply","action":"send_message","text":"Approved"}]});
    let frozen = management_content(&content).unwrap();
    assert_eq!(frozen["approvalPolicyId"], policy["id"]);
    assert_eq!(frozen["approvalPolicyVersion"], policy["version"]);
    assert_eq!(frozen["action"]["steps"], content["steps"]);
    content["steps"][0]["message"] = json!("A different review");
    assert_ne!(
        collab_bridge::limits::canonical_digest(&frozen),
        collab_bridge::limits::canonical_digest(&management_content(&content).unwrap())
    );
    content["approvalPolicy"] = policy;
    assert!(management_content(&content).is_err());
}

#[test]
fn six_management_commands_require_their_exact_fields() {
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
        (
            Semantic::AutomationDelete,
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
    for state in [
        "ENABLED", "PAUSED", "DISABLED", "DELETED", "DRAFT", "UNKNOWN",
    ] {
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
                            matches!(state, "ENABLED" | "PAUSED" | "DISABLED" | "DELETED")
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
