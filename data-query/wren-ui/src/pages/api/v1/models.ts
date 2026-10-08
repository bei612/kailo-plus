import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import { ModelResolver } from '@server/resolvers/modelResolver';
import {
  digest,
  loadQueryDelivery,
  NativeQueryRefusal,
} from '@server/services/nativeQueryAdmission';
import {
  authorizeNativeScope,
  nativePreviewScope,
} from '@server/services/nativeHumanQuery';

const logger = getLogger('API_MODELS');
logger.level = 'debug';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  const configured = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined;
  const { projectService, deployService } = components;
  res.setHeader('Cache-Control', 'private, no-store');
  let project;

  try {
    const token = req.headers['x-kailo-native-human-token'];
    const identityScope = req.headers['x-kailo-native-identity-scope'];
    if (
      configured &&
      (typeof token !== 'string' ||
        !token ||
        typeof identityScope !== 'string' ||
        !/^[a-f0-9]{64}$/.test(identityScope))
    )
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    project = await projectService.getCurrentProject();

    // Only allow GET method
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    // Get current project's last deployment
    const lastDeploy = await deployService.getLastDeployment(project.id);
    if (!lastDeploy) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // The independent native API retains its original manifest. A configured
    // binding must consume the same captured MDL/Resource reader as GraphQL;
    // verified instance access alone never authorizes this business response.
    let mdl = lastDeploy.manifest as any;
    let native;
    if (configured) {
      const config = await loadQueryDelivery();
      const queryScope = nativePreviewScope(config, identityScope as string);
      if (project.id !== config.projectId)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const permission = await authorizeNativeScope(
        config,
        token as string,
        'discover',
      );
      const reader = new ModelResolver();
      const context = {
        projectService,
        deployRepository: components.deployLogRepository,
        nativeHumanToken: token as string,
        nativeIdentityScope: identityScope as string,
      };
      const reference = await reader.getMDL(
        undefined,
        {
          hash: lastDeploy.hash,
          queryScope,
          generation: permission.generation,
        },
        context,
      );
      mdl = JSON.parse(Buffer.from(reference.mdl, 'base64').toString());
      native = {
        config,
        reader,
        context,
        proof: {
          identityScope,
          queryScope,
          generation: permission.generation,
          deploymentHash: reference.hash,
          metadataDigest: digest(mdl),
        },
      };
    }

    // Extract models, views, and relationships from the MDL with defaults
    const models = mdl?.models || [];
    const views = mdl?.views || [];
    const relationships = mdl?.relationships || [];
    const responsePayload = {
      hash: lastDeploy.hash,
      models,
      relationships,
      views,
    };

    if (native) {
      // Preserve the original API History record and success payload. Provenance
      // stays in this native database and is consumed by its existing reader.
      await components.apiHistoryRepository.createOne({
        id: uuidv4(),
        projectId: project.id,
        governanceBindingId: native.config.bindingId,
        apiType: ApiType.GET_MODELS,
        headers: req.headers as Record<string, string>,
        requestPayload: { nativeModels: native.proof },
        responsePayload,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
      // The original history write is asynchronous too. Re-read the same
      // captured deployment and every source after it, before disclosing MDL.
      const current = await native.reader.getMDL(
        undefined,
        {
          hash: native.proof.deploymentHash,
          queryScope: native.proof.queryScope,
          generation: native.proof.generation,
        },
        native.context,
      );
      if (
        current.hash !== native.proof.deploymentHash ||
        digest(JSON.parse(Buffer.from(current.mdl, 'base64').toString())) !==
          native.proof.metadataDigest
      )
        throw new NativeQueryRefusal(409, 'QUERY_EVIDENCE_UNAVAILABLE');
      res.status(200).json(responsePayload);
      return;
    }

    // Return the restructured response
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload,
      projectId: project.id,
      apiType: ApiType.GET_MODELS,
      startTime,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    if (configured) {
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
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
