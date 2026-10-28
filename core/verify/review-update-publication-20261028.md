# Projects review-update publication fence

2026-10-28 主线候选固定 `732b649d8fe5926d6432e859099f0b57df05946d` 增加既有
publication writer fence、Relay 观测白名单和 absence-proof 对 `1619` review-update
kind 的支持。迁移 up/down 在独立 PostgreSQL 容器中执行退出 0；Core 933 项原单元、
collab-bridge publication 5 项、相关 publication/history/reconcile 消费者、clippy
和 SQLx check 均退出 0。

同一受限检查随后尝试运行原 buzz-db publication PostgreSQL 套件，但固定 Rust 1.95
toolchain 在无网络容器内未命中缓存，停在 rustup 下载阶段，未进入测试；容器已手动
清理，不能把该数据库套件计为通过。此前已通过的 Core/Relay 结果不替代这项检查。

本批未部署、未改变既有 `0048` 文件、未接入 Projects 1619 producer；producer、真实
Relay/PG、旧 writer 和正式发布仍需后续联合验证。失败日志保留在 CI Data
`/volumes/data/kailo/verification/publication-db-fence/732b649d8fe5926d6432e859099f0b57df05946d-1619/`。
