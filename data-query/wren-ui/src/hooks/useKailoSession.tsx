import { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  presentation,
} from '@/utils/kailoEmbed';
import { kailoProductTitle } from '@/utils/kailoI18n';

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
  // false until the session query answered; role-gated UI stays hidden.
  loaded: boolean;
  productName: string;
  embedded: boolean;
  theme: KailoTheme;
}

const KailoSessionContext = createContext<KailoSessionValue>({
  user: null,
  isAdmin: false,
  loaded: false,
  productName: '',
  embedded: false,
  theme: 'light',
});

interface Props {
  children: React.ReactNode;
  // Server-rendered PLATFORM_DISPLAY_NAME (first paint); the session query
  // supplies the same value afterwards.
  displayName?: string;
}

export function KailoSessionProvider({ children, displayName }: Props) {
  const router = useRouter();
  const [embedded, setEmbedded] = useState(false);
  const [theme, setTheme] = useState<KailoTheme>('light');
  const [serverName] = useState(displayName || '');
  const { data, loading } = useKailoSessionQuery({
    fetchPolicy: 'cache-and-network',
  });
  const session = data?.kailoSession;

  const followLocale = (locale: KailoLocale) => {
    if (router.locale !== locale)
      router.replace(router.asPath, undefined, { locale, scroll: false });
  };

  // Theme and locale follow Kailo through the runtime; the page offers no
  // switch of its own.
  useEffect(() => {
    const state = presentation();
    setEmbedded(state.embedded);
    setTheme(state.theme);
    followLocale(state.locale);
    const runtime = kailoRuntime();
    if (!runtime) return;
    const stopTheme = runtime.onThemeChange(setTheme);
    const stopLocale = runtime.onLocaleChange(followLocale);
    return () => {
      stopTheme();
      stopLocale();
    };
  }, []);

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
      loaded: !loading && !!session,
      productName: session?.productName || serverName,
      embedded,
      theme,
    }),
    [session, loading, embedded, theme, serverName],
  );

  return (
    <KailoSessionContext.Provider value={value}>
      <Head>
        <title>{kailoProductTitle(router.locale, value.productName)}</title>
      </Head>
      <ConfigProvider locale={router.locale === 'en' ? enUS : zhCN}>
        {children}
      </ConfigProvider>
    </KailoSessionContext.Provider>
  );
}

export default function useKailoSession() {
  return useContext(KailoSessionContext);
}
