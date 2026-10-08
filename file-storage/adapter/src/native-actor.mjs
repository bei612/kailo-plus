// A platform business read must run under its exact native actor. The original
// REST handlers authenticate this transient context with the binding's Core
// PEP and confirm its consumption; an old native server cannot ignore it and
// silently execute with the transport service's ACL.
import { Refused, boundedBody, canonical, nonempty } from '../../../client-kit/adapter/protocol.mjs';

export function actorConfiguration(config, token, args, claims) {
  const kind = claims.agent_principal_id === undefined ? 'HUMAN' : 'AGENT';
  return Object.freeze({...config, nativeActorContext: Object.freeze({
    proof: Buffer.from(canonical({actionToken:token, argumentsJson:canonical(args)})).toString('base64url'),
    acknowledgement: `${claims.tenant_id}:${config.bindingId}:${kind}:${claims.actor_principal_id}`,
  })});
}

export async function nativeJsonFetch(config, deadline, url, options) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Refused(503);
  const context = config.nativeActorContext;
  const headers = {...options.headers};
  if (context !== undefined) {
    if (!nonempty(context.proof) || !nonempty(context.acknowledgement)) throw new Refused(503);
    headers['x-kailo-native-execution'] = context.proof;
  }
  try {
    const response = await fetch(url, {...options, headers, redirect:'manual', signal:AbortSignal.timeout(remaining)});
    if (!response.ok || !response.body
      || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
      || (context !== undefined && response.headers.get('x-kailo-native-actor') !== context.acknowledgement)) {
      await response.body?.cancel();
      throw new Refused(503);
    }
    return JSON.parse(await boundedBody(response.body, config.maxBodyBytes));
  } catch { throw new Refused(503); }
}
