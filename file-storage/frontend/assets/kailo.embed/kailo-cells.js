/*
 * Cells side of the Kailo presentation (07 §4.7, DD-133).
 *
 * Loaded after the platform runtime kailo-embed.js (window.KailoEmbed, wire
 * protocol v1), before the Pydio boot script. KailoEmbed owns the theme and
 * locale (launch parameters, tab storage, Kailo host messages); this file only
 * connects them to the native application (theme builder, language, title)
 * and drives the native "login" action as a silent OIDC redirect. It never
 * handles a token or credential.
 */
(function (window, document) {
    'use strict';

    var STORE_RETURN = 'kailo.cells.return';
    var STORE_ATTEMPTS = 'kailo.cells.sso';
    var MAX_ATTEMPTS = 3;
    var ATTEMPT_WINDOW_MS = 60 * 1000;

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
                /* storage full or disabled */
            }
        }
    }

    // Kailo locale (zh-CN | en) <-> native Cells language id.
    function nativeLanguage(locale) {
        return locale === 'en' ? 'en-us' : locale === 'zh-CN' ? 'zh-cn' : '';
    }

    function kailoLocale(language) {
        var l = String(language || '').toLowerCase();
        return l.indexOf('zh') === 0 ? 'zh-CN' : l.indexOf('en') === 0 ? 'en' : '';
    }

    // Relative same-origin application path only.
    function safeReturnPath(path) {
        if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\' ||
            path.length > 1024 || /[\u0000-\u001f\\]/.test(path) || path.indexOf('/login') === 0 || path.indexOf('/auth/') === 0) {
            return '/';
        }
        return path;
    }

    var embed = window.KailoEmbed || null;
    var listeners = [];
    var cached = null;
    // Top level: the bridge drives the language only after it seeded KailoEmbed
    // from the account (whenPydioReady below); inside Kailo, from the start.
    var seeded = false;

    function embedState() {
        if (embed) {
            return embed.getState();
        }
        // Without the platform runtime (never in a release image): top level, light.
        return {theme: 'light', locale: '', embedded: false, hostConnected: false};
    }

    function params() {
        if (cached) {
            return cached;
        }
        var start = window.startParameters;
        var p = start && start.KAILO_EMBED;
        if (p && typeof p === 'object') {
            cached = p;
        }
        return cached || {};
    }

    function presentation() {
        var s = embedState();
        return {theme: s.theme, dark: s.theme === 'dark', locale: s.locale, language: nativeLanguage(s.locale), embedded: !!s.embedded};
    }

    // The native language the page must show, or '' while the account
    // preference still decides (top level before the bridge seeded KailoEmbed).
    function language() {
        var s = embedState();
        return embed && (s.embedded || seeded) ? nativeLanguage(s.locale) : '';
    }

    function localizedTitle() {
        var titles = params().titles || {};
        var lang = nativeLanguage(embedState().locale) || 'zh-cn';
        return titles[lang] || titles['zh-cn'] || titles['en-us'] || '';
    }

    // Native application parts follow KailoEmbed: title, language, theme.
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
        var lang = nativeLanguage(embedState().locale);
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
            builder.applyHostPresentation(presentation());
        }
    }

    function notify() {
        var current = presentation();
        listeners.slice().forEach(function (fn) {
            try {
                fn(current);
            } catch (e) {
                /* a failing consumer does not stop the others */
            }
        });
        syncPydio();
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

    function showAuthProblem() {
        if (document.getElementById('kailo-auth-problem')) {
            return;
        }
        var box = document.createElement('div');
        box.id = 'kailo-auth-problem';
        box.className = 'kailo-minimal-message kailo-overlay-message';
        var text = document.createElement('p');
        text.textContent = embedState().locale === 'en'
            ? 'Files could not sign you in with your Kailo account. Sign in to Kailo again.'
            : '云盘未能使用 Kailo 账号完成登录，请重新登录 Kailo。';
        box.appendChild(text);
        (document.body || document.documentElement).appendChild(box);
    }

    // Native "login" action: silent (framed) or Kailo (top level) OIDC login
    // instead of the native dialog. Returns false when a loop was stopped.
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
            if (embed && embedState().embedded) {
                embed.requestTopLevelSignIn();
            }
            showAuthProblem();
            return false;
        }
        attempts.count += 1;
        writeJSON(STORE_ATTEMPTS, attempts);
        var s = storage();
        if (s) {
            s.setItem(STORE_RETURN, safeReturnPath(window.location.pathname + window.location.search));
            var lang = nativeLanguage(embedState().locale);
            if (lang) {
                s.setItem('loginLanguage', lang);
            }
        }
        var target = href;
        if (embedState().embedded) {
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

    function logoutUrl() {
        var url = params().logoutUrl;
        return typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
    }

    window.KailoCells = {
        presentation: presentation,
        // Native language id Kailo imposes on the page (Controller.setUser
        // keeps it over the stored account preference), or ''.
        language: language,
        subscribe: function (fn) {
            if (typeof fn === 'function') {
                listeners.push(fn);
            }
            return function () {
                listeners = listeners.filter(function (f) { return f !== fn; });
            };
        },
        sso: function () { return !!params().sso; },
        logoutUrl: logoutUrl,
        // The native "logout" entry is shown only outside a Kailo frame.
        showLogout: function () { return !embedState().embedded && (!!logoutUrl() || !params().sso); },
        startLogin: startLogin,
        consumeReturnPath: consumeReturnPath,
        _internal: {nativeLanguage: nativeLanguage, kailoLocale: kailoLocale, safeReturnPath: safeReturnPath, params: params}
    };

    if (embed) {
        embed.onChange(function () { notify(); });
    }

    whenPydioReady(function () {
        var pydio = window.pydio;
        // Top-level visit: the account language (refreshed from the OIDC
        // locale claim at login) seeds KailoEmbed unless Kailo supplied one.
        if (embed && !embedState().embedded && pydio.currentLanguage) {
            embed.useIdentityLocale(kailoLocale(pydio.currentLanguage));
        }
        seeded = true;
        syncPydio();
    });
})(window, document);
