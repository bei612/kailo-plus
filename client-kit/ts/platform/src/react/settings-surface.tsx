// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/settings/ui/{SettingsView,SettingsSectionHeader}.tsx
// desktop/src/shared/ui/{PageHeader,sidebar-menu-label}.tsx
import type { ReactNode } from "react";
import { ArrowLeft, BellRing, Keyboard, MonitorCog, UserRound, Ticket, LoaderCircle } from "lucide-react";
import { translate, type PlatformLocale } from "../i18n";
import { BffError } from "../transport";
import type { Loaded } from "./use-load";
import { ReadFailure } from "./ui";
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem } from "./sidebar/primitives";

export type SettingsSection = "profile" | "appearance" | "notifications" | "shortcuts" | "community-members";
export const settingsSectionKeys = {
  profile: "platform.settings.profile", appearance: "platform.settings.appearance",
  notifications: "platform.settings.notifications", shortcuts: "platform.settings.shortcuts",
  "community-members": "invitations.title",
} as const;
const icons = { profile: UserRound, appearance: MonitorCog, notifications: BellRing, shortcuts: Keyboard, "community-members": Ticket };

export function SettingsBackButton({ locale, onClose, sidebarState = "expanded", isMobile = false }: {
  locale: PlatformLocale; onClose: () => void;
  sidebarState?: "expanded" | "collapsed"; isMobile?: boolean;
}) {
  const label = translate(locale, "platform.settings.back");
  return <SidebarMenu><SidebarMenuItem>
    <SidebarMenuButton data-testid="settings-back-to-app" onClick={onClose}
      tooltip={label} sidebarState={sidebarState} isMobile={isMobile} type="button">
      <ArrowLeft className="h-4 w-4" /><span>{label}</span>
    </SidebarMenuButton>
  </SidebarMenuItem></SidebarMenu>;
}

export function SettingsNavigation({ locale, section, onSelect, icons: suppliedIcons, sidebarState = "expanded", isMobile = false, invitationAccess, onRetryInvitations }: {
  locale: PlatformLocale; section: SettingsSection; onSelect: (section: SettingsSection) => void;
  icons?: Partial<Record<SettingsSection, ReactNode>>;
  sidebarState?: "expanded" | "collapsed"; isMobile?: boolean;
  invitationAccess?:Loaded<boolean>;
  onRetryInvitations?:()=>void;
}) {
  const groups:Array<{label:string;sections:SettingsSection[]}>= [{label:translate(locale,"platform.settings.personal"),sections:["profile","appearance","notifications","shortcuts"]}];
  if(invitationAccess?.status==="ok")groups.push({label:translate(locale,"platform.settings.communities"),sections:["community-members"]});
  return <>
    {invitationAccess?.status==="pending"?<div className="mx-3 flex items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-xs text-sidebar-foreground/70" data-testid="community-access-loading"><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>{translate(locale,"platform.loading")}</div>:null}
    {invitationAccess?.status==="error"&&onRetryInvitations&&!(invitationAccess.error instanceof BffError&&invitationAccess.error.status===403)?<div className="mx-3" data-testid="community-access-error"><ReadFailure error={invitationAccess.error} onRetry={onRetryInvitations}/></div>:null}
    {groups.map(({label:group,sections})=><SidebarGroup key={group}>
    <SidebarGroupLabel>{group}</SidebarGroupLabel>
    <SidebarGroupContent><SidebarMenu aria-label={translate(locale, "platform.settings.sections", { group })}>
      {sections.map((value) => {
        const Icon = icons[value];
        const label = translate(locale, settingsSectionKeys[value]);
        return <SidebarMenuItem key={value}><SidebarMenuButton aria-pressed={section === value}
          data-testid={`settings-nav-${value}`} isActive={section === value} onClick={() => onSelect(value)} type="button"
          tooltip={label} sidebarState={sidebarState} isMobile={isMobile}>
          {suppliedIcons?.[value] ?? <Icon className={`h-4 w-4 shrink-0 transition-colors ${section === value ? "text-sidebar-active-foreground" : "text-sidebar-foreground/70"}`} />}
          <span className="grid min-w-0 overflow-hidden" data-sidebar="menu-label">
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 truncate font-semibold">{label}</span>
            <span className="col-start-1 row-start-1 truncate">{label}</span>
          </span>
        </SidebarMenuButton></SidebarMenuItem>;
      })}
    </SidebarMenu></SidebarGroupContent>
  </SidebarGroup>)}
  </>;
}

export function SettingsContentSurface({ section, children }: { section: SettingsSection; children: ReactNode }) {
  return <div className="relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge"
    data-buzz-content-surface data-testid="settings-content-surface">
    <section className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 sm:px-6" data-testid="settings-content-scroll">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4" data-testid={`settings-panel-${section}`}>{children}</div>
    </section>
  </div>;
}

export function SettingsSectionHeader({ action, description, title }: {
  action?: ReactNode; description: ReactNode; title: ReactNode;
}) {
  const copy = <><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="text-base font-normal text-muted-foreground"><span data-settings-subcopy className="text-muted-foreground/70">{description}</span></p></>;
  return action ? <div className="flex min-w-0 items-start justify-between gap-4 mb-12">
    <div className="min-w-0 space-y-1">{copy}</div><div className="shrink-0">{action}</div>
  </div> : <div className="min-w-0 space-y-1 mb-12">{copy}</div>;
}
