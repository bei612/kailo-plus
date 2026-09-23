//! 真实浏览器走查用的 Workspace 夹具（`core/verify/web-walkthrough.sh` 调用）。
//!
//! 集成测试证明 BFF 的每个端点在 HTTP 层成立；它们证明不了 Web 端的代码真的
//! 按这些端点工作——SSE 解析、消息渲染、发送回显都在浏览器里。那一半只能由
//! 一个真能在 IdP 登录的用户、在一个真实的 Workspace 里走一遍。
//!
//! 这里不另写一套开通逻辑：直接复用集成测试的夹具，Tenant、Workspace、两级
//! 成员与 Buzz binding 全部走同样的 lifecycle Workflow。唯一的区别是 OIDC
//! subject 由调用方给出——它由 IdP 签发，夹具编造不出来。
//!
//! 开通完成后打印一行 JSON，随后阻塞读 stdin；stdin 关闭即拆除。拆除挂在
//! stdin 上而不是信号上：调用方无论正常结束还是中途失败，关掉管道都会触发它。

#[path = "../tests/common/mod.rs"]
mod common;

use sqlx::PgPool;

#[tokio::main]
async fn main() {
    let subject = std::env::args()
        .nth(1)
        .expect("用法: verify_workspace <IdP 签发的 OIDC subject>");
    let e =
        common::env().expect("KAILO_INTEGRATION 未开启：先 source core/verify/integration-env.sh");
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("连 Core 库");
    let token = common::worker_token(&http, &e).await;

    let fx = match common::provision_live_workspace_for(&http, &e, &pool, &token, &subject).await {
        Ok(f) => f,
        Err(msg) => {
            eprintln!("准备真实 Workspace 失败: {msg}");
            std::process::exit(1);
        }
    };
    println!(
        "{}",
        serde_json::json!({
            "tenant": fx.tenant,
            "workspace": fx.workspace,
            "principal": fx.principal,
        })
    );

    let _ = tokio::task::spawn_blocking(|| {
        std::io::Read::read_to_end(&mut std::io::stdin(), &mut Vec::new())
    })
    .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    eprintln!("已拆除 Workspace {}", fx.workspace);
}
