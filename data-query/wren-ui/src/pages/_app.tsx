import NextApp, { AppContext, AppProps } from 'next/app';
import { Spin } from 'antd';
import apolloClient from '@/apollo/client';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { KailoSessionProvider } from '@/hooks/useKailoSession';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';

// DD-133: the Kailo font is part of this build (the same package and version
// as web-client), never loaded from Kailo at run time.
import '@fontsource-variable/inter/wght.css';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

type Props = AppProps & { kailoDisplayName?: string };

function App({ Component, pageProps, kailoDisplayName }: Props) {
  return (
    <>
      <GlobalConfigProvider>
        <ApolloProvider client={apolloClient}>
          <KailoSessionProvider displayName={kailoDisplayName}>
            <main className="app">
              <Component {...pageProps} />
            </main>
          </KailoSessionProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </>
  );
}

// DD-133: the page head carries deployment facts (Kailo web origin, product
// name), so pages render per request instead of at image build time.
App.getInitialProps = async (context: AppContext) => {
  const props = await NextApp.getInitialProps(context);
  return typeof window === 'undefined'
    ? { ...props, kailoDisplayName: process.env.PLATFORM_DISPLAY_NAME?.trim() }
    : props;
};

export default App;
