import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import ConfigProvider from 'antd/lib/config-provider';
import zhCN from 'antd/lib/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';
import { useKailoSessionQuery } from '@/apollo/client/graphql/kailo.generated';
import {
  kailoRuntime,
  KailoLocale,
  KailoTheme,
  pendingLocale,
  presentation,
} from '@/utils/kailoEmbed';
import { kailoProductTitle, kailoText } from '@/utils/kailoI18n';
import KailoEmpty from '@/components/kailo/KailoEmpty';
import { hostRendersPage } from '@/utils/kailoHost';
import {
  LIST_DENSITY_KEY,
  ListDensity,
  listDensityOf,
} from '@/utils/kailoList';

// DD-133: the Kailo user, derived role, presentation (theme/locale/embedding,
// from kailo-embed.js) and product naming shared by the page shell.
export interface KailoSessionValue {
  user: {
    name?: string | null;
    username?: string | null;
    email?: string | null;
    picture?: string | null;
  } | null;
  isAdmin: boolean;
  // DD-138(4): Kailo inbox delivery is configured ("share with member").
  shareAvailable: boolean;
  // false until the session query answered; role-gated UI stays hidden.
  loaded: boolean;
  productName: string;
  embedded: boolean;
  // DD-157: Kailo renders the page header (title, tabs, actions); the page
  // renders none of its own.
  hostPage: boolean;
  theme: KailoTheme;
  // DD-167 (`07` §4.8.10): Kailo's text size and zoom. Text follows
  // --kailo-text-* and the root zoom follows --kailo-zoom by CSS alone;
  // these values re-render what is drawn outside CSS (charts).
  typeScale: number;
  zoom: number;
  // DD-167 (`20` §15.3): Kailo appearance preference, rows 40 / 32.
  listDensity: ListDensity;
  // Changes with any presentation input a drawing depends on (theme, locale,
  // text size, zoom): charts rebuild their theme from the tokens on it.
  presentationKey: string;
}

const KailoSessionContext = createContext<KailoSessionValue>({
  user: null,
  isAdmin: false,
  shareAvailable: false,
  loaded: false,
  productName: '',
  embedded: false,
  hostPage: false,
  theme: 'light',
  typeScale: 1,
  zoom: 1,
  listDensity: 'comfortable',
  presentationKey: 'light|zh-CN|1|1',
});

const scaleOf = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;

interface Props {
  children: React.ReactNode;
  // Server-rendered PLATFORM_DISPLAY_NAME (first paint); the session query
  // supplies the same value afterwards.
  displayName?: string;
}

export function KailoSessionProvider({ children, displayName }: Props) {
  const router = useRouter();
  const [embedded, setEmbedded] = useState(false);
  const [hostPage, setHostPage] = useState(false);
  const [theme, setTheme] = useState<KailoTheme>('light');
  const [typeScale, setTypeScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [listDensity, setListDensity] = useState<ListDensity>('comfortable');
  // The latest router: listeners registered once must not replace an old path.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [serverName] = useState(displayName || '');
  const { data, loading } = useKailoSessionQuery({
    fetchPolicy: 'cache-and-network',
  });
  const session = data?.kailoSession;

  // DD-167 (`20` §15.2): a locale change keeps the page, its data and any
  // text being typed — only the Next locale (strings, formats) changes.
  const followLocale = (locale: KailoLocale) => {
    const current = routerRef.current;
    if (current.locale !== locale)
      current.replace(current.asPath, undefined, { locale, scroll: false });
  };

  // Theme, locale, text size and zoom follow Kailo through the runtime; the
  // page offers no switch of its own.
  useEffect(() => {
    const state = presentation();
    setEmbedded(state.embedded);
    setHostPage(hostRendersPage());
    setTheme(state.theme);
    setTypeScale(scaleOf(state.typeScale));
    setZoom(scaleOf(state.zoom));
    const runtime = kailoRuntime();
    if (!runtime) return;
    const stopChange = runtime.onChange((next, changed) => {
      if (changed.theme) setTheme(next.theme);
      if (changed.locale) followLocale(next.locale);
      if (changed.fontSize || changed.zoom) {
        setTypeScale(scaleOf(next.typeScale));
        setZoom(scaleOf(next.zoom));
      }
    });
    const readDensity = () =>
      setListDensity(
        listDensityOf(runtime.getPreferences?.()?.[LIST_DENSITY_KEY]),
      );
    readDensity();
    const stopPreferences = runtime.onPreferencesChange?.(readDensity);
    // The host's feature announcement arrives with its first presentation.
    const onPresentation = () => setHostPage(hostRendersPage());
    window.addEventListener('kailo:presentation', onPresentation);
    return () => {
      stopChange();
      stopPreferences?.();
      window.removeEventListener('kailo:presentation', onPresentation);
    };
  }, []);

  // Row height for every list and table (20 §15.3), read by controls.less.
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-kailo-list-density',
      listDensity,
    );
  }, [listDensity]);

  // Next's locale is re-checked after every navigation (see pendingLocale).
  useEffect(() => {
    const locale = pendingLocale(router.locale, router.isReady);
    if (locale) followLocale(locale);
  }, [router.isReady, router.locale, router.asPath]);

  // Top-level visits only: the OIDC `locale` claim seeds the language when
  // Kailo has not supplied one (the runtime ignores it otherwise).
  useEffect(() => {
    const locale = session?.identityLocale;
    if (locale && !presentation().embedded)
      kailoRuntime()?.useIdentityLocale(locale);
  }, [session?.identityLocale]);

  const value = useMemo<KailoSessionValue>(
    () => ({
      user: session?.user || null,
      isAdmin: session?.isAdmin === true,
      shareAvailable: session?.shareAvailable === true,
      loaded: !loading && !!session,
      productName: session?.productName || serverName,
      embedded,
      hostPage,
      theme,
      typeScale,
      zoom,
      listDensity,
      presentationKey: `${theme}|${router.locale}|${typeScale}|${zoom}`,
    }),
    [
      session,
      loading,
      embedded,
      hostPage,
      theme,
      serverName,
      typeScale,
      zoom,
      listDensity,
      router.locale,
    ],
  );

  return (
    <KailoSessionContext.Provider value={value}>
      <Head>
        <title>{kailoProductTitle(router.locale, value.productName)}</title>
      </Head>
      <ConfigProvider
        locale={router.locale === 'en' ? enUS : zhCN}
        // Kailo buttons keep their label as written ("取消", not "取 消").
        autoInsertSpaceInButton={false}
        renderEmpty={() => (
          // DD-157 (20 §13 空态): no antd illustration. Lists and tables
          // inside a page show a quiet line; page-level empty states use
          // KailoEmpty with an illustration and action themselves.
          <KailoEmpty
            className="kailo-empty--compact"
            title={kailoText(router.locale, 'noData')}
          />
        )}
      >
        {children}
      </ConfigProvider>
    </KailoSessionContext.Provider>
  );
}

export default function useKailoSession() {
  return useContext(KailoSessionContext);
}
