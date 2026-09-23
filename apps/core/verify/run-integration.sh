#!/usr/bin/env bash
# 跑全部集成核验：Buzz roster、SecretRef、SpiceDB 关系、成员生命周期整条链。
# 这些用例默认跳过；环境与开关见 integration-env.sh。
set -euo pipefail
cd "$(dirname "$0")/../.."
. core/verify/integration-env.sh

# 夹具回传本次写入的两个版本号；不假设它们是 1 和 2（KV v2 会裁旧版本）
eval "$(./core/verify/seed-secret-ref.sh)"
export VERIFY_SECRET_VERSION_V1 VERIFY_SECRET_VERSION_V2
(cd core && cargo test --workspace)
# Go 侧同理
# -count=1 关掉缓存：集成核验的结论取决于外部系统当下的状态，缓存命中等于没跑
(cd worker && KAILO_INTEGRATION=1 go test -count=1 ./...)
