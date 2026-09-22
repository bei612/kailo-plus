# Backend Quality Guidelines

从本仓库实际犯过的错误提炼，不是通用建议。每条都对应一次真实故障。

## 产物写入必须原子：先临时文件，成功且非空才落位

`cmd > file` 会在命令失败**之前**就创建好文件。命令失败时留下 0 字节文件，
后续步骤把它当成有效产物。

本仓库栽过两次：

- `tools/release.sh` 的 SBOM 生成失败后留下 0 字节 `*.spdx.json`，供应链检查
  一度把它当成已生成。
- `deploy/local/openbao-init.sh` 的 `bao operator init` 失败后留下 0 字节
  `openbao_init.json`，**解封分片永久丢失**，raft 数据不可解，只能清库重来。

写法：

```sh
tmp=$(mktemp)
if cmd > "$tmp" && [ -s "$tmp" ]; then
  mv "$tmp" "$dest"
else
  rm -f "$tmp"; exit 2
fi
```

`[ -s ]` 不能省：命令成功但输出为空同样是失败。

## 不要用退出码推断外部服务的状态

`bao status` 在封存时以非零码退出。配合 `set -o pipefail`，
`bao status | parse || echo sealed` 的结果取决于退出码而不是实际状态，
判定会在两种失败之间摇摆。

只解析输出内容，解析不到就取保守值——宁可多做一次幂等操作，
也不要漏做后在下游才发现。

## 容器内的凭据投递：不要依赖 `_FILE` 约定

`_FILE` 后缀不是通用约定。本仓库三个上游各不相同：

- Temporal 的 `server` 镜像不做配置模板渲染，口令要在入口脚本里从挂载读入后导出。
- SpiceDB 是 distroless，容器内没有 shell，只能用 `env_file` 投递。
- Keycloak 不认 `KC_BOOTSTRAP_ADMIN_PASSWORD_FILE`，同样要入口脚本转一手。

先确认镜像是否有 shell、是否支持 `_FILE`，再决定投递方式；
无论哪种，凭据都不进 `.env`、不进配置文件、不上命令行。

## 要拼进 URI 的随机口令必须用 URL-safe 字母表

`bootstrap.sh` 的 `gen` 原本输出标准 base64，而三个组件的口令都要拼进
`postgres://user:pass@host/db`。标准 base64 的 `/` 在 userinfo 里是路径分隔符，
连接串会被截成另一个库名。43 个字符里不出现 `/` 的概率约 51%——
一半的全新 bootstrap 会随机失败，且每次现象不同。

`head -c 32 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_'`。
熵不变，去掉了对拼接位置的隐含要求。

## 上游子命令要先确认存在，不要按「应该有」来写编排

`spicedb` 二进制没有 `validate` 子命令（可用的只有 `completion/datastore/
help/lsp/man/postgres-fdw/serve/serve-testing/version`）。schema 只能经 gRPC
`WriteSchema` 写入，本仓库用官方 `authzed/zed` 镜像的 `schema write`。

编排里每写一个上游子命令，先 `docker run --rm <image> <cmd> --help` 确认；
`--help` 的退出码与输出比任何记忆都便宜。
