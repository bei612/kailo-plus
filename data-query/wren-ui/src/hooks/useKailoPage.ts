import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import * as events from '@/utils/events';
import { kailoRuntime } from '@/utils/kailoEmbed';
import { kailoText, KailoTextKey } from '@/utils/kailoI18n';
import {
  KailoPage,
  KailoPageAction,
  KailoPageItem,
  setPage,
} from '@/utils/kailoHost';
import useKailoSession from '@/hooks/useKailoSession';

// DD-157 (`07` §4.8.7, `20` §13.2): the page header Kailo renders for 问数.
// Tabs replace the component's own top navigation (问答 / 建模 / 知识 / API);
// each page supplies its title, ancestors and actions. Admin-only entries
// (建模, 数据源设置) are offered to Kailo Tenant administrators only — the
// server enforces the same rule on every write.

export type KailoTabId = 'home' | 'modeling' | 'knowledge' | 'api';

interface TabDef {
  id: KailoTabId;
  label: KailoTextKey;
  path: Path;
  prefix: Path;
  adminOnly?: boolean;
}

export const KAILO_TABS: TabDef[] = [
  { id: 'home', label: 'navHome', path: Path.Home, prefix: Path.Home },
  {
    id: 'modeling',
    label: 'navModeling',
    path: Path.Modeling,
    prefix: Path.Modeling,
    adminOnly: true,
  },
  {
    id: 'knowledge',
    label: 'navKnowledge',
    path: Path.KnowledgeQuestionSQLPairs,
    prefix: Path.Knowledge,
  },
  {
    id: 'api',
    label: 'navApi',
    path: Path.APIManagementHistory,
    prefix: Path.APIManagement,
  },
];

export const SETTINGS_ACTION = 'kailo:data-source-settings';

/** Tabs the user may see on this pathname (none during onboarding). */
export function pageTabs(
  locale: string | undefined,
  pathname: string,
  isAdmin: boolean,
): { tabs: KailoPageItem[]; activeTab?: KailoTabId } {
  if (pathname.startsWith(Path.Onboarding)) return { tabs: [] };
  const visible = KAILO_TABS.filter((tab) => !tab.adminOnly || isAdmin);
  return {
    tabs: visible.map((tab) => ({
      id: tab.id,
      label: kailoText(locale, tab.label),
    })),
    activeTab: visible.find((tab) => pathname.startsWith(tab.prefix))?.id,
  };
}

export interface KailoPageSpec {
  title: string;
  breadcrumbs?: KailoPageItem[];
  actions?: KailoPageAction[];
  /** First setPage waits until the content can show (Kailo keeps its skeleton). */
  ready?: boolean;
  onAction?: (id: string) => void;
  onBreadcrumb?: (id: string) => void;
}

/**
 * Publish this page's header to Kailo on every change of route or context.
 * Returns `hosted: true` when Kailo renders the header — the page then
 * renders no title, tabs or header buttons of its own.
 */
export default function useKailoPage(spec: KailoPageSpec) {
  const router = useRouter();
  const pathname = router.pathname || '';
  const { isAdmin, loaded, hostPage } = useKailoSession();
  const latest = useRef(spec);
  latest.current = spec;

  const page = useMemo<KailoPage>(() => {
    const { tabs, activeTab } = pageTabs(
      router.locale,
      pathname,
      loaded && isAdmin,
    );
    const actions = [...(spec.actions || [])];
    if (loaded && isAdmin && !pathname.startsWith(Path.Onboarding)) {
      actions.push({
        id: SETTINGS_ACTION,
        label: kailoText(router.locale, 'dataSourceSettings'),
        variant: 'menu',
        icon: 'settings',
      });
    }
    return {
      title: (spec.title || '').trim().slice(0, 120) || '—',
      breadcrumbs: (spec.breadcrumbs || []).slice(0, 8),
      tabs,
      ...(activeTab ? { activeTab } : {}),
      actions: actions.slice(0, 8),
    };
  }, [
    router.locale,
    pathname,
    loaded,
    isAdmin,
    spec.title,
    JSON.stringify(spec.breadcrumbs || []),
    JSON.stringify(spec.actions || []),
  ]);

  const ready = spec.ready !== false;
  useEffect(() => {
    if (ready) setPage(page);
  }, [ready, page]);

  useEffect(() => {
    const runtime = kailoRuntime();
    if (!runtime) return;
    const stopNavigate = runtime.onNavigate((target) => {
      if (target.kind === 'tab') {
        const tab = KAILO_TABS.find((item) => item.id === target.id);
        // The active tab too: back to the section's first page.
        if (tab) router.push(tab.path);
        return;
      }
      latest.current.onBreadcrumb?.(target.id);
    });
    const stopAction = runtime.onAction((id) => {
      if (id === SETTINGS_ACTION) {
        events.dispatch(events.EVENT_NAME.OPEN_SETTINGS);
        return;
      }
      latest.current.onAction?.(id);
    });
    return () => {
      stopNavigate();
      stopAction();
    };
  }, [pathname]);

  return { hosted: hostPage };
}
