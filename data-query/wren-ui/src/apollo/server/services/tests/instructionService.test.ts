import { InstructionService } from '../instructionService';
import { InstructionResolver } from '../../resolvers/instructionResolver';
import { InstructionStatus } from '../../models/adaptor';
import { NativeQueryRefusal } from '../nativeQueryAdmission';

describe('original native instruction write admission', () => {
  const input = {
    projectId: 3,
    instruction: 'Use the original business definition',
    questions: ['What is the original definition?'],
    isDefault: false,
  };
  const row = { ...input, id: 7 };
  let prior: string | undefined;
  let service: InstructionService;
  let repository: any;
  let adaptor: any;
  let tx: any;
  let sequence: string[];

  beforeEach(() => {
    prior = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    sequence = [];
    tx = {
      commit: jest.fn(async () => {
        sequence.push('commit');
      }),
      rollback: jest.fn(async () => {
        sequence.push('rollback');
      }),
    };
    repository = {
      transaction: jest.fn(async () => {
        sequence.push('transaction');
        return tx;
      }),
      findOneBy: jest.fn(async () => {
        sequence.push('read');
        return row;
      }),
      createOne: jest.fn(async () => {
        sequence.push('write');
        return row;
      }),
      updateOne: jest.fn(async () => {
        sequence.push('write');
        return row;
      }),
      deleteOne: jest.fn(async () => {
        sequence.push('write');
      }),
    };
    adaptor = {
      generateInstruction: jest.fn(async () => {
        sequence.push('dispatch');
        return { queryId: 'original-task' };
      }),
      getInstructionResult: jest.fn(async () => ({
        status: InstructionStatus.FINISHED,
      })),
      deleteInstructions: jest.fn(async () => {
        sequence.push('dispatch');
      }),
    };
    service = new InstructionService({
      instructionRepository: repository,
      wrenAIAdaptor: adaptor,
    });
  });

  afterEach(() => {
    if (prior === undefined) delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = prior;
  });

  describe.each(['create', 'update', 'delete'] as const)('%s', (operation) => {
    const writeMethod = {
      create: 'createOne',
      update: 'updateOne',
      delete: 'deleteOne',
    }[operation];
    const dispatchMethod =
      operation === 'delete' ? 'deleteInstructions' : 'generateInstruction';
    const invoke = (beforeWrite?: (projectId: number) => Promise<void>) => {
      if (operation === 'create')
        return service.createInstruction(input, beforeWrite);
      if (operation === 'update')
        return service.updateInstruction(row, beforeWrite);
      return service.deleteInstruction(row.id, input.projectId, beforeWrite);
    };

    it('checks the original project after every native await before write and AI dispatch', async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      const beforeWrite = jest.fn(async (projectId: number) => {
        expect(projectId).toBe(input.projectId);
        sequence.push('authorize');
      });
      await invoke(beforeWrite);
      expect(sequence).toEqual([
        'transaction',
        ...(operation === 'create' ? [] : ['read']),
        'authorize',
        'write',
        'authorize',
        'dispatch',
        'commit',
      ]);
      expect(adaptor[dispatchMethod]).toHaveBeenCalledTimes(1);
      expect(tx.rollback).not.toHaveBeenCalled();
      if (operation !== 'create')
        expect(repository.findOneBy).toHaveBeenCalledWith(
          { id: row.id, projectId: input.projectId },
          { tx },
        );
    });

    it('rolls back a denied first write and preserves the exact not-started refusal', async () => {
      const refusal = new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      await expect(
        invoke(async () => {
          throw refusal;
        }),
      ).rejects.toBe(refusal);
      expect(repository[writeMethod]).not.toHaveBeenCalled();
      expect(adaptor[dispatchMethod]).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('rolls back the staged native write if generation changes before AI dispatch', async () => {
      const refusal = new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const beforeWrite = jest.fn(async () => {
        if (repository[writeMethod].mock.calls.length) throw refusal;
      });
      await expect(invoke(beforeWrite)).rejects.toBe(refusal);
      expect(repository[writeMethod]).toHaveBeenCalledTimes(1);
      expect(adaptor[dispatchMethod]).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('does not dispatch when standalone becomes bound while awaiting the transaction', async () => {
      repository.transaction.mockImplementation(async () => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
          'fixture-controlled-delivery';
        return tx;
      });
      await expect(invoke()).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
      expect(repository[writeMethod]).not.toHaveBeenCalled();
      expect(adaptor[dispatchMethod]).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch when standalone becomes bound during the staged native write', async () => {
      repository[writeMethod].mockImplementation(async () => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
          'fixture-controlled-delivery';
        return row;
      });
      await expect(invoke()).rejects.toThrow('NATIVE_AUTHENTICATION_REQUIRED');
      expect(adaptor[dispatchMethod]).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('preserves the original independent native operation without platform credentials', async () => {
      await invoke();
      expect(adaptor[dispatchMethod]).toHaveBeenCalledTimes(1);
      expect(tx.commit).toHaveBeenCalledTimes(1);
    });

    it('retains an already-dispatched error for UNKNOWN handling and never retries the AI request', async () => {
      const unknown = new Error('Original AI acknowledgement lost');
      adaptor[dispatchMethod].mockRejectedValue(unknown);
      await expect(invoke(async () => {})).rejects.toBe(unknown);
      expect(adaptor[dispatchMethod]).toHaveBeenCalledTimes(1);
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(tx.commit).not.toHaveBeenCalled();
    });

    it('consumes the resolver captured-generation check inside the real native service', async () => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      const nativeProjectCheck = jest.fn(async (projectId: number) => {
        expect(projectId).toBe(input.projectId);
        if (repository[writeMethod].mock.calls.length)
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      });
      const ctx: any = {
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: input.projectId })),
        },
        instructionService: service,
        nativeHumanToken: 'fixture-verified-token',
        nativeIdentityScope: 'fixture-scope',
        nativeProjectCheck,
        telemetry: { sendEvent: jest.fn() },
      };
      const resolver = new InstructionResolver();
      const args = { where: { id: row.id }, data: input };
      const result =
        operation === 'create'
          ? resolver.createInstruction(null, args, ctx)
          : operation === 'update'
            ? resolver.updateInstruction(null, args, ctx)
            : resolver.deleteInstruction(null, args, ctx);
      await expect(result).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(adaptor[dispatchMethod]).not.toHaveBeenCalled();
      expect(tx.rollback).toHaveBeenCalledTimes(1);
      expect(nativeProjectCheck).toHaveBeenCalledTimes(3);
    });
  });
});
