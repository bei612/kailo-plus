import PydioApi from 'pydio/http/api'
import uuid4 from 'uuid4'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Same original link route and UI. Retain only the request identity; a refresh
// or lost response never submits a second revocation of an uncertain action.
export default async function nativeRevoke(pydio, id) {
    const client = PydioApi.getRestClient();
    const user = pydio.user, userId = user && user.id;
    const repository = user && user.getActiveRepository();
    const current = () => pydio.user === user && user.id === userId && user.getActiveRepository() === repository;
    const refused = () => new Error(pydio.MessageHash[391]);
    if (!userId || !repository || !UUID.test(id)) throw refused();
    const base = new URL(client.basePath.replace(/\/$/, '') + '/', document.location.href);
    if (base.origin !== document.location.origin || base.username || base.password) throw refused();
    const cacheKey = JSON.stringify(['native-share-revoke', base.href, userId, repository, id]);
    let attempt = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    const call = async (method, headers = {}) => {
        const token = await client.getOrUpdateJwt();
        if (!current() || !token) throw refused();
        const response = await fetch(new URL(`share/link/${id}`, base).href, {method, credentials:'same-origin', redirect:'error',
            headers:{...client.defaultHeaders, ...headers, authorization:`Bearer ${token}`}});
        if (!current()) throw refused();
        const result = await response.json();
        if (!current()) throw refused();
        return {response, result};
    };
    if (!attempt) {
        const {response, result} = await call('GET');
        if (!response.ok || result?.Uuid !== id) throw refused();
        const domain = response.headers.get('X-Kailo-Native-Share-Binding');
        if (domain === null) return undefined;
        const binding = JSON.parse(domain);
        if (!binding || Object.keys(binding).sort().join(',') !== 'bindingId,generation,tenantId' || !UUID.test(binding.bindingId) ||
            !UUID.test(binding.tenantId) || !Number.isSafeInteger(binding.generation) || binding.generation <= 0) throw refused();
        attempt = {key:uuid4(), domain};
        localStorage.setItem(cacheKey, JSON.stringify(attempt));
    }
    if (!UUID.test(attempt.key) || typeof attempt.domain !== 'string' || Object.keys(attempt).sort().join(',') !== 'domain,key') throw refused();
    try {
        const {response, result} = await call('DELETE', {'Idempotency-Key':attempt.key, 'X-Kailo-Native-Share-Binding':attempt.domain});
        if (response.status === 200 && result?.Success === true && !result.submission) {
            localStorage.removeItem(cacheKey);
            return result;
        }
        if (response.status === 202 && ['FAILED','CANCELED'].includes(result?.terminalStatus)) {
            localStorage.removeItem(cacheKey);
            pydio.UI.displayMessage('ERROR', pydio.MessageHash[391]);
        } else {
            pydio.UI.displayMessage('INFO', pydio.MessageHash[response.status === 202 && result?.submission?.dispatchState === 'NOT_DISPATCHED'
                ? 'action.delete.awaiting-admission' : 'action.delete.unknown']);
        }
        return null;
    } catch {
        pydio.UI.displayMessage('INFO', pydio.MessageHash['action.delete.unknown']);
        return null;
    }
}
