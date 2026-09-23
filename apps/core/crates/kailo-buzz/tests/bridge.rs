//! `SS-BUZ-SERVER-CLIENT` 的真实核验。
//!
//! 验证两组事实：
//!
//! - 发布面：Core 不为客户端托管的身份代签；roster 之外的 pubkey 发布被拒；
//!   roster 之内的 pubkey 发布被接受并返回可作为审计证据的 event id。
//! - roster 投影面（`DD-41`/`DD-45`）：加入与撤权重复执行都收敛；做不成时
//!   给出结果不明而不是成功。

use kailo_buzz::bridge::{Custody, IdentityClient, Presence, Scope};
use kailo_buzz::operator::{OperatorError, OperatorIdentity};
use nostr::Keys;

const AUDIENCE: &str = "kailo-local";

/// 集成核验要显式开启（`KAILO_INTEGRATION=1`）：这些变量名与产品侧同名，
/// source 过 `.env` 的 shell 会让本该跳过的用例拿着网内地址去连。
fn env() -> Option<(String, String)> {
    if std::env::var("KAILO_INTEGRATION").as_deref() != Ok("1") {
        return None;
    }
    let origin = std::env::var("RELAY_OPERATOR_API_ORIGIN").ok()?;
    let key = std::env::var("RELAY_OPERATOR_PRIVATE_KEY").ok()?;
    (!origin.is_empty() && !key.is_empty()).then_some((origin, key))
}

#[test]
fn client_custody_identity_is_never_signed_by_core() {
    // 不需要网络：这条在构造阶段就必须失败。原生端本机持钥直连 Relay，
    // Core 手里没有那把钥匙，尝试代签说明实现走错了路径（DD-75）。
    let keys = Keys::generate();
    let err = IdentityClient::new(
        Custody::Client,
        &keys.secret_key().to_secret_hex(),
        "http://unused.invalid",
        "unused.kailo.local",
    )
    .unwrap_err();
    assert!(
        matches!(err, OperatorError::CustodyNotServer),
        "得到 {err:?}"
    );
}

#[tokio::test]
async fn non_member_publish_is_rejected_and_member_publish_is_accepted() {
    let Some((origin, op_key)) = env() else {
        return;
    };
    let http = reqwest::Client::new();

    // 先以 operator 建一个 Community，owner 为新生成的 Tenant CONTROL 身份
    let op = OperatorIdentity::new(&op_key, &origin, AUDIENCE, AUDIENCE).expect("operator 身份");
    let control = Keys::generate();
    let host = format!(
        "b{}.kailo.local",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros()
    );
    op.provision_community(&http, &host, &control.public_key().to_hex())
        .await
        .expect("创建 Community");

    // roster 之外的身份发布必须被拒。require_relay_membership=true 时
    // roster 校验是协作数据平面唯一的准入执行点（SF-BUZ-26、DD-75）。
    let outsider = Keys::generate();
    let outsider_client = IdentityClient::new(
        Custody::Server,
        &outsider.secret_key().to_secret_hex(),
        &origin,
        &host,
    )
    .expect("构造客户端");
    // 先由 owner 建一个 Channel：一个 Workspace 绑定一个 Channel（DD-01），
    // 创建者成为 owner（SF-BUZ-05）。
    let owner_client = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        &origin,
        &host,
    )
    .expect("构造客户端");
    owner_client
        .create_channel(&http, "verify")
        .await
        .expect("创建 Channel");

    // Channel 的标识是 Relay 分配的 UUID，不是创建事件的 id；
    // 成员关系由 Relay 签发的 kind 39002 承载。
    let channels = owner_client
        .member_channel_ids(&http)
        .await
        .expect("列出所属 Channel");
    let channel_id = channels
        .first()
        .cloned()
        .unwrap_or_else(|| panic!("创建后应至少属于一个 Channel，实际 {channels:?}"));

    let err = outsider_client
        .publish_channel_message(&http, &channel_id, "should not pass", &[])
        .await
        .expect_err("非成员发布必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );

    // Community owner 在 roster 中，其发布应被接受并返回 event id——
    // 该 id 是 operation outcome 与 audit evidence（.design/09 第 6 步）。
    let event_id = owner_client
        .publish_channel_message(&http, &channel_id, "hello from core", &[])
        .await
        .expect("成员发布应被接受");
    assert_eq!(
        event_id.len(),
        64,
        "event id 应为 64 位十六进制，得到 {event_id}"
    );
}

/// 按登记的收敛上界重试一个投影动作。
///
/// 它站在 Activity 的 `RetryPolicy` 的位置上：`NotConverged` 是结果不明，
/// 唯一正确的反应是重试，而不是把它读成成功或失败。上界取部署登记的
/// `BUZZ_NIP43_RECONCILE_INTERVAL_SECS`（`07` §1），缺失即认为该不变式未登记，
/// 直接失败而不是猜一个默认值。
async fn retry_until_converged<F, Fut>(mut attempt: F) -> Result<(), OperatorError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), OperatorError>>,
{
    let bound: u64 = std::env::var("BUZZ_NIP43_RECONCILE_INTERVAL_SECS")
        .expect("07 §1 要求显式登记 BUZZ_NIP43_RECONCILE_INTERVAL_SECS")
        .parse()
        .expect("BUZZ_NIP43_RECONCILE_INTERVAL_SECS 必须是秒数");
    // 多给一个周期的余量：对账作业按固定间隔 tick，动作可能刚好落在 tick 之后。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(bound * 2 + 2);
    loop {
        match attempt().await {
            Err(OperatorError::NotConverged(detail)) if std::time::Instant::now() < deadline => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = detail;
            }
            other => return other,
        }
    }
}

/// roster 投影的收敛语义（`DD-41`/`DD-45` 的执行投影）。
///
/// 重点不是「能加能删」，而是**重复执行**：Activity 会重试、Worker 会崩溃重放，
/// 同一次投影必然被执行多次。上游对已不在 roster 的目标返回错误而不是幂等成功，
/// 因此收敛判据必须是再次读到的 roster，不是事件是否被接受。
#[tokio::test]
async fn roster_projection_converges_and_is_repeatable() {
    let Some((origin, op_key)) = env() else {
        return;
    };
    let http = reqwest::Client::new();

    let op = OperatorIdentity::new(&op_key, &origin, AUDIENCE, AUDIENCE).expect("operator 身份");
    let control = Keys::generate();
    let host = format!(
        "r{}.kailo.local",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros()
    );
    op.provision_community(&http, &host, &control.public_key().to_hex())
        .await
        .expect("创建 Community");

    let control_client = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        &origin,
        &host,
    )
    .expect("构造客户端");

    let member = Keys::generate();
    let member_hex = member.public_key().to_hex();

    // relay-level roster：TenantMembership 的执行投影（DD-45）
    for round in 1..=2 {
        control_client
            .converge(&http, Scope::Relay, &member_hex, Presence::Present)
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次加入 relay roster 失败: {e}"));
    }
    let roster = control_client
        .roster(&http, Scope::Relay)
        .await
        .expect("读 relay roster");
    assert!(
        roster.iter().any(|e| e.pubkey == member_hex),
        "加入后应在 roster 中，实际 {roster:?}"
    );

    // 反向：投影做不成时绝不能报成功。刚加入的是普通 member，没有 admin/owner
    // 角色，它发出的 roster 管理事件会被拒且 roster 不变——`converge` 必须给出
    // NotConverged 并带上上游理由，而不是 Ok，也不是把拒绝直接当确定失败
    //（那会让「移除已不在 roster 的成员」这类拒绝被误判为投影失败）。
    let member_client = IdentityClient::new(
        Custody::Server,
        &member.secret_key().to_secret_hex(),
        &origin,
        &host,
    )
    .expect("构造客户端");
    let err = member_client
        .converge(
            &http,
            Scope::Relay,
            &control.public_key().to_hex(),
            Presence::Absent,
        )
        .await
        .expect_err("无 admin 角色的投影必须失败");
    match err {
        OperatorError::NotConverged(detail) => {
            assert!(detail.contains("上游拒绝"), "详情应带上游理由：{detail}")
        }
        other => panic!("得到 {other:?}"),
    }

    // Channel roster：WorkspaceMembership 的执行投影（DD-41）
    control_client
        .create_channel(&http, "roster-verify")
        .await
        .expect("创建 Channel");
    let channel_id = control_client
        .member_channel_ids(&http)
        .await
        .expect("列出所属 Channel")
        .first()
        .cloned()
        .expect("创建后应至少属于一个 Channel");

    for round in 1..=2 {
        control_client
            .converge(
                &http,
                Scope::Channel(&channel_id),
                &member_hex,
                Presence::Present,
            )
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次加入 Channel roster 失败: {e}"));
    }
    let roster = control_client
        .roster(&http, Scope::Channel(&channel_id))
        .await
        .expect("读 Channel roster");
    assert!(
        roster.iter().any(|e| e.pubkey == member_hex),
        "加入后应在 Channel roster 中，实际 {roster:?}"
    );

    // 撤权：第二次执行是关键——上游对已不在 roster 的目标返回
    // 「member not found」而不是幂等成功，收敛判据必须是查证结果。
    //
    // relay 面还要重试：`SF-BUZ-34` 下，同一秒内回到此前出现过的成员集合会让
    // 快照重建整事务回滚，读到的仍是旧值。这是结果不明，修复来自 Relay 的周期
    // 对账，收敛上界就是 `BUZZ_NIP43_RECONCILE_INTERVAL_SECS`。这里替 Activity
    // 的 RetryPolicy 做同一件事：按该上界重试，而不是放宽断言。
    for round in 1..=2 {
        control_client
            .converge(
                &http,
                Scope::Channel(&channel_id),
                &member_hex,
                Presence::Absent,
            )
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次撤 Channel roster 失败: {e}"));
        retry_until_converged(|| {
            control_client.converge(&http, Scope::Relay, &member_hex, Presence::Absent)
        })
        .await
        .unwrap_or_else(|e| panic!("第 {round} 次撤 relay roster 失败: {e}"));
    }

    let roster = control_client
        .roster(&http, Scope::Relay)
        .await
        .expect("读 relay roster");
    assert!(
        !roster.iter().any(|e| e.pubkey == member_hex),
        "撤权后不应在 roster 中，实际 {roster:?}"
    );

    // 撤权是真的生效，不只是快照好看：roster 之外的 pubkey 发布必须被拒。
    let err = member_client
        .publish_channel_message(&http, &channel_id, "should not pass", &[])
        .await
        .expect_err("撤权后发布必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );
}
