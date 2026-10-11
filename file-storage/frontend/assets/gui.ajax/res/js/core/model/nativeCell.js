import PydioApi from '../http/PydioApi'
import uuid4 from 'uuid4'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only the original UI intent reference is stored. Neither a platform token
// nor permission is persisted, and an unknown old generation is never replaced.
export default async function nativeCell(pydio, request, api) {
    if (!request.Room || !request.Room.Uuid) return api.putCell(request);
    const user = pydio.user;
    const userId = user && user.id;
    const repository = user && user.getActiveRepository();
    const client = PydioApi.getRestClient();
    const current = () => pydio.user === user && user.id === userId && user.getActiveRepository() === repository;
    if (!userId || !repository || !UUID.test(request.Room.Uuid)) throw new Error(pydio.MessageHash[391]);
    const cacheKey = JSON.stringify(['native-cell-members', document.location.origin, userId, repository, request.Room.Uuid]);
    const attempt = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    const base = new URL(client.basePath.replace(/\/$/, '') + '/', document.location.href);
    if (base.origin !== document.location.origin || base.username || base.password) throw new Error(pydio.MessageHash[391]);
    const call = async (path, method, body, headers = {}) => {
        const token = await client.getOrUpdateJwt();
        if (!current() || !token) throw new Error(pydio.MessageHash[391]);
        const response = await fetch(new URL(path, base).href, {method, credentials:'same-origin', redirect:'error',
            headers:{...client.defaultHeaders, ...headers, authorization:`Bearer ${token}`, 'content-type':'application/json'},
            ...(body === undefined ? {} : {body:JSON.stringify(body)})});
        if (!current()) throw new Error(pydio.MessageHash[391]);
        const result = await response.json();
        if (!current()) throw new Error(pydio.MessageHash[391]);
        return {response, result};
    };
    const unknown = () => {
        pydio.UI.displayMessage('INFO', pydio.MessageHash['action.share.unknown']);
        return null;
    };
    let metadata;
    try { metadata = await call('share/cell/' + request.Room.Uuid, 'GET'); }
    catch (error) { if (attempt) return unknown(); throw error; }
    if (!metadata.response.ok || metadata.result.Uuid !== request.Room.Uuid) {
        if (attempt) return unknown();
        throw new Error(pydio.MessageHash[391]);
    }
    const domain = metadata.response.headers.get('X-Kailo-Native-Cell-Binding');
    if (attempt && attempt.domain !== domain) return unknown();
    if (domain === null) return api.putCell(request);
    const binding = JSON.parse(domain);
    if (!binding || Object.keys(binding).sort().join(',') !== 'bindingId,generation,tenantId' ||
        !UUID.test(binding.bindingId) || !UUID.test(binding.tenantId) || !Number.isSafeInteger(binding.generation) || binding.generation <= 0) throw new Error(pydio.MessageHash[391]);
    const room = request.Room;
    const selection = JSON.stringify({id:room.Uuid, label:room.Label || '', description:room.Description || '',
        roots:room.RootNodes.map(node => node.Uuid).sort(), accessEnd:room.AccessEnd || 0,
        acls:Object.keys(room.ACLs).sort().map(id => [id, room.ACLs[id].Actions.map(action => [action.Name,action.Value]).sort()])});
    if (attempt && (!UUID.test(attempt.key) || attempt.selection !== selection)) return unknown();
    const pending = attempt || {key:uuid4(), domain, selection};
    if (!attempt) localStorage.setItem(cacheKey, JSON.stringify(pending));
    try {
        const {response, result} = await call('share/cell', 'PUT', request,
            {'Idempotency-Key':pending.key, 'X-Kailo-Native-Cell-Binding':domain});
        if (response.status === 200 && result && result.Uuid === room.Uuid && !result.submission) {
            localStorage.removeItem(cacheKey);
            return result;
        }
        if (response.status === 202 && !result?.terminalStatus && result?.submission?.dispatchState === 'NOT_DISPATCHED') {
            pydio.UI.displayMessage('INFO', pydio.MessageHash['action.share.awaiting-admission']);
            return null;
        }
        return unknown();
    } catch (error) {
        return unknown();
    }
}
