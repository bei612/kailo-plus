// DD-134(2)：「网关」入口只在本会话至少有一个分区可用时出现。这只决定是否呈现入口；
// 每个查询与动作仍由 BFF fresh 授权，前端隐藏不构成授权。读取失败、无权或宿主没有平台
// 客户端时入口不出现，不把失败当作“有权限”。

import type { GatewayAccess } from "@client-kit/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { useOptionalBffClient } from "./context";

export function gatewayAccessUsable(access: GatewayAccess | null | undefined): boolean {
  return !!access && [access.canReadStats, access.canReadTools, access.canReadModelRoutes, access.canCreateModelRoute,
    access.canReadConfig, access.canManageMcp, access.canBindMcp].some((value) => value === true);
}

/** 导航中的网关入口门：不可用时渲染 fallback（默认不渲染）。 */
export function GatewayEntryGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const client = useOptionalBffClient();
  const [usable, setUsable] = useState(false);
  useEffect(() => {
    let current = true;
    setUsable(false);
    if (!client || typeof client.gatewayAccess !== "function") return;
    let read: Promise<GatewayAccess>;
    try { read = client.gatewayAccess(); } catch { return; }
    read.then((access) => { if (current) setUsable(gatewayAccessUsable(access)); }, () => { if (current) setUsable(false); });
    return () => { current = false; };
  }, [client]);
  return <>{usable ? children : fallback}</>;
}
