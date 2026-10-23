/*
 * Kailo DD-132(2)(3): launch rules of the native ONLYOFFICE editor page.
 * Licensed under the GNU Affero General Public License v3, like Pydio Cells.
 */

// DD-138 (07 §4.8.2): document editor preferences declared by the Files release
// (manifest.native-page.json frontendPresentationContract.preferences) and set
// only in Kailo settings. Missing or invalid values fall back to the declared
// defaults, which must stay equal to the release declaration.
export const DOCUMENT_PREFERENCES = Object.freeze({
    measurementUnit: Object.freeze({key: 'documents.measurementUnit', options: Object.freeze(['cm', 'pt', 'inch']), defaultValue: 'cm'}),
    spellcheck: Object.freeze({key: 'documents.spellcheck', defaultValue: true}),
});

// Values Kailo supplied through the platform runtime (window.KailoEmbed); an
// absent or failing runtime yields no values, so the declared defaults apply.
export function kailoPreferences(runtime) {
    try {
        const values = runtime && typeof runtime.getPreferences === 'function' ? runtime.getPreferences() : null;
        return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    } catch (_) {
        return {};
    }
}

// DD-132(3) + DD-138: the editor configuration posted through the native
// docs_api_config form field of the WOPI editor route (SF-OFF-11) at each
// document launch. Macros and plugins stay closed and the editor "Advanced
// settings" file-menu item is hidden (ONLYOFFICE checks
// Common.UI.LayoutManager.isElementVisible('toolbar-file-settings')), so the
// Kailo settings page is the only place for these preferences. The editor
// reads the configuration only when it starts: a preference change applies
// at the next document open.
export function docsApiConfig(preferences) {
    const values = preferences && typeof preferences === 'object' ? preferences : {};
    const {measurementUnit, spellcheck} = DOCUMENT_PREFERENCES;
    const unit = measurementUnit.options.indexOf(values[measurementUnit.key]) >= 0 ? values[measurementUnit.key] : measurementUnit.defaultValue;
    const check = typeof values[spellcheck.key] === 'boolean' ? values[spellcheck.key] : spellcheck.defaultValue;
    return JSON.stringify({editorConfig: {customization: {
        macros: false,
        plugins: false,
        layout: {toolbar: {file: {settings: false}}},
        unit,
        features: {spellcheck: {mode: check, change: false}},
    }}});
}

// DocumentServer locale from the Cells user preference (en-us -> en-US).
export function editorLocale(preference) {
    const parts = String(preference || '').replace('_', '-').split('-');
    const lang = (parts[0] || '').toLowerCase();
    if (!/^[a-z]{2,3}$/.test(lang)) return 'en-US';
    return parts[1] && /^[a-z]{2}$/i.test(parts[1]) ? `${lang}-${parts[1].toUpperCase()}` : lang;
}

// DD-133 §4.7.2 / DD-132(7)③: the Kailo presentation (window.KailoEmbed, loaded by
// the Cells page) decides the launch theme and locale; without a Kailo host the
// Cells user preference keeps the locale and the editor default the theme.
export function kailoPresentation(runtime) {
    try {
        const state = runtime && typeof runtime.getState === 'function' ? runtime.getState() : null;
        if (!state || !state.hostConnected) return null;
        return {
            theme: state.theme === 'dark' ? 'dark' : 'light',
            locale: state.locale === 'zh-CN' ? 'zh-CN' : 'en-US',
        };
    } catch (_) {
        return null;
    }
}

// WOPI host message the editor page understands (editor-wopi.ejs commandMap).
export function presentationMessage(theme) {
    if (theme !== 'light' && theme !== 'dark') throw new Error('unknown Kailo theme');
    return JSON.stringify({MessageId: 'Kailo_Presentation', SendTime: Date.now(), Values: {theme}});
}

// DD-132(7)②: the instance's legal notices (AGPLv3 §5(d), §13).
export function legalNoticeUrl(publicOrigin) {
    const origin = new URL(publicOrigin);
    if (origin.origin !== publicOrigin) throw new Error('unexpected document editor origin');
    return `${publicOrigin}/kailo-legal/`;
}

// Only the fixed WOPI action of the configured DocumentServer is accepted; the
// locale and theme parameters are the only ones this page sets.
export function launchAction(url, publicOrigin, locale, theme) {
    const action = new URL(url);
    if (action.origin !== publicOrigin || !/^\/hosting\/wopi\/(word|cell|slide|pdf|diagram)\/(view|edit)$/.test(action.pathname)
        || action.username || action.password || action.hash || action.searchParams.has('access_token')
        || action.searchParams.get('dchat') !== '1' || !action.searchParams.get('wopisrc')) {
        throw new Error('unexpected document editor action');
    }
    action.searchParams.set('ui', locale);
    action.searchParams.set('lang', locale);
    if (theme === 'light' || theme === 'dark') action.searchParams.set('thm', theme === 'dark' ? '2' : '1');
    return action.toString();
}
