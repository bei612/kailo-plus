import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import {
  type PlatformLocale,
  type PlatformMessageKey,
  translate,
} from "../i18n";

/** The platform menu order, shared by both React hosts. */
export const platformNavigationSections = [
  "members",
  "agents",
  "workflows",
  "tasks",
  "approvals",
  "audit",
  "devices",
] as const;

export type PlatformNavigationSection =
  (typeof platformNavigationSections)[number];

const sectionLabel: Record<PlatformNavigationSection, PlatformMessageKey> = {
  members: "platform.tab.members",
  agents: "platform.tab.agents",
  workflows: "platform.tab.workflows",
  tasks: "platform.tab.tasks",
  approvals: "platform.tab.approvals",
  audit: "platform.tab.audit",
  devices: "platform.tab.devices",
};

// The existing Desktop menu-button presentation, shared with the browser.
// Desktop still supplies its context-aware button to retain collapsed tooltips.
const menuButtonClass =
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding,background-color,box-shadow] duration-100 ease-out motion-reduce:transition-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-active data-[active=true]:font-normal data-[active=true]:text-sidebar-active-foreground data-[active=true]:shadow-xs data-[active=true]:hover:bg-sidebar-active data-[active=true]:hover:text-sidebar-active-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 h-8";

type NavigationButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive: boolean;
  tooltip: string;
};

function NavigationButton({
  isActive,
  tooltip,
  ...props
}: NavigationButtonProps) {
  return (
    <button
      aria-pressed={isActive}
      data-sidebar="menu-button"
      data-size="default"
      data-active={isActive}
      title={tooltip}
      {...props}
    />
  );
}

/** Released platform destinations; host-native rows remain with the host. */
export function PlatformNavigation({
  locale,
  selectedSection,
  onSelectSection,
  icons,
  firstRow,
  ButtonComponent = NavigationButton,
}: {
  locale: PlatformLocale;
  selectedSection: PlatformNavigationSection | null;
  onSelectSection: (section: PlatformNavigationSection) => void;
  icons: Record<PlatformNavigationSection, ReactNode>;
  firstRow?: ReactNode;
  /** Desktop supplies its existing SidebarMenuButton, including its tooltip context. */
  ButtonComponent?: ComponentType<NavigationButtonProps>;
}) {
  return (
    <ul
      className="flex w-full min-w-0 flex-col gap-1 sidebar-primary-menu pb-2"
      data-sidebar="menu"
    >
      {firstRow}
      {platformNavigationSections.map((section) => {
        const label = translate(locale, sectionLabel[section]);
        return (
          <li
            className="group/menu-item relative"
            data-sidebar="menu-item"
            key={section}
          >
            <ButtonComponent
              className={menuButtonClass}
              data-testid={`sidebar-platform-${section}`}
              isActive={selectedSection === section}
              onClick={() => onSelectSection(section)}
              tooltip={label}
              type="button"
            >
              {icons[section]}
              <span
                className="grid min-w-0 overflow-hidden"
                data-sidebar="menu-label"
              >
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 truncate font-semibold"
                >
                  {label}
                </span>
                <span className="col-start-1 row-start-1 truncate">
                  {label}
                </span>
              </span>
            </ButtonComponent>
          </li>
        );
      })}
    </ul>
  );
}
