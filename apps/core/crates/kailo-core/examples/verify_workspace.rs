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
//! `--governance`：另外备好任务工作台与审批箱要走查的两条审批（与
//! `tests/governed_action.rs` 同一做法：成员经成员生命周期开通，admin 关系由夹具
//! 写入，动作经 BFF 以网关投影的身份 header 提交）：
//! - 另一位 Tenant admin B 请求撤掉成员 C，待核验用户批准（「待我审批」）；
//! - 核验用户自己请求撤掉成员 D，待另一位 admin 批准（「我的任务」，可撤回）。
//!
//! 开通完成后打印一行 JSON，随后阻塞读 stdin；stdin 关闭即拆除。拆除挂在
//! stdin 上而不是信号上：调用方无论正常结束还是中途失败，关掉管道都会触发它。

#[path = "../tests/common/mod.rs"]
mod common;

use common::{Env, LiveMember, LiveWorkspace};
use serde_json::{json, Value};
use sqlx::PgPool;

/// 走查要用的两条审批与它们涉及的成员。
struct Governance {
    b: LiveMember,
    c: LiveMember,
    d: LiveMember,
    /// B 发起、待核验用户决定的审批
    for_me: String,
    /// 核验用户发起的动作与它的审批
    mine_task: String,
    mine: String,
}

async fn wait_open(e: &Env, pool: &PgPool, wf: &str) {
    common::until(e, "审批投影进入 WAITING", || async {
        (common::approval_status(pool, wf).await.as_deref() == Some("WAITING")).then_some(())
    })
    .await;
}

async fn revoke_request(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    target: uuid::Uuid,
) -> Result<Value, String> {
    let (st, body) = common::submit(
        http,
        e,
        subject,
        json!({"actionKey":"tenant.member.revoke","idempotencyKey":uuid::Uuid::new_v4(),
               "principalId":target}),
    )
    .await;
    if st != reqwest::StatusCode::ACCEPTED || body["gateState"] != "WAITING" {
        return Err(format!("tenant.member.revoke 应进入审批：{st} {body}"));
    }
    Ok(body)
}

async fn prepare_governance(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    token: &str,
    fx: &LiveWorkspace,
) -> Result<Governance, String> {
    let tenant = format!("tenant:{}", fx.tenant);
    let b = common::add_tenant_member(http, e, pool, token, fx).await?;
    let c = common::add_tenant_member(http, e, pool, token, fx).await?;
    let d = common::add_tenant_member(http, e, pool, token, fx).await?;
    // 两位 Tenant admin：核验用户与 B。撤成员需另一位 admin 批准（self_approval=DENY）
    for p in [fx.principal, b.principal] {
        common::zed_relationship(e, "touch", &tenant, "admin", &format!("principal:{p}"));
    }
    let for_me = revoke_request(http, e, &b.subject, c.principal).await?;
    let for_me = for_me["approvalWorkflowId"]
        .as_str()
        .ok_or("缺审批 ID")?
        .to_owned();
    wait_open(e, pool, &for_me).await;
    let mine = revoke_request(http, e, &fx.subject, d.principal).await?;
    let mine_task = mine["actionExecutionId"]
        .as_str()
        .ok_or("缺 ActionExecution")?
        .to_owned();
    let mine = mine["approvalWorkflowId"]
        .as_str()
        .ok_or("缺审批 ID")?
        .to_owned();
    wait_open(e, pool, &mine).await;
    Ok(Governance {
        b,
        c,
        d,
        for_me,
        mine_task,
        mine,
    })
}

/// 拆除前让两条审批都走到终态：仍未决的由发起者撤回；已批准的等它被消费或失效
/// ——在途的撤权 Workflow 不能被拆掉的 Tenant 截断。
async fn settle_governance(
    http: &reqwest::Client,
    e: &Env,
    pool: &PgPool,
    fx: &LiveWorkspace,
    g: &Governance,
) {
    for (subject, wf) in [
        (g.b.subject.as_str(), g.for_me.as_str()),
        (fx.subject.as_str(), g.mine.as_str()),
    ] {
        let status = common::approval_status(pool, wf).await;
        if matches!(status.as_deref(), Some("REQUESTED" | "WAITING")) {
            let (st, body) = common::bff(
                http,
                e,
                subject,
                reqwest::Method::POST,
                &format!("/api/v1/approvals/{wf}/withdraw"),
                None,
            )
            .await;
            eprintln!("拆除前撤回 {wf}：{st} {body}");
        }
        common::until(e, "审批到达终态", || async {
            let s = common::approval_status(pool, wf).await;
            (!matches!(s.as_deref(), Some("REQUESTED" | "WAITING" | "APPROVED"))).then_some(())
        })
        .await;
    }
    let tenant = format!("tenant:{}", fx.tenant);
    for p in [fx.principal, g.b.principal] {
        common::zed_relationship(e, "delete", &tenant, "admin", &format!("principal:{p}"));
    }
    for m in [&g.b, &g.c, &g.d] {
        common::zed_relationship(
            e,
            "delete",
            &tenant,
            "member",
            &format!("principal:{}", m.principal),
        );
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let governance = args.iter().any(|a| a == "--governance");
    let subject = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .expect("用法: verify_workspace <IdP 签发的 OIDC subject> [--governance]")
        .clone();
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
    let g = if governance {
        match prepare_governance(&http, &e, &pool, &token, &fx).await {
            Ok(g) => Some(g),
            Err(msg) => {
                eprintln!("准备审批失败: {msg}");
                common::teardown_live_workspace(&e, &pool, &fx).await;
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    let mut out = json!({
        "tenant": fx.tenant,
        "workspace": fx.workspace,
        "principal": fx.principal,
    });
    if let Some(g) = &g {
        out["approvalForMe"] = json!(g.for_me);
        out["myTask"] = json!(g.mine_task);
        out["myApproval"] = json!(g.mine);
    }
    println!("{out}");

    let _ = tokio::task::spawn_blocking(|| {
        std::io::Read::read_to_end(&mut std::io::stdin(), &mut Vec::new())
    })
    .await;
    if let Some(g) = &g {
        settle_governance(&http, &e, &pool, &fx, g).await;
    }
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Some(g) = &g {
        common::teardown_members(&pool, &fx, &[&g.b, &g.c, &g.d]).await;
    }
    eprintln!("已拆除 Workspace {}", fx.workspace);
}
