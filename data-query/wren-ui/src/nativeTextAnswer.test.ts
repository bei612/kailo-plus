import { Readable } from 'stream';
import { EventEmitter } from 'events';
import handler from './pages/api/ask_task/streaming_answer';
import { NativeHumanQuery } from './apollo/server/services/nativeHumanQuery';
import { loadQueryDelivery } from './apollo/server/services/nativeQueryAdmission';
import { TextBasedAnswerBackgroundTracker } from './apollo/server/backgrounds/textBasedAnswerBackgroundTracker';
import { components } from './common';

jest.mock('./common', () => ({
  components: {
    askingService: {
      getResponse: jest.fn(),
      changeThreadResponseAnswerDetailStatus: jest.fn(async () => undefined),
    },
    wrenAIAdaptor: { streamTextBasedAnswer: jest.fn() },
    threadResponseRepository: { claimNativeAnswer: jest.fn() },
    apiHistoryRepository: { findOneBy: jest.fn() },
    projectService: { getCurrentProject: jest.fn() },
  },
}));
jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
}));

describe('original native text-answer result consumers', () => {
  const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  const response: any = {
    id: 71,
    threadId: 81,
    question: 'original',
    sql: 'SELECT value FROM native_model',
    answerDetail: {
      queryId: 'native-ai-task',
      queryHistoryId: 'native-query-history',
      status: 'STREAMING',
    },
  };
  const native: any = components;
  const record: any = {
    id: 'native-query-history',
    requestPayload: { sql: response.sql },
    responsePayload: { columns: [], data: [] },
  };
  let authorize: jest.SpyInstance;
  beforeEach(() => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-delivery';
    jest.clearAllMocks();
    native.askingService.getResponse.mockResolvedValue(response);
    native.apiHistoryRepository.findOneBy.mockResolvedValue(record);
    native.projectService.getCurrentProject.mockResolvedValue({ id: 3 });
    jest.mocked(loadQueryDelivery).mockResolvedValue({
      projectId: 3,
      bindingId: 'fixture-binding',
      nativeInstanceRef: 'fixture-instance',
      nativeScopeRef: '3',
    } as any);
    native.threadResponseRepository.claimNativeAnswer.mockImplementation(
      async (expected, detail) => ({ ...expected, answerDetail: detail }),
    );
    authorize = jest
      .spyOn(NativeHumanQuery.prototype, 'readHistory')
      .mockResolvedValue(record);
  });
  afterEach(() => {
    authorize.mockRestore();
    if (original === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
  });
  const invoke = async (chunks: Buffer[]) => {
    native.wrenAIAdaptor.streamTextBasedAnswer.mockResolvedValue(
      Readable.from(chunks),
    );
    const request: any = Object.assign(new EventEmitter(), {
      method: 'GET',
      query: { responseId: '71' },
      headers: {
        'x-kailo-native-human-token': 'verified-human',
        'x-kailo-native-identity-scope': 'a'.repeat(64),
      },
    });
    const output: any = {
      setHeader: jest.fn(),
      status: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      headersSent: false,
      flushHeaders: jest.fn(() => {
        output.headersSent = true;
      }),
    };
    output.status.mockReturnValue(output);
    await handler(request, output);
    return output;
  };
  it('keeps original UTF-8 streaming and completes only on the exact native task receipt', async () => {
    const encoded = Buffer.from(
      'data: {"message":"中文原答案"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
    );
    const result = await invoke([
      encoded.subarray(0, 21),
      encoded.subarray(21, 25),
      encoded.subarray(25),
    ]);
    expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
      'data: {"message":"中文原答案"}\n\ndata: {"done":true}\n\n',
    );
    expect(
      native.threadResponseRepository.claimNativeAnswer,
    ).toHaveBeenCalledWith(response, {
      ...response.answerDetail,
      status: 'FINISHED',
      content: '中文原答案',
    });
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize.mock.calls[0]).toEqual(['verified-human', record]);
  });
  it.each(['close', 'foreign-id', 'unknown-enum'])(
    'does not manufacture FINISHED from %s',
    async (mode) => {
      const suffix =
        mode === 'foreign-id'
          ? 'data: {"done":true,"queryId":"foreign-ai-task"}\n\n'
          : mode === 'unknown-enum'
            ? 'data: {"status":"FUTURE_SUCCESS"}\n\n'
            : '';
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await invoke([
          Buffer.from('data: {"message":"partial"}\n\n' + suffix),
        ]);
        expect(
          native.threadResponseRepository.claimNativeAnswer,
        ).not.toHaveBeenCalled();
        expect(
          result.write.mock.calls.map(([value]) => value).join(''),
        ).not.toContain('"done":true');
      } finally {
        error.mockRestore();
      }
    },
  );
  it('keeps the original standalone answer stream and terminal persistence without a platform binding', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const result = await invoke([
      Buffer.from(
        'data: {"message":"original answer"}\n\ndata: {"done":true,"queryId":"native-ai-task"}\n\n',
      ),
    ]);
    expect(authorize).not.toHaveBeenCalled();
    expect(
      native.threadResponseRepository.claimNativeAnswer,
    ).not.toHaveBeenCalled();
    expect(
      native.askingService.changeThreadResponseAnswerDetailStatus,
    ).toHaveBeenCalledWith(71, 'FINISHED', 'original answer');
    expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
      'data: {"message":"original answer"}\n\ndata: {"done":true}\n\n',
    );
  });
  it('does not open the original AI stream when current HUMAN disclosure is rejected', async () => {
    authorize.mockRejectedValue(new Error('current Resource revoked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from('data: {"message":"private"}\n\n'),
      ]);
      expect(native.wrenAIAdaptor.streamTextBasedAnswer).not.toHaveBeenCalled();
      expect(result.flushHeaders).not.toHaveBeenCalled();
      expect(result.write).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
  it('rechecks current HUMAN/source authorization before each content exposure', async () => {
    authorize
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(record)
      .mockRejectedValue(new Error('current Resource revoked'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from(
          'data: {"message":"allowed"}\n\ndata: {"message":"revoked"}\n\n',
        ),
      ]);
      expect(result.write.mock.calls.map(([value]) => value).join('')).toBe(
        'data: {"message":"allowed"}\n\n',
      );
      expect(
        native.threadResponseRepository.claimNativeAnswer,
      ).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
  it('a concurrent original response change cannot be overwritten with a terminal result', async () => {
    native.threadResponseRepository.claimNativeAnswer.mockResolvedValue(null);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await invoke([
        Buffer.from('data: {"done":true,"queryId":"native-ai-task"}\n\n'),
      ]);
      expect(result.write).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
  it('the original background tracker only polls an admitted AI task; UNKNOWN retries that id without SQL/create', async () => {
    let tick: () => Promise<void>;
    const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
      callback,
    ) => {
      tick = callback;
      return 1;
    }) as any);
    const pending = {
      ...response,
      answerDetail: { ...response.answerDetail, status: 'PREPROCESSING' },
    };
    const queryService: any = { preview: jest.fn() };
    const adaptor: any = {
      createTextBasedAnswer: jest.fn(),
      getTextBasedAnswerResult: jest.fn(async () => ({ status: 'UNKNOWN' })),
    };
    const repository: any = {
      claimNativeAnswer: jest.fn(async () => pending),
      updateOne: jest.fn(),
    };
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = new TextBasedAnswerBackgroundTracker({
      wrenAIAdaptor: adaptor,
      threadResponseRepository: repository,
      projectService: {} as any,
      deployService: {} as any,
      queryService,
    });
    interval.mockRestore();
    try {
      tracker.addTask(pending);
      await tick();
      await new Promise((resolve) => setImmediate(resolve));
      expect(repository.claimNativeAnswer).not.toHaveBeenCalled();
      adaptor.getTextBasedAnswerResult.mockResolvedValue({
        status: 'SUCCEEDED',
      });
      await tick();
      await new Promise((resolve) => setImmediate(resolve));
      expect(adaptor.getTextBasedAnswerResult.mock.calls).toEqual([
        ['native-ai-task'],
        ['native-ai-task'],
      ]);
      expect(repository.claimNativeAnswer).toHaveBeenCalledWith(
        pending,
        expect.objectContaining({
          queryHistoryId: 'native-query-history',
          queryId: 'native-ai-task',
          status: 'STREAMING',
        }),
      );
      expect(adaptor.createTextBasedAnswer).not.toHaveBeenCalled();
      expect(queryService.preview).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
