// 平台页头部与频道页的读取走 react-query。它的 error 态是这里要的关键区分：取不到
// 不是「空」。把失败渲染成空列表，等于把结果不明说成了确定的「没有」。
//
// 成员、审计、设备页来自 Kailo 共用包（@kailo/platform，ADR-09），它们自带同样
// 语义的读取，不经这里。

import { bff, fetchUserState } from "@/platform/bff-client";

export const platformQueries = {
  workspaces: { queryKey: ["platform", "workspaces"], queryFn: bff.workspaces },
  userState: { queryKey: ["platform", "user-state"], queryFn: fetchUserState },
  members: (workspaceId: string) => ({
    queryKey: ["platform", "members", workspaceId],
    queryFn: () => bff.members(workspaceId),
  }),
};
