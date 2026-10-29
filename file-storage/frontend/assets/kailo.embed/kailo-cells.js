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
        } catch {
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
        } catch {
            return null;
        }
    }

    function writeJSON(key, value) {
        var s = storage();
        if (s) {
            try {
                s.setItem(key, JSON.stringify(value));
            } catch {
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

    function hasControlOrBackslash(value) {
        for (var i = 0; i < value.length; i += 1) {
            var code = value.charCodeAt(i);
            if (code < 0x20 || code === 0x5c) {
                return true;
            }
        }
        return false;
    }

    // Relative same-origin application path only.
    function safeReturnPath(path) {
        if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || path.charAt(1) === '\\' ||
            path.length > 1024 || hasControlOrBackslash(path) || path.indexOf('/login') === 0 || path.indexOf('/auth/') === 0) {
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

    // Kailo mode (07 §4.8.1, DD-138): the deployment declared KAILO_EMBED, i.e.
    // the Cells index page rendered startParameters.KAILO_EMBED (web/kailo-embed.go).
    // Independent of framing: a top-level visit is still Kailo mode.
    function kailoMode() {
        var start = window.startParameters;
        return !!(start && start.KAILO_EMBED && typeof start.KAILO_EMBED === 'object');
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
            } catch {
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
            // V-SCN-226: once Kailo received auth-required it alone prompts for
            // the new sign-in; the frame adds no second notice. Without Kailo
            // (top level, or no Kailo origin) the page explains itself.
            var handedToKailo = !!embed && embedState().embedded && embed.requestTopLevelSignIn() === true;
            if (!handedToKailo) {
                showAuthProblem();
            }
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

    // ---- DD-157 page shell (07 §4.8.7, 20 §13) ------------------------------
    // Inside a Kailo frame that accepts the "page" feature, Kailo draws the page
    // header (title, breadcrumbs, tabs, main actions), toasts and destructive
    // confirmations; the native page renders only its content area.

    var TEXT = {
        'zh-CN': {
            home: '主页', files: '所有文件', bookmarks: '收藏', search: '搜索结果',
            upload: '上传', uploadFolder: '上传文件夹', mkdir: '新建文件夹', newFile: '新建{0}', shareFolder: '分享此文件夹', share: '分享',
            refresh: '刷新', download: '下载', locations: '位置', personal: '个人文件', common: '公共文件',
            cells: '共享空间', cancel: '取消', remove: '删除', empty: '清空',
            deleteOne: '删除「{0}」？', deleteMany: '删除 {0} 个项目？',
            toRecycle: '项目将移到回收站，可以从回收站恢复。', permanent: '项目将被永久删除，无法恢复。',
            permanentOption: '永久删除（不移到回收站）', permanentWarning: '勾选后项目将被永久删除，无法恢复。',
            emptyRecycle: '清空回收站？', emptyRecycleBody: '回收站中的所有项目将被永久删除，无法恢复。',
            deleteShares: '删除全部分享？', deleteSharesBody: '公开链接和共享成员将立即失去访问权限。',
            dropTo: '松开即可上传到「{0}」', uploadFailed: '未能开始上传',
        },
        en: {
            home: 'Home', files: 'All files', bookmarks: 'Favorites', search: 'Search results',
            upload: 'Upload', uploadFolder: 'Upload folder', mkdir: 'New folder', newFile: 'New {0}', shareFolder: 'Share this folder', share: 'Share',
            refresh: 'Refresh', download: 'Download', locations: 'Locations', personal: 'Personal files', common: 'Common files',
            cells: 'Shared spaces', cancel: 'Cancel', remove: 'Delete', empty: 'Empty',
            deleteOne: 'Delete "{0}"?', deleteMany: 'Delete {0} items?',
            toRecycle: 'The items move to the recycle bin and can be restored from there.', permanent: 'The items are deleted permanently and cannot be restored.',
            permanentOption: 'Delete permanently (skip the recycle bin)', permanentWarning: 'The items will be deleted permanently and cannot be restored.',
            emptyRecycle: 'Empty the recycle bin?', emptyRecycleBody: 'Every item in the recycle bin is deleted permanently and cannot be restored.',
            deleteShares: 'Delete all shares?', deleteSharesBody: 'Public links and shared members lose access immediately.',
            dropTo: 'Drop to upload to "{0}"', uploadFailed: 'Could not start the upload',
        }
    };

    function text(key, arg) {
        var table = TEXT[embedState().locale === 'en' ? 'en' : 'zh-CN'];
        var value = table[key] || TEXT['zh-CN'][key] || key;
        return arg === undefined ? value : value.replace('{0}', String(arg));
    }

    function clip(value, max) {
        var v = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
        return v.length > max ? v.slice(0, max - 1) + '…' : v;
    }

    function hasFeature(name) {
        return !!(embed && embed.features && embed.features.indexOf(name) >= 0);
    }

    function hostOrigins() {
        var meta = document.querySelector && document.querySelector('meta[name="kailo-web-origin"]');
        return !!(meta && String(meta.getAttribute('content') || '').trim());
    }

    // Kailo draws this page's header: a Kailo frame, the page feature declared
    // and a Kailo origin to talk to. Until Kailo answers, its skeleton covers the
    // page; once it has answered, only a host that announced "page" draws the
    // header (an older Kailo leaves the native header in place).
    var candidate = !!embed && hasFeature('page') && embedState().embedded && hostOrigins();
    var hosted = candidate;
    var hostedListeners = [];

    function pageHosted() {
        return hosted;
    }

    function hostAnswered() {
        return !!embed && !!embedState().hostConnected;
    }

    function hostHandles(feature) {
        return !!embed && (typeof embed.hostSupports === 'function' ? embed.hostSupports(feature) : hostAnswered());
    }

    function setHosted(next) {
        next = !!next && candidate;
        if (next === hosted) {
            return;
        }
        hosted = next;
        lastPage = '';
        markRoot();
        hostedListeners.slice().forEach(function (fn) {
            try {
                fn(hosted);
            } catch {
                /* consumer errors stay local */
            }
        });
        var ui = window.pydio && window.pydio.UI;
        if (ui && ui.refreshTemplateParts) {
            ui.refreshTemplateParts();
        }
        schedulePage();
    }

    function markRoot() {
        var root = document.documentElement;
        if (!root) {
            return;
        }
        if (hosted) {
            root.setAttribute('data-kailo-page-hosted', '');
        } else {
            root.removeAttribute('data-kailo-page-hosted');
        }
    }
    markRoot();

    // Kailo vocabulary (20 §13.8) over the native Chinese strings: 你 not 您,
    // 新建, 收藏 not 书签, no exclamation marks. Applied to the message table
    // itself (Pydio core calls this whenever it loads one), Kailo mode only.
    var ZH_WORDING = [
        [/您/g, '你'],
        [/书签/g, '收藏'],
        [/智能体/g, 'Agent'],
        [/！/g, '。'],
    ];
    var KEY_WORDING = {
        'zh-cn': {'198': '新建', 'user_home.reco.workspace': '位置'},
        'en-us': {'147': 'Favorites', '152-on': 'Favorites'},
    };

    function wording(hash, language) {
        if (!hash || typeof hash !== 'object' || !kailoMode()) {
            return hash;
        }
        var lang = String(language || '').toLowerCase();
        var zh = lang.indexOf('zh') === 0;
        if (zh) {
            Object.keys(hash).forEach(function (key) {
                var value = hash[key];
                if (typeof value === 'string') {
                    ZH_WORDING.forEach(function (rule) {
                        value = value.replace(rule[0], rule[1]);
                    });
                    hash[key] = value;
                }
            });
        }
        var keys = KEY_WORDING[zh ? 'zh-cn' : lang] || {};
        Object.keys(keys).forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(hash, key)) {
                hash[key] = keys[key];
            }
        });
        return hash;
    }

    // Kailo names of the default locations (20 §13.8: 个人文件 / 公共文件).
    function locationLabel(slug) {
        if (!kailoMode()) {
            return '';
        }
        if (slug === 'personal-files') {
            return text('personal');
        }
        if (slug === 'common-files') {
            return text('common');
        }
        return '';
    }

    // Native message bar -> Kailo toast (one notification surface). A message
    // carrying its own action button keeps the native bar.
    function toast(type, message, actionLabel) {
        if (!embed || !embed.toast || actionLabel) {
            return false;
        }
        if (message && typeof message === 'object') {
            message = message.Title || message.message || '';
        }
        var body = String(message === undefined || message === null ? '' : message).replace(/\s+/g, ' ').trim();
        if (!body) {
            return false;
        }
        var kind = String(type || '').toUpperCase();
        var tone = kind === 'ERROR' ? 'error' : kind === 'SUCCESS' ? 'success' : kind === 'WARNING' ? 'warning' : 'info';
        var payload = {tone: tone, title: body};
        if (body.length > 120) {
            // First sentence as the title, the rest as the description.
            var cut = body.slice(0, 120).search(/[。.!?！？][^。.!?！？]*$/);
            var at = cut > 0 ? cut + 1 : 0;
            payload.title = at ? body.slice(0, at) : clip(body, 120);
            var rest = at ? body.slice(at).trim() : body.slice(119).trim();
            if (rest) {
                payload.description = clip(rest, 280);
            }
        }
        try {
            return embed.toast(payload) === true;
        } catch {
            return false;
        }
    }

    // Destructive confirmation in Kailo; null when the native dialog must show.
    function confirm(options) {
        if (!embed || !embed.confirm || !options) {
            return null;
        }
        try {
            return embed.confirm(options) || null;
        } catch {
            return null;
        }
    }

    // allowPermanent (DELETE_ALLOW_PERMANENT): the native "delete permanently" choice travels
    // into Kailo's dialog; a Kailo that cannot show it leaves the native dialog in place.
    function deleteConfirm(count, name, permanent, allowPermanent) {
        var n = Number(count) || 0;
        var options = {
            tone: 'danger',
            title: clip(n === 1 && name ? text('deleteOne', clip(name, 80)) : text('deleteMany', n), 120),
            description: text(permanent ? 'permanent' : 'toRecycle'),
            confirmLabel: text('remove'),
            cancelLabel: text('cancel'),
        };
        if (allowPermanent && !permanent) {
            options.option = { label: text('permanentOption'), warning: text('permanentWarning') };
        }
        return options;
    }

    function namedConfirm(kind) {
        var title = kind === 'empty-recycle' ? 'emptyRecycle' : 'deleteShares';
        return {
            tone: 'danger',
            title: text(title),
            description: text(title + 'Body'),
            confirmLabel: text(kind === 'empty-recycle' ? 'empty' : 'remove'),
            cancelLabel: text('cancel'),
        };
    }

    // List pane next to the content (spec §2): the location tree, or the
    // favorites when the 收藏 tab is active.
    var pane = 'files';
    var paneListeners = [];

    function setPane(next) {
        if (next === pane) {
            return;
        }
        pane = next;
        paneListeners.slice().forEach(function (fn) {
            try {
                fn(pane);
            } catch {
                /* consumer errors stay local */
            }
        });
        schedulePage();
    }

    // The open editor or preview, reported by the native Editor component.
    var editor = null;

    function setEditor(state) {
        editor = state && state.node ? state : null;
        schedulePage();
    }

    var handlers = {};
    var lastPage = '';
    var pageTimer = null;

    function nodePath(node) {
        return node && node.getPath ? String(node.getPath() || '/') : '/';
    }

    function pathParts(path) {
        return String(path || '').split('/').filter(function (p) { return p !== ''; });
    }

    function trail(location, parts) {
        var items = [{id: 'dir:/', label: clip(location, 80) || '/'}];
        var acc = '';
        parts.forEach(function (part) {
            acc += '/' + part;
            items.push({id: 'dir:' + acc, label: clip(part, 80)});
        });
        if (items.length > 8) {
            items = [items[0]].concat(items.slice(items.length - 7));
        }
        return items;
    }

    function action(controller, name) {
        try {
            return controller && controller.getActionByName ? controller.getActionByName(name) : null;
        } catch {
            return null;
        }
    }

    function unavailable(a) {
        return !a || !!a.deny || !!a.contextHidden;
    }

    function buildPage(pydio) {
        var user = pydio && pydio.user;
        if (!user || !user.getRepositoriesList) {
            return null;
        }
        var repos = user.getRepositoriesList();
        var repo = user.getActiveRepositoryObject ? user.getActiveRepositoryObject() : null;
        var controller = pydio.getController ? pydio.getController() : pydio.Controller;
        var holder = pydio.getContextHolder ? pydio.getContextHolder() : null;
        var tabs = [];
        if (repos && repos.has && repos.has('homepage')) {
            tabs.push({id: 'home', label: text('home')});
        }
        tabs.push({id: 'files', label: text('files')});
        tabs.push({id: 'bookmarks', label: text('bookmarks')});
        var homepage = user.activeRepository === 'homepage';
        var gateway = !!repo && repo.accessType === 'gateway';
        var activeTab = pane === 'bookmarks' ? 'bookmarks' : homepage && tabs[0].id === 'home' ? 'home' : 'files';
        var location = repo && repo.getLabel ? repo.getLabel() : '';
        handlers = {};

        if (editor) {
            var file = editor.node;
            var dirs = pathParts(nodePath(file)).slice(0, -1);
            var editorActions = [];
            if (editor.download) {
                editorActions.push({id: 'download', label: text('download'), variant: 'secondary', icon: 'download'});
                handlers.download = editor.download;
            }
            if (shareOpener && action(controller, 'share')) {
                editorActions.push({id: 'share', label: text('share'), variant: 'secondary', icon: 'share'});
                handlers.share = function () { shareOpener(file); };
            }
            return {
                title: clip(editor.title || (file.getLabel && file.getLabel()) || '', 120),
                breadcrumbs: trail(location, dirs),
                tabs: tabs,
                activeTab: activeTab,
                actions: editorActions,
            };
        }

        if (!gateway || !holder) {
            return {
                title: clip(homepage ? text('home') : location || text('files'), 120),
                tabs: tabs,
                activeTab: activeTab,
                actions: [],
            };
        }

        var node = holder.getContextNode ? holder.getContextNode() : null;
        if (node && holder.getSearchNode && node === holder.getSearchNode()) {
            return {title: text('search'), tabs: tabs, activeTab: activeTab, actions: []};
        }
        var parts = pathParts(nodePath(node));
        var title = parts.length ? (node.getLabel && node.getLabel()) || parts[parts.length - 1] : location;
        var actions = [];
        var upload = action(controller, 'upload');
        if (upload) {
            // Kailo opens the file picker in the user's click (07 §4.8.7 文件选择通道);
            // the chosen files go straight to the native uploader for this folder.
            // A read-only location keeps the action visible but unavailable.
            var blocked = unavailable(upload);
            actions.push({id: 'upload', label: text('upload'), variant: 'primary', icon: 'upload', files: {multiple: true}, disabled: blocked});
            handlers.upload = function (selection) { uploadSelection(controller, node, selection); };
        }
        var mkdir = action(controller, 'mkdir');
        if (mkdir) {
            actions.push({id: 'mkdir', label: text('mkdir'), variant: 'secondary', icon: 'folder-plus', disabled: unavailable(mkdir)});
            handlers.mkdir = function () { controller.fireAction('mkdir'); };
        }
        if (upload) {
            actions.push({id: 'upload-folder', label: text('uploadFolder'), variant: 'menu', icon: 'upload', files: {directory: true}, disabled: blocked});
            handlers['upload-folder'] = function (selection) { uploadSelection(controller, node, selection); };
        }
        var mkfile = action(controller, 'mkfile');
        var builder = mkfile && mkfile.subMenuItems && mkfile.subMenuItems.dynamicBuilder;
        if (mkfile && !unavailable(mkfile) && typeof builder === 'function') {
            var templates = [];
            try {
                templates = builder() || [];
            } catch {
                templates = [];
            }
            templates.filter(function (tpl) { return tpl && typeof tpl.callback === 'function' && tpl.alt; }).slice(0, 3).forEach(function (tpl, i) {
                actions.push({id: 'mkfile:' + i, label: clip(text('newFile', tpl.alt), 40), variant: 'menu', icon: 'plus'});
                handlers['mkfile:' + i] = function () { tpl.callback(); };
            });
        }
        if (parts.length && action(controller, 'share') && shareOpener) {
            actions.push({id: 'share', label: text('shareFolder'), variant: 'menu', icon: 'share'});
            handlers.share = function () { shareOpener(node); };
        }
        if (action(controller, 'refresh')) {
            actions.push({id: 'refresh', label: text('refresh'), variant: 'menu', icon: 'refresh'});
            handlers.refresh = function () { controller.fireAction('refresh'); };
        }
        var page = {title: clip(title, 120) || text('files'), tabs: tabs, activeTab: activeTab, actions: actions.slice(0, 8)};
        if (parts.length) {
            page.breadcrumbs = trail(location, parts.slice(0, -1));
        }
        return page;
    }

    // Opens the native share dialog for one node (set by the GUI, which owns the data model).
    var shareOpener = null;

    function syncPage() {
        pageTimer = null;
        if (!hosted || !embed) {
            return false;
        }
        var page = buildPage(window.pydio);
        if (!page) {
            return false;
        }
        var key = JSON.stringify(page);
        if (key === lastPage) {
            return true;
        }
        var shown = false;
        try {
            shown = embed.setPage(page) === true;
        } catch {
            shown = false;
        }
        lastPage = shown ? key : '';
        // Before Kailo answers the page waits behind Kailo's skeleton; an
        // answered host that does not draw the header gives it back.
        if (!shown && (hostAnswered() || !candidate)) {
            setHosted(false);
        }
        return shown;
    }

    function schedulePage() {
        if (!hosted || pageTimer !== null) {
            return;
        }
        pageTimer = window.setTimeout(syncPage, 30);
    }

    function switchToFiles(pydio) {
        var user = pydio.user;
        var repo = user.getActiveRepositoryObject ? user.getActiveRepositoryObject() : null;
        if (repo && repo.accessType === 'gateway') {
            return;
        }
        var list = [];
        user.getRepositoriesList().forEach(function (r) {
            if (r.accessType === 'gateway') {
                list.push(r);
            }
        });
        if (!list.length) {
            return;
        }
        var personal = list.filter(function (r) { return r.getRepositoryType && r.getRepositoryType() === 'workspace-personal'; });
        var shared = list.filter(function (r) { return !(r.getOwner && r.getOwner()); });
        var target = personal[0] || shared[0] || list[0];
        pydio.triggerRepositoryChange(target.getId());
    }

    function navigate(target) {
        var pydio = window.pydio;
        if (!pydio || !pydio.user || !target) {
            return;
        }
        if (editor && editor.close) {
            editor.close();
            editor = null;
        }
        if (target.kind === 'tab') {
            if (target.id === 'bookmarks') {
                setPane('bookmarks');
            } else if (target.id === 'home') {
                setPane('files');
                var home = action(pydio.getController(), 'switch_to_homepage');
                if (home) {
                    home.apply();
                }
            } else if (target.id === 'files') {
                setPane('files');
                switchToFiles(pydio);
            }
        } else if (target.kind === 'breadcrumb' && target.id.indexOf('dir:') === 0) {
            pydio.goTo(target.id.slice(4) || '/');
        }
        schedulePage();
    }

    function runAction(id, selection) {
        var fn = handlers[id];
        if (typeof fn === 'function') {
            fn(selection);
        }
    }

    // ---- Header upload (07 §4.8.7 文件选择通道, 20 §13.4(6)) ------------------
    // Kailo delivers the files chosen in its picker with the action; they enter
    // the native upload queue exactly like a drop on the files list
    // (uploader.html DropUploader: onDrop / onFolderPicked), into the folder
    // the header was declared for. Progress shows in the files list and, when
    // the native flow needs a decision (existing files, metadata, manual
    // start, errors), the native uploader opens its dialog itself.

    // Relative paths of a folder pick ('photos/2026/a.jpg'), or null for plain
    // files. A path that is not a clean relative path falls back to the name.
    function relativePaths(files, paths) {
        var nested = false;
        var out = files.map(function (file, i) {
            var name = String(file && file.name || '');
            var raw = paths && typeof paths[i] === 'string' ? paths[i] : name;
            var parts = raw.split('/');
            var clean = parts.length > 1 && parts.every(function (part) {
                return part !== '' && part !== '.' && part !== '..' && part.indexOf('\\') === -1;
            });
            if (!clean) {
                return name;
            }
            nested = true;
            return raw;
        });
        return nested ? out : null;
    }

    function loadUploader() {
        if (window.UploaderModel && window.UploaderModel.Store) {
            return Promise.resolve(window.UploaderModel);
        }
        try {
            return Promise.resolve(window.require('pydio/http/resources-manager').loadClass('UploaderModel'));
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function readOnly(node) {
        var meta = node && node.getMetadata ? node.getMetadata() : null;
        return !!meta && (meta.get('node_readonly') === 'true' || meta.get('level_readonly') === 'true');
    }

    function uploadSelection(controller, node, selection) {
        var files = selection && Array.isArray(selection.files) ? selection.files.slice() : [];
        if (!files.length) {
            // A Kailo without the file channel: the native upload dialog.
            controller.fireAction('upload');
            return;
        }
        var pydio = window.pydio;
        var forbidden = function () {
            var hash = pydio && pydio.MessageHash;
            var ui = pydio && pydio.UI;
            if (ui && ui.displayMessage) {
                ui.displayMessage('ERROR', (hash && hash['html_uploader.upload.forbidden']) || text('uploadFailed'));
            }
        };
        if (!node || readOnly(node)) {
            forbidden();
            return;
        }
        var paths = relativePaths(files, selection.paths);
        loadUploader().then(function (model) {
            var store = model.Store.getInstance();
            if (paths) {
                store.handleFolderPickerResult(files, node, paths);
            } else {
                store.handleDropEventResults(null, files, node);
            }
        }).catch(forbidden);
    }

    function watchPydio(pydio) {
        if (!hosted || !pydio || !pydio.observe) {
            return;
        }
        var later = function () { schedulePage(); };
        ['user_logged', 'repository_list_refreshed', 'context_changed', 'language'].forEach(function (name) {
            pydio.observe(name, later);
        });
        var holder = pydio.getContextHolder && pydio.getContextHolder();
        if (holder && holder.observe) {
            holder.observe('context_changed', later);
            holder.observe('context_loaded', later);
        }
        var controller = pydio.getController && pydio.getController();
        if (controller && controller.observe) {
            controller.observe('actions_refreshed', later);
        }
        schedulePage();
    }

    if (hosted) {
        embed.onNavigate(navigate);
        embed.onAction(runAction);
    }

    // Drag to upload (spec §4): while files are dragged over the page the
    // files list shows the Kailo drop target (inset dashed brand frame,
    // Upload icon, "松开即可上传到「目录」"). The native drop handling is kept;
    // the overlay never takes pointer events.
    function dropTargetName(pydio) {
        var user = pydio && pydio.user;
        var repo = user && user.getActiveRepositoryObject ? user.getActiveRepositoryObject() : null;
        var holder = pydio && pydio.getContextHolder ? pydio.getContextHolder() : null;
        var node = holder && holder.getContextNode ? holder.getContextNode() : null;
        if (!repo || repo.accessType !== 'gateway' || !node) {
            return '';
        }
        var upload = action(pydio.getController ? pydio.getController() : null, 'upload');
        if (!upload || unavailable(upload)) {
            return '';
        }
        var parts = pathParts(nodePath(node));
        return parts.length ? (node.getLabel && node.getLabel()) || parts[parts.length - 1] : repo.getLabel();
    }

    function watchFileDrag() {
        if (!document.addEventListener) {
            return;
        }
        var depth = 0;
        var overlay = null;
        var hasFiles = function (event) {
            var types = event.dataTransfer && event.dataTransfer.types;
            return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
        };
        var hide = function () {
            depth = 0;
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            overlay = null;
        };
        var show = function () {
            // Kailo mode is known once the start parameters exist (after this script).
            if (!kailoMode()) {
                return;
            }
            var list = document.querySelector('.main-files-list');
            var name = dropTargetName(window.pydio);
            if (!list || !name) {
                return;
            }
            var box = list.getBoundingClientRect();
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'kailo-drop-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                var icon = document.createElement('div');
                icon.className = 'kailo-drop-overlay-icon';
                var label = document.createElement('div');
                label.className = 'kailo-drop-overlay-label';
                overlay.appendChild(icon);
                overlay.appendChild(label);
                document.body.appendChild(overlay);
            }
            overlay.lastChild.textContent = text('dropTo', clip(name, 60));
            overlay.style.left = box.left + 12 + 'px';
            overlay.style.top = box.top + 12 + 'px';
            overlay.style.width = Math.max(0, box.width - 24) + 'px';
            overlay.style.height = Math.max(0, box.height - 24) + 'px';
        };
        document.addEventListener('dragenter', function (event) {
            if (hasFiles(event)) {
                depth += 1;
                show();
            }
        }, true);
        document.addEventListener('dragleave', function (event) {
            if (hasFiles(event)) {
                depth -= 1;
                if (depth <= 0) {
                    hide();
                }
            }
        }, true);
        document.addEventListener('drop', hide, true);
        document.addEventListener('dragend', hide, true);
    }
    watchFileDrag();

    // Icon font not ready yet: no missing-glyph boxes (spec §3 加载), the
    // icons appear once the native icon font has loaded (at most 6 s).
    function watchIconFont(tries) {
        var root = document.documentElement;
        var fonts = document.fonts;
        if (!root || !fonts || typeof fonts.forEach !== 'function' || (tries || 0) > 60) {
            if (root) {
                root.setAttribute('data-kailo-icons-ready', '');
            }
            return;
        }
        var ready = false;
        fonts.forEach(function (face) {
            if (String(face.family).replace(/["']/g, '') === 'Material Design Icons' && face.status === 'loaded') {
                ready = true;
            }
        });
        if (ready) {
            root.setAttribute('data-kailo-icons-ready', '');
            return;
        }
        window.setTimeout(function () { watchIconFont((tries || 0) + 1); }, 100);
    }
    watchIconFont(0);

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
        kailoMode: kailoMode,
        // DD-138: personal/global-shell entries (account dashboard, password,
        // about, admin console switch, rail theme toggle, notification bell,
        // rail user menu) render only outside Kailo mode; Kailo provides them.
        showPersonalShell: function () { return !kailoMode(); },
        startLogin: startLogin,
        consumeReturnPath: consumeReturnPath,
        // DD-157 (07 §4.8.7): Kailo draws the page header; the GUI renders no
        // title, breadcrumb, rail or create menu of its own while true.
        pageHosted: pageHosted,
        text: text,
        wording: wording,
        locationLabel: locationLabel,
        toast: toast,
        confirm: confirm,
        deleteConfirm: deleteConfirm,
        namedConfirm: namedConfirm,
        // listener(hosted) when Kailo's answer changes who draws the header.
        onPageHosted: function (fn) {
            if (typeof fn === 'function') {
                hostedListeners.push(fn);
            }
            return function () {
                hostedListeners = hostedListeners.filter(function (f) { return f !== fn; });
            };
        },
        listPane: function () { return pane; },
        setListPane: function (next) { setPane(next === 'bookmarks' ? 'bookmarks' : 'files'); },
        onListPane: function (fn) {
            if (typeof fn === 'function') {
                paneListeners.push(fn);
            }
            return function () {
                paneListeners = paneListeners.filter(function (f) { return f !== fn; });
            };
        },
        setEditor: setEditor,
        setShareOpener: function (fn) { shareOpener = typeof fn === 'function' ? fn : null; schedulePage(); },
        _internal: {nativeLanguage: nativeLanguage, kailoLocale: kailoLocale, safeReturnPath: safeReturnPath, params: params,
            buildPage: buildPage, syncPage: syncPage, navigate: navigate, runAction: runAction, dropTargetName: dropTargetName,
            relativePaths: relativePaths}
    };

    // The native re-render after a theme change can outlast the runtime's
    // one-frame switching marker: keep transitions off until it has landed.
    var switchTimer = null;

    function holdThemeSwitch() {
        var root = document.documentElement;
        if (!root) {
            return;
        }
        root.setAttribute('data-kailo-cells-theme-switching', '');
        if (switchTimer !== null && window.clearTimeout) {
            window.clearTimeout(switchTimer);
        }
        switchTimer = window.setTimeout(function () {
            switchTimer = null;
            root.removeAttribute('data-kailo-cells-theme-switching');
        }, 400);
    }

    if (embed) {
        embed.onChange(function (state, changed) {
            if (changed && changed.theme) {
                holdThemeSwitch();
            }
            // DD-157: the host's first answer says whether it draws the header.
            if (candidate && state && state.hostConnected) {
                setHosted(hostHandles('page'));
            }
            notify();
            if (changed && changed.locale) {
                schedulePage();
            }
        });
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
        watchPydio(pydio);
    });
})(window, document);
