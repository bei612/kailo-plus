import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

// Kailo 一期：频道、设置与平台页。已排除或未登记的能力不生成任何入口——
// 路由、导航项、按钮一个都不留（.design/01 §5、Stage 1 明确限制）。
export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/settings", "settings.tsx"),
  route("/channels/$channelId", "channels.$channelId.tsx"),
  route("/platform/$section", "platform.$section.tsx"),
]);
