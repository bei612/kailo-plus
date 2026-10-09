import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { isNil } from 'lodash';
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

const logger = getLogger('API_INSTRUCTIONS');
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
interface CreateInstructionRequest {
  instruction: string;
  questions?: string[];
  isGlobal?: boolean;
}

/**
 * Handle POST request - create a new instruction
 */
const handleCreateInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
  access: InstructionRequest,
) => {
  const { instruction, questions, isGlobal } =
    req.body as CreateInstructionRequest;

  // Input validation
  if (!instruction) {
    throw new ApiError('Instruction is required', 400);
  }

  if (instruction.length > 1000) {
    throw new ApiError('Instruction is too long (max 1000 characters)', 400);
  }

  if (isNil(isGlobal) && isNil(questions)) {
    throw new ApiError('isGlobal or questions is required', 400);
  }

  // Validate instruction type and fields
  if (isGlobal === true) {
    // Global instruction - questions should not be provided
    if (questions && questions.length > 0) {
      throw new ApiError(
        'Global instructions should not include questions. Questions are only for question-matching instructions.',
        400,
      );
    }
  } else {
    // Question-matching instruction - questions are required
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      throw new ApiError(
        'Question-matching instructions require at least one question',
        400,
      );
    }

    // Validate each question
    questions.forEach((question, index) => {
      if (
        !question ||
        typeof question !== 'string' ||
        question.trim().length === 0
      ) {
        throw new ApiError(
          `Question at index ${index} is required and cannot be empty`,
          400,
        );
      }
      if (question.length > 500) {
        throw new ApiError(
          `Question at index ${index} is too long (max 500 characters)`,
          400,
        );
      }
    });
  }

  // Create the instruction
  await access.verify();
  access.entered();
  const data = {
    instruction,
    questions: questions || [],
    isDefault: isGlobal === true,
  };
  const newInstruction = access.context
    ? await originalResolvers.Mutation.createInstruction(
        undefined,
        { data },
        access.context,
      )
    : await components.instructionService.createInstruction({
        ...data,
        projectId: project.id,
      });

  // Return the created instruction directly
  const isGlobalValue =
    typeof newInstruction.isDefault === 'boolean'
      ? newInstruction.isDefault
      : Boolean(newInstruction.isDefault);
  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: {
      id: newInstruction.id,
      instruction: newInstruction.instruction,
      questions: newInstruction.questions,
      isGlobal: isGlobalValue,
    },
    projectId: project.id,
    apiType: ApiType.CREATE_INSTRUCTION,
    startTime,
    requestPayload: req.body,
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
    const permission = req.method === 'GET' ? 'discover' : 'manage';
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
      const before = await authorizeNativeScope(config, token, permission);
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
        permission,
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
    // The original native Query wrapper already verifies its dispatch. The
    // independent read still fences configuration arrival before its read.
    if (req.method !== 'GET' || !native) await verify();

    // Handle GET method - list instructions
    if (req.method === 'GET') {
      // Consume the same original GraphQL project authorization and native
      // instruction reader; a verified instance login alone is not this read.
      const instructions = (
        (native
          ? await originalResolvers.Query.instructions(
              undefined,
              {},
              native.context,
            )
          : await components.instructionService.getInstructions(project.id)) ||
        []
      ).map((instruction) => ({
        id: instruction.id,
        instruction: instruction.instruction,
        questions: instruction.questions,
        isGlobal:
          typeof instruction.isDefault === 'boolean'
            ? instruction.isDefault
            : Boolean(instruction.isDefault),
      }));
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: instructions,
        projectId: project.id,
        apiType: ApiType.GET_INSTRUCTIONS,
        startTime,
        requestPayload: {},
        headers: req.headers as Record<string, string>,
        // The original API History write is asynchronous. Fresh authorization
        // must guard its following JSON disclosure, not just the earlier read.
        beforeResponse: verify,
      });
      return;
    }

    // Handle POST method - create instruction
    if (req.method === 'POST') {
      await handleCreateInstruction(req, res, project, startTime, {
        context: native?.context,
        verify,
        entered: () => {
          entered = true;
        },
      });
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
        req.method === 'POST' &&
        (proof?.outcome === 'UNKNOWN' ||
          (entered && proof?.outcome !== 'NOT_STARTED'))
      ) {
        const unknown =
          proof?.outcome === 'UNKNOWN'
            ? error
            : nativeWriteUnknown(error, native?.scope, native?.generation);
        res.status(202).json({
          error: 'NATIVE_EXECUTION_UNKNOWN',
          nativeWrite: unknown.extensions.other.nativeWrite,
        });
        return;
      }
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
      return;
    }
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_INSTRUCTIONS
          : ApiType.CREATE_INSTRUCTION,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
