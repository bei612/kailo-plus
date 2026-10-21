/*
 * Kailo presentation bridge of the native file storage page (DD-133 §2, §4).
 *
 * Loaded by the native index before the Pydio boot script. It decides the
 * embedding mode, applies the Kailo theme and language (URL parameters
 * kailo_theme / kailo_locale first, then postMessage from the allowed Kailo
 * origins only), drives the silent OIDC login of the native "login" action and
 * reacts to the front-channel logout. It never handles a token or credential.
 */
(function (window, document) {
    'use strict';

    var STORE_PRESENTATION = 'kailo.cells.presentation';
    var STORE_RETURN = 'kailo.cells.return';
    var STORE_ATTEMPTS = 'kailo.cells.sso';
    var MAX_ATTEMPTS = 3;
    var ATTEMPT_WINDOW_MS = 60 * 1000;
    var TOKEN_NAME = /^--[a-z0-9-]{1,64}$/;
    var TOKEN_VALUE = /^[0-9a-zA-Z.%#(),\s\/+-]{1,96}$/;

    function storage() {
        try {
            return window.sessionStorage;
        } catch (e) {
            return null;
        }
    }

    function readJSON(key) {
        var s = storage();
        if (!s) {
            return null;
        }
        try {
            return JSON.parse(s.getItem(key) || 'null');
        } catch (e) {
            return null;
        }
    }

    function writeJSON(key, value) {
        var s = storage();
        if (s) {
            try {
                s.setItem(key, JSON.stringify(value));
            } catch (e) {
                /* storage full or disabled: presentation still applies */
            }
        }
    }

    function isEmbedded() {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    }

    // LIGHT/DARK (07 §4.5 presentation enums) or light/dark.
    function normalizeTheme(value) {
        var v = String(value || '').toLowerCase();
        return v === 'dark' || v === 'light' ? v : '';
    }

    // EN / ZH_CN / zh-CN / en-US → Kailo locale "zh-CN" | "en".
    function normalizeLocale(value) {
        var v = String(value || '').replace('_', '-').toLowerCase();
        if (!v) {
            return '';
        }
        if (v === 'zh' || v.indexOf('zh-') === 0) {
            return 'zh-CN';
        }
        if (v === 'en' || v.indexOf('en-') === 0) {
            return 'en';
        }
        return '';
    }

    // Kailo locale → native Cells language id.
    function nativeLanguage(locale) {
        return locale === 'en' ? 'en-us' : locale === 'zh-CN' ? 'zh-cn' : '';
    }

    function safeTokens(tokens) {
        var out = {};
        if (!tokens || typeof tokens !== 'object') {
            return out;
        }
        Object.keys(tokens).forEach(function (name) {
            var value = tokens[name];
            if (TOKEN_NAME.test(name) && typeof value === 'string' && TOKEN_VALUE.test(value) && value.indexOf('url') === -1) {
                out[name] = value;
            }
        });
        return out;
    }

    // Relative same-origin path only; never a scheme, host or protocol-relative URL.
    function safeReturnPath(path) {
        if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\' ||
            path.length > 1024 || /[\u0000-\u001f\\]/.test(path) || path.indexOf('/login') === 0 || path.indexOf('/auth/') === 0) {
            return '/';
        }
        return path;
    }

    var state = {
        embedded: isEmbedded(),
        theme: '',
        locale: '',
        tokens: {},
        params: null,
        listeners: []
    };

    // Initial presentation: URL parameters, then this tab's last known value.
    (function initialPresentation() {
        var query;
        try {
            query = new URLSearchParams(window.location.search);
        } catch (e) {
            query = null;
        }
        var saved = readJSON(STORE_PRESENTATION) || {};
        state.theme = normalizeTheme(query && query.get('kailo_theme')) || normalizeTheme(saved.theme) || 'light';
        state.locale = normalizeLocale(query && query.get('kailo_locale')) || normalizeLocale(saved.locale) || '';
        state.tokens = safeTokens(saved.tokens);
        writeJSON(STORE_PRESENTATION, {theme: state.theme, locale: state.locale, tokens: state.tokens});
    })();

    function applyDocument() {
        var root = document.documentElement;
        root.classList.toggle('kailo-embedded', state.embedded);
        root.classList.toggle('kailo-standalone', !state.embedded);
        root.classList.toggle('dark', state.theme === 'dark');
        root.classList.toggle('light', state.theme !== 'dark');
        root.style.colorScheme = state.theme === 'dark' ? 'dark' : 'light';
        if (state.locale) {
            root.setAttribute('lang', state.locale);
        }
        Object.keys(state.tokens).forEach(function (name) {
            root.style.setProperty(name, state.tokens[name]);
        });
    }

    function params() {
        if (state.params) {
            return state.params;
        }
        var start = window.startParameters;
        var p = start && start.KAILO_EMBED;
        if (p && typeof p === 'object') {
            state.params = p;
        }
        return state.params || {};
    }

    function allowedOrigins() {
        var origins = params().origins;
        return Array.isArray(origins) ? origins.filter(function (o) { return typeof o === 'string' && o; }) : [];
    }

    function postToHost(message) {
        if (!state.embedded || !window.parent) {
            return;
        }
        allowedOrigins().forEach(function (origin) {
            try {
                window.parent.postMessage(message, origin);
            } catch (e) {
                /* not that origin */
            }
        });
    }

    function localizedTitle() {
        var titles = params().titles || {};
        var lang = nativeLanguage(state.locale) || (window.pydio && window.pydio.currentLanguage) || 'zh-cn';
        return titles[lang] || titles['zh-cn'] || titles['en-us'] || '';
    }

    function notify() {
        state.listeners.slice().forEach(function (fn) {
            try {
                fn(api.presentation());
            } catch (e) {
                /* a failing consumer does not stop the others */
            }
        });
    }

    // Apply a presentation change coming from Kailo.
    function setPresentation(next) {
        var changed = false;
        var theme = normalizeTheme(next && next.theme);
        var locale = normalizeLocale(next && next.locale);
        var tokens = safeTokens(next && next.tokens);
        if (theme && theme !== state.theme) {
            state.theme = theme;
            changed = true;
        }
        if (locale && locale !== state.locale) {
            state.locale = locale;
            changed = true;
        }
        if (Object.keys(tokens).length) {
            state.tokens = tokens;
            changed = true;
        }
        if (!changed) {
            return false;
        }
        writeJSON(STORE_PRESENTATION, {theme: state.theme, locale: state.locale, tokens: state.tokens});
        applyDocument();
        syncPydio();
        notify();
        return true;
    }

    function onMessage(event) {
        if (!event || allowedOrigins().indexOf(event.origin) === -1 || event.source !== window.parent) {
            return;
        }
        var data = event.data;
        if (!data || typeof data !== 'object') {
            return;
        }
        if (data.type === 'kailo.presentation') {
            setPresentation(data);
        }
    }

    // Native application parts: title, language and theme builder.
    function syncPydio() {
        var pydio = window.pydio;
        if (!pydio || !pydio.Parameters) {
            return;
        }
        var title = localizedTitle();
        var wording = pydio.Parameters.get && pydio.Parameters.get('customWording');
        if (title && wording) {
            wording.title = title;
            document.title = title;
        }
        var lang = nativeLanguage(state.locale);
        if (lang) {
            var s = storage();
            if (s) {
                // The native login stores it as the user language (authfront modifiers).
                s.setItem('loginLanguage', lang);
            }
            if (pydio.currentLanguage && pydio.currentLanguage !== lang && pydio.loadI18NMessages) {
                pydio.loadI18NMessages(lang);
            }
        }
        var builder = pydio.UI && pydio.UI.themeBuilder;
        if (builder && builder.applyHostPresentation) {
            builder.applyHostPresentation(api.presentation());
        }
    }

    function whenPydioReady(fn, tries) {
        if (window.pydio && window.pydio.UI) {
            fn();
            return;
        }
        if ((tries || 0) > 600) {
            return;
        }
        window.setTimeout(function () { whenPydioReady(fn, (tries || 0) + 1); }, 100);
    }

    // Silent (framed) or Kailo (top level) OIDC login instead of the native
    // login dialog. Returns false when a redirect loop was stopped.
    function startLogin(href) {
        if (typeof href !== 'string' || href.charAt(0) !== '/' || href.charAt(1) === '/') {
            return false;
        }
        var now = Date.now();
        var attempts = readJSON(STORE_ATTEMPTS) || {};
        if (typeof attempts.first !== 'number' || now - attempts.first > ATTEMPT_WINDOW_MS) {
            attempts = {first: now, count: 0};
        }
        if (attempts.count >= MAX_ATTEMPTS) {
            showAuthProblem();
            return false;
        }
        attempts.count += 1;
        writeJSON(STORE_ATTEMPTS, attempts);
        var s = storage();
        if (s) {
            s.setItem(STORE_RETURN, safeReturnPath(window.location.pathname + window.location.search));
            var lang = nativeLanguage(state.locale);
            if (lang) {
                s.setItem('loginLanguage', lang);
            }
        }
        var target = href;
        if (state.embedded) {
            target += (href.indexOf('?') === -1 ? '?' : '&') + 'prompt=none';
        }
        window.location.replace(target);
        return true;
    }

    // After the native callback: forget the loop guard, return to the page.
    function consumeReturnPath() {
        var s = storage();
        var path = '/';
        if (s) {
            path = safeReturnPath(s.getItem(STORE_RETURN) || '/');
            s.removeItem(STORE_RETURN);
            s.removeItem(STORE_ATTEMPTS);
        }
        return path;
    }

    function showAuthProblem() {
        postToHost({type: 'kailo.native.auth-required', component: 'file_storage'});
        if (document.getElementById('kailo-auth-problem')) {
            return;
        }
        var box = document.createElement('div');
        box.id = 'kailo-auth-problem';
        box.className = 'kailo-minimal-message kailo-overlay-message';
        var text = document.createElement('p');
        text.textContent = state.locale === 'en'
            ? 'Files could not sign you in with your Kailo account. Reload Kailo and try again.'
            : '云盘未能使用 Kailo 账号完成登录，请刷新 Kailo 后重试。';
        box.appendChild(text);
        (document.body || document.documentElement).appendChild(box);
    }

    function logoutUrl() {
        var url = params().logoutUrl;
        return typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
    }

    var api = {
        get embedded() { return state.embedded; },
        presentation: function () {
            return {theme: state.theme, dark: state.theme === 'dark', locale: state.locale, language: nativeLanguage(state.locale), tokens: state.tokens};
        },
        subscribe: function (fn) {
            if (typeof fn === 'function') {
                state.listeners.push(fn);
            }
            return function () {
                state.listeners = state.listeners.filter(function (f) { return f !== fn; });
            };
        },
        sso: function () { return !!params().sso; },
        logoutUrl: logoutUrl,
        // The native "logout" entry is shown only outside a Kailo frame.
        showLogout: function () { return !state.embedded && (!!logoutUrl() || !params().sso); },
        startLogin: startLogin,
        consumeReturnPath: consumeReturnPath,
        setPresentation: setPresentation,
        _internal: {normalizeTheme: normalizeTheme, normalizeLocale: normalizeLocale, nativeLanguage: nativeLanguage,
            safeTokens: safeTokens, safeReturnPath: safeReturnPath, onMessage: onMessage, params: params}
    };
    window.KailoCells = api;

    applyDocument();
    window.addEventListener('message', onMessage);
    try {
        new window.BroadcastChannel('kailo-cells').onmessage = function (event) {
            if (event && event.data && event.data.type === 'kailo.native.logged-out') {
                window.location.reload();
            }
        };
    } catch (e) {
        /* no BroadcastChannel: the next native request re-authenticates */
    }

    function boot() {
        params();
        postToHost({type: 'kailo.native.ready', component: params().component || 'file_storage'});
        whenPydioReady(syncPydio);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window, document);
