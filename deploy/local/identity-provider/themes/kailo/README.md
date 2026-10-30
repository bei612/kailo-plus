# Kailo IdP 登录主题（DD-164(8)）

`login/` 是 IdP 登录、错误与退出确认页的 Kailo 呈现：父主题为固定镜像自带的 `keycloak.v2`
（Keycloak 26.4.7，`quay.io/keycloak/keycloak@sha256:9409c59b…e6007`），页面结构与行为保持 IdP 原样，
只替换样式与文案。

- 样式只用 `--kailo-*` 令牌：`css/kailo-theme-tokens.css` 就是 `client-kit/embed/kailo-theme-tokens.css`
  （生成物，单一来源），由 `deploy/local/compose.yaml` 的 configs 投递，不复制进本目录；`css/kailo.css`
  把父主题的 PatternFly v5 变量映射到这些令牌（品牌紫、字体、圆角、阴影），去掉 IdP 的标识与背景。
- 标识与 favicon 是 `web-client/web/public/app-icon.png`（同样以 configs 投递）；名称取 realm 显示名，
  由 `bootstrap.sh --declare-realm-presentation` 从 `PLATFORM_DISPLAY_NAME` 收敛。
- 文案：`messages_zh_CN`、`messages_zh_Hans`（Keycloak 26 的简体中文包名）与 `messages_en`，标题为
  “登录 <显示名>”/“Sign in to <显示名>”，卡片标题“登录你的账号”/“Sign in to your account”。
- 明暗：`js/kailo-theme.js` 随系统明暗为 `<html>` 设 `data-kailo-theme`，与令牌文件的深色选择器一致。
- 语言：realm 启用 `zh-CN`、`en`，默认 `zh-CN`；网关只在本机有 Kailo 语言（`buzz-locale`）时传
  `ui_locales`，否则由 IdP 依次取其语言 cookie、`Accept-Language`、默认中文。

## 验证（2026-10-30，分支 `feat/authz-idp`）

CI 节点以同一镜像 digest 起一次性 Keycloak（私有网络、不发布端口，按 compose configs 的目标路径只读挂载
本主题、令牌与图标），再以真实 `idp-declarations.py realm-presentation`/`session-termination` 收敛后截图：

| 用例 | `<title>` | 卡片标题 | 按钮 | 页面含 "Keycloak" |
|---|---|---|---|---|
| 浏览器 `zh-CN` | 登录 Kailo | 登录你的账号 | 登录 | 否 |
| 浏览器 `en-US` | Sign in to Kailo | Sign in to your account | Sign in | 否 |
| 浏览器 `zh-CN` + `ui_locales=en` | Sign in to Kailo | Sign in to your account | Sign in | 否 |
| 浏览器 `en-US`、深色 | Sign in to Kailo | Sign in to your account | Sign in | 否（`data-kailo-theme=dark`） |
| 浏览器 `fr-FR` | 登录 Kailo（realm 默认） | 登录你的账号 | 登录 | 否 |

主按钮背景为品牌色 `#6d4fed`（深色 `#6151c6`），字体为 Kailo 字体栈；截图与日志在 CI 节点
`~/kailo-acceptance/authz-same-source-20261030/idp/`。
