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

const themeBootstrap = `(function(){try{var t=new URLSearchParams(location.search).get('kailo_theme');t=t?t.toLowerCase():null;var d=t==='dark'||t==='buzz-dark'?'dark':t==='light'||t==='buzz'?'light':null;if(d){sessionStorage.setItem('kailo.theme',d)}else{d=sessionStorage.getItem('kailo.theme')==='dark'?'dark':'light'}var r=document.documentElement;r.classList.add(d);r.setAttribute('data-kailo-theme',d);r.style.colorScheme=d}catch(e){}})();`;

export default class AppDocument extends Document {
  static async getInitialProps(
    ctx: DocumentContext,
  ): Promise<DocumentInitialProps> {
    const originalRenderPage = ctx.renderPage;

    const sheet = new ServerStyleSheet();

    ctx.renderPage = () =>
      originalRenderPage({
        enhanceApp: (App) => (props) => sheet.collectStyles(<App {...props} />),
        enhanceComponent: (Component) => Component,
      });

    const intialProps = await Document.getInitialProps(ctx);
    const styles = sheet.getStyleElement();

    return { ...intialProps, styles };
  }

  render() {
    return (
      <Html lang={this.props.locale === 'en' ? 'en' : 'zh-CN'}>
        <Head>
          {/* DD-133 §4: apply the Kailo theme before first paint (same rule
              as utils/kailoEmbed: URL kailo_theme, then this tab's last). */}
          <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
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
