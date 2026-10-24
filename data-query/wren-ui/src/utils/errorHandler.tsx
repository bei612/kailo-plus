import { GraphQLError } from 'graphql';
import { ErrorResponse } from '@apollo/client/link/error';
import { ApolloError } from '@apollo/client';
import { notify } from './kailoHost';
import { kailoT } from './kailoI18n';
import { getUserConfig } from './env';
import { getNativeWriteText } from './language';
import { signInOwnedByHost } from './kailoEmbed';
import type { NativeWriteReference } from '@/apollo/server/utils/error';

export const nativeWriteEvidence = (error: any) => {
  const errors =
    error?.graphQLErrors ||
    (Array.isArray(error?.errors)
      ? error.errors
      : error?.errors?.graphQLErrors) ||
    [];
  return errors.find((entry: any) =>
    ['UNKNOWN', 'NOT_STARTED'].includes(
      entry?.extensions?.other?.nativeWrite?.outcome,
    ),
  )?.extensions?.other?.nativeWrite;
};

// The original create controls retain only an input digest and, when returned,
// the original native row reference. This is replay protection in this browser,
// not a native idempotency key or another execution/permission authority.
export const runNativeMetadataWrite = async ({
  nativeType,
  variables,
  submit,
  observe,
  locale,
  mutationField,
  beforeSubmit,
}: {
  nativeType: NativeWriteReference['nativeType'];
  variables: any;
  submit: (variables: any, guarded?: boolean) => Promise<any>;
  observe: (nativeId: number) => Promise<any>;
  locale?: string;
  mutationField?: 'createSqlPair' | 'updateSqlPair';
  beforeSubmit?: () => Promise<void>;
}) => {
  const text = getNativeWriteText(locale);
  const field =
    mutationField ||
    {
      model: 'createModel',
      view: 'createView',
      dashboardItem: 'createDashboardItem',
      sqlPair: 'createSqlPair',
    }[nativeType];
  const readScope = async () => {
    const config = await getUserConfig();
    if (config.nativeBindingConfigured === false) return undefined;
    if (
      config.nativeBindingConfigured !== true ||
      !Number.isSafeInteger(config.nativeBindingGeneration) ||
      config.nativeBindingGeneration! < 1 ||
      typeof config.queryScope !== 'string' ||
      !/^[a-f0-9]{64}$/.test(config.queryScope)
    )
      throw new Error(text.scopeError);
    return {
      scope: config.queryScope,
      generation: config.nativeBindingGeneration!,
    };
  };
  const identity = await readScope().catch((error) => {
    notify.error(text.scopeError);
    throw error;
  });
  if (identity === undefined) {
    await beforeSubmit?.();
    if ((await readScope()) !== undefined) throw new Error(text.scopeError);
    return (await submit(variables))?.data?.[field];
  }
  const { scope, generation } = identity;
  const sameIdentity = async () => {
    const current = await readScope();
    return current?.scope === scope && current.generation === generation;
  };
  let slot: string;
  let previous: any;
  let input: any;
  try {
    const encoded = JSON.stringify(variables, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
    );
    input = JSON.parse(encoded);
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(encoded),
    );
    const digest = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    slot = `kailo.native-write.${scope}.${nativeType}.${digest}`;
    const retained = sessionStorage.getItem(slot);
    if (retained !== null) {
      previous = JSON.parse(retained);
      if (previous?.outcome !== 'UNKNOWN') throw new Error();
    } else {
      sessionStorage.setItem(
        slot,
        JSON.stringify({ outcome: 'UNKNOWN', generation }),
      );
    }
  } catch {
    notify.error(text.storageError);
    throw new Error(text.storageError);
  }
  const unknown = () => {
    notify.warning(text.unknown);
    return new Error('NATIVE_EXECUTION_UNKNOWN');
  };
  const referenceMatches = (reference: any) =>
    reference?.nativeType === nativeType &&
    Number.isSafeInteger(reference?.nativeId) &&
    reference.nativeId > 0;
  if (previous) {
    // Absence is not a writer fence. Without an actual returned reference there
    // is no safe read-back target and, in particular, no permission to resubmit.
    if (
      previous.generation !== generation ||
      !referenceMatches(previous.reference)
    )
      throw unknown();
    try {
      if (!(await sameIdentity())) throw unknown();
      const current = await observe(previous.reference.nativeId);
      if (
        current?.id !== previous.reference.nativeId ||
        !(await sameIdentity())
      )
        throw unknown();
      sessionStorage.removeItem(slot);
      return current;
    } catch {
      throw unknown();
    }
  }
  // No native call has started yet. A failed second identity check is a proven
  // pre-dispatch refusal, not evidence of an uncertain write.
  try {
    await beforeSubmit?.();
  } catch (error) {
    sessionStorage.removeItem(slot);
    // The original caller presents its query/validation outcome. A pending
    // admitted query is not an identity denial or a failed metadata write.
    throw error;
  }
  try {
    if (!(await sameIdentity())) throw new Error(text.scopeError);
  } catch (error) {
    sessionStorage.removeItem(slot);
    notify.error(text.scopeError);
    throw error;
  }
  try {
    const response = await submit(input, true);
    const current = response?.data?.[field];
    if (
      response?.errors ||
      !Number.isSafeInteger(current?.id) ||
      current.id <= 0
    )
      throw response;
    sessionStorage.setItem(
      slot,
      JSON.stringify({
        outcome: 'UNKNOWN',
        generation,
        reference: { nativeType, nativeId: current.id },
      }),
    );
    if (!(await sameIdentity())) throw unknown();
    sessionStorage.removeItem(slot);
    return current;
  } catch (error: any) {
    const evidence = nativeWriteEvidence(error);
    if (
      evidence?.outcome === 'UNKNOWN' &&
      evidence.scope === scope &&
      evidence.generation === generation &&
      referenceMatches(evidence.reference)
    ) {
      try {
        sessionStorage.setItem(
          slot,
          JSON.stringify({
            outcome: 'UNKNOWN',
            generation,
            reference: evidence.reference,
          }),
        );
      } catch {
        // The pre-dispatch UNKNOWN marker still prevents a blind retry.
      }
    } else if (evidence?.outcome === 'NOT_STARTED' && !error.networkError) {
      // The server refused this request before entering its native write. Only
      // that explicit error is evidence that this browser may discard the mark.
      sessionStorage.removeItem(slot);
      throw error;
    }
    throw unknown();
  }
};

// Refer to backend GeneralErrorCodes for mapping
export const ERROR_CODES = {
  INVALID_CALCULATED_FIELD: 'INVALID_CALCULATED_FIELD',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  NO_CHART: 'NO_CHART',
};

// DD-157 (20 §13.8): one Kailo toast per failed action, in the Kailo
// locale; the reason is the description where the server gives one.
abstract class ErrorHandler {
  public handle(error: GraphQLError) {
    const errorMessage = this.getErrorMessage(error);
    if (errorMessage) notify.error(errorMessage, this.getErrorDetail(error));
  }

  abstract getErrorMessage(error: GraphQLError): string | null;

  public getErrorDetail(_error: GraphQLError): string | undefined {
    return undefined;
  }
}

const errorHandlers = new Map<string, ErrorHandler>();

class SaveTablesErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errSaveTables');
    }
  }
}

class SaveRelationsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errSaveRelations');
    }
  }
}

class CreateAskingTaskErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateAskingTask');
    }
  }
}

class CreateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateThread');
    }
  }
}

class UpdateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateThread');
    }
  }
}

class DeleteThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteThread');
    }
  }
}

class CreateThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateThreadResponse');
    }
  }
}

class UpdateThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateThreadResponse');
    }
  }
}

class GenerateThreadResponseAnswerErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errGenerateThreadResponseAnswer');
    }
  }
}

class AdjustThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errAdjustThreadResponse');
    }
  }
}

class CreateViewErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateView');
    }
  }
}

class UpdateDataSourceErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateDataSource');
    }
  }

  public getErrorDetail(error: GraphQLError) {
    return error.message || undefined;
  }
}

class CreateModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateModel');
    }
  }
}

class UpdateModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateModel');
    }
  }
}

class DeleteModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteModel');
    }
  }
}

class UpdateModelMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateModelMetadata');
    }
  }
}

class CreateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateCalculatedField');
    }
  }
}

class UpdateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateCalculatedField');
    }
  }
}

class DeleteCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteCalculatedField');
    }
  }
}

class CreateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateRelationship');
    }
  }
}

class UpdateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateRelationship');
    }
  }
}

class DeleteRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteRelationship');
    }
  }
}

class UpdateViewMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateViewMetadata');
    }
  }
}

class TriggerDataSourceDetectionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errTriggerDataSourceDetection');
    }
  }
}

class ResolveSchemaChangeErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errResolveSchemaChange');
    }
  }
}

class CreateDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateDashboardItem');
    }
  }
}

class UpdateDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateDashboardItem');
    }
  }
}

class UpdateDashboardItemLayoutsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateDashboardItemLayouts');
    }
  }
}

class DeleteDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteDashboardItem');
    }
  }
}

class SetDashboardScheduleErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errSetDashboardSchedule');
    }
  }
}

class CreateSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateSqlPair');
    }
  }
}

class UpdateSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateSqlPair');
    }
  }
}

class DeleteSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteSqlPair');
    }
  }
}

class CreateInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errCreateInstruction');
    }
  }
}

class UpdateInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errUpdateInstruction');
    }
  }
}

class DeleteInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return kailoT('setup.errDeleteInstruction');
    }
  }
}

errorHandlers.set('SaveTables', new SaveTablesErrorHandler());
errorHandlers.set('SaveRelations', new SaveRelationsErrorHandler());
errorHandlers.set('CreateAskingTask', new CreateAskingTaskErrorHandler());
errorHandlers.set('CreateThread', new CreateThreadErrorHandler());
errorHandlers.set('UpdateThread', new UpdateThreadErrorHandler());
errorHandlers.set('DeleteThread', new DeleteThreadErrorHandler());
errorHandlers.set(
  'CreateThreadResponse',
  new CreateThreadResponseErrorHandler(),
);
errorHandlers.set(
  'UpdateThreadResponse',
  new UpdateThreadResponseErrorHandler(),
);
errorHandlers.set(
  'GenerateThreadResponseAnswer',
  new GenerateThreadResponseAnswerErrorHandler(),
);
errorHandlers.set(
  'AdjustThreadResponse',
  new AdjustThreadResponseErrorHandler(),
);

errorHandlers.set('CreateView', new CreateViewErrorHandler());
errorHandlers.set('UpdateDataSource', new UpdateDataSourceErrorHandler());
errorHandlers.set('CreateModel', new CreateModelErrorHandler());
errorHandlers.set('UpdateModel', new UpdateModelErrorHandler());
errorHandlers.set('DeleteModel', new DeleteModelErrorHandler());
errorHandlers.set('UpdateModelMetadata', new UpdateModelMetadataErrorHandler());
errorHandlers.set('UpdateViewMetadata', new UpdateViewMetadataErrorHandler());
errorHandlers.set(
  'CreateCalculatedField',
  new CreateCalculatedFieldErrorHandler(),
);
errorHandlers.set(
  'UpdateCalculatedField',
  new UpdateCalculatedFieldErrorHandler(),
);
errorHandlers.set(
  'DeleteCalculatedField',
  new DeleteCalculatedFieldErrorHandler(),
);

// Relationship
errorHandlers.set('CreateRelationship', new CreateRelationshipErrorHandler());
errorHandlers.set('UpdateRelationship', new UpdateRelationshipErrorHandler());
errorHandlers.set('DeleteRelationship', new DeleteRelationshipErrorHandler());

// Schema change
errorHandlers.set(
  'TriggerDataSourceDetection',
  new TriggerDataSourceDetectionErrorHandler(),
);
errorHandlers.set('ResolveSchemaChange', new ResolveSchemaChangeErrorHandler());

// Dashboard
errorHandlers.set('CreateDashboardItem', new CreateDashboardItemErrorHandler());
errorHandlers.set('UpdateDashboardItem', new UpdateDashboardItemErrorHandler());
errorHandlers.set(
  'UpdateDashboardItemLayouts',
  new UpdateDashboardItemLayoutsErrorHandler(),
);
errorHandlers.set('DeleteDashboardItem', new DeleteDashboardItemErrorHandler());
errorHandlers.set(
  'SetDashboardSchedule',
  new SetDashboardScheduleErrorHandler(),
);

// SQL Pair
errorHandlers.set('CreateSqlPair', new CreateSqlPairErrorHandler());
errorHandlers.set('UpdateSqlPair', new UpdateSqlPairErrorHandler());
errorHandlers.set('DeleteSqlPair', new DeleteSqlPairErrorHandler());

// Instruction
errorHandlers.set('CreateInstruction', new CreateInstructionErrorHandler());
errorHandlers.set('UpdateInstruction', new UpdateInstructionErrorHandler());
errorHandlers.set('DeleteInstruction', new DeleteInstructionErrorHandler());

const errorHandler = (error: ErrorResponse) => {
  // V-SCN-226: Kailo alone prompts for the expired session (auth-required sent).
  if (signInOwnedByHost(error?.networkError)) return;
  const operationName = error?.operation?.operationName || '';
  const nativeUnknown = nativeWriteEvidence(error);
  // This original Apollo context flag changes only error presentation. It is
  // not sent as permission/scope authority; standalone keeps its native errors.
  const guarded = error?.operation?.getContext?.()?.nativeWriteGuarded === true;
  const sqlPair = ['CreateSqlPair', 'UpdateSqlPair', 'DeleteSqlPair'].includes(
    operationName,
  );
  const guardedNativeWriteUnknown =
    guarded &&
    (['CreateModel', 'CreateView', 'CreateDashboardItem'].includes(
      operationName,
    ) ||
      sqlPair) &&
    (nativeUnknown?.outcome !== 'NOT_STARTED' || !!error.networkError);
  if (nativeUnknown?.outcome === 'UNKNOWN' || guardedNativeWriteUnknown) {
    const text = getNativeWriteText(
      typeof document === 'undefined'
        ? undefined
        : document.documentElement.lang,
    );
    notify.warning(sqlPair ? text.unresolved : text.unknown);
    return;
  }
  // networkError
  if (error.networkError) {
    notify.error(kailoT('setup.errNetwork'), kailoT('setup.errNetworkHint'));
  }

  if (error.graphQLErrors) {
    for (const err of error.graphQLErrors) {
      errorHandlers.get(operationName)?.handle(err);
    }
  }
};

export default errorHandler;

export const parseGraphQLError = (error: ApolloError) => {
  if (!error) return null;
  const graphQLErrors: GraphQLError = error.graphQLErrors?.[0];
  const extensions = graphQLErrors?.extensions || {};
  return {
    message: extensions.message as string,
    shortMessage: extensions.shortMessage as string,
    code: extensions.code as string,
    stacktrace: extensions?.stacktrace as Array<string> | undefined,
  };
};
