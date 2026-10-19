//! DD-125(6)、`.design/09`「Agent 回合运行期间，Core 以该 Installation 的 AGENT 身份沿
//! DD-120(1) 的瞬时路径发 20002」：成员可见的“工作中”信号（原版后备信号，SF-BUZ-55）。
//!
//! 原 buzz-acp 在回合运行期间每 3 秒以 Agent 密钥发一条 kind 20002（`typing_refresh`、
//! `build_typing_event`）。Kailo 的 Agent 私钥只在 Core（DD-72/75），因此由 Core 按同一
//! 间隔为每个运行中的回合签发：`h` 为该 Workspace Channel，线程引用沿回复位置
//! （`agent_task::reply_ancestry`）。瞬时事件不写 DISPATCH/结果审计、不按 event ID 对账；
//! Relay `OK false` 是拒绝，超时是结果不明，都不重签，由下一次刷新取代（DD-120(1)）。
//! 回合结束（原生终态、取消或代际不再准入）即不再出现在查询结果里，钥匙随之从内存丢弃。

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use collab_bridge::stream::{Lease, PublishError, SessionKey};
use sqlx::FromRow;
use uuid::Uuid;

use crate::bff::BffState;
use crate::presence::{typing_event, TypingThread};
use crate::server_identity::read_bound_keys;
use crate::web_transport::community_limits;

/// 原 buzz-acp `typing_refresh` 间隔。
const REFRESH: Duration = Duration::from_secs(3);
/// 每轮至多处理的运行中回合数；超出的回合下一轮仍会出现。
const BATCH: i64 = 500;

/// 运行中的回合：原生 turn 已记录且未到原生终态、未请求取消、其代际仍被准入，Channel
/// 绑定、Workspace 与 Tenant 的 Buzz 投影 ACTIVE，AGENT 身份是该 Installation 的 ACTIVE
/// SERVER 钥匙。
pub(crate) const RUNNING: &str = "select i.tenant_id,i.installation_resource_id,
    i.root_event_id,i.source_event_id,i.source_kind,i.trigger_target_event_id,
    wb.channel_id,tb.normalized_host,a.pubkey as agent_pubkey,
    a.private_key_secret_ref as agent_locator,a.private_key_secret_version as agent_secret_version,
    a.private_key_secret_audience as agent_audience
  from catalog.agent_invocation i
  join identity.tenant t on t.id=i.tenant_id and t.state='ACTIVE'
  join identity.workspace w on w.id=i.workspace_id and w.tenant_id=t.id and w.state='ACTIVE'
  join catalog.agent_installation inst on inst.resource_id=i.installation_resource_id
    and inst.workspace_id=w.id
  join catalog.channel_agent_binding cb on cb.installation_resource_id=inst.resource_id
    and cb.workspace_id=w.id and cb.status='ACTIVE'
  join catalog.agent_memory_binding m on m.installation_resource_id=inst.resource_id
    and m.state='ACTIVE'
  join identity.buzz_identity_binding a on a.pubkey=m.agent_buzz_identity_binding_id
    and a.principal_id=inst.agent_principal_id and a.tenant_id=t.id and a.kind='AGENT'
    and a.custody='SERVER' and a.state='ACTIVE' and a.private_key_secret_status='ACTIVE'
  join projection.workspace_buzz_binding wb on wb.workspace_id=w.id and wb.state='ACTIVE'
  join projection.tenant_buzz_binding tb on tb.tenant_id=t.id and tb.state='ACTIVE'
  where i.status in ('DISPATCHING','RUNNING') and i.runtime_turn_id is not null
    and not i.cancel_pending
    and (i.native_status is null or i.native_status not in ('completed','failed','interrupted'))
    and catalog.agent_generation_admitted(i.installation_resource_id,i.agent_version_asset_id,
      i.projection_generation)
  order by i.installation_resource_id,i.id limit $1";

#[derive(FromRow)]
struct Running {
    tenant_id: Uuid,
    installation_resource_id: Uuid,
    root_event_id: String,
    source_event_id: String,
    source_kind: String,
    trigger_target_event_id: Option<String>,
    channel_id: Uuid,
    normalized_host: String,
    agent_pubkey: String,
    agent_locator: String,
    agent_secret_version: i32,
    agent_audience: String,
}

/// 原 `build_typing_event` 的线程引用，按 Agent 回复的位置（`reply_ancestry`）：只有
/// Buzz 消息触发的回合在线程内；`root` 只在不同于 `parent` 时出现。定时、手动与
/// webhook 运行的结果发到频道，只带 `h`。
fn typing_thread(
    source_kind: &str,
    root: &str,
    source: &str,
    trigger: Option<&str>,
) -> Option<TypingThread> {
    if source_kind != "BUZZ_EVENT" {
        return None;
    }
    let parent = trigger.unwrap_or(source);
    Some(TypingThread {
        parent: parent.to_owned(),
        root: (root != parent).then(|| root.to_owned()),
    })
}

/// 与 BFF 的在线租约巡检一起在启动时拉起（`main.rs`）。
pub(crate) fn spawn_typing_refresher(state: BffState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(REFRESH);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut keys: HashMap<String, nostr::Keys> = HashMap::new();
        loop {
            tick.tick().await;
            let rows: Vec<Running> = match sqlx::query_as(RUNNING)
                .bind(BATCH)
                .fetch_all(&state.pool)
                .await
            {
                Ok(rows) => rows,
                Err(error) => {
                    tracing::warn!(%error, "Agent 工作中信号查询失败");
                    continue;
                }
            };
            // 钥匙只在其回合运行期间留在内存。
            let live: HashSet<&str> = rows.iter().map(|row| row.agent_pubkey.as_str()).collect();
            keys.retain(|pubkey, _| live.contains(pubkey.as_str()));
            let mut sent = HashSet::new();
            for row in &rows {
                let thread = typing_thread(
                    &row.source_kind,
                    &row.root_event_id,
                    &row.source_event_id,
                    row.trigger_target_event_id.as_deref(),
                );
                let scope = (
                    row.agent_pubkey.clone(),
                    row.channel_id,
                    thread.as_ref().map(|t| (t.parent.clone(), t.root.clone())),
                );
                if !sent.insert(scope) {
                    continue;
                }
                let Some(signer) = agent_keys(&state, &mut keys, row).await else {
                    continue;
                };
                let channel = row.channel_id.to_string();
                let Some(event) = typing_event(&signer, &channel, thread.as_ref()) else {
                    continue;
                };
                let Ok(limits) = community_limits(&state, &row.normalized_host).await else {
                    continue;
                };
                let sessions = std::sync::Arc::clone(&state.relay_sessions);
                let key = SessionKey {
                    session: format!("agent:{}", row.installation_resource_id),
                    community_host: row.normalized_host.clone(),
                    pubkey: row.agent_pubkey.clone(),
                };
                tokio::spawn(async move {
                    let outcome = sessions
                        .publish(key, &signer, &event, &limits, Lease::Unchanged)
                        .await;
                    match outcome {
                        Ok(()) => {}
                        Err(PublishError::Rejected(reason)) => {
                            tracing::info!(%reason, "Relay 拒绝 Agent 工作中信号");
                        }
                        Err(error) => tracing::debug!(%error, "Agent 工作中信号未确认，不重签"),
                    }
                });
            }
        }
    });
}

/// 该 Installation 的 AGENT SERVER 钥匙：locator 必须是本 Tenant 下该 Installation 的
/// 固定路径、audience 是本服务，按精确 SecretRef 版本读取并核对公钥。
async fn agent_keys(
    state: &BffState,
    keys: &mut HashMap<String, nostr::Keys>,
    row: &Running,
) -> Option<nostr::Keys> {
    if let Some(cached) = keys.get(&row.agent_pubkey) {
        return Some(cached.clone());
    }
    let expected = state.secrets.tenant_locator(
        row.tenant_id,
        &format!("buzz-agent/installation/{}", row.installation_resource_id),
    );
    let audience = state.memory_service.secret_audience.as_str();
    if row.agent_locator != expected || row.agent_audience != audience {
        tracing::warn!(installation = %row.installation_resource_id, "AGENT 钥匙引用不在固定位置");
        return None;
    }
    let reference = secret_store::SecretRef {
        locator: row.agent_locator.clone(),
        version: u32::try_from(row.agent_secret_version).ok()?,
        audience: row.agent_audience.clone(),
    };
    match read_bound_keys(&state.secrets, &reference, &row.agent_pubkey).await {
        Ok(signer) => {
            keys.insert(row.agent_pubkey.clone(), signer.clone());
            Some(signer)
        }
        Err(_) => {
            tracing::warn!(installation = %row.installation_resource_id, "AGENT 钥匙不可查证");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_follows_the_reply_location() {
        let root = "a".repeat(64);
        let source = "b".repeat(64);
        let target = "c".repeat(64);
        // A mention inside a thread: parent is the trigger, root is the thread root.
        let thread = typing_thread("BUZZ_EVENT", &root, &source, None).unwrap();
        assert_eq!(
            (thread.parent.as_str(), thread.root.as_deref()),
            (&*source, Some(&*root))
        );
        // A top-level mention is its own Session root: only the reply tag.
        let thread = typing_thread("BUZZ_EVENT", &source, &source, None).unwrap();
        assert_eq!(thread.root, None);
        // A reaction trigger replies under the reacted message.
        let thread = typing_thread("BUZZ_EVENT", &root, &source, Some(&target)).unwrap();
        assert_eq!(thread.parent, target);
        for kind in ["SCHEDULE", "MANUAL", "WEBHOOK"] {
            assert!(typing_thread(kind, &root, &source, None).is_none());
        }
    }

    #[test]
    fn agent_typing_keeps_the_original_build_typing_event_shape() {
        let keys = nostr::Keys::generate();
        let channel = Uuid::from_u128(7).to_string();
        let root = "a".repeat(64);
        let parent = "b".repeat(64);
        let thread = typing_thread("BUZZ_EVENT", &root, &parent, None);
        let event = typing_event(&keys, &channel, thread.as_ref()).unwrap();
        assert_eq!(event.kind.as_u16(), 20002);
        assert!(event.content.is_empty());
        assert_eq!(event.pubkey, keys.public_key());
        let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        assert_eq!(
            tags,
            vec![
                vec!["h".to_owned(), channel.clone()],
                vec!["e".to_owned(), root, String::new(), "root".to_owned()],
                vec!["e".to_owned(), parent, String::new(), "reply".to_owned()],
            ]
        );
        let event = typing_event(&keys, &channel, None).unwrap();
        assert_eq!(event.tags.len(), 1);
    }

    #[test]
    fn running_turns_exclude_terminal_cancelled_and_unadmitted_work() {
        for fact in [
            "i.status in ('DISPATCHING','RUNNING')",
            "i.runtime_turn_id is not null",
            "not i.cancel_pending",
            "not in ('completed','failed','interrupted')",
            "catalog.agent_generation_admitted(",
            "cb.status='ACTIVE'",
            "a.kind='AGENT'",
            "a.custody='SERVER'",
            "wb.state='ACTIVE'",
            "tb.state='ACTIVE'",
        ] {
            assert!(RUNNING.contains(fact), "{fact}");
        }
    }

    #[tokio::test]
    #[ignore = "requires AGENT_INVOKE_TEST_DATABASE_URL pointing at a disposable migrated database"]
    async fn running_turn_query_matches_the_migrated_schema() {
        let pool = sqlx::PgPool::connect(&std::env::var("AGENT_INVOKE_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let rows: Vec<Running> = sqlx::query_as(RUNNING)
            .bind(1_i64)
            .fetch_all(&pool)
            .await
            .unwrap();
        // Without a running admitted turn no Agent is "working"; the query must still bind.
        drop(rows);
        pool.close().await;
    }
}
