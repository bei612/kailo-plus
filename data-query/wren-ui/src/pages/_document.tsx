/* eslint-disable react/display-name */
import Document, {
  Html,
  Head,
  Main,
  NextScript,
  DocumentContext,
  DocumentInitialProps,
} from 'next/document';
import { ServerStyleSheet } from 'styled-components';
import { kailoWebOrigins } from '@/utils/kailoOrigins';

type Props = DocumentInitialProps & { kailoWebOrigin: string };

export default class AppDocument extends Document<Props> {
  static async getInitialProps(ctx: DocumentContext): Promise<Props> {
    const originalRenderPage = ctx.renderPage;

    const sheet = new ServerStyleSheet();

    ctx.renderPage = () =>
      originalRenderPage({
        enhanceApp: (App) => (props) => sheet.collectStyles(<App {...props} />),
        enhanceComponent: (Component) => Component,
      });

    const intialProps = await Document.getInitialProps(ctx);
    const styles = sheet.getStyleElement();

    // Rendered per request (App.getInitialProps), so this is the running
    // deployment's value, never a build-time copy.
    const kailoWebOrigin = kailoWebOrigins(
      process.env.KAILO_FRAME_ANCESTORS,
    ).join(' ');
    return { ...intialProps, styles, kailoWebOrigin };
  }

  render() {
    return (
      <Html lang={this.props.locale === 'en' ? 'en' : 'zh-CN'}>
        <Head>
          {/* DD-133 (`07` §4.7.1): Kailo origin, icon, tokens and runtime,
              all served from this origin and ahead of the page's own styles
              and scripts; the runtime applies the Kailo theme before paint. */}
          <meta name="kailo-web-origin" content={this.props.kailoWebOrigin} />
          {/* DD-157 (`07` §4.8.7): Kailo renders the page header, toasts and
              confirmations and owns the global shortcuts; read by
              kailo-embed.js, so it precedes the runtime script. */}
          <meta
            name="kailo-embed-features"
            content="page toast confirm shortcuts"
          />
          <link rel="icon" type="image/png" href="/kailo/app-icon.png" />
          {/* eslint-disable-next-line @next/next/no-css-tags */}
          <link rel="stylesheet" href="/kailo/kailo-theme-tokens.css" />
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="/kailo/kailo-embed.js" />
          {this.props.styles}
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
