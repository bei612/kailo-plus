/*
 * Kailo DD-132(2)(3): launch rules of the native ONLYOFFICE editor page.
 * Licensed under the GNU Affero General Public License v3, like Pydio Cells.
 */

// DD-132(3): macros and plugins are closed for every launch through the native
// docs_api_config form field of the WOPI editor route (SF-OFF-11).
export const DOCS_API_CONFIG = JSON.stringify({editorConfig: {customization: {macros: false, plugins: false}}});

// DocumentServer locale from the Cells user preference (en-us -> en-US).
export function editorLocale(preference) {
    const parts = String(preference || '').replace('_', '-').split('-');
    const lang = (parts[0] || '').toLowerCase();
    if (!/^[a-z]{2,3}$/.test(lang)) return 'en-US';
    return parts[1] && /^[a-z]{2}$/i.test(parts[1]) ? `${lang}-${parts[1].toUpperCase()}` : lang;
}

// Only the fixed WOPI action of the configured DocumentServer is accepted; the
// locale parameters are the only ones this page sets.
export function launchAction(url, publicOrigin, locale) {
    const action = new URL(url);
    if (action.origin !== publicOrigin || !/^\/hosting\/wopi\/(word|cell|slide|pdf|diagram)\/(view|edit)$/.test(action.pathname)
        || action.username || action.password || action.hash || action.searchParams.has('access_token')
        || action.searchParams.get('dchat') !== '1' || !action.searchParams.get('wopisrc')) {
        throw new Error('unexpected document editor action');
    }
    action.searchParams.set('ui', locale);
    action.searchParams.set('lang', locale);
    return action.toString();
}
