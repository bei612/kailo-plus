/*
 * Kailo DD-163 (.design/07 §4.8.8): one collaboration system. In Kailo mode
 * shared-space chat is Kailo channels; the chat toggle, the docked or
 * detached chat panel and the unread chat icon of a shared space are not
 * rendered, and the chat service refuses every room but file comments
 * (common/auth/native-kailo-chat.go). File comments (meta.comments, NODE
 * rooms) stay: they belong to the file.
 */

function kailoModeOn(kailo) {
    return !!(kailo && typeof kailo.kailoMode === 'function' && kailo.kailoMode())
}

/** Whether shared-space chat is offered at all (toggle, panel, unread icon). */
export function workspaceChatShown(pydio, kailo = (typeof window !== 'undefined' ? window.KailoCells : undefined)) {
    if (kailoModeOn(kailo)) {
        return false
    }
    return !pydio.getPluginConfigs('action.advanced_settings').get('GLOBAL_DISABLE_CHATS')
}
