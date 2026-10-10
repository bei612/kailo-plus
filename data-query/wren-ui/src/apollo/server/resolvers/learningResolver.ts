import { IContext } from '@server/types';
import { getConfig } from '@server/config';

import { getLogger } from '@server/utils';
import { uniq } from 'lodash';
import {
  authorizeNativeScope,
  nativePreviewScope,
} from '../services/nativeHumanQuery';
import {
  canonical,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';
import { nativeWriteUnknown } from '../utils/error';

const config = getConfig();

const logger = getLogger('LearingResolver');
logger.level = 'debug';

export class LearningResolver {
  private async nativeUser(ctx: IContext) {
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE === undefined &&
      ctx.nativeIdentityScope === undefined &&
      ctx.nativeHumanToken === undefined
    )
      return undefined;
    const delivery = await loadQueryDelivery();
    const identity = ctx.nativeIdentityScope;
    const token = ctx.nativeHumanToken;
    const userId = nativePreviewScope(delivery, identity);
    const project = await ctx.projectService.getCurrentProject();
    if (project.id !== delivery.projectId)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const admitted = await authorizeNativeScope(delivery, token, 'discover');
    const check = async () => {
      if (
        identity !== ctx.nativeIdentityScope ||
        token !== ctx.nativeHumanToken ||
        canonical(await loadQueryDelivery()) !== canonical(delivery) ||
        (await ctx.projectService.getCurrentProject()).id !== project.id
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const fresh = await authorizeNativeScope(delivery, token, 'discover');
      if (fresh.generation !== admitted.generation)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    return { userId, projectId: project.id, check };
  }

  private standalone(ctx: IContext) {
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE !== undefined ||
      ctx.nativeIdentityScope !== undefined ||
      ctx.nativeHumanToken !== undefined
    )
      throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
  }

  constructor() {
    this.getLearningRecord = this.getLearningRecord.bind(this);
    this.saveLearningRecord = this.saveLearningRecord.bind(this);
  }

  public async getLearningRecord(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<any> {
    const native = await this.nativeUser(ctx);
    if (native) {
      const records = await ctx.learningRepository.findAllBy({
        userId: native.userId,
      });
      await native.check();
      return { paths: uniq(records.flatMap((record) => record.paths)) };
    }
    const result = await ctx.learningRepository.findAll();
    this.standalone(ctx);
    return { paths: result[0]?.paths || [] };
  }

  public async saveLearningRecord(
    _root: any,
    args: any,
    ctx: IContext,
  ): Promise<any> {
    const { path } = args.data;
    const native = await this.nativeUser(ctx);
    if (native) {
      let dispatched = false;
      try {
        const result = await ctx.learningRepository.saveNativePath(
          native.projectId,
          native.userId,
          path,
          async () => {
            await native.check();
            dispatched = true;
          },
        );
        await native.check();
        return result;
      } catch (error) {
        if (dispatched) throw nativeWriteUnknown(error);
        throw error;
      }
    }
    const result = await ctx.learningRepository.findAll();
    this.standalone(ctx);

    if (!result.length) {
      return await ctx.learningRepository.createOne({
        userId: config?.userUUID,
        paths: [path],
      });
    }

    const [record] = result;
    return await ctx.learningRepository.updateOne(record.id, {
      userId: config?.userUUID,
      paths: uniq([...record.paths, path]),
    });
  }
}
