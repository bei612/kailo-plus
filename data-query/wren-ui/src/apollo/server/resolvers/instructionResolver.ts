import { IContext } from '@server/types';
import { UpdateInstructionInput } from '@server/models';
import { Instruction } from '@server/repositories/instructionRepository';
import { getLogger } from '@server/utils';
import { TelemetryEvent, TrackTelemetry } from '@server/telemetry/telemetry';
import { NativeQueryRefusal } from '@server/services/nativeQueryAdmission';

const logger = getLogger('InstructionResolver');
logger.level = 'debug';

export type InstructionContext = Pick<
  IContext,
  | 'projectService'
  | 'instructionService'
  | 'telemetry'
  | 'nativeHumanToken'
  | 'nativeIdentityScope'
  | 'nativeProjectCheck'
>;

export class InstructionResolver {
  constructor() {
    this.getInstructions = this.getInstructions.bind(this);
    this.createInstruction = this.createInstruction.bind(this);
    this.updateInstruction = this.updateInstruction.bind(this);
    this.deleteInstruction = this.deleteInstruction.bind(this);
  }

  private async currentProject(ctx: InstructionContext) {
    const token = ctx.nativeHumanToken;
    const identityScope = ctx.nativeIdentityScope;
    const configured =
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      token !== undefined ||
      identityScope !== undefined;
    const project = await ctx.projectService.getCurrentProject();
    if (!configured) {
      if (
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
        ctx.nativeHumanToken !== undefined ||
        ctx.nativeIdentityScope !== undefined
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      return project;
    }
    if (!ctx.nativeProjectCheck)
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    await ctx.nativeProjectCheck(project.id);
    return project;
  }

  public async getInstructions(
    _root: any,
    _args: any,
    ctx: InstructionContext,
  ): Promise<Instruction[]> {
    try {
      const project = await this.currentProject(ctx);
      return await ctx.instructionService.getInstructions(project.id);
    } catch (error) {
      logger.error(`Error getting instructions: ${error}`);
      throw error;
    }
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_CREATE_INSTRUCTION)
  public async createInstruction(
    _root: any,
    args: {
      data: {
        instruction: string;
        questions: string[];
        isDefault: boolean;
      };
    },
    ctx: InstructionContext,
  ): Promise<Instruction> {
    const { instruction, questions, isDefault } = args.data;
    const project = await this.currentProject(ctx);
    return await ctx.instructionService.createInstruction({
      instruction,
      questions,
      isDefault,
      projectId: project.id,
    });
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_UPDATE_INSTRUCTION)
  public async updateInstruction(
    _root: any,
    args: {
      data: Pick<
        UpdateInstructionInput,
        'instruction' | 'questions' | 'isDefault'
      >;
      where: { id: number };
    },
    ctx: InstructionContext,
  ): Promise<Instruction> {
    const { id } = args.where;
    const { instruction, questions, isDefault } = args.data;
    if (!id) {
      throw new Error('Instruction ID is required.');
    }
    const project = await this.currentProject(ctx);
    return await ctx.instructionService.updateInstruction({
      id,
      projectId: project.id,
      instruction,
      questions,
      isDefault,
    });
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_DELETE_INSTRUCTION)
  public async deleteInstruction(
    _root: any,
    args: { where: { id: number } },
    ctx: InstructionContext,
  ): Promise<boolean> {
    const { id } = args.where;
    const project = await this.currentProject(ctx);
    await ctx.instructionService.deleteInstruction(id, project.id);
    return true;
  }
}
