// DD-133 §2/§4 (`07` §4.7.2): bridge between this page and the Kailo
// presentation runtime `client-kit/embed/kailo-embed.js`, which the page
// loads in <head> (copied into public/kailo at image build). The runtime owns
// the wire protocol v1 (launch parameters, `ready`, `auth-required`, the
// host's `presentation` messages from the exact `kailo-web-origin`); this
// module only adapts it to Next/antd and adds the native session renewal.
import type {
  KailoEmbedRuntime,
  KailoLocale,
  KailoPresentationState,
  KailoTheme,
} from '../../../../client-kit/embed/kailo-embed';

export type { KailoLocale, KailoTheme };

const AUTH_OK_PATH = '/kailo-embed/auth-ok';

export function kailoRuntime(): KailoEmbedRuntime | null {
  return typeof window === 'undefined' ? null : window.KailoEmbed || null;
}

// Without the runtime (unit tests, a failed script load) the page renders in
// the light Chinese default at top level.
export function presentation(): KailoPresentationState {
  return (
    kailoRuntime()?.getState() || {
      theme: 'light',
      locale: 'zh-CN',
      embedded: false,
      hostConnected: false,
    }
  );
}

// The Next locale the page must switch to, or null when it already shows the
// Kailo one. Checked after every navigation, not once at mount: the page's own
// first redirect (index -> /home) aborts an earlier locale replace and keeps
// the default locale (V-SCN-201 production acceptance).
export function pendingLocale(
  routerLocale: string | undefined,
  ready: boolean,
): KailoLocale | null {
  if (!ready) return null;
  const wanted = presentation().locale;
  return routerLocale === wanted ? null : wanted;
}

let renewal: Promise<boolean> | null = null;

// Silent renewal of the native Gateway session through the existing IdP
// session in a hidden same-origin frame. The IdP login page refuses framing,
// so a missing IdP session ends on a cross-origin (unreadable) document or a
// callback error and is reported as `false`; no login form is ever shown.
export function renewNativeSession(timeoutMs = 15000): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (renewal) return renewal;
  renewal = new Promise<boolean>((resolve) => {
    const frame = document.createElement('iframe');
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      frame.remove();
      renewal = null;
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.addEventListener('load', () => {
      let path: string | null = null;
      try {
        path = frame.contentWindow?.location.pathname ?? null;
      } catch {
        path = null;
      }
      finish(path === AUTH_OK_PATH);
    });
    frame.src = `/auth/login?returnTo=${encodeURIComponent(AUTH_OK_PATH)}`;
    document.body.appendChild(frame);
  });
  return renewal;
}

// The IdP needs interaction: inside Kailo ask the host (`auth-required`); the
// host shows its re-login state and signs in at top level on the user's click.
// At top level the IdP sign-in is the Kailo sign-in.
export function requireSignIn() {
  if (presentation().embedded) {
    kailoRuntime()?.requestTopLevelSignIn();
    return;
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(
    `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

// Apollo/REST fetch: one silent renewal and retry on a Gateway 401.
export async function kailoFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401 || typeof window === 'undefined') return response;
  if (await renewNativeSession()) return fetch(input, init);
  requireSignIn();
  return response;
}
