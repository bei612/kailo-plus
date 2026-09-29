import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

// 邀请兑换页（DD-83）：`<网关浏览器入口>/app/invite#<一次性凭据>`。凭据在 fragment 里，
// 不随任何请求发往服务端；页面读出后立即从地址栏清掉。
export const Route = createFileRoute("/invite")({
  component: lazyRouteComponent(() => import("@/platform/ui/InvitePage"), "InvitePage"),
});
