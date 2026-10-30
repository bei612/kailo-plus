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

    // ---- DD-138(6) admin surfaces (07 §4.8.5) -------------------------------
    // Kailo loads one declared admin function at its fixed path with
    // kailo_admin_surface=<key>. The allowlist equals adminSurfaces of
    // fork/release/manifest.native-page.json and the server allowlist
    // (frontend/web/kailo-admin.go), which already refused any other admin
    // path before this page was served. The key only selects what renders.
    var ADMIN_SEGMENT = '/kailo-admin';
    var ADMIN_PARAM = 'kailo_admin_surface';
    var ADMIN_STORE = 'kailo-embed-admin-surface'; // kept by kailo-embed.js for the launched path
    var ADMIN_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
    var KAILO_ADMIN_SURFACES = {
        'storage.dataSources': {
            path: '/kailo-admin/data-sources', node: '/data/datasources', component: 'AdminWorkspaces.DataSourcesBoard',
            access: 'READ_ONLY', title: {'zh-CN': '文件存储位置', en: 'File storage locations'},
        },
        'files.metadata': {
            path: '/kailo-admin/metadata', node: '/data/metadata', component: 'AdminWorkspaces.MetadataBoard',
            access: 'EDITABLE', title: {'zh-CN': '文件元数据字段', en: 'File metadata fields'},
        },
    };

    function currentPath() {
        return String((window.location && window.location.pathname) || '');
    }

    // This document is an admin surface page (Kailo mode, /kailo-admin/...):
    // it renders that one admin function or the unavailable state, nothing else.
    function adminSurfacePage() {
        var p = currentPath();
        return kailoMode() && (p === ADMIN_SEGMENT || p.indexOf(ADMIN_SEGMENT + '/') === 0);
    }

    // The launched key: the runtime's value for this document; after the
    // in-page OIDC return (LoginCallbackRouter puts back the saved path and
    // query) the query of the current location, else the tab's record of the
    // launch when it was for this very path.
    function launchedSurfaceKey() {
        var key = embed && typeof embed.adminSurface === 'function' ? embed.adminSurface() : null;
        if (key) {
            return key;
        }
        try {
            var values = new URLSearchParams(window.location.search || '').getAll(ADMIN_PARAM);
            if (values.length) {
                return values.length === 1 ? values[0] : null;
            }
        } catch {
            return null;
        }
        var stored = readJSON(ADMIN_STORE);
        return stored && typeof stored.key === 'string' && stored.path === currentPath() ? stored.key : null;
    }

    // The declared surface this page renders, or null: unknown key, a key
    // declared for another path, a missing or malformed key.
    function adminSurface() {
        if (!adminSurfacePage()) {
            return null;
        }
        var key = launchedSurfaceKey();
        if (typeof key !== 'string' || key.length > 64 || !ADMIN_KEY.test(key) ||
            !Object.prototype.hasOwnProperty.call(KAILO_ADMIN_SURFACES, key)) {
            return null;
        }
        var s = KAILO_ADMIN_SURFACES[key];
        if (s.path !== currentPath()) {
            return null;
        }
        return {
            key: key, node: s.node, component: s.component, access: s.access, readOnly: s.access === 'READ_ONLY',
            title: s.title[embedState().locale === 'en' ? 'en' : 'zh-CN'],
        };
    }

    // DD-167 (07 §4.8.10): Kailo's text size dial (13 / 14 / 15 px body) and
    // its ⌘± zoom. Older runtimes and hosts leave them out: the defaults.
    var FONT_SIZES = {smaller: 13 / 14, 'default': 1, larger: 15 / 14};

    function typeState(s) {
        var fontSize = s && Object.prototype.hasOwnProperty.call(FONT_SIZES, s.fontSize) ? s.fontSize : 'default';
        var zoom = s && typeof s.zoom === 'number' && isFinite(s.zoom) && s.zoom >= 0.75 && s.zoom <= 1.5 ? s.zoom : 1;
        var scale = s && typeof s.typeScale === 'number' && isFinite(s.typeScale) && s.typeScale > 0 ? s.typeScale : FONT_SIZES[fontSize];
        return {fontSize: fontSize, zoom: zoom, typeScale: scale};
    }

    function presentation() {
        var s = embedState();
        var type = typeState(s);
        return {theme: s.theme, dark: s.theme === 'dark', locale: s.locale, language: nativeLanguage(s.locale), embedded: !!s.embedded,
            fontSize: type.fontSize, zoom: type.zoom, typeScale: type.typeScale};
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
            adminUnavailable: '该管理项不可用', adminUnavailableBody: '请回到 Kailo 管理区重新打开。', newField: '新建字段',
            dsName: '名称', dsType: '存储类型', dsState: '状态', dsEnabled: '已启用', dsDisabled: '已停用',
            storageLocal: '本地文件系统', storageS3: 'S3 兼容对象存储', storageAzure: 'Azure Blob 存储', storageGcs: 'Google Cloud 存储',
            dsFolder: '存放目录', dsBucket: '存储桶', dsEndpoint: '服务端点', dsRegion: '区域', dsFormat: '存储格式',
            dsFlat: '扁平（只经云盘访问）', dsStructured: '结构化（与目录结构一致）', dsReadOnly: '只读存储', yes: '是',
            dsVersioning: '版本保留', dsNoVersioning: '不保留版本', dsEncryption: '加密', dsEncrypted: '已启用', dsNotEncrypted: '未启用',
            dsPeer: '服务节点', close: '关闭',
            // DD-167 (20 §15): lists, states, host dialogs.
            total: '共 {0} 条', pageOf: '第 {0} / {1} 页', perPage: '每页 {0} 条', prevPage: '上一页', nextPage: '下一页',
            pageCompact: '{0} / {1}', stillLoading: '仍在载入…', retry: '重试',
            colName: '名称', colModified: '修改时间', colSize: '大小', colKind: '类型', colLocation: '所在位置', colModifier: '修改者',
            folderKind: '文件夹', fileKind: '{0} 文件',
            sortBy: '排序', sortName: '名称', sortModified: '修改时间', sortSize: '大小', sortAsc: '升序', sortDesc: '降序',
            viewList: '列表视图', viewGrid: '网格视图', details: '详情', searchHere: '在「{0}」中搜索', searchAll: '搜索文件',
            clearSearch: '清除检索', back: '返回',
            loadFailed: '未能载入文件', loadFailedRecent: '未能载入最近使用', loadFailedFavorites: '未能载入收藏',
            loadFailedSearch: '未能载入搜索结果', loadFailedLocations: '未能载入位置',
            reasonNetwork: '网络不可达，请检查网络后重试。', reasonUnavailable: '服务暂不可用，请稍后重试。',
            reasonTimeout: '请求超时，请稍后重试。', reasonGone: '内容已不存在，可能已被移动或删除。', reasonUnknown: '请稍后重试。',
            forbiddenTitle: '你没有访问此位置的权限', forbiddenFile: '你没有访问此文件的权限',
            forbiddenAdmin: '请联系管理员为你开通访问权限。', forbiddenOwner: '请所有者分享给你后再打开。',
            emptyFolder: '还没有文件', emptyFolderBody: '上传文件或新建文件夹开始使用。',
            emptyReadOnly: '这里还没有内容', emptyReadOnlyBody: '有人分享给你后会显示在这里。',
            emptyRecycleBin: '回收站是空的', emptyRecycleBinBody: '删除的文件会先移到这里，可以在这里恢复。',
            emptyFiltered: '没有符合条件的文件', emptyFilteredBody: '换个关键词试试。',
            emptySearchStart: '输入关键词搜索文件', emptySearchStartBody: '按名称或内容搜索当前位置中的文件。',
            emptyFavorites: '还没有收藏', emptyFavoritesBody: '在文件菜单中选择“收藏”，常用的文件和文件夹会显示在这里。',
            emptyRecent: '最近没有使用过文件', emptyRecentBody: '打开或编辑过的文件会显示在这里。',
            unconfigured: '云盘尚未完成设置', unconfiguredBody: '请管理员在 Kailo 管理区完成设置。',
            recent: '最近使用', items: '{0} 项', spaces: '{0} 个空间', openLocation: '打开', recycle: '回收站',
            mkdirLabel: '名称', mkdirDefault: '新建文件夹', mkdirConfirm: '新建', mkdirExists: '已有同名的文件或文件夹「{0}」',
            mkdirFailed: '未能新建文件夹', mkdirDone: '已新建文件夹「{0}」', mkdirInvalid: '名称不能包含 / 或 \\',
            newFileTitle: '新建{0}', newFileLabel: '文件名', newFileDone: '已新建「{0}」', newFileFailed: '未能新建文件',
            deletedMany: '已删除 {0} 项', deletedOne: '已删除「{0}」', recycledMany: '已将 {0} 项移到回收站', recycledOne: '已将「{0}」移到回收站',
            deleteFailed: '未能删除', emptiedRecycle: '已清空回收站', emptyRecycleFailed: '未能清空回收站',
            renameLabel: '名称', renameConfirm: '重命名', newDoc: '新建文档',
            more: '更多', product: '云盘', unfavorite: '移出收藏',
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
            adminUnavailable: 'This admin item is unavailable', adminUnavailableBody: 'Open it again from the Kailo admin area.', newField: 'New field',
            dsName: 'Name', dsType: 'Storage type', dsState: 'Status', dsEnabled: 'Enabled', dsDisabled: 'Disabled',
            storageLocal: 'Local file system', storageS3: 'S3-compatible object storage', storageAzure: 'Azure Blob Storage', storageGcs: 'Google Cloud Storage',
            dsFolder: 'Folder', dsBucket: 'Bucket', dsEndpoint: 'Endpoint', dsRegion: 'Region', dsFormat: 'Storage format',
            dsFlat: 'Flat (accessed through Files only)', dsStructured: 'Structured (mirrors the folder tree)', dsReadOnly: 'Read-only storage', yes: 'Yes',
            dsVersioning: 'Version retention', dsNoVersioning: 'No versions kept', dsEncryption: 'Encryption', dsEncrypted: 'On', dsNotEncrypted: 'Off',
            dsPeer: 'Service node', close: 'Close',
            // DD-167 (20 §15): lists, states, host dialogs.
            total: '{0} items', pageOf: 'Page {0} of {1}', perPage: '{0} per page', prevPage: 'Previous page', nextPage: 'Next page',
            pageCompact: '{0} / {1}', stillLoading: 'Still loading…', retry: 'Retry',
            colName: 'Name', colModified: 'Modified', colSize: 'Size', colKind: 'Kind', colLocation: 'Location', colModifier: 'Modified by',
            folderKind: 'Folder', fileKind: '{0} file',
            sortBy: 'Sort', sortName: 'Name', sortModified: 'Modified', sortSize: 'Size', sortAsc: 'Ascending', sortDesc: 'Descending',
            viewList: 'List view', viewGrid: 'Grid view', details: 'Details', searchHere: 'Search in "{0}"', searchAll: 'Search files',
            clearSearch: 'Clear search', back: 'Back',
            loadFailed: 'Could not load the files', loadFailedRecent: 'Could not load recent files', loadFailedFavorites: 'Could not load favorites',
            loadFailedSearch: 'Could not load the search results', loadFailedLocations: 'Could not load the locations',
            reasonNetwork: 'The network is unreachable. Check your connection and try again.', reasonUnavailable: 'The service is unavailable right now. Try again later.',
            reasonTimeout: 'The request timed out. Try again later.', reasonGone: 'This item no longer exists. It may have been moved or deleted.', reasonUnknown: 'Try again later.',
            forbiddenTitle: 'You don\'t have access to this location', forbiddenFile: 'You don\'t have access to this file',
            forbiddenAdmin: 'Ask your administrator for access.', forbiddenOwner: 'Ask the owner to share it with you.',
            emptyFolder: 'No files yet', emptyFolderBody: 'Upload files or create a folder to get started.',
            emptyReadOnly: 'Nothing here yet', emptyReadOnlyBody: 'Items shared with you will appear here.',
            emptyRecycleBin: 'The recycle bin is empty', emptyRecycleBinBody: 'Deleted items move here first and can be restored from here.',
            emptyFiltered: 'No matching files', emptyFilteredBody: 'Try a different keyword.',
            emptySearchStart: 'Search for files', emptySearchStartBody: 'Search by name or content in the current location.',
            emptyFavorites: 'No favorites yet', emptyFavoritesBody: 'Choose "Add to favorites" in a file\'s menu to keep it here.',
            emptyRecent: 'No recent files', emptyRecentBody: 'Files you open or edit will appear here.',
            unconfigured: 'Files is not set up yet', unconfiguredBody: 'Ask an administrator to finish the setup in the Kailo admin area.',
            recent: 'Recent', items: '{0} items', spaces: '{0} spaces', openLocation: 'Open', recycle: 'Recycle bin',
            mkdirLabel: 'Name', mkdirDefault: 'New folder', mkdirConfirm: 'Create', mkdirExists: 'An item named "{0}" already exists',
            mkdirFailed: 'Could not create the folder', mkdirDone: 'Created folder "{0}"', mkdirInvalid: 'Names cannot contain / or \\',
            newFileTitle: 'New {0}', newFileLabel: 'File name', newFileDone: 'Created "{0}"', newFileFailed: 'Could not create the file',
            deletedMany: 'Deleted {0} items', deletedOne: 'Deleted "{0}"', recycledMany: 'Moved {0} items to the recycle bin', recycledOne: 'Moved "{0}" to the recycle bin',
            deleteFailed: 'Could not delete', emptiedRecycle: 'Emptied the recycle bin', emptyRecycleFailed: 'Could not empty the recycle bin',
            renameLabel: 'Name', renameConfirm: 'Rename', newDoc: 'New document',
            more: 'More', product: 'Files', unfavorite: 'Remove from favorites',
        }
    };

    function text(key, arg, arg2) {
        var table = TEXT[embedState().locale === 'en' ? 'en' : 'zh-CN'];
        var value = table[key] || TEXT['zh-CN'][key] || key;
        if (arg !== undefined) {
            value = value.replace('{0}', String(arg));
        }
        return arg2 === undefined ? value : value.replace('{1}', String(arg2));
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

    // Admin surface page (DD-138(6)): the header is Kailo's "管理 › 分类 › 标题";
    // the page declares only the surface title (and its own actions) once the
    // panel or the unavailable state is on screen, so the host then reveals it.
    var surfaceReady = false;
    var surfaceActions = [];
    var SURFACE_ICONS = ['plus', 'refresh', 'pencil', 'trash'];

    function setAdminSurfaceState(state) {
        surfaceReady = !!(state && state.ready);
        surfaceActions = state && Array.isArray(state.actions) ? state.actions.filter(function (a) {
            return a && typeof a.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(a.id) && typeof a.run === 'function';
        }).slice(0, 8) : [];
        schedulePage();
    }

    function buildSurfacePage() {
        handlers = {};
        if (!surfaceReady) {
            return null;
        }
        var surface = adminSurface();
        var page = {title: clip(surface ? surface.title : text('adminUnavailable'), 120)};
        if (!surface) {
            return page;
        }
        var actions = [];
        surfaceActions.forEach(function (a) {
            var primary = a.variant === 'primary' && !actions.some(function (b) { return b.variant === 'primary'; });
            var item = {id: 'surface:' + a.id, label: clip(a.label, 40), variant: primary ? 'primary' : 'secondary'};
            if (SURFACE_ICONS.indexOf(a.icon) >= 0) {
                item.icon = a.icon;
            }
            if (a.disabled) {
                item.disabled = true;
            }
            actions.push(item);
            handlers[item.id] = function () { a.run(); };
        });
        if (actions.length) {
            page.actions = actions;
        }
        return page;
    }

    // Read-only facts of one data source for the storage.dataSources surface
    // (definition list, 20 §13.2). Never a credential: ApiKey/ApiSecret and the
    // vault references are not read.
    var STORAGE_TYPES = {LOCAL: 'storageLocal', S3: 'storageS3', AZURE: 'storageAzure', GCS: 'storageGcs'};

    function dataSourceFacts(ds, policies) {
        if (!ds || typeof ds !== 'object') {
            return [];
        }
        var conf = ds.StorageConfiguration && typeof ds.StorageConfiguration === 'object' ? ds.StorageConfiguration : {};
        var type = ds.StorageType || 'LOCAL';
        var facts = [];
        var add = function (label, value) {
            var v = clip(value, 400);
            if (v) {
                facts.push({label: text(label), value: v});
            }
        };
        add('dsName', ds.Name);
        add('dsType', STORAGE_TYPES[type] ? text(STORAGE_TYPES[type]) : type);
        add('dsState', text(ds.Disabled ? 'dsDisabled' : 'dsEnabled'));
        if (type === 'LOCAL') {
            add('dsFolder', conf.folder);
        } else {
            add('dsBucket', ds.ObjectsBucket ? ds.ObjectsBucket + (ds.ObjectsBaseFolder ? '/' + ds.ObjectsBaseFolder : '') : conf.bucketsRegexp);
            add('dsEndpoint', conf.customEndpoint);
            add('dsRegion', conf.customRegion);
        }
        add('dsFormat', text(ds.FlatStorage ? 'dsFlat' : 'dsStructured'));
        if (conf.readOnly === 'true' || conf.readOnly === true) {
            add('dsReadOnly', text('yes'));
        }
        var policy = (Array.isArray(policies) ? policies : []).filter(function (p) {
            return p && p.Uuid && p.Uuid === ds.VersioningPolicyName;
        })[0];
        add('dsVersioning', ds.VersioningPolicyName ? (policy && policy.Name) || ds.VersioningPolicyName : text('dsNoVersioning'));
        add('dsEncryption', text(ds.EncryptionMode === 'MASTER' ? 'dsEncrypted' : 'dsNotEncrypted'));
        add('dsPeer', ds.PeerAddress);
        return facts;
    }

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
        if (adminSurfacePage()) {
            return buildSurfacePage();
        }
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
            templates = templates.filter(function (tpl) { return tpl && typeof tpl.callback === 'function' && tpl.alt; });
            // 20 §15.1: "新建文档" is a secondary action (the word-processing
            // template); the other templates stay in the "more" menu.
            var docIndex = -1;
            templates.forEach(function (tpl, i) {
                if (docIndex < 0 && /\.docx?$|\.odt$|word|文档/i.test(String(tpl.alt))) {
                    docIndex = i;
                }
            });
            if (docIndex >= 0) {
                actions.push({id: 'mkfile:' + docIndex, label: text('newDoc'), variant: 'secondary', icon: 'plus'});
                handlers['mkfile:' + docIndex] = function () { templates[docIndex].callback(); };
            }
            templates.slice(0, 4).forEach(function (tpl, i) {
                if (i === docIndex) {
                    return;
                }
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
        if (!hosted) {
            scheduleLocalPage();
            return;
        }
        if (pageTimer !== null) {
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
        if (!(hosted || kailoMode()) || !pydio || !pydio.observe) {
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

    // ---- DD-167 lists, states and host dialogs (07 §4.8.10, 20 §15) ---------

    // List density: Kailo's 外观 › 列表密度 (manifest preference
    // appearance.listDensity), comfortable 40 px / compact 32 px rows.
    var DENSITY_KEY = 'appearance.listDensity';
    var densityListeners = [];

    function listDensity() {
        var values = null;
        try {
            values = embed && typeof embed.getPreferences === 'function' ? embed.getPreferences() : null;
        } catch {
            values = null;
        }
        return values && values[DENSITY_KEY] === 'compact' ? 'compact' : 'comfortable';
    }

    function rowHeight() {
        return listDensity() === 'compact' ? 32 : 40;
    }

    function markDensity() {
        var root = document.documentElement;
        if (root) {
            root.setAttribute('data-kailo-density', listDensity());
        }
    }
    markDensity();

    if (embed && typeof embed.onPreferencesChange === 'function') {
        embed.onPreferencesChange(function (values, changed) {
            if (changed && changed.indexOf && changed.indexOf(DENSITY_KEY) < 0) {
                return;
            }
            markDensity();
            var density = listDensity();
            densityListeners.slice().forEach(function (fn) {
                try {
                    fn(density);
                } catch {
                    /* consumer errors stay local */
                }
            });
        });
    }

    // Pagination (20 §15.3): page sizes per view, page numbers with gaps.
    var PAGE_SIZES = {list: [20, 50, 100], grid: [24, 48, 96]};

    function pageSizes(view) {
        return PAGE_SIZES[view === 'grid' ? 'grid' : 'list'].slice();
    }

    // A stored size for the given view; the same step of the other view maps over.
    function normalizePageSize(size, view) {
        var sizes = pageSizes(view);
        var n = Number(size);
        if (sizes.indexOf(n) >= 0) {
            return n;
        }
        var i = PAGE_SIZES[view === 'grid' ? 'list' : 'grid'].indexOf(n);
        return i >= 0 ? sizes[i] : sizes[0];
    }

    // {total, page, pages, size}: pages >= 1, page clamped into [1, pages]
    // (a page past the end shows the last one, 20 §15.3).
    function paging(total, page, size) {
        var t = Math.max(0, Math.floor(Number(total) || 0));
        var s = Math.max(1, Math.floor(Number(size) || 1));
        var pages = Math.max(1, Math.ceil(t / s));
        var p = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
        return {total: t, page: p, pages: pages, size: s};
    }

    // Page buttons: all when at most 7, else first, last and the current
    // neighbourhood with 'gap' markers, always 7 slots.
    function pageItems(page, pages) {
        var out = [];
        var i;
        if (pages <= 7) {
            for (i = 1; i <= pages; i += 1) {
                out.push(i);
            }
            return out;
        }
        if (page <= 4) {
            return [1, 2, 3, 4, 5, 'gap', pages];
        }
        if (page >= pages - 3) {
            return [1, 'gap', pages - 4, pages - 3, pages - 2, pages - 1, pages];
        }
        return [1, 'gap', page - 1, page, page + 1, 'gap', pages];
    }

    // Load failure -> state (20 §15.4): forbidden keeps its own state (no
    // retry, no internal code); the others are inline errors with a reason.
    function loadErrorKind(error) {
        if (!error) {
            return 'unknown';
        }
        var status = Number(error.status || error.statusCode || (error.response && error.response.status) || 0);
        var body = String(error.code || error.message || '');
        if (status === 403 || body.indexOf('KAILO_MANAGED') >= 0 || body.indexOf('KAILO_ADMIN_REQUIRED') >= 0) {
            return 'forbidden';
        }
        if (status === 404 || status === 410) {
            return 'gone';
        }
        if (status === 408 || status === 504 || /timeout/i.test(body)) {
            return 'timeout';
        }
        if (status >= 500) {
            return 'unavailable';
        }
        if (!status && (error.crossDomain || /network|failed to fetch|offline/i.test(body))) {
            return 'network';
        }
        return 'unknown';
    }

    var REASONS = {network: 'reasonNetwork', unavailable: 'reasonUnavailable', timeout: 'reasonTimeout', gone: 'reasonGone', unknown: 'reasonUnknown'};

    function loadErrorReason(kind) {
        return text(REASONS[kind] || 'reasonUnknown');
    }

    // Kailo's one-line text dialog (07 §4.8.10): a Promise of the trimmed
    // answer (null on cancel), or null when the page must draw its own.
    function prompt(options) {
        if (!embed || typeof embed.prompt !== 'function' || !options) {
            return null;
        }
        try {
            return embed.prompt(options) || null;
        } catch {
            return null;
        }
    }

    // The page's own one-line dialog when Kailo cannot show it (top level or
    // an older Kailo): the same Kailo dialog (20 §9: title Title 2, label and
    // field, actions right, main action last; Esc and the scrim cancel; the
    // main action is disabled while the text is empty or too long).
    function ownPrompt(options) {
        var opts = options || {};
        var max = Math.max(1, Math.min(255, Math.floor(Number(opts.maxLength) || 255)));
        return new Promise(function (resolve) {
            var previous = document.activeElement;
            var scrim = document.createElement('div');
            scrim.className = 'kailo-dialog-scrim';
            var box = document.createElement('div');
            box.className = 'kailo-dialog';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            var title = document.createElement('h2');
            title.className = 'kailo-dialog-title';
            title.id = 'kailo-dialog-title';
            title.textContent = clip(opts.title, 120);
            box.setAttribute('aria-labelledby', title.id);
            box.appendChild(title);
            if (opts.description) {
                var description = document.createElement('p');
                description.className = 'kailo-dialog-description';
                description.textContent = clip(opts.description, 400);
                box.appendChild(description);
            }
            var label = document.createElement('label');
            label.className = 'kailo-dialog-label';
            label.setAttribute('for', 'kailo-dialog-input');
            label.textContent = clip(opts.label, 80);
            box.appendChild(label);
            var input = document.createElement('input');
            input.className = 'kailo-dialog-input';
            input.id = 'kailo-dialog-input';
            input.type = 'text';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.maxLength = max;
            input.value = String(opts.value || '').slice(0, max);
            if (opts.placeholder) {
                input.placeholder = clip(opts.placeholder, 80);
            }
            box.appendChild(input);
            var actions = document.createElement('div');
            actions.className = 'kailo-dialog-actions';
            var cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'kailo-button kailo-button-secondary';
            cancel.textContent = clip(opts.cancelLabel || text('cancel'), 24);
            var ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'kailo-button kailo-button-primary';
            ok.textContent = clip(opts.confirmLabel || text('mkdirConfirm'), 24);
            actions.appendChild(cancel);
            actions.appendChild(ok);
            box.appendChild(actions);
            scrim.appendChild(box);
            var value = function () { return input.value.trim(); };
            var sync = function () {
                var v = value();
                ok.disabled = !v || v.length > max;
            };
            var done = false;
            var finish = function (answer) {
                if (done) {
                    return;
                }
                done = true;
                document.removeEventListener('keydown', onKey, true);
                if (scrim.parentNode) {
                    scrim.parentNode.removeChild(scrim);
                }
                if (previous && typeof previous.focus === 'function') {
                    try {
                        previous.focus();
                    } catch {
                        /* the element left the page */
                    }
                }
                resolve(answer);
            };
            var onKey = function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(null);
                } else if (event.key === 'Enter' && event.target === input && !ok.disabled) {
                    event.preventDefault();
                    finish(value());
                }
            };
            input.addEventListener('input', sync);
            cancel.addEventListener('click', function () { finish(null); });
            ok.addEventListener('click', function () {
                if (!ok.disabled) {
                    finish(value());
                }
            });
            scrim.addEventListener('mousedown', function (event) {
                if (event.target === scrim) {
                    finish(null);
                }
            });
            document.addEventListener('keydown', onKey, true);
            sync();
            (document.body || document.documentElement).appendChild(scrim);
            try {
                input.focus();
                input.select();
            } catch {
                /* not focusable in this environment */
            }
        });
    }

    // One name from the user: Kailo's dialog when it shows prompts, else the
    // page's own Kailo-styled dialog. Promise of the trimmed text or null.
    function askName(options) {
        return prompt(options) || ownPrompt(options);
    }

    // A file or folder name the native tree accepts: not empty, no path separators.
    function validName(name) {
        var n = String(name === undefined || name === null ? '' : name).trim();
        return !!n && n !== '.' && n !== '..' && n.indexOf('/') < 0 && n.indexOf('\\') < 0 && !hasControlOrBackslash(n);
    }

    // A failed write (20 §15.4): "未能…" with the reason, in the page language.
    function failure(key, reason) {
        var r = clip(reason, 200);
        return text(key) + (r ? (embedState().locale === 'en' ? ': ' : '：') + r : '');
    }

    // Result of a delete (20 §13.4(2)): "已删除 n 项" / "已移到回收站".
    function deleteResult(count, name, permanent) {
        var n = Number(count) || 0;
        var one = n === 1 && name;
        if (permanent) {
            return text(one ? 'deletedOne' : 'deletedMany', one ? clip(name, 80) : n);
        }
        return text(one ? 'recycledOne' : 'recycledMany', one ? clip(name, 80) : n);
    }

    // ⌘± zoom inside the page (07 §4.8.10): the body carries zoom (overlay
    // CSS), so floating layers zoom with the content. Chrome's CSS zoom
    // reports rectangles and pointer coordinates in viewport pixels while
    // positions inside the zoomed body are in its own pixels; the native
    // popovers and context menus position themselves from those numbers, so
    // while zoomed both are reported in the body's pixels.
    var typeListeners = [];
    var zoomGeometry = false;

    function currentZoom() {
        return typeState(embedState()).zoom;
    }

    function installZoomGeometry() {
        if (zoomGeometry) {
            return;
        }
        var El = window.Element;
        var Mouse = window.MouseEvent;
        if (!El || !El.prototype || typeof El.prototype.getBoundingClientRect !== 'function') {
            return;
        }
        zoomGeometry = true;
        var rect = El.prototype.getBoundingClientRect;
        El.prototype.getBoundingClientRect = function () {
            var r = rect.apply(this, arguments);
            var z = currentZoom();
            if (z === 1 || this === document.documentElement) {
                return r;
            }
            var x = r.left / z;
            var y = r.top / z;
            var w = r.width / z;
            var h = r.height / z;
            return {x: x, y: y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: function () { return this; }};
        };
        if (Mouse && Mouse.prototype && Object.getOwnPropertyDescriptor) {
            ['clientX', 'clientY', 'pageX', 'pageY'].forEach(function (name) {
                var d = Object.getOwnPropertyDescriptor(Mouse.prototype, name);
                if (d && typeof d.get === 'function' && d.configurable) {
                    Object.defineProperty(Mouse.prototype, name, {
                        configurable: true,
                        enumerable: d.enumerable,
                        get: function () {
                            var v = d.get.call(this);
                            var z = currentZoom();
                            return z === 1 ? v : v / z;
                        },
                    });
                }
            });
        }
    }

    function typeChanged() {
        if (currentZoom() !== 1) {
            installZoomGeometry();
        }
        var t = typeState(embedState());
        typeListeners.slice().forEach(function (fn) {
            try {
                fn(t);
            } catch {
                /* consumer errors stay local */
            }
        });
    }
    if (currentZoom() !== 1) {
        installZoomGeometry();
    }

    function listenerList(list) {
        return function (fn) {
            if (typeof fn === 'function') {
                list.push(fn);
            }
            return function () {
                var i = list.indexOf(fn);
                if (i >= 0) {
                    list.splice(i, 1);
                }
            };
        };
    }

    // Header at top level (no Kailo frame): the page draws the same header
    // (title, breadcrumbs, tabs, actions) itself in Kailo style (07 §4.8.7(1)).
    var localPageListeners = [];
    var localPageTimer = null;

    function scheduleLocalPage() {
        if (hosted || !kailoMode() || adminSurfacePage() || localPageTimer !== null || !localPageListeners.length) {
            return;
        }
        localPageTimer = window.setTimeout(function () {
            localPageTimer = null;
            var page = null;
            try {
                page = buildPage(window.pydio);
            } catch {
                page = null;
            }
            localPageListeners.slice().forEach(function (fn) {
                try {
                    fn(page);
                } catch {
                    /* consumer errors stay local */
                }
            });
        }, 30);
    }

    function localPage() {
        if (hosted || !kailoMode()) {
            return null;
        }
        try {
            return buildPage(window.pydio);
        } catch {
            return null;
        }
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
        kailoMode: kailoMode,
        // DD-138: personal/global-shell entries (account dashboard, password,
        // about, admin console switch, rail theme toggle, notification bell,
        // rail user menu) render only outside Kailo mode; Kailo provides them.
        showPersonalShell: function () { return !kailoMode(); },
        // DD-138(6) (07 §4.8.5): an admin surface page renders only its one
        // admin function (adminSurface(), else the unavailable state); in Kailo
        // mode the native console renders nothing else.
        adminSurfacePage: adminSurfacePage,
        adminSurface: adminSurface,
        // {ready, actions:[{id, label, icon?, variant?, disabled?, run}]} of the surface page.
        setAdminSurfaceState: setAdminSurfaceState,
        dataSourceFacts: dataSourceFacts,
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
        // DD-167 (07 §4.8.10, 20 §15): density, paging, states, host dialogs, type dials.
        listDensity: listDensity,
        rowHeight: rowHeight,
        onListDensity: listenerList(densityListeners),
        pageSizes: pageSizes,
        normalizePageSize: normalizePageSize,
        paging: paging,
        pageItems: pageItems,
        loadErrorKind: loadErrorKind,
        loadErrorReason: loadErrorReason,
        prompt: prompt,
        askName: askName,
        validName: validName,
        deleteResult: deleteResult,
        failure: failure,
        zoom: currentZoom,
        onTypeChange: listenerList(typeListeners),
        // Kailo mode at top level: the page draws Kailo's header itself.
        localPage: localPage,
        onLocalPage: function (fn) {
            var stop = listenerList(localPageListeners)(fn);
            scheduleLocalPage();
            return stop;
        },
        navigatePage: function (target) { navigate(target); },
        runPageAction: function (id, selection) { runAction(id, selection); },
        _internal: {nativeLanguage: nativeLanguage, kailoLocale: kailoLocale, safeReturnPath: safeReturnPath, params: params,
            buildPage: buildPage, syncPage: syncPage, navigate: navigate, runAction: runAction, dropTargetName: dropTargetName,
            relativePaths: relativePaths, typeState: typeState}
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
            if (changed && (changed.fontSize || changed.zoom)) {
                typeChanged();
            }
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
