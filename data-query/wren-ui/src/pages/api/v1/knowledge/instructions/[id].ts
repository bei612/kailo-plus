import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import originalResolvers from '@server/resolvers';
import { InstructionContext } from '@server/resolvers/instructionResolver';
import {
  digest,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import {
  authorizeNativeScope,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';
import { nativeWriteUnknown } from '@server/utils/error';

const logger = getLogger('API_INSTRUCTION_BY_ID');
logger.level = 'debug';

type InstructionRequest = {
  context?: InstructionContext;
  verify: () => Promise<void>;
  entered: () => void;
};

/**
 * Instructions API - Supports two types of instructions:
 *
 * 1. Global Instructions (isGlobal: true)
 *    - Apply to every query that Wren AI generates
 *    - Ideal for setting consistent standards, enforcing business rules
 *    - Should NOT include questions field
 *
 * 2. Question-Matching Instructions (isGlobal: false or undefined)
 *    - Applied only when user's question matches certain patterns
 *    - Ideal for guiding how Wren AI handles specific business concepts
 *    - MUST include questions array with at least one question
 */
interface UpdateInstructionRequest {
  instruction?: string;
  questions?: string[];
  isGlobal?: boolean;
}

/**
 * Validate instruction ID from request query
 */
const validateInstructionId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Instruction ID is required', 400);
  }

  const instructionId = parseInt(id, 10);
  if (isNaN(instructionId)) {
    throw new ApiError('Invalid instruction ID', 400);
  }

  return instructionId;
};

/**
 * Handle PUT request - update an existing instruction
 */
const handleUpdateInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
  access: InstructionRequest,
) => {
  const { id } = req.query;
  const instructionId = validateInstructionId(id);

  const { instruction, questions, isGlobal } =
    req.body as UpdateInstructionRequest;

  // Get the original instruction
  const existingInstruction = access.context
    ? await components.instructionRepository.findOneBy({
        id: instructionId,
        projectId: project.id,
      })
    : await components.instructionService.getInstruction(instructionId);

  if (!existingInstruction) {
    throw new ApiError('Instruction not found', 404);
  }

  // Merge original with update payload
  const mergedInstruction = {
    instruction: instruction ?? existingInstruction.instruction,
    questions: questions ?? existingInstruction.questions,
    isGlobal: isGlobal ?? existingInstruction.isDefault,
  };

  // If isGlobal is true, set questions to empty array
  if (mergedInstruction.isGlobal === true) {
    mergedInstruction.questions = [];
  }

  // Update the instruction
  await access.verify();
  access.entered();
  const updatedInstruction = access.context
    ? await originalResolvers.Mutation.updateInstruction(
        undefined,
        {
          where: { id: instructionId },
          data: {
            instruction: mergedInstruction.instruction,
            questions: mergedInstruction.questions,
            isDefault: mergedInstruction.isGlobal,
          },
        },
        access.context,
      )
    : await components.instructionService.updateInstruction({
        id: instructionId,
        instruction: mergedInstruction.instruction,
        questions: mergedInstruction.questions,
        isDefault: mergedInstruction.isGlobal,
        projectId: project.id,
      });

  // Return the updated instruction directly
  const isGlobalValue =
    typeof updatedInstruction.isDefault === 'boolean'
      ? updatedInstruction.isDefault
      : Boolean(updatedInstruction.isDefault);
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: {
      id: updatedInstruction.id,
      instruction: updatedInstruction.instruction,
      questions: updatedInstruction.questions,
      isGlobal: isGlobalValue,
    },
    projectId: project.id,
    apiType: ApiType.UPDATE_INSTRUCTION,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
    beforeResponse: access.verify,
  });
};

/**
 * Handle DELETE request - delete an instruction
 */
const handleDeleteInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
  access: InstructionRequest,
) => {
  const { id } = req.query;
  const instructionId = validateInstructionId(id);

  // Delete the instruction
  if (
    access.context &&
    !(await components.instructionRepository.findOneBy({
      id: instructionId,
      projectId: project.id,
    }))
  )
    throw new ApiError('Instruction not found', 404);
  await access.verify();
  access.entered();
  if (access.context)
    await originalResolvers.Mutation.deleteInstruction(
      undefined,
      { where: { id: instructionId } },
      access.context,
    );
  else
    await components.instructionService.deleteInstruction(
      instructionId,
      project.id,
    );

  // Return 204 No Content with no payload
  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    projectId: project.id,
    apiType: ApiType.DELETE_INSTRUCTION,
    startTime,
    requestPayload: { id: instructionId },
    headers: req.headers as Record<string, string>,
    beforeResponse: access.verify,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let project;
  let native;
  let entered = false;

  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const token = req.headers['x-kailo-native-human-token'];
    const identityScope = req.headers['x-kailo-native-identity-scope'];
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      token !== undefined ||
      identityScope !== undefined
    ) {
      if (
        typeof token !== 'string' ||
        !token ||
        typeof identityScope !== 'string'
      )
        throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
      const config = await loadQueryDelivery();
      const scope = nativePreviewScope(config, identityScope);
      const before = await authorizeNativeScope(config, token, 'manage');
      native = {
        config,
        token,
        identityScope,
        scope,
        generation: before.generation,
        context: {
          projectService: components.projectService,
          instructionService: components.instructionService,
          telemetry: components.telemetry,
          nativeHumanToken: token,
          nativeIdentityScope: identityScope,
        } satisfies InstructionContext,
      };
    }
    project = await components.projectService.getCurrentProject();
    const verify = async () => {
      const current = await components.projectService.getCurrentProject();
      if (!native) {
        if (
          current.id !== project.id ||
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
          req.headers['x-kailo-native-human-token'] !== undefined ||
          req.headers['x-kailo-native-identity-scope'] !== undefined
        )
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        return;
      }
      if (current.id !== project.id)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      if (
        current.id !== native.config.projectId ||
        String(current.id) !== native.config.nativeScopeRef
      )
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      if (digest(await loadQueryDelivery()) !== digest(native.config))
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const after = await authorizeNativeScope(
        native.config,
        native.token,
        'manage',
      );
      if (
        after.generation !== native.generation ||
        req.headers['x-kailo-native-human-token'] !== native.token ||
        req.headers['x-kailo-native-identity-scope'] !== native.identityScope ||
        native.context.nativeHumanToken !== native.token ||
        native.context.nativeIdentityScope !== native.identityScope
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
    };
    await verify();
    const access: InstructionRequest = {
      context: native?.context,
      verify,
      entered: () => {
        entered = true;
      },
    };

    // Handle PUT method - update instruction
    if (req.method === 'PUT') {
      await handleUpdateInstruction(req, res, project, startTime, access);
      return;
    }

    // Handle DELETE method - delete instruction
    if (req.method === 'DELETE') {
      await handleDeleteInstruction(req, res, project, startTime, access);
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    if (
      native ||
      error instanceof NativeQueryRefusal ||
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      req.headers['x-kailo-native-human-token'] !== undefined ||
      req.headers['x-kailo-native-identity-scope'] !== undefined
    ) {
      const proof = error?.extensions?.other?.nativeWrite;
      if (
        proof?.outcome === 'UNKNOWN' ||
        (entered && proof?.outcome !== 'NOT_STARTED')
      ) {
        const unknown =
          proof?.outcome === 'UNKNOWN'
            ? error
            : nativeWriteUnknown(error, native?.scope, native?.generation);
        res.status(202).json({
          error: 'NATIVE_EXECUTION_UNKNOWN',
          nativeWrite: unknown.extensions.other.nativeWrite,
        });
      } else {
        res
          .status(
            error instanceof NativeQueryRefusal
              ? error.status
              : error instanceof ApiError
                ? error.statusCode
                : 503,
          )
          .json({
            error:
              error instanceof NativeQueryRefusal
                ? error.code
                : error instanceof ApiError
                  ? error.message
                  : 'QUERY_EVIDENCE_UNAVAILABLE',
          });
      }
      return;
    }
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_INSTRUCTION
          : ApiType.DELETE_INSTRUCTION,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
