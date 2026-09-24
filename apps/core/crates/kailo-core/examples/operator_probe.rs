//! 以给定的 operator 私钥签一次只读 operator 请求，报告 Relay 是否接受它
//! （RB-02 步骤 F 的核验：轮换后新 key 被接受、旧 key 被拒）。
//!
//! 私钥从文件读入（参数是文件路径），不经命令行参数或环境变量传值。operator
//! origin 与 audience 取自集成核验环境（`core/verify/integration-env.sh`）。
//!
//! 输出一行 `ACCEPTED` 或 `REJECTED <HTTP 状态>`；传输失败以非零码退出，
//! 不把它读成任何一种结论。

use kailo_buzz::operator::{OperatorError, OperatorIdentity};

#[tokio::main]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("用法: operator_probe <operator 私钥文件>");
    let origin =
        std::env::var("RELAY_OPERATOR_API_ORIGIN").expect("缺少 RELAY_OPERATOR_API_ORIGIN");
    let audience = std::env::var("RELAY_OPERATOR_AUDIENCE").expect("缺少 RELAY_OPERATOR_AUDIENCE");
    let key = std::fs::read_to_string(&path).expect("读私钥文件");
    let operator = OperatorIdentity::new(key.trim(), &origin, &audience, &audience)
        .expect("构造 operator 身份");
    match operator.probe(&reqwest::Client::new()).await {
        Ok(()) => println!("ACCEPTED {}", operator.pubkey_hex()),
        Err(OperatorError::Rejected { status, .. }) => {
            println!("REJECTED {status} {}", operator.pubkey_hex())
        }
        Err(e) => {
            eprintln!("结果不明: {e}");
            std::process::exit(2);
        }
    }
}
