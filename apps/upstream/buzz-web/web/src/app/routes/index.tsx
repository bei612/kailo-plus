import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

// 一期的根路径就是平台页。上游自带的聊天主体覆盖的能力（反应、话题、DM、
// presence、git、Agent、收件箱……）大部分在一期不启用，而它当前仍直连 Relay
// 并在本地持钥——那正是 DD-39 要移除的。把它留在路由表里，等于让一条设计
// 禁止的路径继续可达。
export const Route = createFileRoute("/")({
  component: lazyRouteComponent(() => import("@/platform/ui/PlatformApp"), "PlatformApp"),
});
