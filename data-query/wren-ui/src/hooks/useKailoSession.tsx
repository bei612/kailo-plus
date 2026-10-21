import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import ConfigProvider from 'antd/lib/config-provider';
import zhCN from 'antd/lib/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';
import { useKailoSessionQuery } from '@/apollo/client/graphql/kailo.generated';
import {
  applyTheme,
  initialLocale,
  initialTheme,
  isEmbedded,
  KailoLocale,
  KailoTheme,
  readHostMessage,
  rememberLocale,
  setHostOrigins,
  signOutNativeSession,
  tellHost,
} from '@/utils/kailoEmbed';
import { kailoProductTitle } from '@/utils/kailoI18n';

// DD-133: the Kailo user, derived role, presentation (theme/locale/embedding)
// and product naming shared by the page shell.
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

export function KailoSessionProvider({ children }) {
  const router = useRouter();
  const [embedded, setEmbedded] = useState(false);
  const [theme, setTheme] = useState<KailoTheme>('light');
  const { data, loading } = useKailoSessionQuery({
    fetchPolicy: 'cache-and-network',
  });
  const session = data?.kailoSession;
  const hostOrigins = useMemo(
    () => session?.hostOrigins || [],
    [session?.hostOrigins],
  );

  const switchLocale = (locale: KailoLocale) => {
    rememberLocale(locale);
    if (router.locale !== locale)
      router.replace(router.asPath, undefined, { locale, scroll: false });
  };

  // Initial theme and locale come from the Kailo URL parameters.
  useEffect(() => {
    const search = window.location.search;
    const nextTheme = initialTheme(search);
    applyTheme(nextTheme);
    setTheme(nextTheme);
    setEmbedded(isEmbedded());
    const locale = initialLocale(search);
    if (locale) switchLocale(locale);
  }, []);

  // Later changes arrive from the exact Kailo origin only.
  useEffect(() => {
    setHostOrigins(hostOrigins);
    if (!session) return;
    tellHost(hostOrigins, 'ready', { locale: router.locale, theme });
    const onMessage = (event: MessageEvent) => {
      const message = readHostMessage(event, hostOrigins, window.parent);
      if (!message) return;
      if (message.type === 'theme') {
        applyTheme(message.theme);
        setTheme(message.theme);
      } else if (message.type === 'locale') {
        switchLocale(message.locale);
      } else if (message.type === 'logout') {
        signOutNativeSession().then(() => tellHost(hostOrigins, 'signed-out'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [session, hostOrigins]);

  const value = useMemo<KailoSessionValue>(
    () => ({
      user: session?.user || null,
      isAdmin: session?.isAdmin === true,
      loaded: !loading && !!session,
      productName: session?.productName || '',
      embedded,
      theme,
    }),
    [session, loading, embedded, theme],
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
