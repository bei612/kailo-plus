import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

// 一期只注册平台自身的页面（平台页与邀请兑换页）。已阻断或未启用的能力不生成任何入口——
// route、导航项、按钮一个都不留。留着入口再在里面报「未启用」是另一种假实现。
export const routes = rootRoute("root.tsx", [index("index.tsx"), route("/invite", "invite.tsx")]);
