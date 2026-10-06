//! `SS-BUZ-SERVER-CLIENT` 的真实核验。
//!
//! 验证两组事实：
//!
//! - 发布面：Core 不为客户端托管的身份代签；roster 之外的 pubkey 发布被拒；
//!   roster 之内的 pubkey 发布被接受并返回可作为审计证据的 event id。
//! - roster 投影面（`DD-41`/`DD-45`）：加入与撤权重复执行都收敛；做不成时
//!   给出结果不明而不是成功。

use collab_bridge::bridge::{Custody, IdentityClient, Presence, Scope};
use collab_bridge::operator::{OperatorError, OperatorIdentity};
use futures_util::FutureExt;
use nostr::Keys;
use std::panic::AssertUnwindSafe;

/// 集成核验要显式开启（`PLATFORM_INTEGRATION=1`）：这些变量名与产品侧同名，
/// source 过 `.env` 的 shell 会让本该跳过的用例拿着网内地址去连。
fn env() -> Option<(String, String, String)> {
    if std::env::var("PLATFORM_INTEGRATION").as_deref() != Ok("1") {
        return None;
    }
    let v = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
    Some((
        v("RELAY_OPERATOR_API_ORIGIN")?,
        v("RELAY_OPERATOR_PRIVATE_KEY")?,
        v("RELAY_OPERATOR_AUDIENCE")?,
    ))
}

/// 以 operator 建一个 Community，owner 为新生成的 Tenant CONTROL 身份。
async fn provision(
    http: &reqwest::Client,
    origin: &str,
    op_key: &str,
    audience: &str,
    prefix: &str,
) -> (OperatorIdentity, Keys, String) {
    let op = OperatorIdentity::new(op_key, origin, audience, audience).expect("operator 身份");
    let control = Keys::generate();
    // 主机名取自这次新生成的 owner 公钥：并行用例同一微秒起步也不会撞名
    let host = format!(
        "{prefix}{}.platform.test",
        &control.public_key().to_hex()[..16]
    );
    op.provision_community(http, &host, &control.public_key().to_hex())
        .await
        .expect("创建 Community");
    (op, control, host)
}

/// 测试建的 Community 不留在 Relay 里：Relay 的 operator 面只能按 owner 列举，
/// 测试进程一退出这把 owner 钥匙就没了，留下的 Community 再也找不回来。
async fn retire(http: &reqwest::Client, op: &OperatorIdentity, host: &str, control: &Keys) {
    op.archive_community(http, host, &control.public_key().to_hex())
        .await
        .expect("归档 Community");
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
        "unused.platform.test",
    )
    .unwrap_err();
    assert!(
        matches!(err, OperatorError::CustodyNotServer),
        "得到 {err:?}"
    );
}

/// 实现后的离线原生签名断言：不创建业务对象、不发送事件或投递凭据。
#[test]
fn channel_result_has_stable_invocation_reference_without_fake_thread() {
    let keys = Keys::generate();
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        "http://unused.invalid",
        "unused.platform.test",
    )
    .unwrap();
    let id = uuid::Uuid::new_v4();
    let event = client
        .sign_channel_result_at("channel", "native answer", None, Some(id), 105)
        .unwrap();
    assert_eq!(
        event.id,
        client
            .sign_channel_result_at("channel", "native answer", None, Some(id), 105)
            .unwrap()
            .id
    );
    assert_ne!(
        event.id,
        client
            .sign_channel_result_at(
                "channel",
                "native answer",
                None,
                Some(uuid::Uuid::new_v4()),
                105
            )
            .unwrap()
            .id
    );
    assert_eq!(event.created_at.as_secs(), 105);
    let reference = format!("urn:uuid:{id}");
    assert!(event
        .tags
        .iter()
        .any(|tag| tag.as_slice() == ["r", reference.as_str()]));
    assert!(event
        .tags
        .iter()
        .all(|tag| tag.as_slice().first().map(String::as_str) != Some("e")));
    assert!(event.verify().is_ok());
    assert!(client
        .sign_channel_result_at("channel", "native answer", None, None, 105)
        .is_err());
}

#[test]
fn task_reply_id_is_fixed_by_native_time_body_and_thread_ancestry() {
    let keys = Keys::generate();
    let client = IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        "http://unused.invalid",
        "unused.platform.test",
    )
    .unwrap();
    let root = "a".repeat(64);
    let source = "b".repeat(64);
    let first = client
        .sign_channel_reply_at("channel", "native answer", (&root, &source), 105)
        .unwrap();
    let same = client
        .sign_channel_reply_at("channel", "native answer", (&root, &source), 105)
        .unwrap();
    assert_eq!(first.id, same.id);
    assert_eq!(first.kind.as_u16(), 9);
    assert_eq!(first.pubkey, keys.public_key());
    assert_eq!(first.created_at.as_secs(), 105);
    assert!(first.verify().is_ok());
    assert_eq!(
        collab_bridge::nip10::parse_thread_markers(&first.tags).resolve(),
        Some((root.clone(), source.clone()))
    );
    assert!(first
        .tags
        .iter()
        .any(|tag| tag.as_slice() == ["h", "channel"]));
    let changed_time = client
        .sign_channel_reply_at("channel", "native answer", (&root, &source), 106)
        .unwrap();
    let changed_source = client
        .sign_channel_reply_at("channel", "native answer", (&root, &root), 105)
        .unwrap();
    let changed_body = client
        .sign_channel_reply_at("channel", "different answer", (&root, &source), 105)
        .unwrap();
    assert_ne!(first.id, changed_time.id);
    assert_ne!(first.id, changed_source.id);
    assert_ne!(first.id, changed_body.id);
    assert!(client
        .sign_channel_reply_at("channel", "native answer", ("bad-root", &source), 105)
        .is_err());
}

#[tokio::test]
async fn non_member_publish_is_rejected_and_member_publish_is_accepted() {
    let Some((origin, op_key, audience)) = env() else {
        return;
    };
    let http = reqwest::Client::new();
    let (op, control, host) = provision(&http, &origin, &op_key, &audience, "b").await;
    let outcome = AssertUnwindSafe(publish_gate(&http, &origin, &control, &host))
        .catch_unwind()
        .await;
    retire(&http, &op, &host, &control).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn publish_gate(http: &reqwest::Client, origin: &str, control: &Keys, host: &str) {
    // roster 之外的身份发布必须被拒。require_relay_membership=true 时
    // roster 校验是协作数据平面唯一的准入执行点（SF-BUZ-26、DD-75）。
    let outsider = Keys::generate();
    let outsider_client = IdentityClient::new(
        Custody::Server,
        &outsider.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");
    // 先由 owner 建一个 Channel：一个 Workspace 绑定一个 Channel（DD-01），
    // 创建者成为 owner（SF-BUZ-05）。
    let owner_client = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");
    // Channel id 由调用方给出；重发同一个 id 不另建（DD-80）。
    let channel_id = uuid::Uuid::new_v4().to_string();
    for _ in 0..2 {
        owner_client
            .ensure_channel(http, &channel_id, "verify", None)
            .await
            .expect("建立 Channel");
    }
    // 成员关系由 Relay 签发的 kind 39002 承载；创建者在 roster 上且只一次。
    let owner_hex = control.public_key().to_hex();
    let roster = owner_client
        .roster(http, Scope::Channel(&channel_id))
        .await
        .expect("读取 Channel roster");
    assert_eq!(
        roster.iter().filter(|e| e.pubkey == owner_hex).count(),
        1,
        "创建者应在 roster 上且只一次：{roster:?}"
    );

    let forum_id = uuid::Uuid::new_v4().to_string();
    let metadata = contracts::WorkspaceChannelCreate {
        channel_type: contracts::ChannelType::Forum,
        description: Some("Architecture discussion".into()),
        ttl_seconds: Some(604800),
    };
    for _ in 0..2 {
        owner_client
            .ensure_channel(http, &forum_id, "Architecture", Some(&metadata))
            .await
            .expect("original forum metadata converges across duplicate creation");
    }
    let different = contracts::WorkspaceChannelCreate {
        description: Some("Different intent".into()),
        ..metadata
    };
    assert!(
        matches!(
            owner_client
                .ensure_channel(http, &forum_id, "Architecture", Some(&different))
                .await,
            Err(OperatorError::NotConverged(_))
        ),
        "duplicate identifier must not mask mismatched native metadata"
    );

    let err = outsider_client
        .publish_channel_message(http, &channel_id, "should not pass", &[])
        .await
        .expect_err("非成员发布必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );

    // Community owner 在 roster 中，其发布应被接受并返回 event id——
    // 该 id 是 operation outcome 与 audit evidence（.design/09 第 6 步）。
    let event_id = owner_client
        .publish_channel_message(http, &channel_id, "hello from core", &[])
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

/// 平台 Community 的治理由 Relay 执行（`SS-BUZ-GOVERNANCE`、`DD-80`）。
///
/// 原生端持钥直连 Relay，Core 不在其路径上。上游的 NIP-29 权限比平台宽
/// （`SF-BUZ-37`）：成员能自建 Channel、自加入、读写非 private Channel。这里
/// 以一个**在 roster 上**的成员逐项尝试，每项都必须被拒且理由指向治理规则——
/// 被别的原因拒掉证明不了治理生效。
#[tokio::test]
async fn members_cannot_govern_the_community() {
    let Some((origin, op_key, audience)) = env() else {
        return;
    };
    let http = reqwest::Client::new();
    let (op, control, host) = provision(&http, &origin, &op_key, &audience, "g").await;
    let outcome = AssertUnwindSafe(governance_gate(&http, &origin, &control, &host))
        .catch_unwind()
        .await;
    retire(&http, &op, &host, &control).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// Relay 的拒绝有两种形状：HTTP 非 2xx，或 2xx 而 `accepted` 为 false。
fn refusal(result: Result<serde_json::Value, OperatorError>) -> String {
    match result {
        Ok(v) if v.get("accepted").and_then(|a| a.as_bool()) == Some(false) => v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_owned(),
        Err(OperatorError::Rejected { body, .. }) => body,
        other => panic!("应被拒绝，得到 {other:?}"),
    }
}

async fn governance_gate(http: &reqwest::Client, origin: &str, control: &Keys, host: &str) {
    let control_client = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");
    let mine = uuid::Uuid::new_v4().to_string();
    let other = uuid::Uuid::new_v4().to_string();
    for channel in [&mine, &other] {
        control_client
            .ensure_channel(http, channel, "governed", None)
            .await
            .expect("owner 建 Channel");
    }

    let member = Keys::generate();
    let member_hex = member.public_key().to_hex();
    let member_client = IdentityClient::new(
        Custody::Server,
        &member.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");
    retry_until_converged(|| {
        control_client.converge(http, Scope::Relay, &member_hex, Presence::Present)
    })
    .await
    .expect("投入 relay roster");
    retry_until_converged(|| {
        control_client.converge(http, Scope::Channel(&mine), &member_hex, Presence::Present)
    })
    .await
    .expect("投入自己 Workspace 的 Channel roster");

    // 放行的 kind 在自己的 Channel 里照常可用：拒绝不是一刀切
    member_client
        .publish_channel_message(http, &mine, "in my workspace", &[])
        .await
        .expect("成员在自己的 Channel 发消息应被接受");
    control_client
        .publish_channel_message(http, &other, "not for this member", &[])
        .await
        .expect("owner 发消息");

    let t = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
    let fresh = uuid::Uuid::new_v4().to_string();
    for (what, kind, tags) in [
        (
            "自建 Channel",
            9007,
            vec![
                t("h", &fresh),
                t("name", "rogue"),
                t("visibility", "private"),
            ],
        ),
        (
            "把自己加进别的 Channel",
            9000,
            vec![t("h", &other), t("p", &member_hex)],
        ),
        ("申请加入别的 Channel", 9021, vec![t("h", &other)]),
        (
            "改 Channel 元数据",
            9002,
            vec![t("h", &mine), t("name", "renamed")],
        ),
        (
            "加 relay 成员",
            9030,
            vec![t("p", &Keys::generate().public_key().to_hex())],
        ),
        ("发 Workspace 之外的全局事件", 1, vec![]),
    ] {
        let why = refusal(member_client.publish(http, kind, "", &tags).await);
        assert!(
            why.contains("reserved to the community owner"),
            "{what}（kind {kind}）应因治理规则被拒，实际理由：{why}"
        );
    }

    // 不在其 roster 上的 Channel：写被拒，读不到
    let why = refusal(
        member_client
            .publish(http, 9, "cross-workspace", &[t("h", &other)])
            .await,
    );
    assert!(
        why.contains("not a channel member"),
        "跨 Workspace 写应被拒，实际理由：{why}"
    );
    let read = |channel: &str| serde_json::json!({ "kinds": [9], "#h": [channel] });
    let own = member_client
        .query(http, &[read(&mine)])
        .await
        .expect("读自己的 Channel");
    assert!(
        own.as_array().is_some_and(|a| !a.is_empty()),
        "自己的 Channel 应读得到：{own}"
    );
    match member_client.query(http, &[read(&other)]).await {
        Ok(v) => assert!(
            v.as_array().is_some_and(|a| a.is_empty()),
            "别的 Workspace 的消息不得被读到：{v}"
        ),
        Err(OperatorError::Rejected { .. }) => {}
        Err(e) => panic!("读取失败而非被拒：{e}"),
    }

    // owner 也不能建非 private 的 Channel：缺省即 open（SF-BUZ-38）
    for tags in [
        vec![
            t("h", &uuid::Uuid::new_v4().to_string()),
            t("name", "open"),
            t("visibility", "open"),
        ],
        vec![
            t("h", &uuid::Uuid::new_v4().to_string()),
            t("name", "implicit"),
        ],
    ] {
        let why = refusal(control_client.publish(http, 9007, "", &tags).await);
        assert!(
            why.contains("private"),
            "非 private Channel 应被拒，实际理由：{why}"
        );
    }
}

/// roster 投影的收敛语义（`DD-41`/`DD-45` 的执行投影）。
///
/// 重点不是「能加能删」，而是**重复执行**：Activity 会重试、Worker 会崩溃重放，
/// 同一次投影必然被执行多次。上游对已不在 roster 的目标返回错误而不是幂等成功，
/// 因此收敛判据必须是再次读到的 roster，不是事件是否被接受。
#[tokio::test]
async fn roster_projection_converges_and_is_repeatable() {
    let Some((origin, op_key, audience)) = env() else {
        return;
    };
    let http = reqwest::Client::new();
    let (op, control, host) = provision(&http, &origin, &op_key, &audience, "r").await;
    let outcome = AssertUnwindSafe(roster_projection(&http, &origin, &control, &host))
        .catch_unwind()
        .await;
    retire(&http, &op, &host, &control).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn roster_projection(http: &reqwest::Client, origin: &str, control: &Keys, host: &str) {
    let control_client = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");

    let member = Keys::generate();
    let member_hex = member.public_key().to_hex();

    // relay-level roster：TenantMembership 的执行投影（DD-45）
    for round in 1..=2 {
        control_client
            .converge(http, Scope::Relay, &member_hex, Presence::Present)
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次加入 relay roster 失败: {e}"));
    }
    let roster = control_client
        .roster(http, Scope::Relay)
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
        origin,
        host,
    )
    .expect("构造客户端");
    let err = member_client
        .converge(
            http,
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
    let channel_id = uuid::Uuid::new_v4().to_string();
    control_client
        .ensure_channel(http, &channel_id, "roster-verify", None)
        .await
        .expect("建立 Channel");

    for round in 1..=2 {
        control_client
            .converge(
                http,
                Scope::Channel(&channel_id),
                &member_hex,
                Presence::Present,
            )
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次加入 Channel roster 失败: {e}"));
    }
    let roster = control_client
        .roster(http, Scope::Channel(&channel_id))
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
                http,
                Scope::Channel(&channel_id),
                &member_hex,
                Presence::Absent,
            )
            .await
            .unwrap_or_else(|e| panic!("第 {round} 次撤 Channel roster 失败: {e}"));
        retry_until_converged(|| {
            control_client.converge(http, Scope::Relay, &member_hex, Presence::Absent)
        })
        .await
        .unwrap_or_else(|e| panic!("第 {round} 次撤 relay roster 失败: {e}"));
    }

    let roster = control_client
        .roster(http, Scope::Relay)
        .await
        .expect("读 relay roster");
    assert!(
        !roster.iter().any(|e| e.pubkey == member_hex),
        "撤权后不应在 roster 中，实际 {roster:?}"
    );

    // 撤权是真的生效，不只是快照好看：roster 之外的 pubkey 发布必须被拒。
    let err = member_client
        .publish_channel_message(http, &channel_id, "should not pass", &[])
        .await
        .expect_err("撤权后发布必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );
}

/// 读部署登记的整数配置。集成核验 source 了 `deploy/local/.env`，登记值必须在；
/// 缺失即该上界未登记，直接失败而不是猜一个默认值。
fn registered(name: &str) -> u64 {
    std::env::var(name)
        .unwrap_or_else(|_| panic!("缺少部署登记值 {name}"))
        .parse()
        .unwrap_or_else(|_| panic!("{name} 必须是非负整数"))
}

/// 等到订阅追平（EOSE）；中途收到关闭即失败。
async fn until_live(sub: &mut collab_bridge::stream::Subscription, what: &str) {
    use collab_bridge::stream::Frame;
    let deadline = tokio::time::Instant::now()
        + std::time::Duration::from_secs(registered("BFF_STREAM_AUTH_TIMEOUT_SECONDS"));
    loop {
        match tokio::time::timeout_at(deadline, sub.next()).await {
            Ok(Some(Frame::EndOfStored)) => return,
            Ok(Some(Frame::Event(_))) => {}
            Ok(Some(Frame::Closed(r))) => panic!("{what} 在追平前被关闭：{r}"),
            Ok(None) => panic!("{what} 已结束"),
            Err(_) => panic!("{what} 未在认证上界内追平"),
        }
    }
}

/// 等到订阅收到指定事件。
async fn until_event(sub: &mut collab_bridge::stream::Subscription, event_id: &str, what: &str) {
    use collab_bridge::stream::Frame;
    let deadline = tokio::time::Instant::now()
        + std::time::Duration::from_secs(registered("BFF_STREAM_AUTH_TIMEOUT_SECONDS"));
    loop {
        match tokio::time::timeout_at(deadline, sub.next()).await {
            Ok(Some(Frame::Event(ev))) if ev["id"].as_str() == Some(event_id) => return,
            Ok(Some(Frame::Closed(r))) => panic!("{what} 在收到事件前被关闭：{r}"),
            Ok(Some(_)) => {}
            Ok(None) => panic!("{what} 已结束"),
            Err(_) => panic!("{what} 未收到刚发布的事件"),
        }
    }
}

/// NIP-42 会话复用（`apps/02` Stage 1「按 (principal, active session) 复用 NIP-42 会话」）。
///
/// 验四件事：同一会话的多条流共用一条已认证连接且事件按订阅分发；另一个会话不继承
/// 这条连接的认证；最后一个订阅结束时连接关闭；每连接订阅数按 NIP-11 上界预检，
/// 超出是 LIMIT 而不发往 Relay。上界取自运行期从 Relay 读取的 NIP-11。
#[tokio::test]
async fn one_session_shares_one_authenticated_connection() {
    let Some((origin, op_key, audience)) = env() else {
        return;
    };
    let http = reqwest::Client::new();
    let (op, control, host) = provision(&http, &origin, &op_key, &audience, "s").await;
    let outcome = AssertUnwindSafe(session_reuse(&http, &origin, &control, &host))
        .catch_unwind()
        .await;
    retire(&http, &op, &host, &control).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn session_reuse(http: &reqwest::Client, origin: &str, control: &Keys, host: &str) {
    use collab_bridge::limits::{fetch_nip11, RelayLimits};
    use collab_bridge::operator::LimitKind;
    use collab_bridge::stream::{RelaySessions, SessionKey};
    use std::sync::Arc;

    let owner = IdentityClient::new(
        Custody::Server,
        &control.secret_key().to_secret_hex(),
        origin,
        host,
    )
    .expect("构造客户端");
    let channel_id = uuid::Uuid::new_v4().to_string();
    owner
        .ensure_channel(http, &channel_id, "session-reuse", None)
        .await
        .expect("建立 Channel");

    let limits = fetch_nip11(http, &url::Url::parse(origin).expect("origin"), host)
        .await
        .expect("运行期读取 NIP-11")
        .limits;
    let ws_url = origin.replacen("http", "ws", 1);
    let hub = Arc::new(RelaySessions::new(
        &ws_url,
        std::time::Duration::from_secs(registered("BFF_STREAM_AUTH_TIMEOUT_SECONDS")),
        registered("BFF_STREAM_BUFFER") as usize,
    ));
    let key = |session: &str| SessionKey {
        session: session.to_owned(),
        community_host: host.to_owned(),
        pubkey: control.public_key().to_hex(),
    };
    let filter = || vec![serde_json::json!({ "kinds": [9], "#h": [channel_id] })];

    let mut a = hub
        .subscribe(key("s1"), control, filter(), &limits)
        .await
        .expect("首个订阅");
    let mut b = hub
        .subscribe(key("s1"), control, filter(), &limits)
        .await
        .expect("同一会话的第二个订阅");
    assert_eq!(
        hub.connection_count(),
        1,
        "同一会话的两条流必须共用一条已认证连接"
    );
    until_live(&mut a, "订阅 a").await;
    until_live(&mut b, "订阅 b").await;

    // 同一连接上的两个 REQ 都收到新事件：分发按订阅 id，不串也不漏
    let event_id = owner
        .publish_channel_message(http, &channel_id, "shared connection", &[])
        .await
        .expect("发布");
    until_event(&mut a, &event_id, "订阅 a").await;
    until_event(&mut b, &event_id, "订阅 b").await;

    // 另一个会话不继承这条连接的认证：它另建连接、自己完成 NIP-42
    let mut c = hub
        .subscribe(key("s2"), control, filter(), &limits)
        .await
        .expect("另一个会话的订阅");
    assert_eq!(hub.connection_count(), 2, "另一个会话必须另建连接");
    until_live(&mut c, "订阅 c").await;

    // 每连接订阅数按 NIP-11 上界预检：已有 2 个时，上界为 2 的第三个是 LIMIT
    let tight = RelayLimits {
        max_subscriptions: 2,
        ..limits.clone()
    };
    let err = match hub.subscribe(key("s1"), control, filter(), &tight).await {
        Ok(_) => panic!("超出每连接订阅上界的订阅必须被拒"),
        Err(e) => e,
    };
    assert_eq!(err.limit(), Some(LimitKind::Capacity), "得到 {err:?}");
    // 预检失败不影响已有订阅，也不另开连接
    assert_eq!(hub.connection_count(), 2);

    // 最后一个订阅结束时连接关闭；会话 s1 仍有订阅 b，连接保留
    drop(c);
    drop(a);
    let deadline = tokio::time::Instant::now()
        + std::time::Duration::from_secs(registered("BFF_STREAM_AUTH_TIMEOUT_SECONDS"));
    while hub.connection_count() != 1 {
        assert!(
            tokio::time::Instant::now() < deadline,
            "会话 s2 的最后一个订阅结束后连接应关闭，仍有 {} 条",
            hub.connection_count()
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    // s1 的连接仍在用：再开一条流不新建连接
    let d = hub
        .subscribe(key("s1"), control, filter(), &limits)
        .await
        .expect("复用已有连接");
    assert_eq!(hub.connection_count(), 1, "仍有订阅的会话连接必须被复用");
    drop(b);
    drop(d);
    while hub.connection_count() != 0 {
        assert!(
            tokio::time::Instant::now() < deadline,
            "全部订阅结束后连接应关闭"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// Relay 的 429 属于 `apps/06` §4 的 LIMIT，Core 预算在发往 Relay 之前拦截。
///
/// Relay 对 `/events`、`/query`、`/count` 按 (Community, pubkey) 共用一份额度，且在
/// 读取请求体、核对成员之前先扣（`api/bridge.rs::enforce_http_admission`）。于是
/// 任何已认证 pubkey 都能量出该额度 L：连续查询直到第一次 429。再用另一把钥匙挂上
/// Core 预算（1 次）：第 1 次发出，其后被预算拦下；如果拦下的请求其实发出去了，
/// 这把钥匙在 Relay 上剩下的额度就会少于 L-1。
#[tokio::test]
async fn relay_rate_limit_is_limit_and_core_budget_stops_before_relay() {
    let Some((origin, op_key, audience)) = env() else {
        return;
    };
    let http = reqwest::Client::new();
    let (op, control, host) = provision(&http, &origin, &op_key, &audience, "l").await;
    let outcome = AssertUnwindSafe(rate_limits(&http, &origin, &host))
        .catch_unwind()
        .await;
    retire(&http, &op, &host, &control).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// 以一把钥匙连续查询，直到第一次被判为 LIMIT；返回此前 Relay 受理的次数。
///
/// 上界是 Relay 的一个窗口：上游 admission 窗口固定 60 秒，一个窗口内打不满就
/// 永远打不满，此时失败而不是无限循环。
async fn calls_until_limited(http: &reqwest::Client, client: &IdentityClient) -> u64 {
    use collab_bridge::operator::LimitKind;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    let mut accepted = 0;
    let filter = [serde_json::json!({ "kinds": [9], "limit": 1 })];
    loop {
        assert!(
            std::time::Instant::now() < deadline,
            "一个 admission 窗口内没有被限流"
        );
        match client.query(http, &filter).await {
            // 非成员查询在额度之后才被拒（403），同样计入 Relay 额度
            Ok(_) | Err(OperatorError::Rejected { status: 403, .. }) => accepted += 1,
            Err(e) => {
                assert_eq!(
                    e.limit(),
                    Some(LimitKind::RateLimited),
                    "Relay 的 429 必须判为 LIMIT，而不是拒绝或结果不明：{e:?}"
                );
                assert!(
                    matches!(e, OperatorError::Rejected { status: 429, .. }),
                    "没有挂预算时，这个 LIMIT 必须来自 Relay：{e:?}"
                );
                return accepted;
            }
        }
    }
}

async fn rate_limits(http: &reqwest::Client, origin: &str, host: &str) {
    use collab_bridge::bridge::Delivery;
    use collab_bridge::limits::ApiBudget;
    use collab_bridge::operator::LimitKind;
    use std::sync::Arc;

    let client = |keys: &Keys| {
        IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            origin,
            host,
        )
        .expect("构造客户端")
    };

    let first = Keys::generate();
    let quota = calls_until_limited(http, &client(&first)).await;
    assert!(quota > 0, "Relay 额度必须为正");

    // 被 429 的发布是确定未落库的 LIMIT，不是「拒绝」也不是「结果不明」
    let c = client(&first);
    let event = c
        .sign_channel_message(&uuid::Uuid::new_v4().to_string(), "limited", &[])
        .expect("签名");
    let admitted = c.admit().expect("未挂预算时总能取到额度");
    match c.deliver(http, &event, admitted).await {
        Delivery::Limited(LimitKind::RateLimited, _) => {}
        other => panic!("429 的发布必须是 Limited(RateLimited)，得到 {other:?}"),
    }

    // Core 预算：额度 1，窗口取 Relay 的整个窗口，预算内的第 2 次起不发出
    let second = Keys::generate();
    let budget = Arc::new(ApiBudget::new(1, std::time::Duration::from_secs(60)).expect("预算"));
    let budgeted = client(&second).with_budget(budget);
    let filter = [serde_json::json!({ "kinds": [9], "limit": 1 })];
    match budgeted.query(http, &filter).await {
        Ok(_) | Err(OperatorError::Rejected { status: 403, .. }) => {}
        Err(e) => panic!("预算内的第 1 次应发往 Relay：{e:?}"),
    }
    for _ in 0..3 {
        let err = budgeted
            .query(http, &filter)
            .await
            .expect_err("预算用完必须拒绝");
        assert!(
            matches!(err, OperatorError::BudgetExhausted { retry_after_secs } if retry_after_secs > 0),
            "预算用完必须是 BudgetExhausted 且给出等待时长：{err:?}"
        );
        assert_eq!(err.limit(), Some(LimitKind::RateLimited));
    }
    // 预算拦下的 3 次没有打到 Relay：这把钥匙在 Relay 上恰好只用掉 1 次
    let remaining = calls_until_limited(http, &client(&second)).await;
    assert_eq!(
        remaining,
        quota - 1,
        "被 Core 预算拦下的请求不得消耗 Relay 额度"
    );
}
