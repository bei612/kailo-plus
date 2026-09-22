//! SecretRef 解析对运行中的 OpenBao 的真实核验（`DD-70`）。
//!
//! 验的不是「能读到」，而是三条边界：audience 不符即拒、版本必须精确、
//! 策略之外的路径读不到。
//!
//! 注意这里为什么不能用 `expect_err`：`SecretValue` 故意不实现 `Debug`，
//! 而 `expect_err` 要求 `T: Debug`。编译器因此挡住了「把 secret 值打进测试
//! 输出」这条路——连测试代码都没有这个口子。

use kailo_secrets::{SecretError, SecretRef, SecretStore};

/// 集成核验要显式开启，不按「某个环境变量碰巧存在」来判断。
///
/// 这些变量名与产品侧同名（`OPENBAO_ADDR` 等），而部署里它们指向网内地址；
/// 谁在自己的 shell 里 source 过 `.env`，再跑门禁就会让本该跳过的用例拿着
/// `http://openbao:8200` 去连，然后以一堆看不懂的失败收场。显式开关让
/// 「跳过」有确定含义：没开，而不是某个变量恰好没设。
fn store() -> Option<SecretStore> {
    if std::env::var("KAILO_INTEGRATION").as_deref() != Ok("1") {
        return None;
    }
    Some(SecretStore::from_env().expect("构造 SecretStore"))
}

fn identity() -> String {
    std::env::var("OPENBAO_SERVICE_IDENTITY").expect("核验需要 OPENBAO_SERVICE_IDENTITY")
}

fn locator() -> String {
    std::env::var("VERIFY_SECRET_LOCATOR").expect("核验需要 VERIFY_SECRET_LOCATOR")
}

/// 夹具本次写入的两个版本号。
///
/// 不写死 1 和 2：KV v2 按 `max_versions` 裁掉旧版本，同一路径反复写之后最旧
/// 可读版本会往后移。写死会让用例在跑够次数后必然失败，而失败信息看起来像
/// 「SecretRef 解析坏了」——实际是那个版本已经不存在了。
fn versions() -> (u32, u32) {
    let v = |k: &str| {
        std::env::var(k)
            .expect("核验需要夹具回传的版本号")
            .parse()
            .expect("版本号必须是数字")
    };
    (v("VERIFY_SECRET_VERSION_V1"), v("VERIFY_SECRET_VERSION_V2"))
}

/// 取到的必须正是请求的那个版本。
///
/// 不取 latest 是 binding 语义的要求：binding 冻结的是某个具体版本，取 latest
/// 会让一次无关的轮换悄悄改变已 active 的 binding 行为。
#[tokio::test]
async fn reads_the_exact_requested_version() {
    let Some(s) = store() else { return };
    let (n1, n2) = versions();
    let v1 = s
        .read(
            &SecretRef {
                locator: locator(),
                version: n1,
                audience: identity(),
            },
            "value",
        )
        .await
        .expect("版本 1 应可读");
    let v2 = s
        .read(
            &SecretRef {
                locator: locator(),
                version: n2,
                audience: identity(),
            },
            "value",
        )
        .await
        .expect("版本 2 应可读");
    assert_ne!(
        v1.expose(),
        v2.expose(),
        "两个版本的值应不同，否则这条断言没有意义"
    );
    assert_eq!(v1.expose(), "v1");
    assert_eq!(v2.expose(), "v2");
}

/// audience 不符即拒，且在发出任何网络请求之前就拒。
///
/// 同一把 secret 不得被用于它不该服务的调用方。这条检查放在最前面，是因为
/// 「先取回来再判断」意味着值已经进过内存与日志缓冲。
#[tokio::test]
async fn audience_mismatch_is_refused() {
    let Some(s) = store() else { return };
    let err = s
        .read(
            &SecretRef {
                locator: locator(),
                version: versions().0,
                audience: "some-other-service".into(),
            },
            "value",
        )
        .await;
    assert!(
        matches!(err, Err(SecretError::AudienceMismatch)),
        "audience 不符必须拒绝"
    );
}

/// 不存在的版本不能读成成功。
#[tokio::test]
async fn missing_version_is_not_success() {
    let Some(s) = store() else { return };
    let err = s
        .read(
            &SecretRef {
                locator: locator(),
                version: 9999,
                audience: identity(),
            },
            "value",
        )
        .await;
    assert!(
        matches!(err, Err(SecretError::VersionUnavailable)),
        "不存在的版本必须失败"
    );
}

/// 策略之外的 mount 读不到。
///
/// Core 的策略只覆盖登记的 KV mount。这条守的是「凭据的能力等于策略」，
/// 而不是「代码里没写过那条路径」——后者挡不住任何拼错或注入的 locator。
#[tokio::test]
async fn path_outside_policy_is_refused() {
    let Some(s) = store() else { return };
    let loc = locator();
    let mut parts = loc.splitn(3, '/');
    let ns = parts.next().unwrap().to_owned();
    let path = {
        parts.next();
        parts.next().unwrap().to_owned()
    };
    let err = s
        .read(
            &SecretRef {
                locator: format!("{ns}/not-a-mount/{path}"),
                version: versions().0,
                audience: identity(),
            },
            "value",
        )
        .await;
    assert!(
        matches!(err, Err(SecretError::VersionUnavailable)),
        "策略之外的 mount 必须读不到"
    );
}
