# OpenBao 本地拓扑配置。
#
# 07-运行与运维基线.md §1 的四条不变式在此落实其中三条：
#   - 不用 server -dev（内存 storage 加固定 root token）：用 raft 持久化存储
#   - 配置中不出现 disable_mlock：上游已移除 mlock 支持，出现且为 false 时\n#     进程拒绝启动（SF-OBA-10）。私钥不被换出改由宿主 swap 策略保障。
#   - 至少一个 audit device：零 device 时 audit broker 的 fail-closed 分支被
#     短路、取用不留痕（SF-OBA-06）。该版本拒绝经 API 启用 audit device，
#     必须在配置中声明——见 SF-OBA-11。
#
# 第四条 auto-unseal 属于部署形态：它需要外部密钥源（KMS 或另一套 transit
# 提供方），本地无此条件，改由 bootstrap 用 shamir 分片解封，分片存放在
# gitignore 的 secrets/ 下。该不变式对部署描述生效，不对本地开发拓扑生效——
# 它保障的是冷启动可用性，不是安全边界，07 §2 允许本地简化可用性而非边界。

ui = false

storage "raft" {
  path    = "/openbao/data"
  node_id = "kailo-local"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr     = "http://openbao:8200"
cluster_addr = "http://openbao:8201"

# 至少一个 audit device（07 §1、SF-OBA-06）。该版本只接受声明式配置：
# 经 API 启用会得到 "cannot enable audit device via API"（SF-OBA-11）。
# 两个标签依次是 type 与 path：parseAuditDevices 在 len(item.Keys) == 2 时
# 才从标签取值，只给一个标签会报 "audit type must be specified"。
audit "file" "file/" {
  options = {
    file_path = "/openbao/data/audit.log"
  }
}
