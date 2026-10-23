// DD-141 visual specimen (.design/20). Renders the Kailo tokens and the shared
// components in every state with the shell's own CSS hooks, so the design can
// be reviewed and screenshotted without a session. Dev-server only.
import type { CSSProperties, ReactNode } from "react";
import { Bell, Bot, ChevronDown, Copy, FileText, Hash, Inbox, Lock, MoreHorizontal, Plus, Search, Send, Settings, Sparkles, Trash2, Users, Workflow } from "lucide-react";
import { Button } from "@client-kit/platform/react/button";
import { KailoMark } from "@client-kit/platform/react/surfaces";
import {
  KAILO_BRAND_DIRECTION, KAILO_DIRECTIONS, KAILO_STATUS_RAMPS, kailoCommonVars, kailoExtendedVars, kailoRoles, kailoThemeVars,
  type KailoBrandDirection, type KailoMode,
} from "@client-kit/platform/theme/kailo-tokens";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";

export interface SpecParams { direction: KailoBrandDirection; mode: KailoMode; view: "full" | "directions" | "icon"; size: number }

export function readSpecParams(search: string): SpecParams {
  const query = new URLSearchParams(search);
  const direction = query.get("direction");
  return {
    direction: direction === "violet" || direction === "orchid" || direction === "iris" ? direction : KAILO_BRAND_DIRECTION,
    mode: query.get("mode") === "dark" ? "dark" : "light",
    view: query.get("view") === "directions" ? "directions" : query.get("view") === "icon" ? "icon" : "full",
    size: Number(query.get("size") ?? 168) || 168,
  };
}

const DIRECTION_LABEL: Record<KailoBrandDirection, string> = {
  iris: "Iris 靛紫 · H285", violet: "Violet 纯正紫 · H298", orchid: "Orchid 品红紫 · H318",
};

function scopeVars(direction: KailoBrandDirection, mode: KailoMode): CSSProperties {
  return { ...kailoCommonVars(direction), ...kailoThemeVars(mode, direction), ...kailoExtendedVars(mode, direction) } as CSSProperties;
}

function applyDocument(direction: KailoBrandDirection, mode: KailoMode) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scopeVars(direction, mode) as Record<string, string>)) root.style.setProperty(key, value);
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  root.setAttribute("data-buzz-sidebar", "");
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): string {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x! + 0.05) / (y! + 0.05)).toFixed(2);
}

function Section({ id, title, kicker, children }: { id: string; title: string; kicker: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-10" data-spec-section={id}>
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">{kicker}</span>
        <h2 className="text-xl font-semibold tracking-[-0.018em]">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="h-12 rounded-md ring-1 ring-inset ring-black/5" style={{ background: color }} />
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-medium">{label}</span>
        <span className="font-mono text-2xs text-muted-foreground">{color}</span>
      </div>
    </div>
  );
}

function Ramp({ ramp, name }: { ramp: Record<string | number, string>; name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">{name}</span>
      <div className="flex gap-2">{Object.entries(ramp).map(([step, color]) => <Swatch color={color} key={step} label={step} />)}</div>
    </div>
  );
}

/** One self-contained sample of a direction in one mode (scoped variables). */
function DirectionPanel({ direction, mode }: { direction: KailoBrandDirection; mode: KailoMode }) {
  const r = kailoRoles(mode, direction);
  const ramp = mode === "dark" ? KAILO_DIRECTIONS[direction].brandDark : KAILO_DIRECTIONS[direction].brand;
  return (
    <div className={`${mode} flex flex-1 flex-col gap-4 rounded-xl border border-border bg-background p-5 text-foreground`} style={scopeVars(direction, mode)}>
      <div className="flex items-center gap-3">
        <KailoMark size={28} />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{DIRECTION_LABEL[direction]}</span>
          <span className="text-xs text-muted-foreground">{mode === "dark" ? "深色 · 单独调校" : "浅色"} · 主色 {r.brand}</span>
        </div>
      </div>
      <div className="flex gap-1">{Object.entries(ramp).map(([step, color]) => <div className="h-9 flex-1 rounded-sm" key={step} style={{ background: color }} title={step} />)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button>创建 Agent</Button>
        <Button variant="outline">邀请成员</Button>
        <Badge>进行中</Badge>
        <span className="text-sm text-brand-text underline-offset-4">查看运行记录</span>
      </div>
      <div className="flex gap-3">
        <div className="flex w-52 flex-col gap-px rounded-lg p-1.5" data-testid="app-sidebar" style={{ background: r.sidebar }}>
          <button className="flex items-center" data-active="false" data-sidebar="menu-button" type="button"><Inbox className="size-4" /><span>收件箱</span></button>
          <button className="flex items-center" data-active="true" data-sidebar="menu-button" type="button"><Hash className="size-4" /><span>产品设计评审</span></button>
          <button className="flex items-center" data-active="false" data-sidebar="menu-button" type="button"><Bot className="size-4" /><span>研究助理</span></button>
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2"><span className="h-6 w-6 rounded-md" style={{ background: r.brandSoft }} /><span className="text-sm font-semibold">#产品设计评审</span></div>
          <p className="text-sm text-muted-foreground">提到 <span className="rounded-sm px-1 font-medium" style={{ background: r.brandSoft, color: r.brandSoftText }}>@研究助理</span> 汇总本周反馈。</p>
          <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${r.gradientFrom}, ${r.gradientVia}, ${r.gradientTo})` }} />
        </div>
      </div>
    </div>
  );
}

function DirectionsView() {
  return (
    <div className="flex flex-col gap-6 p-10">
      <header className="flex items-center gap-3">
        <KailoMark size={32} />
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">品牌紫色方向对比</h1>
          <p className="text-sm text-muted-foreground">DD-141 · 三个方向 × 明暗两版；选用 Iris（.design/20 §2.2）。</p>
        </div>
      </header>
      {(Object.keys(KAILO_DIRECTIONS) as KailoBrandDirection[]).map((direction) => (
        <div className="flex gap-5" data-spec-direction={direction} key={direction}>
          <DirectionPanel direction={direction} mode="light" />
          <DirectionPanel direction={direction} mode="dark" />
        </div>
      ))}
    </div>
  );
}

function RolesTable({ direction, mode }: { direction: KailoBrandDirection; mode: KailoMode }) {
  const r = kailoRoles(mode, direction);
  const rows: [string, string, string][] = [
    ["正文 / 内容区", r.text, r.surface], ["次要正文 / 内容区", r.textSecondary, r.surface], ["弱化文字 / 内容区", r.textMuted, r.surface],
    ["弱化文字 / 侧栏", r.textMuted, r.sidebar], ["主按钮文字 / 主按钮", r.onBrand, r.brand], ["品牌文字 / 内容区", r.brandText, r.surface],
    ["选中文字 / 选中底", r.brandSoftText, r.brandSoft], ["成功文字", r.successText, r.surface], ["警告文字", r.warningText, r.surface],
    ["危险文字", r.dangerText, r.surface], ["信息文字", r.infoText, r.surface],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-2xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          <tr><th className="px-4 py-2.5">组合</th><th className="px-4 py-2.5">样例</th><th className="px-4 py-2.5 text-right">对比度</th><th className="px-4 py-2.5 text-right">AA</th></tr>
        </thead>
        <tbody>
          {rows.map(([name, fg, bg]) => (
            <tr className="border-t border-border" key={name}>
              <td className="px-4 py-2">{name}</td>
              <td className="px-4 py-2"><span className="rounded-md px-2 py-1 font-medium" style={{ color: fg, background: bg, boxShadow: "inset 0 0 0 1px hsl(var(--border))" }}>协作 Agent 123</span></td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{contrast(fg, bg)}</td>
              <td className="px-4 py-2 text-right">{Number(contrast(fg, bg)) >= 4.5 ? <span className="text-success-text">✓</span> : <span className="text-danger-text">✗</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TYPE_RAMP: [string, string, string, string][] = [
  ["Display", "text-3xl font-semibold tracking-[-0.022em]", "30 / 36 · 650", "让人与 Agent 在同一处协作"],
  ["Title 1", "text-2xl font-semibold tracking-[-0.018em]", "22 / 28 · 650", "工作流 Workflows"],
  ["Title 2", "text-lg font-semibold tracking-[-0.012em]", "17 / 24 · 600", "运行历史与步骤轨迹"],
  ["Headline", "text-base font-semibold", "15 / 22 · 600", "#产品设计评审 · 12 位成员"],
  ["Body", "text-sm", "14 / 20 · 400", "研究助理已整理 3 份用户访谈，关键结论：权限审批延迟是首要痛点（P0）。"],
  ["Callout", "text-control font-medium", "13 / 18 · 500", "收件箱 · Agents · 云盘 · 知识库"],
  ["Caption", "text-xs text-muted-foreground", "12 / 16 · 450", "星期二 14:32 · 已编辑 · v2.4.1"],
  ["Overline", "text-2xs font-semibold tracking-[0.04em] uppercase text-muted-foreground", "11 / 14 · 600", "频道 Channels"],
];

function StateLabel({ children }: { children: ReactNode }) {
  return <span className="w-20 shrink-0 text-xs text-muted-foreground">{children}</span>;
}

function Spinner() {
  return <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

function ControlsSection() {
  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const forced: Record<(typeof variants)[number], { hover: string; pressed: string }> = {
    default: { hover: "bg-primary/90", pressed: "bg-primary/95 translate-y-px" },
    outline: { hover: "border-muted-foreground/35 bg-accent/60", pressed: "bg-accent translate-y-px" },
    secondary: { hover: "bg-secondary/70", pressed: "bg-secondary translate-y-px" },
    ghost: { hover: "bg-accent", pressed: "bg-accent translate-y-px" },
    destructive: { hover: "bg-destructive/90", pressed: "bg-destructive translate-y-px" },
    link: { hover: "underline", pressed: "underline" },
  };
  const label: Record<(typeof variants)[number], string> = { default: "主要", outline: "次要", secondary: "填充", ghost: "幽灵", destructive: "危险", link: "链接" };
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[5rem_repeat(6,minmax(0,1fr))] items-center gap-x-4 gap-y-3">
        <span />
        {["默认", "悬停", "按下", "焦点", "禁用", "加载"].map((s) => <span className="text-xs text-muted-foreground" key={s}>{s}</span>)}
        {variants.map((variant) => (
          <div className="contents" key={variant}>
            <StateLabel>{label[variant]}</StateLabel>
            <div><Button variant={variant}>保存</Button></div>
            <div><Button className={forced[variant].hover} variant={variant}>保存</Button></div>
            <div><Button className={forced[variant].pressed} variant={variant}>保存</Button></div>
            <div><Button className="ring-2 ring-ring ring-offset-2 ring-offset-background" variant={variant}>保存</Button></div>
            <div><Button disabled variant={variant}>保存</Button></div>
            <div><Button variant={variant}><Spinner />保存中</Button></div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg"><Plus />新建工作流</Button>
        <Button>运行</Button>
        <Button size="sm" variant="outline">筛选</Button>
        <Button size="xs" variant="secondary">标签</Button>
        <Button aria-label="更多" size="icon" variant="ghost"><MoreHorizontal /></Button>
        <Button aria-label="设置" size="icon" variant="outline"><Settings /></Button>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {[
          ["默认", ""], ["悬停", "border-muted-foreground/40"], ["焦点", "border-ring ring-[3px] ring-ring/15"], ["错误", "border-destructive ring-[3px] ring-destructive/15"], ["禁用", ""],
        ].map(([state, cls]) => (
          <div className="flex flex-col gap-1.5 text-control font-medium" key={state}>
            <span>{state}</span>
            <Input className={cls} defaultValue={state === "默认" ? "" : "kailo-qa-1"} disabled={state === "禁用"} placeholder="输入频道名称" />
            {state === "错误" ? <span className="text-xs text-danger-text">名称已被占用</span> : <span className="text-xs text-muted-foreground">最多 80 个字符</span>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2"><span className="flex size-4 items-center justify-center rounded-sm bg-primary text-[10px] text-primary-foreground">✓</span><span className="text-sm">已选中</span></div>
        <div className="flex items-center gap-2"><span className="size-4 rounded-sm border border-input bg-background" /><span className="text-sm">未选中</span></div>
        <div className="flex items-center gap-2"><span className="relative h-[18px] w-8 rounded-full bg-primary"><span className="absolute right-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-sm" /></span><span className="text-sm">开</span></div>
        <div className="flex items-center gap-2"><span className="relative h-[18px] w-8 rounded-full bg-input"><span className="absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-sm" /></span><span className="text-sm">关</span></div>
        <div className="flex rounded-lg bg-accent p-0.5 text-control font-medium">
          <span className="rounded-md bg-background px-3 py-1 shadow-xs">浅色</span><span className="px-3 py-1 text-muted-foreground">深色</span><span className="px-3 py-1 text-muted-foreground">系统</span>
        </div>
        <div className="flex gap-5 border-b border-border text-control font-medium">
          <span className="border-b-2 border-primary pb-2">概览</span><span className="pb-2 text-muted-foreground">运行历史</span><span className="pb-2 text-muted-foreground">设置</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>品牌</Badge><Badge variant="secondary">默认</Badge><Badge variant="outline">描边</Badge><Badge variant="destructive">失败</Badge>
        <span className="inline-flex h-5 items-center rounded-sm bg-success-soft px-1.5 text-xs font-medium text-success-text">已完成</span>
        <span className="inline-flex h-5 items-center rounded-sm bg-warning-soft px-1.5 text-xs font-medium text-warning-text">待审批</span>
        <span className="inline-flex h-5 items-center rounded-sm bg-info-soft px-1.5 text-xs font-medium text-info-text">运行中</span>
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground">12</span>
      </div>
    </div>
  );
}

function MenuPanel() {
  return (
    <div className="w-60 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
      <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">频道</div>
      {[
        [Bell, "通知设置", "⌘N", false], [Copy, "复制链接", "⌘L", true], [Users, "成员", "", false], [Workflow, "工作流", "", false],
      ].map(([Icon, text, key, active]) => {
        const I = Icon as typeof Bell;
        return (
          <div className={`flex h-[30px] items-center gap-2 rounded-md px-2 text-control ${active ? "bg-accent" : ""}`} key={String(text)}>
            <I className="size-4 text-muted-foreground" /><span className="flex-1">{String(text)}</span><span className="font-mono text-xs text-muted-foreground">{String(key)}</span>
          </div>
        );
      })}
      <div className="-mx-1 my-1 h-px bg-border" />
      <div className="flex h-[30px] items-center gap-2 rounded-md px-2 text-control text-danger-text"><Trash2 className="size-4" />离开频道</div>
    </div>
  );
}

function OverlaysSection() {
  return (
    <div className="flex flex-wrap items-start gap-8">
      <MenuPanel />
      <div className="flex flex-col gap-4">
        <span className="w-fit rounded-md bg-[var(--k-neutral-900)] px-2 py-1 text-xs text-white dark:bg-[var(--k-neutral-750)]">复制消息链接 ⌘⇧C</span>
        <div className="flex w-80 items-start gap-3 rounded-xl border border-border bg-popover p-3.5 shadow-lg">
          <Sparkles className="mt-0.5 size-4 text-success" />
          <div className="flex flex-col gap-0.5"><span className="text-control font-semibold">工作流已启用</span><span className="text-control text-muted-foreground">下次运行：明天 09:00</span></div>
        </div>
        <div className="flex w-80 items-start gap-3 rounded-xl border border-border bg-popover p-3.5 shadow-lg">
          <Bell className="mt-0.5 size-4 text-danger" />
          <div className="flex flex-col gap-0.5"><span className="text-control font-semibold">发送失败</span><span className="text-control text-muted-foreground">网络中断，已保存为草稿。</span></div>
        </div>
      </div>
      <div className="relative flex h-72 w-[30rem] items-center justify-center overflow-hidden rounded-xl" style={{ background: "rgb(10 10 16 / 0.4)" }}>
        <div className="w-96 rounded-2xl border border-border bg-popover p-5 shadow-xl">
          <h3 className="text-lg font-semibold tracking-[-0.012em]">删除工作流？</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">“每日站会纪要” 及其 42 次运行记录将被删除，此操作无法撤销。</p>
          <div className="mt-5 flex justify-end gap-2"><Button variant="outline">取消</Button><Button variant="destructive">删除</Button></div>
        </div>
      </div>
    </div>
  );
}

function DataSection() {
  const rows = [
    ["每日站会纪要", "#产品设计评审", "运行中", "info", "2 分钟前"],
    ["周报摘要", "#增长", "已完成", "success", "昨天 18:00"],
    ["客户反馈分拣", "#支持", "待审批", "warning", "星期二 10:24"],
    ["发布说明", "#发布", "失败", "danger", "10 月 20 日"],
  ];
  const tone: Record<string, string> = { info: "bg-info-soft text-info-text", success: "bg-success-soft text-success-text", warning: "bg-warning-soft text-warning-text", danger: "bg-danger-soft text-danger-text" };
  return (
    <div className="grid grid-cols-[2fr_1fr] gap-6">
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-2xs font-semibold tracking-[0.04em] text-muted-foreground uppercase"><tr className="border-b border-border"><th className="px-4 py-2.5">名称</th><th className="px-4 py-2.5">频道</th><th className="px-4 py-2.5">状态</th><th className="px-4 py-2.5 text-right">最近运行</th></tr></thead>
          <tbody>
            {rows.map(([name, channel, status, t, when], index) => (
              <tr className={`h-10 border-b border-border last:border-0 ${index === 1 ? "bg-accent/60" : ""} ${index === 2 ? "bg-brand-soft" : ""}`} key={name}>
                <td className="px-4 font-medium">{name}</td><td className="px-4 text-muted-foreground">{channel}</td>
                <td className="px-4"><span className={`inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium ${tone[t!]}`}>{status}</span></td>
                <td className="px-4 text-right tabular-nums text-muted-foreground">{when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3">
        {[["研究助理", true], ["写作助理", true], ["kailo-qa-2", false]].map(([name, agent]) => (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-shadow hover:shadow-sm" key={String(name)}>
            <span className="relative flex size-9 items-center justify-center rounded-[30%] text-sm font-semibold text-white" style={{ background: agent ? "var(--k-gradient-brand)" : "#3f8f6b" }}>
              {String(name).slice(0, 1)}
              {agent ? <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-background"><Sparkles className="size-2.5 text-brand-text" /></span> : null}
            </span>
            <div className="flex min-w-0 flex-1 flex-col"><span className="truncate text-sm font-semibold">{String(name)}</span><span className="text-xs text-muted-foreground">{agent ? "Agent · 运行中" : "成员 · 在线"}</span></div>
            <span className={`size-2 rounded-full ${agent ? "bg-info" : "bg-success"}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLoadingSection() {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-8 py-12 text-center">
        <svg aria-hidden="true" className="size-16" fill="none" viewBox="0 0 64 64">
          <rect height="40" rx="10" stroke="url(#spec-empty)" strokeWidth="2" width="44" x="10" y="12" />
          <path d="M20 26h24M20 34h16" stroke="url(#spec-empty)" strokeLinecap="round" strokeWidth="2" />
          <circle cx="48" cy="16" fill="var(--k-gradient-to)" r="4" />
          <defs><linearGradient id="spec-empty" x1="10" x2="54" y1="12" y2="52"><stop style={{ stopColor: "var(--k-gradient-from)" }} /><stop offset="1" style={{ stopColor: "var(--k-gradient-to)" }} /></linearGradient></defs>
        </svg>
        <h3 className="text-lg font-semibold tracking-[-0.012em]">还没有工作流</h3>
        <p className="max-w-xs text-sm text-muted-foreground">把频道里的重复事务交给工作流：定时、提及或 Webhook 都能触发。</p>
        <Button><Plus />新建工作流</Button>
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-border p-5">
        {[0, 1, 2].map((i) => (
          <div className="flex items-start gap-3" key={i}>
            <div className="kailo-skeleton size-9 rounded-[30%]" />
            <div className="flex flex-1 flex-col gap-2"><div className="kailo-skeleton h-3 w-32 rounded-sm" /><div className="kailo-skeleton h-3 w-full rounded-sm" /><div className="kailo-skeleton h-3 w-2/3 rounded-sm" /></div>
          </div>
        ))}
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />正在加载频道…</div>
        <div className="h-0.5 overflow-hidden rounded-full bg-accent"><div className="h-full w-2/5 rounded-full bg-primary" /></div>
      </div>
    </div>
  );
}

function ShellMock() {
  const nav: [typeof Inbox, string, boolean][] = [[Inbox, "收件箱", false], [Users, "成员", false], [Bot, "Agent", false], [Workflow, "工作流", false]];
  const channels: [typeof Hash, string, boolean, boolean][] = [[Hash, "产品设计评审", true, false], [Lock, "r14-accept-私密频道", false, true], [Hash, "多人多Agent协作验收", false, false], [FileText, "发布说明", false, false]];
  return (
    <div className="relative flex h-[640px] flex-col overflow-hidden rounded-xl border border-border" data-spec-shell>
      <div aria-hidden className="buzz-theme-gradient-underlay absolute inset-0 -z-0" />
      <div className="relative z-10 flex h-11 shrink-0 items-center gap-1 px-3" data-testid="app-top-chrome">
        <KailoMark />
        <button aria-label="侧栏" className="flex size-7 items-center justify-center" data-sidebar="trigger" type="button"><ChevronDown className="size-4 rotate-90" /></button>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col gap-3 px-2.5 pb-3" data-testid="app-sidebar">
          <button className="flex items-center gap-2 px-2.5 text-sm" data-testid="open-search" type="button"><Search className="size-4" /><span className="flex-1 text-left">搜索全部</span><span className="font-mono text-xs">⌘K</span></button>
          <ul className="flex flex-col" data-sidebar="menu">
            {nav.map(([I, text], i) => <li data-sidebar="menu-item" key={text}><button className={`flex w-full items-center ${i === 1 ? "bg-[hsl(var(--foreground)/0.055)]" : ""}`} data-active="false" data-sidebar="menu-button" type="button"><I /><span>{text}</span></button></li>)}
          </ul>
          <div>
            <div className="flex items-center" data-sidebar="group-label">频道</div>
            <ul className="flex flex-col" data-sidebar="menu">
              {channels.map(([I, text, active, unread]) => (
                <li data-sidebar="menu-item" key={text}>
                  <button className="flex w-full items-center" data-active={active} data-sidebar="menu-button" type="button">
                    <I /><span className={`flex-1 truncate text-left ${unread ? "font-semibold text-foreground" : ""}`}>{text}</span>
                    {unread ? <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground">3</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-auto flex items-center gap-2.5 px-2 py-1.5" data-testid="sidebar-profile-card">
            <span className="flex size-7 items-center justify-center rounded-[30%] bg-[#d9488f] text-xs font-semibold text-white">Q</span>
            <div className="flex flex-col leading-tight"><span className="text-control font-semibold">kailo-qa-1</span><span className="text-xs" data-buzz-sidebar-secondary>在线 · 专注中</span></div>
          </div>
        </div>
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background" data-buzz-content-surface>
          <header className="relative z-30 shrink-0" data-testid="chat-header">
            <div className="flex h-9 items-center gap-2.5">
              <div className="group/title flex min-w-0 flex-1 items-center gap-[4px]">
                <div className="flex shrink-0 items-center"><Hash className="h-4 w-4" /></div>
                <h1 className="truncate" data-testid="chat-title">产品设计评审</h1>
                <span className="ml-2 truncate text-xs text-muted-foreground">设计评审、视觉走查与发布前验收</span>
              </div>
              <Button size="sm" variant="ghost"><Users />12</Button>
              <Button aria-label="更多" size="icon" variant="ghost"><MoreHorizontal /></Button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col gap-1 overflow-hidden py-3">
                <section className="relative flex" data-testid="message-timeline-day-divider"><p>星期二</p></section>
                {[
                  ["研究助理", true, "14:30", "已整理 3 份用户访谈。关键结论：权限审批延迟是首要痛点（P0），建议在收件箱直接审批。"],
                  ["kailo-qa-1", false, "14:32", "收到，@研究助理 把结论同步到知识库，并给出两个备选方案。"],
                ].map(([name, agent, time, text], index) => (
                  <div className={`flex gap-3 px-5 py-1.5 ${index === 1 ? "bg-[hsl(var(--foreground)/0.025)]" : ""}`} key={String(name)}>
                    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-[30%] text-sm font-semibold text-white" style={{ background: agent ? "var(--k-gradient-brand)" : "#d9488f" }}>
                      {String(name).slice(0, 1)}
                      {agent ? <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-background"><Sparkles className="size-2.5 text-brand-text" /></span> : null}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-baseline gap-2"><span className="text-sm font-semibold">{String(name)}</span>{agent ? <span className="rounded-sm bg-brand-soft px-1 text-2xs font-semibold text-brand-soft-foreground">AGENT</span> : null}<span className="text-xs text-muted-foreground">{String(time)}</span></div>
                      <p className="text-sm leading-5">{index === 1 ? <>收到，<span className="rounded-sm bg-brand-soft px-0.5 font-medium text-brand-soft-foreground">@研究助理</span> 把结论同步到知识库，并给出两个备选方案。</> : String(text)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="shrink-0 px-4 pb-3">
                <form className="flex flex-col gap-2 border px-3 pb-2 pt-3" data-testid="message-composer" style={{ borderColor: "hsl(var(--ring))", boxShadow: "0 0 0 3px hsl(var(--ring) / 0.16), var(--k-shadow-xs)" }}>
                  <span className="text-sm text-muted-foreground">给 #产品设计评审 发消息</span>
                  <div className="flex items-center gap-1 text-muted-foreground"><Plus className="size-4" /><span className="flex-1" /><button className="flex size-7 items-center justify-center" data-testid="send-message" type="button"><Send className="size-4" /></button></div>
                </form>
              </footer>
            </div>
            <aside className="flex w-80 shrink-0 flex-col border-l border-border">
              <div className="flex h-[52px] items-center border-b border-border px-4 text-sm font-semibold">线程 · 研究助理</div>
              <div className="flex flex-col gap-2 p-4 text-sm text-muted-foreground"><span>2 条回复</span><div className="kailo-skeleton h-3 w-3/4 rounded-sm" /><div className="kailo-skeleton h-3 w-1/2 rounded-sm" /></div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullView({ direction, mode }: { direction: KailoBrandDirection; mode: KailoMode }) {
  const dir = KAILO_DIRECTIONS[direction];
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-10 py-12">
      <header className="relative overflow-hidden rounded-2xl p-10 text-white" style={{ background: "var(--k-gradient-brand)" }}>
        <div className="flex items-center gap-4">
          <span className="rounded-[10px] bg-white/15 p-1.5"><KailoMark size={40} /></span>
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.022em]">Kailo 视觉设计系统</h1>
            <p className="mt-1 text-sm text-white/80">DD-141 · {DIRECTION_LABEL[direction]} · {mode === "dark" ? "深色" : "浅色"} · 功能对照原版，视觉对照本系统</p>
          </div>
        </div>
      </header>
      <Section id="color" kicker="01" title="色彩">
        <Ramp name="品牌 brand（浅色）" ramp={dir.brand} />
        <Ramp name="品牌 brandDark（深色单独调校）" ramp={dir.brandDark} />
        <Ramp name="中性 neutral（紫调冷灰）" ramp={dir.neutral} />
        <div className="grid grid-cols-4 gap-4">
          {(Object.keys(KAILO_STATUS_RAMPS) as (keyof typeof KAILO_STATUS_RAMPS)[]).map((name) => {
            const ramp = KAILO_STATUS_RAMPS[name][mode];
            return <div className="flex gap-1.5" key={name}>{(["50", "300", "500", "700"] as const).map((s) => <Swatch color={ramp[s]} key={s} label={`${name} ${s}`} />)}</div>;
          })}
        </div>
        <RolesTable direction={direction} mode={mode} />
      </Section>
      <Section id="type" kicker="02" title="字体与字号层级">
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {TYPE_RAMP.map(([name, cls, spec, sample]) => (
            <div className="flex items-baseline gap-6 px-5 py-3.5" key={name}>
              <span className="w-24 shrink-0 text-xs font-semibold">{name}</span>
              <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{spec}</span>
              <span className={cls}>{sample}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-6 px-5 py-3.5"><span className="w-24 shrink-0 text-xs font-semibold">Mono</span><span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">13 · JetBrains Mono</span><code className="text-sm">workflow_id = "wf_01JB7Q" · 0O 1lI</code></div>
        </div>
      </Section>
      <Section id="controls" kicker="03" title="控件与状态"><ControlsSection /></Section>
      <Section id="overlays" kicker="04" title="菜单、提示、通知与弹窗"><OverlaysSection /></Section>
      <Section id="data" kicker="05" title="列表、表格与身份"><DataSection /></Section>
      <Section id="empty" kicker="06" title="空态、骨架屏与加载"><EmptyLoadingSection /></Section>
      <Section id="shell" kicker="07" title="布局外壳"><ShellMock /></Section>
    </div>
  );
}

export function DesignSpec({ direction, mode, view, size }: SpecParams) {
  applyDocument(direction, mode);
  // Brand-mark raster source (app icon / favicon): the mark alone on a transparent page.
  if (view === "icon") return <div className="inline-flex" data-spec-icon><KailoMark size={size} /></div>;
  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground" data-spec-root>
      {view === "directions" ? <DirectionsView /> : <FullView direction={direction} mode={mode} />}
    </div>
  );
}
