import { AppProps } from 'next/app';
import Head from 'next/head';
import { Spin } from 'antd';
import apolloClient from '@/apollo/client';
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig';
import { KailoSessionProvider } from '@/hooks/useKailoSession';
import { ApolloProvider } from '@apollo/client';
import { defaultIndicator } from '@/components/PageLoading';

require('../styles/index.less');

Spin.setDefaultIndicator(defaultIndicator);

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        {/* DD-133 §1: Kailo's own icon, copied from the web-client build. */}
        <link rel="icon" type="image/png" href="/kailo/app-icon.png" />
      </Head>
      <GlobalConfigProvider>
        <ApolloProvider client={apolloClient}>
          <KailoSessionProvider>
            <main className="app">
              <Component {...pageProps} />
            </main>
          </KailoSessionProvider>
        </ApolloProvider>
      </GlobalConfigProvider>
    </>
  );
}

export default App;
