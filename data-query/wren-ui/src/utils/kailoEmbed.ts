// DD-133 §2/§4: presentation and session bridge between this native page and
// the Kailo host that embeds it.
//
// - Theme and locale follow Kailo: initial values come from the URL
//   (`kailo_theme`, `kailo_locale`), later changes from postMessage sent by an
//   exact Kailo origin (KAILO_FRAME_ANCESTORS, delivered by `kailoSession`).
//   The page offers no theme or language switch of its own.
// - Session: an expired gateway session is renewed silently in a hidden
//   same-origin frame through the existing IdP session; when the IdP session
//   is gone the host is told (`auth-required`) and Kailo signs in at top level.
//
// This module is the single place that speaks the host protocol. When the
// platform's kailo-embed.js is delivered, only this file adapts to it.

export type KailoTheme = 'light' | 'dark';
export type KailoLocale = 'zh-CN' | 'en';

export const PAGE_MESSAGE_SOURCE = 'kailo-native-page';
export const HOST_MESSAGE_SOURCE = 'kailo-host';
export const COMPONENT = 'data-query';
const AUTH_OK_PATH = '/kailo-embed/auth-ok';
const STORAGE = { theme: 'kailo.theme', locale: 'kailo.locale' };

export function parseTheme(value: unknown): KailoTheme | null {
  if (typeof value !== 'string') return null;
  const theme = value.trim().toLowerCase();
  if (['dark', 'buzz-dark'].includes(theme)) return 'dark';
  if (['light', 'buzz'].includes(theme)) return 'light';
  return null;
}

export function parseLocale(value: unknown): KailoLocale | null {
  if (typeof value !== 'string') return null;
  const locale = value.trim().toLowerCase().replace('_', '-');
  if (locale === 'en' || locale.startsWith('en-')) return 'en';
  if (locale === 'zh' || locale.startsWith('zh-')) return 'zh-CN';
  return null;
}

export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function stored(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be partitioned or disabled in an iframe; the URL and the
    // host messages remain the source of truth.
  }
}

export function initialTheme(search: string): KailoTheme {
  const fromUrl = parseTheme(new URLSearchParams(search).get('kailo_theme'));
  if (fromUrl) store(STORAGE.theme, fromUrl);
  return fromUrl || parseTheme(stored(STORAGE.theme)) || 'light';
}

export function initialLocale(search: string): KailoLocale | null {
  const fromUrl = parseLocale(new URLSearchParams(search).get('kailo_locale'));
  if (fromUrl) store(STORAGE.locale, fromUrl);
  return fromUrl || parseLocale(stored(STORAGE.locale));
}

// client-kit convention: `.dark` / `.light` on <html> selects the token set.
export function applyTheme(theme: KailoTheme, root?: HTMLElement) {
  const element = root || document.documentElement;
  element.classList.toggle('dark', theme === 'dark');
  element.classList.toggle('light', theme === 'light');
  element.setAttribute('data-kailo-theme', theme);
  element.style.colorScheme = theme;
  store(STORAGE.theme, theme);
}

export function rememberLocale(locale: KailoLocale) {
  store(STORAGE.locale, locale);
}

// The exact Kailo origin hosting this frame, if it is an allowed origin.
export function hostOrigin(allowed: string[]): string | null {
  if (typeof window === 'undefined' || !isEmbedded()) return null;
  const candidates: string[] = [];
  const ancestors = (window.location as any).ancestorOrigins as
    | DOMStringList
    | undefined;
  if (ancestors?.length) candidates.push(ancestors[0]);
  try {
    if (document.referrer) candidates.push(new URL(document.referrer).origin);
  } catch {
    // An unparsable referrer is not a candidate.
  }
  if (allowed.length === 1) candidates.push(allowed[0]);
  return candidates.find((origin) => allowed.includes(origin)) || null;
}

export type HostMessage =
  | { type: 'theme'; theme: KailoTheme }
  | { type: 'locale'; locale: KailoLocale }
  | { type: 'logout' };

// Only messages from the parent window at an allowed Kailo origin are read.
export function readHostMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  allowed: string[],
  parent: unknown,
): HostMessage | null {
  if (!allowed.includes(event.origin) || event.source !== parent) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== HOST_MESSAGE_SOURCE)
    return null;
  if (data.type === 'theme') {
    const theme = parseTheme(data.theme);
    return theme ? { type: 'theme', theme } : null;
  }
  if (data.type === 'locale') {
    const locale = parseLocale(data.locale);
    return locale ? { type: 'locale', locale } : null;
  }
  if (data.type === 'logout') return { type: 'logout' };
  return null;
}

export function tellHost(
  allowed: string[],
  type: 'ready' | 'auth-required' | 'signed-out',
  detail: Record<string, unknown> = {},
) {
  const origin = hostOrigin(allowed);
  if (!origin) return;
  window.parent.postMessage(
    { source: PAGE_MESSAGE_SOURCE, component: COMPONENT, type, detail },
    origin,
  );
}

// The host's logout: clear this page's gateway session (same-origin POST, the
// gateway checks Origin) and report it. The IdP/Kailo session is Kailo's.
export async function signOutNativeSession(): Promise<boolean> {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
    });
    return response.type === 'opaqueredirect' || response.status < 400;
  } catch {
    return false;
  }
}

let renewal: Promise<boolean> | null = null;

// Silent renewal through the existing IdP session in a hidden same-origin
// frame. The IdP login page refuses framing, so a missing IdP session ends on
// a cross-origin (unreadable) document and is reported as `false`.
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

// After a failed renewal: inside Kailo, let the host sign in at top level and
// show the gateway's sign-in page in the frame; at top level, sign in directly.
export function requireSignIn(allowed: string[]) {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  if (isEmbedded()) {
    tellHost(allowed, 'auth-required', { returnTo });
    window.location.assign(
      `/kailo-embed/signin?returnTo=${encodeURIComponent(returnTo)}`,
    );
    return;
  }
  window.location.assign(
    `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
}

let knownHostOrigins: string[] = [];

export function setHostOrigins(origins: string[]) {
  knownHostOrigins = origins;
}

// Apollo/REST fetch: one silent renewal and retry on a gateway 401.
export async function kailoFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401 || typeof window === 'undefined') return response;
  if (await renewNativeSession()) return fetch(input, init);
  requireSignIn(knownHostOrigins);
  return response;
}
