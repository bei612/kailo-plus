//! `SS-BUZ-SERVER-CLIENT` 的真实核验。
//!
//! 验证三件事：Core 不为客户端托管的身份代签；roster 之外的 pubkey 发布被拒；
//! roster 之内的 pubkey 发布被接受并返回可作为审计证据的 event id。

use kailo_buzz::bridge::{Custody, IdentityClient};
use kailo_buzz::operator::{OperatorError, OperatorIdentity};
use nostr::Keys;

const AUDIENCE: &str = "kailo-local";

fn env() -> Option<(String, String)> {
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
        .publish_channel_message(&http, &channel_id, "should not pass")
        .await
        .expect_err("非成员发布必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );

    // Community owner 在 roster 中，其发布应被接受并返回 event id——
    // 该 id 是 operation outcome 与 audit evidence（.design/09 第 6 步）。
    let event_id = owner_client
        .publish_channel_message(&http, &channel_id, "hello from core")
        .await
        .expect("成员发布应被接受");
    assert_eq!(
        event_id.len(),
        64,
        "event id 应为 64 位十六进制，得到 {event_id}"
    );
}
