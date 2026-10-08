import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useAskingStreamTask from './hooks/useAskingStreamTask';
import useAskPrompt from './hooks/useAskPrompt';
import PromptResult from './components/pages/home/prompt/Result';
import Prompt from './components/pages/home/prompt';
import { PROCESS_STATE } from './utils/enum';
import {
  AskingTaskStatus,
  AskingTaskType,
} from './apollo/client/graphql/__types__';

const mockCreate = jest.fn();
const mockCancel = jest.fn();
const mockRerun = jest.fn();
const mockFetch = jest.fn();
const mockRecommend = jest.fn();
const mockFetchRecommend = jest.fn();
let mockAskingResult: any;
let mockRecommendedResult: any;
jest.mock('./apollo/client/graphql/home.generated', () => ({
  useCreateAskingTaskMutation: () => [mockCreate, {}],
  useCancelAskingTaskMutation: () => [mockCancel, {}],
  useRerunAskingTaskMutation: () => [mockRerun, {}],
  useAskingTaskLazyQuery: () => [mockFetch, mockAskingResult],
  useCreateInstantRecommendedQuestionsMutation: () => [mockRecommend, {}],
  useInstantRecommendedQuestionsLazyQuery: () => [
    mockFetchRecommend,
    mockRecommendedResult,
  ],
}));
jest.mock(
  './components/editor/MarkdownBlock',
  () =>
    ({ content }: any) =>
      require('react').createElement('div', null, content),
);
jest.mock('./components/ErrorCollapse', () => () => null);
jest.mock('./components/pages/home/prompt/Input', () => () => null);
jest.mock('./hooks/useAskProcessState', () => ({
  ...jest.requireActual('./hooks/useAskProcessState'),
  __esModule: true,
  default: () => ({
    currentState: require('./utils/enum').PROCESS_STATE.FINISHED,
    matchedState: jest.fn(),
    transitionTo: jest.fn(),
    resetState: jest.fn(),
    isFailed: () => false,
  }),
}));
jest.mock('./components/pages/home/RecommendedQuestions', () => ({
  __esModule: true,
  default: () => null,
  getRecommendedQuestionProps: () => ({ show: false }),
}));
jest.mock('antd', () => ({
  Button: ({ children }: any) =>
    require('react').createElement('button', null, children),
}));

class NativeEventSource {
  static sources: NativeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  close = jest.fn();
  constructor(readonly url: string) {
    NativeEventSource.sources.push(this);
  }
  message(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  error() {
    this.onerror?.({ type: 'error' });
  }
}

describe('original Ask SSE hook and same-task GraphQL observation', () => {
  const originalSource = Object.getOwnPropertyDescriptor(global, 'EventSource');
  let slots: any[];
  let cursor: number;
  let pendingEffects: (() => void)[];
  const sameDependencies = (a: readonly any[], b: readonly any[]) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((item, i) => Object.is(item, b[i]));
  const memo = (factory: () => any, dependencies: readonly any[]) => {
    const index = cursor++;
    if (
      !slots[index] ||
      !sameDependencies(slots[index].dependencies, dependencies)
    ) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  };
  // Exercise the original hook's actual callbacks using the existing Node Jest
  // runner. Only React's scheduling and browser EventSource are substituted.
  const render = <T,>(hook: () => T): T => {
    cursor = 0;
    const result = hook();
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
    return result;
  };
  beforeEach(() => {
    slots = [];
    cursor = 0;
    pendingEffects = [];
    NativeEventSource.sources = [];
    Object.defineProperty(global, 'EventSource', {
      configurable: true,
      value: NativeEventSource,
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(React, 'useRef').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    });
    jest.spyOn(React, 'useState').mockImplementation(((initial: any) => {
      const index = cursor++;
      if (!slots[index])
        slots[index] = {
          value: typeof initial === 'function' ? initial() : initial,
        };
      return [
        slots[index].value,
        (next: any) => {
          slots[index].value =
            typeof next === 'function' ? next(slots[index].value) : next;
        },
      ];
    }) as any);
    jest.spyOn(React, 'useMemo').mockImplementation(memo);
    jest
      .spyOn(React, 'useCallback')
      .mockImplementation((callback: any, dependencies: readonly any[]) =>
        memo(() => callback, dependencies),
      );
    jest
      .spyOn(React, 'useEffect')
      .mockImplementation((effect, dependencies) => {
        const index = cursor++;
        if (
          !slots[index] ||
          !sameDependencies(slots[index].dependencies, dependencies)
        ) {
          const previous = slots[index];
          const slot = { dependencies, cleanup: undefined as any };
          slots[index] = slot;
          pendingEffects.push(() => {
            previous?.cleanup?.();
            slot.cleanup = effect();
          });
        }
      });
    mockAskingResult = { data: undefined, stopPolling: jest.fn(), client: {} };
    mockRecommendedResult = { data: undefined, stopPolling: jest.fn() };
    mockCreate.mockReset();
    mockRerun.mockReset();
    mockCancel.mockReset().mockResolvedValue({});
    mockFetch.mockReset().mockResolvedValue({ data: {} });
    mockRecommend.mockReset().mockResolvedValue({
      data: {
        createInstantRecommendedQuestions: { id: 'original-recommendation' },
      },
    });
    mockFetchRecommend.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    slots.forEach((slot) => slot.cleanup?.());
    jest.restoreAllMocks();
    if (originalSource)
      Object.defineProperty(global, 'EventSource', originalSource);
    else delete global.EventSource;
  });

  it('retains partial output and unresolved loading on EOF, observing instead of reopening the same ID', () => {
    const [start] = render(useAskingStreamTask);
    start('native/query?scope=actual');
    const source = NativeEventSource.sources[0];
    expect(source.url).toBe(
      '/api/ask_task/streaming?queryId=native%2Fquery%3Fscope%3Dactual',
    );
    source.message({ message: 'partial native answer' });
    source.error();
    const [observeAgain, state] = render(useAskingStreamTask);
    expect(state).toMatchObject({
      data: 'partial native answer',
      loading: true,
      completed: false,
    });
    observeAgain('native/query?scope=actual');
    expect(NativeEventSource.sources).toHaveLength(1);
    expect(source.close).toHaveBeenCalledTimes(1);
    source.message({ done: true });
    expect(render(useAskingStreamTask)[1].completed).toBe(false);
  });

  it('finishes only on the original exact done frame and ignores queued frames after it', () => {
    render(useAskingStreamTask)[0]('native-current');
    const source = NativeEventSource.sources[0];
    source.message({ message: 'verified answer' });
    source.message({ done: true });
    source.message({ message: 'late data' });
    source.error();
    expect(render(useAskingStreamTask)[1]).toMatchObject({
      data: 'verified answer',
      loading: false,
      completed: true,
    });
  });

  it.each([
    null,
    [],
    { done: 'true' },
    { done: false },
    { done: true, message: 'not a done frame' },
    { done: true, queryId: 'foreign' },
    { message: 42 },
    { unknown: 'future value' },
  ])(
    'rejects an unknown or malformed frame %j without success/failure or retry',
    (frame) => {
      render(useAskingStreamTask)[0]('native-current');
      const source = NativeEventSource.sources[0];
      source.message(frame);
      const [observeAgain, state] = render(useAskingStreamTask);
      expect(state).toMatchObject({
        data: '',
        loading: true,
        completed: false,
      });
      expect(source.close).toHaveBeenCalledTimes(1);
      observeAgain('native-current');
      expect(NativeEventSource.sources).toHaveLength(1);
    },
  );

  it('closes invalid JSON and preserves its partial evidence', () => {
    render(useAskingStreamTask)[0]('native-current');
    const source = NativeEventSource.sources[0];
    source.message({ message: 'partial' });
    source.onmessage?.({ data: '{' });
    expect(render(useAskingStreamTask)[1]).toMatchObject({
      data: 'partial',
      loading: true,
      completed: false,
    });
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('fences queued events across reset, a different task and unmount', () => {
    render(useAskingStreamTask)[0]('old-native');
    const old = NativeEventSource.sources[0];
    old.message({ message: 'old answer' });
    render(useAskingStreamTask)[1].reset();
    old.message({ message: 'late old answer' });
    old.message({ done: true });
    expect(render(useAskingStreamTask)[1]).toMatchObject({
      data: '',
      loading: false,
      completed: false,
    });
    render(useAskingStreamTask)[0]('new-native');
    const next = NativeEventSource.sources[1];
    next.message({ message: 'new answer' });
    old.message({ done: true });
    expect(render(useAskingStreamTask)[1]).toMatchObject({
      data: 'new answer',
      loading: true,
      completed: false,
    });
    slots.forEach((slot) => slot.cleanup?.());
    next.message({ done: true });
    expect(render(useAskingStreamTask)[1].completed).toBe(false);
    expect(next.close).toHaveBeenCalledTimes(1);
  });

  it('does not auto-retry a constructor/transport failure', () => {
    const construct = jest.fn(() => {
      throw new Error('transport unavailable');
    });
    Object.defineProperty(global, 'EventSource', {
      configurable: true,
      value: construct,
    });
    const [start] = render(useAskingStreamTask);
    start('native-current');
    start('native-current');
    expect(construct).toHaveBeenCalledTimes(1);
    expect(render(useAskingStreamTask)[1]).toMatchObject({
      loading: true,
      completed: false,
    });
  });

  const observeGeneral = async () => {
    await render(() => useAskPrompt()).onFetching('observed-native');
    mockAskingResult.data = {
      askingTask: {
        queryId: 'observed-native',
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.GENERAL,
      },
    };
    render(() => useAskPrompt());
    return NativeEventSource.sources[0];
  };

  it('continues the same GraphQL task on stream loss without creating or rerunning an Ask', async () => {
    const source = await observeGeneral();
    source.message({ message: 'partial' });
    source.error();
    const result = render(() => useAskPrompt());
    expect(result.data.askingTask.queryId).toBe('observed-native');
    expect(result.data.askingStreamCompleted).toBe(false);
    expect(result.loading).toBe(true);
    expect(mockAskingResult.stopPolling).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls).toEqual([
      [{ variables: { taskId: 'observed-native' } }],
    ]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRerun).not.toHaveBeenCalled();
    expect(NativeEventSource.sources).toHaveLength(1);
  });

  it('stops finished GENERAL polling only after native done, not after intent classification', async () => {
    const source = await observeGeneral();
    expect(mockAskingResult.stopPolling).not.toHaveBeenCalled();
    source.message({ message: 'answer' });
    source.message({ done: true });
    const result = render(() => useAskPrompt());
    expect(result.data.askingStreamCompleted).toBe(true);
    expect(mockAskingResult.stopPolling).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('uses the actual observed ID after rerouting and hides old polling data/body', async () => {
    const old = await observeGeneral();
    old.message({ message: 'old body' });
    await render(() => useAskPrompt()).onFetching('next-native');
    let result = render(() => useAskPrompt());
    expect(result.data.askingTask).toBeNull();
    expect(result.data.askingStreamTask).toBe('');
    mockAskingResult.data = {
      askingTask: {
        queryId: 'next-native',
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.GENERAL,
      },
    };
    render(() => useAskPrompt());
    const next = NativeEventSource.sources[1];
    expect(next.url).toContain('queryId=next-native');
    old.message({ done: true });
    result = render(() => useAskPrompt());
    expect(result.data.askingTask.queryId).toBe('next-native');
    expect(result.data.askingStreamCompleted).toBe(false);
  });

  it('ignores a late create ACK after the user moved to another existing native task', async () => {
    let ack: (response: any) => void;
    mockCreate.mockReturnValue(
      new Promise((resolve) => {
        ack = resolve;
      }),
    );
    const submit = render(() => useAskPrompt()).onSubmit('original question');
    await render(() => useAskPrompt()).onFetching('selected-native');
    ack!({ data: { createAskingTask: { id: 'late-created-native' } } });
    await submit;
    expect(mockFetch.mock.calls).toEqual([
      [{ variables: { taskId: 'selected-native' } }],
    ]);
  });

  it.each(['create', 'rerun'])(
    'does not reattach a late %s ACK after Close stopped observation',
    async (operation) => {
      let ack: (response: any) => void;
      const mutation = operation === 'create' ? mockCreate : mockRerun;
      const field =
        operation === 'create' ? 'createAskingTask' : 'rerunAskingTask';
      mutation.mockReturnValue(
        new Promise((resolve) => {
          ack = resolve;
        }),
      );
      const prompt = render(() => useAskPrompt());
      const pending =
        operation === 'create'
          ? prompt.onSubmit('original question')
          : prompt.onReRun({ id: 7, question: 'original question' } as any);
      render(() => useAskPrompt()).onStopPolling();
      ack!({ data: { [field]: { id: 'late-native-after-close' } } });
      await pending;
      mockAskingResult.data = {
        askingTask: {
          queryId: 'late-native-after-close',
          type: AskingTaskType.GENERAL,
          status: AskingTaskStatus.FINISHED,
        },
      };
      const closed = render(() => useAskPrompt());
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockAskingResult.stopPolling).toHaveBeenCalledTimes(1);
      expect(closed.data.askingTask).toBeNull();
      expect(closed.data.askingStreamTask).toBe('');
      expect(NativeEventSource.sources).toHaveLength(0);
      expect(mockCancel).not.toHaveBeenCalled();
    },
  );

  it.each(['create', 'rerun'])(
    'rejects late %s polling data when Close occurred after ACK but before the read completed',
    async (operation) => {
      let read: (response: any) => void;
      const mutation = operation === 'create' ? mockCreate : mockRerun;
      const field =
        operation === 'create' ? 'createAskingTask' : 'rerunAskingTask';
      mutation.mockResolvedValue({
        data: { [field]: { id: 'already-acknowledged-native' } },
      });
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          read = resolve;
        }),
      );
      const prompt = render(() => useAskPrompt());
      const pending =
        operation === 'create'
          ? prompt.onSubmit('original question')
          : prompt.onReRun({ id: 7, question: 'original question' } as any);
      await Promise.resolve();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      render(() => useAskPrompt()).onStopPolling();
      const late = {
        askingTask: {
          queryId: 'already-acknowledged-native',
          type: AskingTaskType.GENERAL,
          status: AskingTaskStatus.FINISHED,
        },
      };
      mockAskingResult.data = late;
      read!({ data: late });
      await pending;
      const closed = render(() => useAskPrompt());
      expect(closed.data.askingTask).toBeNull();
      expect(closed.data.askingStreamTask).toBe('');
      expect(NativeEventSource.sources).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockCancel).not.toHaveBeenCalled();
    },
  );

  it('discards current stream callbacks and old polling data after Close without canceling the native task', async () => {
    const source = await observeGeneral();
    source.message({ message: 'old answer' });
    render(() => useAskPrompt()).onStopPolling();
    mockAskingResult.data = {
      askingTask: {
        queryId: 'observed-native',
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.GENERAL,
      },
    };
    source.message({ message: 'late old answer' });
    source.message({ done: true });
    const closed = render(() => useAskPrompt());
    expect(closed.data.askingTask).toBeNull();
    expect(closed.data.askingStreamTask).toBe('');
    expect(closed.data.askingStreamCompleted).toBe(false);
    expect(closed.loading).toBe(false);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(NativeEventSource.sources).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('original GeneralAnswer rendering', () => {
  const render = (completed: boolean, loading: boolean) =>
    renderToStaticMarkup(
      React.createElement(PromptResult, {
        processState: PROCESS_STATE.FINISHED,
        data: {
          type: AskingTaskType.GENERAL,
          originalQuestion: 'Original question',
          askingStreamTask: 'Partial or completed original answer',
          askingStreamCompleted: completed,
          intentReasoning: 'Original intent',
          recommendedQuestions: null,
        },
        loading,
        onClose: () => {},
        onStop: async () => {},
        onIntentSQLAnswer: () => {},
        onSelectRecommendedQuestion: () => {},
      }),
    );
  it('never presents disconnected partial content as completed even when transport loading is false', () => {
    const html = render(false, false);
    expect(html).toContain('Partial or completed original answer');
    expect(html).not.toContain('For the most accurate semantics');
  });
  it('preserves the original completion text only with actual done evidence', () => {
    expect(render(true, false)).toContain('For the most accurate semantics');
  });
  it('keeps the original loading icon while current native observation is unresolved', () => {
    const html = render(false, true);
    expect(html).toContain('anticon-loading');
    expect(html).not.toContain('For the most accurate semantics');
  });

  const promptProps = () => ({
    data: {
      originalQuestion: 'Original question',
      askingTask: {
        queryId: 'original-native',
        type: AskingTaskType.GENERAL,
        status: AskingTaskStatus.FINISHED,
      } as any,
      askingStreamTask: 'Original answer',
      askingStreamCompleted: true,
    },
    loading: false,
    inputProps: { placeholder: 'Original placeholder' },
    onCreateResponse: jest.fn(),
    onStop: jest.fn(),
    onSubmit: jest.fn(),
    onStopPolling: jest.fn(),
    onStopStreaming: jest.fn(),
    onStopRecommend: jest.fn(),
  });

  it('passes actual stream completion through the original Prompt to GeneralAnswer', () => {
    const state = jest
      .spyOn(React, 'useState')
      .mockImplementation(((initial: any) => [
        typeof initial === 'boolean' ? true : initial,
        jest.fn(),
      ]) as any);
    try {
      const html = renderToStaticMarkup(
        React.createElement(Prompt, promptProps()),
      );
      expect(html).toContain('For the most accurate semantics');
    } finally {
      state.mockRestore();
    }
  });

  it('closes only observation when the user dismisses the original prompt', () => {
    let attributes: any;
    const imperative = jest
      .spyOn(React, 'useImperativeHandle')
      .mockImplementation((_ref, create) => {
        attributes = create();
      });
    const props = promptProps();
    try {
      renderToStaticMarkup(React.createElement(Prompt, props));
      attributes.close();
      expect(props.onStopPolling).toHaveBeenCalledTimes(1);
      expect(props.onStopStreaming).toHaveBeenCalledTimes(1);
      expect(props.onStopRecommend).toHaveBeenCalledTimes(1);
      expect(props.onSubmit).not.toHaveBeenCalled();
      expect(props.onStop).not.toHaveBeenCalled();
    } finally {
      imperative.mockRestore();
    }
  });
});
