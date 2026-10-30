import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { Path } from '@/utils/enum';
import { kailoRuntime } from '@/utils/kailoEmbed';
import { kailoText, KailoTextKey } from '@/utils/kailoI18n';
import {
  KailoPage,
  KailoPageAction,
  KailoPageItem,
  setPage,
} from '@/utils/kailoHost';
import useKailoSession from '@/hooks/useKailoSession';

// DD-157 (`07` §4.8.7, `20` §13.2): the page header Kailo renders for 数据建模.
// DD-167 (`20` §15.1): the tabs are 问答 · 看板 · 知识 · API and replace
// the component's own navigation (the dashboard is no longer a pane row);
// each page supplies its title, ancestors and actions. DD-138(6) (`07`
// §4.8.5): business pages carry no admin entries — modeling, the data source
// connection and the project settings are Kailo admin surfaces
// (components/kailo/KailoAdminSurface), which have no tabs. DD-138(7): the
// API call history is administration data — its tab is the administrators'
// only (the server refuses the history to everyone else).

export type KailoTabId = 'home' | 'dashboard' | 'knowledge' | 'api';

interface TabDef {
  id: KailoTabId;
  label: KailoTextKey;
  path: Path;
  matches: (pathname: string) => boolean;
  adminOnly?: boolean;
}

export const KAILO_TABS: TabDef[] = [
  {
    id: 'home',
    label: 'navHome',
    path: Path.Home,
    matches: (pathname) =>
      pathname.startsWith(Path.Home) && pathname !== Path.HomeDashboard,
  },
  {
    id: 'dashboard',
    label: 'dashboard',
    path: Path.HomeDashboard,
    matches: (pathname) => pathname === Path.HomeDashboard,
  },
  {
    id: 'knowledge',
    label: 'navKnowledge',
    path: Path.KnowledgeQuestionSQLPairs,
    matches: (pathname) => pathname.startsWith(Path.Knowledge),
  },
  {
    id: 'api',
    label: 'navApi',
    path: Path.APIManagementHistory,
    matches: (pathname) => pathname.startsWith(Path.APIManagement),
    adminOnly: true,
  },
];

/** The business tabs this user may see (API history: administrators). */
export function pageTabs(
  locale: string | undefined,
  pathname: string,
  isAdmin: boolean,
): { tabs: KailoPageItem[]; activeTab?: KailoTabId } {
  const visible = KAILO_TABS.filter((tab) => !tab.adminOnly || isAdmin);
  return {
    tabs: visible.map((tab) => ({
      id: tab.id,
      label: kailoText(locale, tab.label),
    })),
    activeTab: visible.find((tab) => tab.matches(pathname))?.id,
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
  const { hostPage, isAdmin, loaded } = useKailoSession();
  const latest = useRef(spec);
  latest.current = spec;

  const page = useMemo<KailoPage>(() => {
    const { tabs, activeTab } = pageTabs(
      router.locale,
      pathname,
      loaded && isAdmin,
    );
    return {
      title: (spec.title || '').trim().slice(0, 120) || '—',
      breadcrumbs: (spec.breadcrumbs || []).slice(0, 8),
      tabs,
      ...(activeTab ? { activeTab } : {}),
      actions: (spec.actions || []).slice(0, 8),
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
    const stopAction = runtime.onAction((id) => latest.current.onAction?.(id));
    return () => {
      stopNavigate();
      stopAction();
    };
  }, [pathname]);

  return { hosted: hostPage };
}
