import PydioApi from 'pydio/http/api'
import uuid4 from 'uuid4'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// This stores only the browser's request key and exact original selection,
// never credentials or execution authority. Core owns approval and terminal
// state. Retrying this selection observes the same Action, including refresh.
export default async function nativeDelete(pydio, request) {
    const user = pydio.user;
    const repository = user && user.getActiveRepository();
    const userId = user && user.id;
    const client = PydioApi.getRestClient();
    const current = () => pydio.user === user && user.id === userId && user.getActiveRepository() === repository;
    if (!user || !userId || !repository || !Array.isArray(request.Nodes) || !request.Nodes.length) throw new Error(pydio.MessageHash[391]);
    const selection = [...request.Nodes].sort((left, right) => left.Path < right.Path ? -1 : left.Path > right.Path ? 1 : 0);
    const paths = selection.map(node => node.Path);
    if (paths.some(path => typeof path !== 'string' || !path) || new Set(paths).size !== paths.length) throw new Error(pydio.MessageHash[391]);
    const cacheKey = JSON.stringify(['native-delete', document.location.origin, userId, repository, paths, request.RemovePermanently === true]);
    let attempt = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    const base = new URL(client.basePath.replace(/\/$/, '') + '/', document.location.href);
    if (base.origin !== document.location.origin || base.username || base.password) throw new Error(pydio.MessageHash[391]);
    const call = async (path, body, headers = {}) => {
        const token = await client.getOrUpdateJwt();
        if (!current() || !token) throw new Error(pydio.MessageHash[391]);
        const response = await fetch(new URL(path, base).href, {method:'POST', credentials:'same-origin', redirect:'error',
            headers:{...client.defaultHeaders, ...headers, authorization:`Bearer ${token}`, 'content-type':'application/json'}, body:JSON.stringify(body)});
        if (!current()) throw new Error(pydio.MessageHash[391]);
        const result = await response.json();
        if (!current()) throw new Error(pydio.MessageHash[391]);
        return {response, result};
    };
    let metadata;
    try {
        metadata = await call('tree/stats', {NodePaths:paths});
    } catch (error) {
        if (!attempt) throw error;
        pydio.UI.displayMessage('INFO', pydio.MessageHash['action.delete.unknown']);
        return null;
    }
    const domain = metadata.response.headers.get('X-Kailo-Native-Delete-Binding');
    if (domain !== null) {
        const binding = JSON.parse(domain);
        if (!binding || Object.keys(binding).sort().join(',') !== 'bindingId,generation,tenantId' ||
            !UUID.test(binding.bindingId) || !UUID.test(binding.tenantId) || !Number.isSafeInteger(binding.generation) || binding.generation <= 0) throw new Error(pydio.MessageHash[391]);
    }
    // A pending old generation is not silently replaced by a new operation.
    // Retain it for the original Core reconciliation/operational resolution.
    if (attempt && attempt.domain !== domain) {
        pydio.UI.displayMessage('INFO', pydio.MessageHash['action.delete.unknown']);
        return null;
    }
    if (!attempt) {
        // Original metadata API resolves the recycle-bin selection as well as
        // files; the delete producer independently repeats native ACL checks.
        const {response, result} = metadata;
        if (!response.ok || !Array.isArray(result.Nodes) || result.Nodes.length !== paths.length) throw new Error(pydio.MessageHash[391]);
        const Nodes = paths.map((Path, index) => {
            const matches = result.Nodes.filter(node => node.Path === Path);
            if (matches.length !== 1 || !UUID.test(matches[0].Uuid) || (selection[index].Uuid && selection[index].Uuid !== matches[0].Uuid)) throw new Error(pydio.MessageHash[391]);
            return {Path, Uuid:matches[0].Uuid};
        });
        attempt = {key:uuid4(), domain, request:{Nodes, RemovePermanently:request.RemovePermanently === true}};
        // Storage failure happens before dispatch, never after silently losing
        // the key for an already dispatched operation.
        localStorage.setItem(cacheKey, JSON.stringify(attempt));
    }
    if (!UUID.test(attempt.key) || !Array.isArray(attempt.request?.Nodes) || attempt.request.Nodes.length !== paths.length ||
        attempt.request.Nodes.some((node,index) => node.Path !== paths[index] || !UUID.test(node.Uuid) || (selection[index].Uuid && selection[index].Uuid !== node.Uuid)) ||
        attempt.request.RemovePermanently !== (request.RemovePermanently === true)) throw new Error(pydio.MessageHash[391]);
    try {
        const {response, result} = await call('tree/delete', attempt.request, {'Idempotency-Key':attempt.key,
            ...(domain === null ? {} : {'X-Kailo-Native-Delete-Binding':domain})});
        if (response.status === 200 && result && typeof result === 'object' && !result.submission) {
            localStorage.removeItem(cacheKey);
            return result;
        }
        if (response.status === 202 && ['FAILED', 'CANCELED'].includes(result?.terminalStatus)) {
            localStorage.removeItem(cacheKey);
            pydio.UI.displayMessage('ERROR', pydio.MessageHash[391]);
            return null;
        }
        // HTTP acceptance, denial after dispatch and a lost response are not
        // deletion success/failure. Only the original Core result is terminal.
        const waiting = response.status === 202 && result?.submission?.dispatchState === 'NOT_DISPATCHED';
        pydio.UI.displayMessage('INFO', pydio.MessageHash[waiting ? 'action.delete.awaiting-admission' : 'action.delete.unknown']);
        return null;
    } catch (error) {
        pydio.UI.displayMessage('INFO', pydio.MessageHash['action.delete.unknown']);
        return null;
    }
}
