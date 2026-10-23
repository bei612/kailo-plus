import { IContext } from '@server/types';
import type {
  KailoShareCandidate,
  KailoShareService,
  KailoShareTarget,
} from '../services/kailoShare';
import { getLogger } from '@server/utils';

const logger = getLogger('KailoShareResolver');

// DD-138(4), `.design/07` §4.8.3: GraphQL entry of "分享给成员 / Share with
// member" (services/kailoShare.ts). Sharing changes no access: every project
// member can already read all threads and the single dashboard.
export class KailoShareResolver {
  constructor(
    // Injected in tests; the running server uses the singleton components.
    private readonly service?: () => Promise<{
      share: KailoShareService;
      threadName: (
        projectId: number,
        threadId: number,
      ) => Promise<string | null>;
    }>,
  ) {
    this.available = this.available.bind(this);
    this.members = this.members.bind(this);
    this.share = this.share.bind(this);
  }

  private async deps() {
    if (this.service) return this.service();
    const { components } = await import('@/common');
    return {
      share: components.kailoShareService,
      threadName: async (projectId: number, threadId: number) => {
        const thread = await components.threadRepository.findOneBy({
          id: threadId,
        });
        return thread && thread.projectId === projectId
          ? thread.summary || ''
          : null;
      },
    };
  }

  // KailoSession.shareAvailable
  public async available(
    _parent: unknown,
    _args: unknown,
    ctx: IContext,
  ): Promise<boolean> {
    try {
      return (await this.deps()).share.available(ctx.kailoUser);
    } catch (error) {
      logger.debug(`share availability unknown: ${error?.name}`);
      return false;
    }
  }

  public async members(
    _root: unknown,
    _args: unknown,
    ctx: IContext,
  ): Promise<KailoShareCandidate[]> {
    return (await this.deps()).share.candidates(ctx.kailoUser);
  }

  public async share(
    _root: unknown,
    args: {
      data: {
        target: KailoShareTarget;
        recipients: string[];
        requestId: string;
      };
    },
    ctx: IContext,
  ): Promise<{ notified: number }> {
    const deps = await this.deps();
    const project = await ctx.projectService.getCurrentProject();
    const notified = await deps.share.share(ctx.kailoUser, args.data, {
      threadName: (threadId) => deps.threadName(project.id, threadId),
      dashboardExists: async () =>
        !!(await ctx.dashboardRepository.findOneBy({ projectId: project.id })),
    });
    return { notified };
  }
}
