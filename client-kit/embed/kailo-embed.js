/*!
 * kailo-embed.js — Kailo presentation runtime for component pages (DD-133).
 * Plain script, no dependencies, no network access. Load it synchronously in
 * <head> (after kailo-theme-tokens.css) so the first paint already has the
 * Kailo theme:
 *
 *   <meta name="kailo-web-origin" content="https://kailo.example.com">
 *   <link rel="stylesheet" href="/kailo/kailo-theme-tokens.css">
 *   <script src="/kailo/kailo-embed.js"></script>
 *
 * Wire protocol v1 (window.postMessage, never "*"):
 *   component -> Kailo  {source:"kailo-embed", version:1, type:"ready"}
 *   component -> Kailo  {source:"kailo-embed", version:1, type:"auth-required"}
 *   Kailo -> component  {source:"kailo-host", version:1, type:"presentation",
 *                        theme:"light"|"dark", locale:"zh-CN"|"en"}
 */
(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc || global.KailoEmbed) return;

  var VERSION = 1;
  var THEMES = ["light", "dark"];
  var LOCALES = ["zh-CN", "en"];
  var STORE_KEY = "kailo-embed-presentation";
  var root = doc.documentElement;
  var framed = false;
  try { framed = global.parent !== global; } catch (e) { framed = true; }

  function member(value, allowed) {
    return typeof value === "string" && allowed.indexOf(value) >= 0 ? value : null;
  }

  function exactOrigin(text) {
    try {
      var url = new URL(text);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === text ? text : null;
    } catch (e) { return null; }
  }

  function originsFrom(list) {
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var origin = exactOrigin(list[i]);
      if (origin && out.indexOf(origin) < 0) out.push(origin);
    }
    return out;
  }

  // Deployment fact, rendered into the page by the component's own server or
  // build from the platform .env; never taken from the URL or the referrer.
  var meta = doc.querySelector('meta[name="kailo-web-origin"]');
  var origins = originsFrom(meta ? String(meta.getAttribute("content") || "").split(/\s+/) : []);

  function readStore() {
    try {
      var value = JSON.parse(global.sessionStorage.getItem(STORE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (e) { return {}; }
  }

  function writeStore(value) {
    try { global.sessionStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch (e) { /* storage denied */ }
  }

  var params;
  try { params = new URLSearchParams(global.location.search); } catch (e) { params = null; }
  var stored = readStore();
  var urlTheme = params ? member(params.get("kailo_theme"), THEMES) : null;
  var urlLocale = params ? member(params.get("kailo_locale"), LOCALES) : null;
  var systemDark = false;
  try { systemDark = !!(global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { systemDark = false; }

  // Precedence: launch parameter, then the value this tab already received
  // (OIDC redirects drop the query string), then the device default.
  var state = {
    theme: urlTheme || member(stored.theme, THEMES) || (systemDark ? "dark" : "light"),
    locale: urlLocale || member(stored.locale, LOCALES) || "zh-CN"
  };
  // What Kailo itself supplied (launch URL, earlier in this tab, or the host).
  // Only these values persist, so a device default or the identity locale
  // never masquerades as a Kailo value after the next redirect.
  var supplied = {
    theme: urlTheme || member(stored.theme, THEMES) || undefined,
    locale: urlLocale || member(stored.locale, LOCALES) || undefined
  };
  if (urlTheme || urlLocale) writeStore(supplied);
  var hostConnected = false;
  var listeners = [];

  function apply() {
    if (state.theme === "dark") root.setAttribute("data-kailo-theme", "dark");
    else root.removeAttribute("data-kailo-theme");
    root.style.colorScheme = state.theme;
    root.setAttribute("lang", state.locale);
    if (framed) root.setAttribute("data-kailo-embedded", "");
  }

  function snapshot() {
    return { theme: state.theme, locale: state.locale, embedded: framed, hostConnected: hostConnected };
  }

  function update(theme, locale) {
    var changed = { theme: theme !== state.theme, locale: locale !== state.locale };
    state.theme = theme;
    state.locale = locale;
    apply();
    if (!changed.theme && !changed.locale) return;
    var current = snapshot();
    var targets = listeners.slice();
    for (var i = 0; i < targets.length; i += 1) {
      // One failing component callback must not starve the others.
      try { targets[i](current, changed); } catch (e) { setTimeout(function (error) { return function () { throw error; }; }(e), 0); }
    }
    try { global.dispatchEvent(new CustomEvent("kailo:presentation", { detail: { state: current, changed: changed } })); } catch (e) { /* old engines */ }
  }

  function post(type) {
    if (!framed) return false;
    for (var i = 0; i < origins.length; i += 1) {
      // The browser delivers only to the origin that actually frames us.
      global.parent.postMessage({ source: "kailo-embed", version: VERSION, type: type }, origins[i]);
    }
    return origins.length > 0;
  }

  global.addEventListener("message", function (event) {
    if (!framed || event.source !== global.parent || origins.indexOf(event.origin) < 0) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== "kailo-host" || data.version !== VERSION
      || data.type !== "presentation") return;
    var theme = member(data.theme, THEMES);
    var locale = member(data.locale, LOCALES);
    if (!theme || !locale) return;
    hostConnected = true;
    supplied = { theme: theme, locale: locale };
    writeStore(supplied);
    update(theme, locale);
  });

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("KailoEmbed listener must be a function");
    listeners.push(listener);
    return function unsubscribe() {
      var index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  global.KailoEmbed = Object.freeze({
    version: VERSION,
    themes: THEMES.slice(),
    locales: LOCALES.slice(),
    /** {theme, locale, embedded, hostConnected} */
    getState: snapshot,
    /** listener(state, {theme: boolean, locale: boolean}); returns unsubscribe. */
    onChange: subscribe,
    onThemeChange: function (listener) {
      return subscribe(function (current, changed) { if (changed.theme) listener(current.theme); });
    },
    onLocaleChange: function (listener) {
      return subscribe(function (current, changed) { if (changed.locale) listener(current.locale); });
    },
    /**
     * Top-level visits only: the OIDC `locale` claim may seed the language when
     * neither Kailo nor this tab supplied one. Ignored once Kailo has spoken.
     */
    useIdentityLocale: function (locale) {
      var value = member(locale, LOCALES);
      if (!value || supplied.locale) return false;
      update(state.theme, value);
      return true;
    },
    /**
     * Silent OIDC (prompt=none) failed inside the Kailo frame: ask Kailo to
     * re-authenticate at the top level. Never show a login form in the frame.
     */
    requestTopLevelSignIn: function () { return post("auth-required"); }
  });

  apply();
  post("ready");
})(window);
