import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import PageLoading from '@/components/PageLoading';
import { SettingsIcon } from '@/components/kailo/KailoIcons';
import useKailoSession from '@/hooks/useKailoSession';
import { kailoRuntime } from '@/utils/kailoEmbed';
import { KailoPageAction, setPage } from '@/utils/kailoHost';
import useKailoText from '@/utils/kailoI18n';
import {
  ADMIN_SURFACE_PARAM,
  adminSurfaceTitle,
  KailoAdminSurface as Surface,
  resolveAdminSurface,
} from '@/utils/kailoAdminSurface';

// DD-138(6) (`07` §4.8.5, `20` §13.2): a page Kailo loads into its admin
// area. It renders only the one admin function declared for its path: no
// product shell, header, tabs, navigation or links to other admin functions.
// Kailo draws "管理 › 分类 › 标题" itself; the page announces the declared
// title (setPage) once its content can show.

/** The key Kailo launched this document for (kailo-embed.js), else the URL. */
export function launchedAdminSurface(): string | null {
  const runtime = kailoRuntime();
  if (runtime && typeof runtime.adminSurface === 'function')
    return runtime.adminSurface();
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(ADMIN_SURFACE_PARAM);
}

const SurfaceContext = createContext<Surface | null>(null);

interface Props {
  path: string;
  children: ReactNode;
}

export default function KailoAdminSurface({ path, children }: Props) {
  const t = useKailoText();
  const { locale } = useRouter();
  const { loaded, isAdmin } = useKailoSession();
  // Read after mount: the server render has no runtime.
  const [launched, setLaunched] = useState<string | null | undefined>();
  useEffect(() => setLaunched(launchedAdminSurface()), []);

  const view = useMemo(
    () =>
      launched === undefined
        ? null
        : resolveAdminSurface(path, launched, { loaded, isAdmin }),
    [path, launched, loaded, isAdmin],
  );

  const unavailable = view?.state === 'unavailable';
  useEffect(() => {
    if (!unavailable) return;
    setPage({
      title: view.surface
        ? adminSurfaceTitle(view.surface, locale)
        : t('adminSurfaceUnavailable'),
      actions: [],
    });
  }, [unavailable, locale]);

  if (!view || view.state === 'pending') return <PageLoading visible />;
  if (view.state === 'unavailable')
    return (
      <div className="kailo-admin-surface">
        <KailoEmpty
          className="h-100"
          icon={SettingsIcon}
          title={t('adminSurfaceUnavailable')}
          description={t('adminSurfaceUnavailableHint')}
        />
      </div>
    );
  return (
    <SurfaceContext.Provider value={view.surface}>
      <div className="kailo-admin-surface">{children}</div>
    </SurfaceContext.Provider>
  );
}

interface AdminPageSpec {
  /** First setPage waits until the content can show (Kailo keeps its skeleton). */
  ready?: boolean;
  actions?: KailoPageAction[];
  onAction?: (id: string) => void;
}

/**
 * Announce the admin surface page to Kailo: the declared title in the current
 * locale and the surface's own actions (no tabs, no breadcrumbs). Returns the
 * surface; null outside KailoAdminSurface.
 */
export function useKailoAdminPage(spec: AdminPageSpec = {}) {
  const surface = useContext(SurfaceContext);
  const { locale } = useRouter();
  const latest = useRef(spec);
  latest.current = spec;
  const ready = spec.ready !== false;
  const actions = JSON.stringify(spec.actions || []);

  useEffect(() => {
    if (!surface || !ready) return;
    setPage({
      title: adminSurfaceTitle(surface, locale),
      actions: (spec.actions || []).slice(0, 8),
    });
  }, [surface, ready, locale, actions]);

  useEffect(() => {
    const runtime = kailoRuntime();
    if (!runtime || !surface) return;
    return runtime.onAction((id) => latest.current.onAction?.(id));
  }, [surface]);

  return surface;
}
