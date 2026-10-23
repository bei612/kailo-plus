// DD-134 网关管理区的共用呈现：时间窗、枚举文案、数字与时延格式、读取三态。
// 只用宿主语义色与 ui.tsx 原语；读取失败与无权不渲染成空或零。

import {
  AgentInstallationToolSource,
  GatewayCallKind,
  GatewayCallOutcome,
  GatewayConfigChangeKind,
  GatewayConfigRevisionSource,
  GatewayStatsDimension,
} from "@client-kit/contracts";
import type { ReactNode } from "react";
import type { PlatformMessageKey } from "../i18n";
import { useLocale, useT } from "./context";
import { isForbidden } from "./pages";
import { Badge, Button, Notice, type Tone } from "./ui";
import type { Loaded } from "./use-load";

export type GatewayWindow = "hour" | "day" | "week";

export const windowLabel: Record<GatewayWindow, PlatformMessageKey> = {
  hour: "gateway.window.hour",
  day: "gateway.window.day",
  week: "gateway.window.week",
};

const windowMs: Record<GatewayWindow, number> = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };

const isoSeconds = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 区间 [from, to)，to 固定在本次读取时刻；刷新才前移。最长 7 天（DD-134(3)④）。 */
export function gatewayRange(window: GatewayWindow, at: number): { from: string; to: string } {
  const to = Math.floor(at / 1000) * 1000;
  return { from: isoSeconds(to - windowMs[window]), to: isoSeconds(to) };
}

export function WindowSelect({ value, onChange }: { value: GatewayWindow; onChange: (value: GatewayWindow) => void }) {
  const t = useT();
  return <select aria-label={t("gateway.window")} className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
    value={value} onChange={(event) => onChange(event.target.value as GatewayWindow)}>
    {(Object.keys(windowLabel) as GatewayWindow[]).map((key) => <option key={key} value={key}>{t(windowLabel[key])}</option>)}
  </select>;
}

export const dimensionLabel: Record<GatewayStatsDimension, PlatformMessageKey> = {
  [GatewayStatsDimension.ModelRoute]: "gateway.dimension.modelRoute",
  [GatewayStatsDimension.Tool]: "gateway.dimension.tool",
  [GatewayStatsDimension.Agent]: "gateway.dimension.agent",
  [GatewayStatsDimension.Binding]: "gateway.dimension.binding",
  [GatewayStatsDimension.Tenant]: "gateway.dimension.tenant",
};

export const kindLabel: Record<GatewayCallKind, PlatformMessageKey> = {
  [GatewayCallKind.Model]: "gateway.kind.model",
  [GatewayCallKind.Tool]: "gateway.kind.tool",
};

export const outcomeLabel: Record<GatewayCallOutcome, PlatformMessageKey> = {
  [GatewayCallOutcome.Succeeded]: "gateway.outcome.succeeded",
  [GatewayCallOutcome.Failed]: "gateway.outcome.failed",
  [GatewayCallOutcome.Denied]: "gateway.outcome.denied",
  [GatewayCallOutcome.Running]: "gateway.outcome.running",
  [GatewayCallOutcome.Unknown]: "gateway.outcome.unknown",
};

const outcomeTone: Record<GatewayCallOutcome, Tone> = {
  [GatewayCallOutcome.Succeeded]: "positive",
  [GatewayCallOutcome.Failed]: "negative",
  [GatewayCallOutcome.Denied]: "negative",
  [GatewayCallOutcome.Running]: "neutral",
  [GatewayCallOutcome.Unknown]: "neutral",
};

/** DD-149(10)：连接器工具的来源显示“用户连接器”。 */
export const toolSourceLabel: Record<AgentInstallationToolSource, PlatformMessageKey> = {
  [AgentInstallationToolSource.PlatformNative]: "gateway.tools.native",
  [AgentInstallationToolSource.Application]: "gateway.tools.application",
  [AgentInstallationToolSource.UserRegisteredExternal]: "gateway.tools.connector",
};

export const revisionSourceLabel: Record<GatewayConfigRevisionSource, PlatformMessageKey> = {
  [GatewayConfigRevisionSource.CoreRecorded]: "gateway.config.coreRecorded",
  [GatewayConfigRevisionSource.Unrecorded]: "gateway.config.unrecorded",
};

export const changeLabel: Record<GatewayConfigChangeKind, PlatformMessageKey> = {
  [GatewayConfigChangeKind.Added]: "gateway.config.added",
  [GatewayConfigChangeKind.Removed]: "gateway.config.removed",
  [GatewayConfigChangeKind.Changed]: "gateway.config.changed",
};

/** 契约外的枚举值如实显示原值，不猜含义。 */
export function EnumText<V extends string>({ table, value }: { table: Record<V, PlatformMessageKey>; value: V }) {
  const t = useT();
  return <span title={value}>{Object.hasOwn(table, value) ? t(table[value]) : value}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: GatewayCallOutcome }) {
  return <Badge tone={outcomeTone[outcome] ?? "neutral"}><EnumText table={outcomeLabel} value={outcome} /></Badge>;
}

export function useNumber() {
  const locale = useLocale();
  return (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(locale).format(value);
}

export function useDuration() {
  const t = useT();
  const number = useNumber();
  return (ms: number | undefined) => ms === undefined ? "—" : t("gateway.ms", { value: number(ms) });
}

export function usePercent() {
  const locale = useLocale();
  return (part: number, total: number) => total > 0
    ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(part / total) : "—";
}

export function useTimestamp() {
  const locale = useLocale();
  return (value: string | undefined) => {
    if (!value) return "—";
    const at = Date.parse(value);
    return Number.isNaN(at) ? value
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(at));
  };
}

/** 403 是确定的无权；其余失败是读取不明，给重试，不渲染成空。 */
export function GatewayLoad<T>({ state, reload, children }: {
  state: Loaded<T>; reload: () => void; children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error") {
    if (isForbidden(state.error)) return <Notice role="alert">{t("gateway.denied")}</Notice>;
    return <Notice role="alert"><span>{t("gateway.readFailed")}</span><Button onClick={reload}>{t("platform.retry")}</Button></Notice>;
  }
  return <>{children(state.data)}</>;
}

export function GatewaySection({ title, testId, children, description }: {
  title: ReactNode; testId?: string; children: ReactNode; description?: ReactNode;
}) {
  return <section className="flex flex-col gap-3" data-testid={testId}>
    <h2 className="text-sm font-medium">{title}</h2>
    {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    {children}
  </section>;
}

export function shortDigest(value: string | undefined): string {
  if (!value) return "—";
  const bare = value.replace(/^sha256:/, "");
  return bare.length > 16 ? `${bare.slice(0, 12)}…` : value;
}
