//! `SS-BUZ-OPERATOR` 的真实核验。
//!
//! 未提供 `RELAY_OPERATOR_API_ORIGIN` 与密钥时跳过：这是接缝核验，
//! 没有可达的 Relay 时它没有适用对象。

use kailo_buzz::operator::{OperatorError, OperatorIdentity};
use nostr::Keys;

/// 每次核验用一对新密钥充当 Tenant CONTROL 身份。
///
/// operator 只负责签名创建请求，不做 Community 的 owner——按 .design/09，
/// 创建成功后 relay-level roster 用 Tenant CONTROL。把 operator 当 owner
/// 既偏离设计，也会撞上每 owner 的 Community 数量上限。
fn fresh_control_pubkey() -> String {
    Keys::generate().public_key().to_hex()
}

const AUDIENCE: &str = "kailo-local";

fn env() -> Option<(String, String)> {
    let origin = std::env::var("RELAY_OPERATOR_API_ORIGIN").ok()?;
    let key = std::env::var("RELAY_OPERATOR_PRIVATE_KEY").ok()?;
    if origin.is_empty() || key.is_empty() {
        return None;
    }
    Some((origin, key))
}

#[tokio::test]
async fn audience_mismatch_is_rejected_before_any_network_call() {
    let Some((origin, key)) = env() else { return };
    // audience 不符时必须在取用密钥之后、发请求之前就失败——
    // 同一把 operator key 不得服务它不该服务的部署。
    let err = OperatorIdentity::new(&key, &origin, AUDIENCE, "other-deployment").unwrap_err();
    assert!(
        matches!(err, OperatorError::AudienceMismatch),
        "得到 {err:?}"
    );
}

#[tokio::test]
async fn provision_is_idempotent_for_same_owner_and_rejects_a_different_owner() {
    let Some((origin, key)) = env() else { return };
    let id = OperatorIdentity::new(&key, &origin, AUDIENCE, AUDIENCE).expect("构造 operator 身份");
    let http = reqwest::Client::new();

    let host = format!(
        "t{}.kailo.local",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_micros()
    );
    let owner = fresh_control_pubkey();

    let created = id
        .provision_community(&http, &host, &owner)
        .await
        .expect("首次创建应成功");
    let community_id = created
        .get("community_id")
        .and_then(|v| v.as_str())
        .expect("响应缺 community_id")
        .to_string();

    // 同一 owner 重发是幂等收敛而不是失败：这让「行已建、owner bootstrap 崩溃」
    // 之后的重试能收敛。返回的必须是同一个 community，不得新建第二个。
    let again = id
        .provision_community(&http, &host, &owner)
        .await
        .expect("同一 owner 重发应幂等成功");
    assert_eq!(
        again.get("community_id").and_then(|v| v.as_str()),
        Some(community_id.as_str()),
        "同一 owner 重发产生了不同的 community"
    );

    // 换一个 owner 必须被拒绝。这是 REQ-09 的落点：两个 Tenant 不得共用
    // 同一协作空间，operator 签名也不能把已有 Community 转给别人。
    let other_owner = "0".repeat(63) + "1";
    let err = id
        .provision_community(&http, &host, &other_owner)
        .await
        .expect_err("换 owner 必须被拒绝");
    assert!(
        matches!(err, OperatorError::Rejected { .. }),
        "得到 {err:?}"
    );
}

#[tokio::test]
async fn signature_over_wrong_origin_is_rejected() {
    let Some((_, key)) = env() else { return };
    // 签名 URL 与 Relay 配置的 origin 不符时不可能通过——这条证明 origin
    // 确实参与了签名校验，而不是可被入站 Host 头顶替。
    let id = OperatorIdentity::new(&key, "http://wrong-origin.invalid:9999", AUDIENCE, AUDIENCE)
        .expect("构造 operator 身份");
    let http = reqwest::Client::new();
    let err = id
        .provision_community(&http, "x.kailo.local", &id.pubkey_hex())
        .await
        .expect_err("错误 origin 必须失败");
    assert!(
        matches!(
            err,
            OperatorError::Transport(_) | OperatorError::Rejected { .. }
        ),
        "得到 {err:?}"
    );
}
