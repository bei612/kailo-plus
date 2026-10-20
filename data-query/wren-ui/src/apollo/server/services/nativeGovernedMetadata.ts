import type { IContext } from '../types';
import { nativePreviewScope } from './nativeHumanQuery';
import {
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './nativeQueryAdmission';
import { isGovernedQueryMode } from './nativeQueryMode';

// The shared entry of original native metadata readers (models, views,
// diagram, schema change, asking-task candidates) into the governed chain.
//
// STANDALONE (DD-127(7)): returns undefined without loading any delivery; the
// caller keeps its original upstream read. GOVERNED (DD-124): the controlled
// delivery, the verified native person, its token and the bound project are
// all required; the caller then applies per-Resource read authorization.
export async function governedMetadataDelivery(
  ctx: Pick<IContext, 'nativeIdentityScope' | 'nativeHumanToken'>,
  projectId: number,
): Promise<NativeQueryDelivery | undefined> {
  if (!isGovernedQueryMode()) return undefined;
  const config = await loadQueryDelivery();
  nativePreviewScope(config, ctx.nativeIdentityScope);
  if (!ctx.nativeHumanToken)
    throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
  if (config.projectId !== projectId)
    throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
  return config;
}
