import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewMetadata from './components/pages/modeling/metadata/ViewMetadata';
import ModelMetadata from './components/pages/modeling/metadata/ModelMetadata';
import useGovernedPreview from './hooks/useGovernedPreview';
import useGovernedSqlPreview from './hooks/useGovernedSqlPreview';
import useDashboardQuery from './hooks/useDashboardQuery';
import useNativeSQL from './hooks/useNativeSQL';
import { queryReceiptState } from './utils/queryReceipt';
import { getQueryPreviewText } from './utils/language';
import { getNativeWriteText } from './utils/language';
import errorHandler, { runNativeMetadataWrite } from './utils/errorHandler';
import { message } from 'antd';
import { webcrypto } from 'node:crypto';
import SaveAsViewModal from './components/modals/SaveAsViewModal';
import ModelDrawer from './components/pages/modeling/ModelDrawer';
import QuestionSQLPairModal from './components/modals/QuestionSQLPairModal';
import { FORM_MODE } from './utils/enum';
import APIHistory from './pages/api-management/history';
import DetailsDrawer from './components/pages/apiManagement/DetailsDrawer';
import { ApiType } from './apollo/client/graphql/__types__';
import { getApiHistoryText } from './utils/language';
import HomeThread from './pages/home/[id]';

let mockLocale: string | undefined;
let mockScope: string;
let mockButtons: any[];
let mockPreviewResult: any;
let mockFormValues: any;
let mockSqlWatch: string;
const mockPreview = jest.fn();
const mockConfig = jest.fn();
const mockSqlPairRead = jest.fn();
const mockHistoryRead = jest.fn();
const mockNativeSqlRead = jest.fn();
const mockCreateView = jest.fn();
const mockViewRead = jest.fn();
let mockNativeSqlOptions: any[];
jest.mock('./apollo/client/graphql/home.generated', () => ({
  useGetNativeSqlLazyQuery: (options: any) => {
    mockNativeSqlOptions.push(options);
    return [
      mockNativeSqlRead,
      { data: { nativeSql: 'old shared Apollo cache' } },
    ];
  },
  useThreadQuery: () => ({ data: {}, updateQuery: jest.fn() }),
  useCreateThreadResponseMutation: () => [jest.fn()],
  useUpdateThreadResponseMutation: () => [jest.fn(), {}],
  useThreadResponseLazyQuery: () => [jest.fn(), { stopPolling: jest.fn() }],
  useGenerateThreadRecommendationQuestionsMutation: () => [jest.fn()],
  useGetThreadRecommendationQuestionsLazyQuery: () => [
    jest.fn(),
    { stopPolling: jest.fn() },
  ],
  useGenerateThreadResponseAnswerMutation: () => [jest.fn()],
  useGenerateThreadResponseChartMutation: () => [jest.fn()],
  useAdjustThreadResponseChartMutation: () => [jest.fn()],
}));
jest.mock('./apollo/client', () => ({
  __esModule: true,
  default: { query: (...args: any[]) => mockViewRead(...args) },
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: '11' }) }));
jest.mock('./hooks/useHomeSidebar', () => () => ({}));
jest.mock('./hooks/useAskPrompt', () => ({
  __esModule: true,
  default: () => ({ data: {} }),
}));
jest.mock('./hooks/useAdjustAnswer', () => () => ({}));
jest.mock('./components/pages/home/prompt', () => () => null);
jest.mock('./components/pages/home/promptThread', () => () => null);
jest.mock('./components/pages/home/promptThread/TextBasedAnswer', () => ({
  getAnswerIsFinished: () => true,
}));
jest.mock('./components/pages/home/promptThread/ChartAnswer', () => ({
  getIsChartFinished: () => true,
}));
jest.mock('./components/pages/home/promptThread/store', () => ({
  PromptThreadProvider: ({ children }: any) => children,
}));
jest.mock('./components/modals/AdjustReasoningStepsModal', () => () => null);
jest.mock('./components/modals/AdjustSQLModal', () => () => null);
const mockHistoryOpen = jest.fn();
const mockHistoryClose = jest.fn();
const mockHistoryUpdate = jest.fn();
let mockHistoryState: any;
let mockHistoryTable: any;
let mockHistoryDrawer: any;
let mockHistoryQueryOptions: any[];
jest.mock('./apollo/client/graphql/apiManagement.generated', () => ({
  useApiHistoryQuery: () => {
    throw new Error('Original history cache must not bypass current identity');
  },
  useApiHistoryLazyQuery: (options: any) => {
    mockHistoryQueryOptions.push(options);
    return [mockHistoryRead];
  },
}));
jest.mock('./hooks/useDrawerAction', () => () => ({
  state: mockHistoryState,
  openDrawer: mockHistoryOpen,
  closeDrawer: mockHistoryClose,
  updateState: mockHistoryUpdate,
}));
jest.mock('./components/layouts/SiderLayout', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
jest.mock('./components/layouts/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
jest.mock('./utils/table', () => ({ getColumnSearchProps: () => ({}) }));
jest.mock('./components/code/JsonCodeBlock', () => ({
  __esModule: true,
  default: ({ code }: any) =>
    jest
      .requireActual('react')
      .createElement('pre', null, JSON.stringify(code)),
}));
jest.mock('./apollo/client/graphql/sqlPairs.generated', () => ({
  useSqlPairsLazyQuery: () => [mockSqlPairRead],
  useCreateSqlPairMutation: () => [jest.fn(), {}],
}));
jest.mock('next/router', () => ({ useRouter: () => ({ locale: mockLocale }) }));
jest.mock('./utils/env', () => ({ getUserConfig: () => mockConfig() }));
jest.mock('./apollo/client/graphql/view.generated', () => ({
  usePreviewViewDataMutation: () => [mockPreview, mockPreviewResult],
  useValidateViewMutation: () => [jest.fn()],
  useCreateViewMutation: () => [mockCreateView, {}],
}));
jest.mock('./apollo/client/graphql/model.generated', () => ({
  usePreviewModelDataMutation: () => [mockPreview, mockPreviewResult],
}));
jest.mock('./apollo/client/graphql/sql.generated', () => ({
  usePreviewSqlMutation: () => [mockPreview, mockPreviewResult],
  useGenerateQuestionMutation: () => [jest.fn()],
}));
jest.mock('./apollo/client/graphql/settings.generated', () => ({
  useGetSettingsQuery: () => ({ data: {} }),
}));
jest.mock('./components/editor/SQLEditor', () => () => null);
jest.mock('./components/ErrorCollapse', () => () => null);
jest.mock('./components/modals/ImportDataSourceSQLModal', () => ({
  __esModule: true,
  default: () => null,
  isSupportSubstitute: () => false,
}));
jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const field = ({ children }: any) =>
    React.createElement('div', null, children);
  const overlay = ({ children, footer }: any) =>
    React.createElement('section', null, children, footer);
  const Input: any = (props: any) =>
    React.createElement('input', { 'aria-label': props['aria-label'] });
  Input.TextArea = () => null;
  const Form: any = field;
  Form.Item = field;
  Form.useWatch = () => mockSqlWatch;
  Form.useForm = () => [
    {
      validateFields: async () => mockFormValues ?? { name: 'OriginalView' },
      resetFields: jest.fn(),
      setFieldsValue: jest.fn(),
    },
  ];
  return {
    Form,
    Modal: overlay,
    Drawer: (props: any) => {
      if (props.title === 'API details') mockHistoryDrawer = props;
      return overlay(props);
    },
    Tag: (props: any) =>
      React.createElement(
        'span',
        { 'data-tag-color': props.color },
        props.children,
      ),
    Table: (props: any) => {
      mockHistoryTable = props;
      return null;
    },
    Space: field,
    message: { warning: jest.fn(), error: jest.fn(), success: jest.fn() },
    Alert: (props: any) =>
      React.createElement(
        'div',
        { 'data-alert-type': props.type },
        props.message,
      ),
    Row: field,
    Col: field,
    Input,
    InputNumber: field,
    Typography: { Text: field, Paragraph: field, Link: field },
    Button: (props: any) => {
      mockButtons.push(props);
      return React.createElement('button', null, props.children);
    },
  };
});
jest.mock('./components/code/SQLCodeBlock', () => () => null);
jest.mock(
  './components/dataPreview/PreviewData',
  () => (props: any) =>
    jest
      .requireActual('react')
      .createElement(
        'div',
        { 'data-native-preview': true },
        props.previewData ? JSON.stringify(props.previewData) : null,
      ),
);
jest.mock('./components/table/FieldTable', () => () => null);
jest.mock('./components/table/CalculatedFieldTable', () => () => null);
jest.mock('./components/table/RelationTable', () => () => null);
jest.mock('./components/table/BaseTable', () => ({ COLUMN: {} }));
jest.mock('./components/pages/modeling/form/ModelForm', () => () => null);

describe('original Show original SQL hook identity and late-response consumers', () => {
  let hook: ReturnType<typeof useNativeSQL>;
  let effect: jest.SpyInstance;
  let state: jest.SpyInstance;
  let effects: Array<() => void | (() => void)>;
  let cleanup: void | (() => void);
  let published: any[];
  let listeners: Map<string, () => void>;
  let originalWindow: PropertyDescriptor | undefined;
  let originalDocument: PropertyDescriptor | undefined;
  const identity = {
    nativeBindingConfigured: true,
    nativeBindingGeneration: 2,
    queryScope: 'a'.repeat(64),
  };
  const flush = async () => {
    for (let index = 0; index < 16; index++) await Promise.resolve();
  };
  beforeEach(() => {
    published = [];
    mockLocale = undefined;
    effects = [];
    listeners = new Map();
    mockNativeSqlOptions = [];
    mockConfig.mockReset().mockResolvedValue(identity);
    mockNativeSqlRead
      .mockReset()
      .mockResolvedValue({ data: { nativeSql: 'SELECT originalConverted' } });
    jest.mocked(message.error).mockClear();
    effect = jest
      .spyOn(jest.requireActual('react'), 'useEffect')
      .mockImplementation((callback: any) => {
        effects.push(callback);
      });
    state = jest
      .spyOn(jest.requireActual('react'), 'useState')
      .mockImplementation((initial: any) => [
        initial,
        (value: any) => published.push(value),
      ]);
    originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
    originalDocument = Object.getOwnPropertyDescriptor(global, 'document');
    const events = {
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: events,
    });
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: { ...events, visibilityState: 'visible' },
    });
    const Consumer = () => {
      hook = useNativeSQL(71);
      return null;
    };
    renderToStaticMarkup(createElement(Consumer));
    cleanup = effects[0]();
    hook.nativeSQLResult.setNativeSQLMode(true);
  });
  afterEach(() => {
    if (cleanup) cleanup();
    effect.mockRestore();
    state.mockRestore();
    if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
    else delete (global as any).window;
    if (originalDocument)
      Object.defineProperty(global, 'document', originalDocument);
    else delete (global as any).document;
  });
  const bodies = () => published.filter((value) => value?.responseId);
  it('reads the original selected response without shared Apollo cache and sends the real current request identity', async () => {
    expect(mockNativeSqlOptions).toEqual([{ fetchPolicy: 'no-cache' }]);
    expect(hook.nativeSQLResult.data).toBe('');
    await hook.fetchNativeSQL();
    expect(mockNativeSqlRead).toHaveBeenCalledTimes(1);
    expect(mockNativeSqlRead).toHaveBeenCalledWith({
      variables: {
        responseId: 71,
        queryScope: identity.queryScope,
        generation: 2,
      },
    });
    expect(bodies()).toEqual([
      { responseId: 71, value: 'SELECT originalConverted' },
    ]);
    expect(message.error).not.toHaveBeenCalled();
  });
  it('retains explicit independent native conversion without fabricating scope or generation', async () => {
    mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
    await hook.fetchNativeSQL();
    expect(mockNativeSqlRead).toHaveBeenCalledWith({
      variables: { responseId: 71 },
    });
    expect(bodies()).toHaveLength(1);
  });
  it.each([
    {},
    { nativeBindingConfigured: true },
    { ...identity, nativeBindingGeneration: 0 },
    { ...identity, queryScope: '' },
  ])(
    'does not borrow independent mode from malformed current configuration %p',
    async (config) => {
      mockConfig.mockResolvedValue(config);
      await hook.fetchNativeSQL();
      expect(mockNativeSqlRead).not.toHaveBeenCalled();
      expect(bodies()).toEqual([]);
    },
  );
  it.each(['scope', 'generation', 'binding'])(
    'withholds converted SQL if %s changes during the original request',
    async (fault) => {
      mockConfig
        .mockResolvedValueOnce(identity)
        .mockResolvedValueOnce(
          fault === 'scope'
            ? { ...identity, queryScope: 'b'.repeat(64) }
            : fault === 'generation'
              ? { ...identity, nativeBindingGeneration: 3 }
              : { nativeBindingConfigured: false },
        );
      await hook.fetchNativeSQL();
      expect(bodies()).toEqual([]);
      expect(mockNativeSqlRead).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['close', 'hide', 'unmount'])(
    'does not publish a late original converter acknowledgement after %s',
    async (boundary) => {
      let acknowledge: (value: any) => void;
      mockNativeSqlRead.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      const pending = hook.fetchNativeSQL();
      await flush();
      expect(mockNativeSqlRead).toHaveBeenCalledTimes(1);
      if (boundary === 'close') hook.nativeSQLResult.setNativeSQLMode(false);
      else if (boundary === 'unmount') {
        if (cleanup) cleanup();
        cleanup = undefined;
      } else {
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          configurable: true,
        });
        listeners.get('visibilitychange')();
      }
      acknowledge({ data: { nativeSql: 'SELECT staleConverted' } });
      await pending;
      expect(bodies()).toEqual([]);
      expect(mockConfig).toHaveBeenCalledTimes(1);
      expect(message.error).not.toHaveBeenCalled();
    },
  );
  it('restores the original enabled SQL view through a fresh same-identity read on focus, never the old cache', async () => {
    await hook.fetchNativeSQL();
    expect(bodies()).toHaveLength(1);
    listeners.get('focus')();
    await flush();
    expect(mockNativeSqlRead).toHaveBeenCalledTimes(2);
    expect(bodies()).toHaveLength(2);
  });
  it('does not restore the prior response under another actor or generation on focus', async () => {
    await hook.fetchNativeSQL();
    mockConfig.mockResolvedValue({ ...identity, queryScope: 'b'.repeat(64) });
    listeners.get('focus')();
    await flush();
    expect(mockNativeSqlRead).toHaveBeenCalledTimes(1);
    expect(bodies()).toHaveLength(1);
    expect(published).toContain(false);
  });
  it.each(['error', 'missing'])(
    'does not present %s conversion evidence as successful native SQL or retry automatically',
    async (fault) => {
      mockNativeSqlRead.mockResolvedValue(
        fault === 'error'
          ? { error: new Error('QUERY_EVIDENCE_UNAVAILABLE') }
          : {},
      );
      await hook.fetchNativeSQL();
      expect(bodies()).toEqual([]);
      expect(mockNativeSqlRead).toHaveBeenCalledTimes(1);
      expect(published).toContain(false);
    },
  );
  it.each([undefined, 'en'])(
    'presents a bound conversion refusal through the original toast in locale %p, without native error bodies',
    async (locale) => {
      mockLocale = locale;
      if (cleanup) cleanup();
      effects = [];
      const Consumer = () => {
        hook = useNativeSQL(71);
        return null;
      };
      renderToStaticMarkup(createElement(Consumer));
      cleanup = effects[0]();
      hook.nativeSQLResult.setNativeSQLMode(true);
      mockNativeSqlRead.mockResolvedValue({
        error: new Error('provider details SELECT private_table'),
      });
      await hook.fetchNativeSQL();
      expect(message.error).toHaveBeenCalledWith(
        getQueryPreviewText(locale).referenceError,
      );
      expect(
        JSON.stringify(jest.mocked(message.error).mock.calls),
      ).not.toContain('private_table');
      expect(bodies()).toEqual([]);
    },
  );
});

describe('original API History detail bounded native observation consumers', () => {
  const pending = {
    id: 'original-history-id',
    projectId: 3,
    apiType: ApiType.CREATE_SQL_PAIR,
    statusCode: 202,
    createdAt: '2026-10-08T00:00:00Z',
    requestPayload: null,
    responsePayload: null,
  };
  const completed = {
    ...pending,
    statusCode: 200,
    requestPayload: { question: 'Original question' },
    responsePayload: { id: 42 },
  };
  let effects: Array<() => void | (() => void)>;
  let published: any[];
  let listeners: Map<string, () => void>;
  let cleanup: (() => void) | undefined;
  let effect: jest.SpyInstance;
  let state: jest.SpyInstance;
  let originalWindow: PropertyDescriptor | undefined;
  let originalDocument: PropertyDescriptor | undefined;
  const pageResult = (items: any[]) => ({
    data: { apiHistory: { items, total: items.length, hasMore: false } },
  });
  const flush = async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
  };
  beforeEach(() => {
    mockLocale = undefined;
    mockButtons = [];
    mockHistoryState = { visible: true, defaultValue: pending };
    mockHistoryQueryOptions = [];
    mockHistoryOpen.mockReset().mockImplementation((record) => {
      mockHistoryState = { visible: true, defaultValue: record };
    });
    mockHistoryClose.mockReset().mockImplementation(() => {
      mockHistoryState = { visible: false, defaultValue: null };
    });
    mockHistoryUpdate.mockReset();
    mockHistoryRead.mockReset().mockResolvedValue(pageResult([pending]));
    mockConfig.mockReset().mockResolvedValue({
      nativeBindingConfigured: true,
      nativeBindingGeneration: 2,
      queryScope: 'a'.repeat(64),
    });
    effects = [];
    published = [];
    listeners = new Map();
    cleanup = undefined;
    effect = jest
      .spyOn(jest.requireActual('react'), 'useEffect')
      .mockImplementation((callback: any) => {
        effects.push(callback);
      });
    state = jest
      .spyOn(jest.requireActual('react'), 'useState')
      .mockImplementation((initial: any) => [
        initial,
        (value: any) => {
          if (value?.items) published.push(value);
        },
      ]);
    originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
    originalDocument = Object.getOwnPropertyDescriptor(global, 'document');
    const events = {
      addEventListener: (name: string, callback: () => void) =>
        listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: events,
    });
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: { ...events, visibilityState: 'visible' },
    });
  });
  afterEach(() => {
    cleanup?.();
    effect.mockRestore();
    state.mockRestore();
    if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
    else delete global.window;
    if (originalDocument)
      Object.defineProperty(global, 'document', originalDocument);
    else delete global.document;
  });
  const mount = async () => {
    renderToStaticMarkup(createElement(APIHistory));
    cleanup = effects[0]() as () => void;
    await flush();
  };
  const open = async () => {
    await mount();
    const action = mockHistoryTable.columns.find(
      (column: any) => column.key === 'actions',
    );
    renderToStaticMarkup(action.render(pending));
    await mockButtons
      .findLast((button: any) => button.children?.[1] === ' Details')
      .onClick();
    return mockButtons.find(
      (button: any) =>
        button.children === getApiHistoryText(mockLocale).observe,
    );
  };
  it.each([undefined, 'en'])(
    'renders original table/drawer 202 as unconfirmed, never a success or failure (%s)',
    (locale) => {
      mockLocale = locale;
      renderToStaticMarkup(createElement(APIHistory));
      const status = mockHistoryTable.columns.find(
        (column: any) => column.key === 'statusCode',
      );
      const html = renderToStaticMarkup(status.render(202));
      expect(html).toContain(getApiHistoryText(locale).unknown);
      expect(html).toContain('data-tag-color="warning"');
      expect(html).not.toContain('success');
      mockButtons = [];
      const drawer = renderToStaticMarkup(
        createElement(DetailsDrawer, {
          visible: true,
          onClose: jest.fn(),
          defaultValue: pending as any,
          onObserve: jest.fn(),
        }),
      );
      expect(drawer).toContain(getApiHistoryText(locale).unknown);
      expect(drawer).toContain(getApiHistoryText(locale).observe);
      expect(drawer).not.toContain('data-tag-color="success"');
    },
  );
  it('uses the original Details button and exact-history GraphQL consumer, without another mutation, and only displays the fresh same row', async () => {
    const button = await open();
    expect(mockHistoryOpen).toHaveBeenCalledWith(pending);
    expect(mockHistoryRead.mock.calls[0][0].variables.filter).toEqual({
      queryScope: 'a'.repeat(64),
      generation: 2,
      apiType: undefined,
      statusCode: undefined,
      threadId: undefined,
    });
    mockHistoryRead.mockResolvedValue(pageResult([completed]));
    await button.onClick();
    expect(mockHistoryRead).toHaveBeenCalledTimes(3);
    expect(mockHistoryRead).toHaveBeenLastCalledWith({
      variables: {
        filter: {
          id: pending.id,
          queryScope: 'a'.repeat(64),
          generation: 2,
        },
        pagination: { offset: 0, limit: 1 },
      },
    });
    expect(mockHistoryOpen).toHaveBeenLastCalledWith(completed);
    expect(mockConfig).toHaveBeenCalledTimes(6);
    expect(
      mockHistoryQueryOptions.every(
        (options) => options.fetchPolicy === 'no-cache',
      ),
    ).toBe(true);
  });
  it('allows the never-configured standalone original history read without inventing a governed scope', async () => {
    mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
    const button = await open();
    mockHistoryRead.mockResolvedValue(pageResult([completed]));
    await button.onClick();
    expect(mockHistoryOpen).toHaveBeenLastCalledWith(completed);
    expect(
      mockHistoryRead.mock.calls.every(
        ([request]) =>
          !('queryScope' in request.variables.filter) &&
          !('generation' in request.variables.filter),
      ),
    ).toBe(true);
  });
  it.each(['list', 'selected'])(
    'keeps an actual server refusal private when config returns A both before and after the %s request',
    async (read) => {
      if (read === 'list') {
        mockHistoryRead.mockResolvedValue({
          data: null,
          error: new Error('QUERY_REFERENCE_CHANGED'),
        });
        await mount();
        expect(published).toEqual([]);
      } else {
        const button = await open();
        mockHistoryOpen.mockClear();
        mockHistoryRead.mockResolvedValue({
          data: null,
          error: new Error('QUERY_REFERENCE_CHANGED'),
        });
        await button.onClick();
        expect(mockHistoryClose).toHaveBeenCalled();
      }
      expect(mockHistoryOpen).not.toHaveBeenCalled();
      expect(
        mockHistoryRead.mock.calls.at(-1)[0].variables.filter,
      ).toMatchObject({
        queryScope: 'a'.repeat(64),
        generation: 2,
      });
      expect(mockConfig.mock.calls.length).toBeGreaterThanOrEqual(2);
    },
  );
  it.each([
    {},
    { nativeBindingConfigured: true, queryScope: '' },
    { nativeBindingConfigured: true, queryScope: 'a'.repeat(64) },
  ])(
    'fails closed before the selected observation with invalid config %j',
    async (config) => {
      mockConfig.mockResolvedValue(config);
      await (await open()).onClick();
      expect(mockHistoryRead).not.toHaveBeenCalled();
      expect(mockHistoryOpen).not.toHaveBeenCalled();
    },
  );
  it('refuses a completed body when the current identity changes during its same-ID read', async () => {
    const button = await open();
    mockHistoryRead.mockImplementation(async () => {
      mockConfig.mockResolvedValue({
        nativeBindingConfigured: true,
        nativeBindingGeneration: 2,
        queryScope: 'b'.repeat(64),
      });
      return { data: { apiHistory: { items: [completed] } } };
    });
    await button.onClick();
    expect(mockHistoryOpen).not.toHaveBeenCalledWith(completed);
    expect(mockHistoryClose).toHaveBeenCalled();
  });
  it('Close detaches a pending original read and ignores its late completed ACK without reopening or disclosing it', async () => {
    const button = await open();
    let finish: (value: any) => void;
    mockHistoryRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const observation = button.onClick();
    await flush();
    mockHistoryDrawer.onClose();
    finish({ data: { apiHistory: { items: [completed] } } });
    await observation;
    expect(mockHistoryClose).toHaveBeenCalled();
    expect(mockHistoryOpen).toHaveBeenCalledTimes(1);
    expect(mockHistoryOpen).not.toHaveBeenCalledWith(completed);
  });
  it('a missing native event or a missing history row stays unconfirmed and does not fabricate a completed body', async () => {
    const button = await open();
    mockHistoryRead.mockResolvedValue({ data: { apiHistory: { items: [] } } });
    await button.onClick();
    expect(mockHistoryOpen).not.toHaveBeenCalledWith(completed);
    expect(mockHistoryRead).toHaveBeenCalledTimes(3);
  });
  it.each(['actor', 'generation'])(
    'does not publish a late original list body when %s changes while its no-cache page request is in flight',
    async (change) => {
      let finish: (value: any) => void;
      mockHistoryRead.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await mount();
      mockConfig.mockResolvedValue({
        nativeBindingConfigured: true,
        nativeBindingGeneration: change === 'generation' ? 3 : 2,
        queryScope: (change === 'actor' ? 'b' : 'a').repeat(64),
      });
      finish(pageResult([completed]));
      await flush();
      expect(published).toEqual([]);
      expect(mockHistoryOpen).not.toHaveBeenCalled();
    },
  );
  it('does not open an old Table record directly after the actor has changed, or issue a selected read under the old page identity', async () => {
    await mount();
    mockConfig.mockResolvedValue({
      nativeBindingConfigured: true,
      nativeBindingGeneration: 2,
      queryScope: 'b'.repeat(64),
    });
    const action = mockHistoryTable.columns.find(
      (column: any) => column.key === 'actions',
    );
    renderToStaticMarkup(action.render(completed));
    await mockButtons
      .findLast((button: any) => button.children?.[1] === ' Details')
      .onClick();
    expect(mockHistoryRead).toHaveBeenCalledTimes(1);
    expect(mockHistoryOpen).not.toHaveBeenCalled();
  });
  it.each(['focus', 'visibilitychange'])(
    'clears the original private view at %s and restores only fresh same-identity list and selected bodies',
    async (boundary) => {
      await open();
      const before = mockHistoryClose.mock.calls.length;
      mockHistoryRead.mockResolvedValue(pageResult([completed]));
      listeners.get(boundary)();
      expect(mockHistoryClose.mock.calls.length).toBeGreaterThan(before);
      await flush();
      expect(published.at(-1).items).toEqual([completed]);
      expect(mockHistoryOpen).toHaveBeenLastCalledWith(completed);
      expect(mockHistoryRead).toHaveBeenCalledTimes(4);
    },
  );
  it("does not reattach the prior actor's selected body when the original page refreshes under a new verified identity", async () => {
    await open();
    const count = mockHistoryOpen.mock.calls.length;
    const other = { ...pending, id: 'other-actor-history' };
    mockConfig.mockResolvedValue({
      nativeBindingConfigured: true,
      nativeBindingGeneration: 2,
      queryScope: 'b'.repeat(64),
    });
    mockHistoryRead.mockResolvedValue(pageResult([other]));
    listeners.get('focus')();
    await flush();
    expect(published.at(-1).items).toEqual([other]);
    expect(mockHistoryOpen).toHaveBeenCalledTimes(count);
    expect(mockHistoryRead).toHaveBeenCalledTimes(3);
  });
  it.each(['hidden', 'unmount'])(
    'rejects the original late list body after %s without publishing it',
    async (boundary) => {
      let finish: (value: any) => void;
      mockHistoryRead.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await mount();
      if (boundary === 'hidden') {
        (document as any).visibilityState = 'hidden';
        listeners.get('visibilitychange')();
      } else {
        cleanup();
        cleanup = undefined;
      }
      finish(pageResult([completed]));
      await flush();
      expect(published).toEqual([]);
      expect(mockHistoryOpen).not.toHaveBeenCalled();
    },
  );
});

describe('original independent preview selection and visibility consumers', () => {
  let hook: ReturnType<typeof useGovernedPreview>;
  let kind: 'model' | 'view';
  let id: number;
  let error: Error | undefined;
  let stateSlots: any[];
  let refSlots: any[];
  let stateIndex: number;
  let refIndex: number;
  let effects: Array<() => void | (() => void)>;
  let listeners: Map<string, () => void>;
  let cleanup: void | (() => void);
  let spies: jest.SpyInstance[];
  let originalWindow: PropertyDescriptor | undefined;
  let originalDocument: PropertyDescriptor | undefined;
  const rows = {
    columns: [{ name: 'customer' }],
    data: [['original-native-row']],
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const Consumer = () => {
      hook = useGovernedPreview(kind, id, mockPreview, undefined, error);
      return createElement('button', null, 'Original native preview');
    };
    renderToStaticMarkup(createElement(Consumer));
    return hook;
  };
  const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  };
  beforeEach(async () => {
    kind = 'model';
    id = 7;
    error = undefined;
    stateSlots = [];
    refSlots = [];
    effects = [];
    listeners = new Map();
    cleanup = undefined;
    mockConfig
      .mockReset()
      .mockResolvedValue({ nativeBindingConfigured: false });
    mockPreview.mockReset().mockResolvedValue(rows);
    originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
    originalDocument = Object.getOwnPropertyDescriptor(global, 'document');
    const events = {
      addEventListener: (name: string, listener: () => void) =>
        listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: events,
    });
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: { ...events, visibilityState: 'visible' },
    });
    const React = jest.requireActual('react');
    spies = [
      jest.spyOn(React, 'useState').mockImplementation((initial: any) => {
        const slot = stateIndex++;
        if (!(slot in stateSlots)) stateSlots[slot] = initial;
        return [
          stateSlots[slot],
          (value: any) => {
            stateSlots[slot] = value;
          },
        ];
      }),
      jest.spyOn(React, 'useRef').mockImplementation((initial: any) => {
        const slot = refIndex++;
        if (!(slot in refSlots)) refSlots[slot] = { current: initial };
        return refSlots[slot];
      }),
      jest
        .spyOn(React, 'useEffect')
        .mockImplementation((effect: () => void | (() => void)) => {
          if (!effects.length) effects.push(effect);
        }),
    ];
    render();
    cleanup = effects[0]();
    await flush();
    render();
  });
  afterEach(() => {
    if (typeof cleanup === 'function') cleanup();
    for (const spy of spies) spy.mockRestore();
    if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
    else delete (global as any).window;
    if (originalDocument)
      Object.defineProperty(global, 'document', originalDocument);
    else delete (global as any).document;
  });
  it('publishes original independent rows without claiming platform governance', async () => {
    await hook.preview();
    expect(render()).toMatchObject({
      data: rows,
      completed: true,
      governed: false,
      pending: false,
    });
    expect(hook.receipt).toBeUndefined();
    expect(mockPreview).toHaveBeenCalledWith({ id: 7 });
  });
  it.each(['kind', 'id', 'focus', 'visibility', 'unmount'])(
    'does not publish late independent rows after %s changes the active observation',
    async (change) => {
      let resolve: (value: any) => void;
      mockPreview.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const request = hook.preview();
      await flush();
      if (change === 'kind') {
        kind = 'view';
        render();
      }
      if (change === 'id') {
        id = 8;
        render();
      }
      if (change === 'focus') listeners.get('focus')();
      if (change === 'visibility') listeners.get('visibilitychange')();
      if (change === 'unmount' && typeof cleanup === 'function') cleanup();
      resolve(rows);
      await request;
      await flush();
      expect(render().data).toBeUndefined();
      expect(hook.completed).toBe(false);
      expect(mockPreview).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['kind', 'id', 'focus', 'visibility'])(
    'preserves the original native error only for its submitted selection, not after %s',
    async (change) => {
      error = new Error('Original provider refusal');
      mockPreview.mockRejectedValueOnce(error);
      await hook.preview();
      expect(render()).toMatchObject({
        error,
        governed: false,
        pending: false,
        completed: false,
      });
      if (change === 'kind') kind = 'view';
      if (change === 'id') id = 8;
      if (change === 'focus') listeners.get('focus')();
      if (change === 'visibility') listeners.get('visibilitychange')();
      await flush();
      expect(render().error).toBeUndefined();
      expect(hook.pending).toBe(false);
      expect(hook.data).toBeUndefined();
    },
  );
});

describe('original saved-view preview controls', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: jest.fn((key: string) => entries.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      entries.delete(key);
    }),
  };
  const originalStorage = Object.getOwnPropertyDescriptor(
    global,
    'sessionStorage',
  );
  const originalCrypto = Object.getOwnPropertyDescriptor(global, 'crypto');
  beforeEach(() => {
    entries.clear();
    mockButtons = [];
    mockPreviewResult = { reset: jest.fn() };
    mockFormValues = undefined;
    mockSqlWatch = undefined;
    mockLocale = undefined;
    mockScope = 'a'.repeat(64);
    mockConfig.mockReset().mockImplementation(async () => ({
      queryScope: mockScope,
      nativeBindingConfigured: true,
    }));
    mockPreview.mockReset().mockResolvedValue({
      data: { previewViewData: { submission: { gateState: 'ALLOWED' } } },
    });
    mockSqlPairRead.mockReset();
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    storage.setItem.mockClear();
    storage.getItem.mockClear();
    storage.removeItem.mockClear();
    Object.defineProperty(global, 'sessionStorage', {
      configurable: true,
      value: storage,
    });
  });
  afterAll(() => {
    if (originalCrypto) Object.defineProperty(global, 'crypto', originalCrypto);
    else delete global.crypto;
    if (originalStorage)
      Object.defineProperty(global, 'sessionStorage', originalStorage);
    else delete global.sessionStorage;
  });
  const render = () =>
    renderToStaticMarkup(
      createElement(ViewMetadata, {
        viewId: 7,
        displayName: 'saved view',
        fields: [],
        statement: 'SELECT 1',
      } as any),
    );
  const renderResponse = () => {
    const ResponsePreview = () => {
      const query = useGovernedPreview(
        'response',
        21,
        mockPreview,
        undefined,
        undefined,
      );
      mockButtons.push({ onClick: query.preview });
      return createElement('button', null, 'Original response preview');
    };
    return renderToStaticMarkup(createElement(ResponsePreview));
  };
  const renderNativeMetadata = (kind: 'model' | 'view') =>
    kind === 'view'
      ? render()
      : renderToStaticMarkup(
          createElement(ModelMetadata, {
            modelId: 7,
            referenceName: 'orders',
            displayName: 'Orders',
            fields: [
              { referenceName: 'customer', displayName: 'Customer alias' },
            ],
            calculatedFields: [],
            relationFields: [],
          } as any),
        );
  const renderSql = (
    sql = 'select original_column from original_model',
    visible = true,
  ) => {
    let query: ReturnType<typeof useGovernedSqlPreview>;
    const Editor = () => {
      query = useGovernedSqlPreview(sql, visible);
      return createElement('button', null, 'Original SQL editor');
    };
    renderToStaticMarkup(createElement(Editor));
    return query!;
  };
  const renderDashboard = (submit = mockPreview) => {
    let query: ReturnType<typeof useDashboardQuery>;
    const Consumer = () => {
      query = useDashboardQuery(21, submit);
      return createElement(
        'button',
        { onClick: () => query.preview(true) },
        'Original dashboard refresh',
      );
    };
    renderToStaticMarkup(createElement(Consumer));
    return query!;
  };
  const dashboardReceipt = (
    scope: string,
    refresh: boolean,
    status?: string,
  ) => ({
    data: [{ one: 'permitted' }],
    cacheHit: true,
    queryReceipt: {
      previewScope: scope,
      itemId: 21,
      inputReference: {
        nativeObjectRef: JSON.stringify({
          historyId: 'original-history',
          cache: { cacheEnabled: true, refresh },
        }),
      },
      submission: {
        actionKey: 'data_query.query@v1',
        gateState: 'ALLOWED',
        dispatchState: 'DISPATCHED',
      },
      ...(status ? { terminalStatus: status } : {}),
    },
  });
  it('original dashboard refresh keeps the same key and original refresh choice through UNKNOWN and transport loss', async () => {
    const query = renderDashboard();
    mockPreview.mockResolvedValue(dashboardReceipt(mockScope, true));
    await query.preview(true);
    const first = mockPreview.mock.calls[0][0];
    mockPreview.mockRejectedValueOnce(new Error('lost ACK'));
    await query.preview(false);
    await query.preview(false);
    expect(mockPreview.mock.calls.map((call) => call[0])).toEqual([
      first,
      first,
      first,
    ]);
    expect(first.refresh).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(JSON.stringify([...entries.values()])).not.toContain('permitted');
  });
  it.each(['RUNNING', 'UNKNOWN', 'NEW_STATUS'])(
    'the dashboard retains the original query key for %s evidence',
    async (status) => {
      const query = renderDashboard();
      mockPreview.mockResolvedValue(dashboardReceipt(mockScope, false, status));
      await query.preview();
      await query.preview(true);
      expect(mockPreview.mock.calls[1][0]).toEqual(
        mockPreview.mock.calls[0][0],
      );
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );
  it('original dashboard completion retires only its exact query key so an explicit later refresh is new', async () => {
    const query = renderDashboard();
    mockPreview.mockResolvedValue(
      dashboardReceipt(mockScope, true, 'COMPLETED'),
    );
    await query.preview(true);
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    await query.preview(true);
    expect(mockPreview.mock.calls[1][0].idempotencyKey).not.toBe(
      mockPreview.mock.calls[0][0].idempotencyKey,
    );
  });
  it.each(['scope', 'item', 'refresh', 'action'])(
    'a foreign dashboard %s receipt cannot retire the pending original intent',
    async (changed) => {
      const query = renderDashboard();
      const value = dashboardReceipt(mockScope, true, 'COMPLETED');
      if (changed === 'scope') value.queryReceipt.previewScope = 'b'.repeat(64);
      if (changed === 'item') value.queryReceipt.itemId = 999;
      if (changed === 'action')
        value.queryReceipt.submission.actionKey = 'data_query.dry_run@v1';
      if (changed === 'refresh')
        value.queryReceipt.inputReference.nativeObjectRef = JSON.stringify({
          historyId: 'original-history',
          cache: { cacheEnabled: true, refresh: false },
        });
      mockPreview.mockResolvedValue(value);
      await query.preview(true);
      await query.preview(false);
      expect(mockPreview.mock.calls[1][0]).toEqual(
        mockPreview.mock.calls[0][0],
      );
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );
  it('a current user change during dashboard completion keeps the original user key instead of adopting the result', async () => {
    const query = renderDashboard();
    mockPreview.mockImplementation(async () => {
      const result = dashboardReceipt(mockScope, true, 'COMPLETED');
      mockScope = 'b'.repeat(64);
      return result;
    });
    await query.preview(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('dashboard storage failure refuses submission rather than issuing an unretained refresh key', async () => {
    const query = renderDashboard();
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    await query.preview(true);
    expect(mockPreview).not.toHaveBeenCalled();
  });
  it.each(['focus', 'unmount'])(
    'the original dashboard %s fence ignores a late completion without retiring its intent',
    async (boundary) => {
      const effects: Array<() => void | (() => void)> = [];
      const effect = jest
        .spyOn(jest.requireActual('react'), 'useEffect')
        .mockImplementation((callback: any) => {
          effects.push(callback);
        });
      const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
      const originalDocument = Object.getOwnPropertyDescriptor(
        global,
        'document',
      );
      const listeners = new Map<string, () => void>();
      Object.defineProperty(global, 'window', {
        configurable: true,
        value: {
          addEventListener: (event: string, callback: () => void) =>
            listeners.set(event, callback),
          removeEventListener: (event: string) => listeners.delete(event),
        },
      });
      Object.defineProperty(global, 'document', {
        configurable: true,
        value: {
          visibilityState: 'visible',
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        },
      });
      try {
        const query = renderDashboard();
        const cleanup = effects[0]() as () => void;
        let finish: (value: any) => void;
        let entered: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        mockPreview.mockImplementationOnce(() => {
          entered();
          return new Promise((resolve) => {
            finish = resolve;
          });
        });
        const pending = query.preview(true);
        await started;
        if (boundary === 'focus') listeners.get('focus')!();
        else cleanup();
        finish!(dashboardReceipt(mockScope, true, 'COMPLETED'));
        await pending;
        expect(storage.removeItem).not.toHaveBeenCalled();
        expect(entries.size).toBe(1);
        expect(mockPreview).toHaveBeenCalledTimes(boundary === 'focus' ? 2 : 1);
        if (boundary === 'focus')
          expect(mockPreview.mock.calls[1][0]).toEqual(
            mockPreview.mock.calls[0][0],
          );
        if (boundary === 'focus') cleanup();
      } finally {
        effect.mockRestore();
        if (originalWindow)
          Object.defineProperty(global, 'window', originalWindow);
        else delete global.window;
        if (originalDocument)
          Object.defineProperty(global, 'document', originalDocument);
        else delete global.document;
      }
    },
  );
  it.each(['focus', 'visible', 'changed-user', 'revoked'])(
    'dashboard %s revalidates its original settled key without a new execution or stale chart body',
    async (boundary) => {
      const effects: Array<() => void | (() => void)> = [];
      const effect = jest
        .spyOn(jest.requireActual('react'), 'useEffect')
        .mockImplementation((callback: any) => {
          effects.push(callback);
        });
      const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
      const originalDocument = Object.getOwnPropertyDescriptor(
        global,
        'document',
      );
      const listeners = new Map<string, () => void>();
      const events = {
        addEventListener: (event: string, callback: () => void) =>
          listeners.set(event, callback),
        removeEventListener: (event: string) => listeners.delete(event),
      };
      Object.defineProperty(global, 'window', {
        configurable: true,
        value: events,
      });
      Object.defineProperty(global, 'document', {
        configurable: true,
        value: { ...events, visibilityState: 'visible' },
      });
      const values: any[] = [];
      let arrived: () => void;
      let signal = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      let stateIndex = 0;
      const state = jest
        .spyOn(jest.requireActual('react'), 'useState')
        .mockImplementation((initial: any) => {
          const index = stateIndex++;
          return [
            initial,
            (next: any) => {
              if (index === 0) {
                values.push(next);
                if (next?.result) arrived();
              }
              if (index === 3 && next === true) arrived();
              if (
                index === 1 &&
                next?.received?.submission?.gateState === 'DENIED'
              )
                arrived();
            },
          ];
        });
      try {
        const query = renderDashboard();
        const cleanup = effects[0]() as () => void;
        mockPreview.mockResolvedValue(
          dashboardReceipt(mockScope, true, 'COMPLETED'),
        );
        await query.preview(true);
        expect(values[values.length - 1]?.result.data).toEqual([
          { one: 'permitted' },
        ]);
        expect(entries.size).toBe(0);
        const first = mockPreview.mock.calls[0][0];
        signal = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        if (boundary === 'changed-user') mockScope = 'b'.repeat(64);
        if (boundary === 'revoked')
          mockPreview.mockResolvedValue({
            queryReceipt: {
              ...dashboardReceipt(mockScope, true).queryReceipt,
              submission: {
                actionKey: 'data_query.query@v1',
                gateState: 'DENIED',
                dispatchState: 'NOT_DISPATCHED',
              },
            },
          });
        listeners.get(boundary === 'visible' ? 'visibilitychange' : 'focus')!();
        expect(values[values.length - 1]).toBeUndefined();
        await Promise.resolve();
        expect(mockPreview).toHaveBeenCalledTimes(
          boundary === 'changed-user' ? 1 : 2,
        );
        await signal;
        expect(entries.size).toBe(0);
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(mockPreview).toHaveBeenCalledTimes(
          boundary === 'changed-user' ? 1 : 2,
        );
        if (boundary !== 'changed-user')
          expect(mockPreview.mock.calls[1][0]).toEqual(first);
        if (boundary === 'changed-user' || boundary === 'revoked')
          expect(values[values.length - 1]).toBeUndefined();
        else
          expect(values[values.length - 1]?.result.data).toEqual([
            { one: 'permitted' },
          ]);
        cleanup();
      } finally {
        effect.mockRestore();
        state.mockRestore();
        if (originalWindow)
          Object.defineProperty(global, 'window', originalWindow);
        else delete global.window;
        if (originalDocument)
          Object.defineProperty(global, 'document', originalDocument);
        else delete global.document;
      }
    },
  );
  const sqlReceipt = (scope: string, dryRun = false, completed = false) => ({
    previewScope: scope,
    submission: {
      actionKey: dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1',
      gateState: 'ALLOWED',
      dispatchState: 'DISPATCHED',
    },
    inputReference: {
      nativeObjectRef: JSON.stringify({
        historyId: 'native-original-history',
        modelId: 7,
        limit: 50,
      }),
    },
    ...(completed
      ? {
          terminalStatus: 'COMPLETED',
          data: dryRun ? { valid: true } : { columns: [], data: [] },
        }
      : {}),
  });
  it('passes only the exact completed dry-run identity from the original SQL-pair submit controls', async () => {
    const sql = 'select original_column from original_model';
    mockSqlWatch = sql;
    mockFormValues = { sql, question: 'Original question' };
    mockConfig.mockResolvedValue({
      queryScope: mockScope,
      nativeBindingConfigured: true,
      nativeBindingGeneration: 2,
    });
    mockPreview.mockImplementation(async ({ variables }) => ({
      data: {
        previewSql: {
          ...sqlReceipt(mockScope, true, true),
          inputReference: {
            nativeObjectRef: JSON.stringify({
              historyId: 'original-history',
              modelId: 7,
              limit: variables.data.limit,
            }),
          },
        },
      },
    }));
    const submit = jest
      .fn()
      .mockResolvedValue({ data: { createSqlPair: { id: 42 } } });
    const close = jest.fn();
    const markup = renderToStaticMarkup(
      createElement(QuestionSQLPairModal, {
        visible: true,
        formMode: FORM_MODE.CREATE,
        onSubmit: submit,
        onClose: close,
      } as any),
    );
    expect(markup).toContain('Submit');
    expect(markup).toContain('Preview data');
    await mockButtons.find((button) => button.children === 'Submit').onClick();
    expect(submit).toHaveBeenCalledWith({
      nativeWriteGuarded: true,
      data: {
        ...mockFormValues,
        idempotencyKey:
          mockPreview.mock.calls[0][0].variables.data.idempotencyKey,
        idempotencyScope: mockScope,
      },
    });
    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(mockPreview.mock.calls[0][0].variables.data).toMatchObject({
      sql,
      limit: 1,
      dryRun: true,
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...entries.entries()])).not.toContain(sql);
  });
  it.each([
    {},
    { nativeBindingConfigured: true },
    { queryScope: 'a'.repeat(64) },
    { nativeBindingConfigured: true, queryScope: '' },
  ])(
    'the original SQL editor refuses unknown or invalid configuration %p without standalone execution',
    async (config) => {
      mockConfig.mockResolvedValue(config);
      const sql = 'select original_column from original_model';
      const query = renderSql(sql);
      expect(
        await query.preview({
          variables: { data: { sql, limit: 1, dryRun: true } },
        }),
      ).toBe(false);
      expect(mockPreview).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
    },
  );
  it('withholds an original standalone result if a binding is configured while native preview is in flight', async () => {
    const sql = 'select original_column from original_model';
    mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
    const query = renderSql(sql);
    mockPreview.mockImplementation(async () => {
      mockConfig.mockResolvedValue({
        nativeBindingConfigured: true,
        queryScope: mockScope,
      });
      return { data: { previewSql: { columns: [], data: [] } } };
    });
    expect(
      await query.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(false);
    expect(query.validatedSql()).toBeUndefined();
    expect(entries.size).toBe(0);
  });
  describe('original SQL-pair mutation outcome presentation', () => {
    const setup = (
      submit = jest.fn(),
      bindingConfigured = true,
      formMode = FORM_MODE.CREATE,
    ) => {
      const sql = 'select original_column from original_model';
      mockSqlWatch = sql;
      mockFormValues = { sql, question: 'Original question' };
      mockConfig.mockResolvedValue(
        bindingConfigured
          ? {
              queryScope: mockScope,
              nativeBindingConfigured: bindingConfigured,
              nativeBindingGeneration: 2,
            }
          : { nativeBindingConfigured: false },
      );
      mockPreview.mockImplementation(async ({ variables }) => ({
        data: {
          previewSql: bindingConfigured
            ? {
                ...sqlReceipt(mockScope, true, true),
                inputReference: {
                  nativeObjectRef: JSON.stringify({
                    historyId: 'original-history',
                    limit: variables.data.limit,
                  }),
                },
              }
            : { columns: [], data: [] },
        },
      }));
      const close = jest.fn();
      const changed = jest.fn();
      const React = jest.requireActual('react');
      const original = React.useState;
      const state = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial: any) => {
          const [value, setter] = original(initial);
          return [
            value,
            (next: any) => {
              changed(next);
              setter(next);
            },
          ];
        });
      renderToStaticMarkup(
        createElement(QuestionSQLPairModal, {
          visible: true,
          formMode,
          defaultValue:
            formMode === FORM_MODE.CREATE
              ? undefined
              : { id: 42, ...mockFormValues },
          onSubmit: submit,
          onClose: close,
        } as any),
      );
      state.mockRestore();
      return {
        submit,
        close,
        changed,
        click: mockButtons.find((button) => button.children === 'Submit')
          .onClick,
      };
    };
    beforeEach(() => {
      jest.mocked(message.warning).mockClear();
    });
    it.each([FORM_MODE.CREATE, FORM_MODE.EDIT])(
      'retains original standalone %s without a fabricated scope, key or governed receipt',
      async (formMode) => {
        Object.defineProperty(global, 'crypto', {
          configurable: true,
          value: undefined,
        });
        const field =
          formMode === FORM_MODE.CREATE ? 'createSqlPair' : 'updateSqlPair';
        const actual = setup(
          jest.fn().mockResolvedValue({ data: { [field]: { id: 42 } } }),
          false,
          formMode,
        );
        await actual.click();
        expect(mockPreview).toHaveBeenCalledWith({
          variables: { data: { sql: mockSqlWatch, limit: 1, dryRun: true } },
        });
        expect(actual.submit).toHaveBeenCalledWith({
          data: mockFormValues,
          ...(formMode === FORM_MODE.CREATE ? {} : { id: 42 }),
          nativeWriteGuarded: undefined,
        });
        expect(actual.close).toHaveBeenCalledTimes(1);
        expect(entries.size).toBe(0);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(message.warning).not.toHaveBeenCalled();
      },
    );
    it('uses both original native dry-run and data preview calls in explicitly unconfigured standalone mode', async () => {
      setup(jest.fn(), false);
      await mockButtons
        .find((button) => button.children === 'Preview data')
        .onClick();
      expect(mockPreview.mock.calls.map(([input]) => input)).toEqual([
        { variables: { data: { sql: mockSqlWatch, limit: 1, dryRun: true } } },
        { variables: { data: { sql: mockSqlWatch, limit: 50 } } },
      ]);
      expect(entries.size).toBe(0);
    });
    it.each(['UNKNOWN', 'transport loss', 'missing native outcome'])(
      'keeps %s unresolved in the actual original modal and never resubmits or closes it',
      async (outcome) => {
        const error =
          outcome === 'UNKNOWN'
            ? {
                graphQLErrors: [
                  { extensions: { other: { nativeWrite: { outcome } } } },
                ],
              }
            : new Error(outcome);
        const actual = setup(jest.fn().mockRejectedValue(error));
        await actual.click();
        await actual.click();
        expect(actual.submit).toHaveBeenCalledTimes(1);
        expect(mockPreview).toHaveBeenCalledTimes(1);
        expect(actual.close).not.toHaveBeenCalled();
        expect(message.warning).toHaveBeenCalledWith(
          getNativeWriteText().unknown,
        );
        expect(actual.changed.mock.calls.flat()).not.toContainEqual(
          expect.objectContaining({ shortMessage: 'Invalid SQL syntax' }),
        );
      },
    );
    it.each(['QUERY_SCOPE_DENIED', 'QUERY_EVIDENCE_UNAVAILABLE'])(
      'preserves an actual NOT_STARTED %s refusal without relabeling it as SQL syntax',
      async (code) => {
        const actual = setup(
          jest.fn().mockRejectedValue({
            graphQLErrors: [
              {
                extensions: {
                  code,
                  shortMessage: 'Original admission refusal',
                  other: { nativeWrite: { outcome: 'NOT_STARTED' } },
                },
              },
            ],
          }),
        );
        await actual.click();
        await actual.click();
        expect(actual.submit).toHaveBeenCalledTimes(2);
        expect(actual.close).not.toHaveBeenCalled();
        expect(actual.changed).toHaveBeenCalledWith(
          expect.objectContaining({
            code,
            shortMessage: 'Original admission refusal',
          }),
        );
        expect(message.warning).not.toHaveBeenCalled();
      },
    );
    it('keeps original INVALID_SQL_ERROR syntax presentation in never-configured standalone mode', async () => {
      const actual = setup(
        jest.fn().mockRejectedValue({
          graphQLErrors: [
            {
              extensions: {
                code: 'INVALID_SQL_ERROR',
                shortMessage: 'Original invalid SQL',
              },
            },
          ],
        }),
        false,
      );
      await actual.click();
      expect(actual.changed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_SQL_ERROR',
          shortMessage: 'Invalid SQL syntax',
        }),
      );
      expect(actual.close).not.toHaveBeenCalled();
      expect(message.warning).not.toHaveBeenCalled();
    });
    it('does not dispatch two concurrent native SQL-pair writes while the original ACK is pending', async () => {
      let settle: (value?: any) => void;
      let submitted: () => void;
      const started = new Promise<void>((resolve) => {
        submitted = resolve;
      });
      const actual = setup(
        jest.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              settle = resolve;
              submitted();
            }),
        ),
      );
      const pending = actual.click();
      await started;
      await actual.click();
      expect(actual.submit).toHaveBeenCalledTimes(1);
      expect(mockPreview).toHaveBeenCalledTimes(1);
      settle!({ data: { createSqlPair: { id: 42 } } });
      await pending;
      expect(actual.close).toHaveBeenCalledTimes(1);
    });
    it('recovers the original SQL-pair write after modal reload through its recorded native reference without another dry-run or INSERT', async () => {
      const error = {
        graphQLErrors: [
          {
            extensions: {
              other: {
                nativeWrite: {
                  outcome: 'UNKNOWN',
                  scope: mockScope,
                  generation: 2,
                  reference: { nativeType: 'sqlPair', nativeId: 42 },
                },
              },
            },
          },
        ],
      };
      const submit = jest.fn().mockRejectedValue(error);
      const first = setup(submit);
      await first.click();
      expect(submit).toHaveBeenCalledTimes(1);
      mockButtons = [];
      const reloaded = setup(submit);
      mockSqlPairRead.mockResolvedValue({
        data: {
          sqlPairs: [{ id: 42, ...mockFormValues, nativeWritePending: true }],
        },
      });
      await reloaded.click();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(mockPreview).toHaveBeenCalledTimes(1);
      expect(reloaded.close).not.toHaveBeenCalled();
      mockSqlPairRead.mockResolvedValue({
        data: {
          sqlPairs: [{ id: 42, ...mockFormValues, nativeWritePending: false }],
        },
      });
      await reloaded.click();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(mockPreview).toHaveBeenCalledTimes(1);
      expect(mockSqlPairRead).toHaveBeenCalledTimes(2);
      expect(reloaded.close).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([...entries.entries()])).not.toContain(
        mockFormValues.sql,
      );
    });
    it('does not send the original native write when current identity changes after dry-run validation', async () => {
      const actual = setup(jest.fn());
      mockConfig
        .mockResolvedValueOnce({
          queryScope: mockScope,
          nativeBindingConfigured: true,
          nativeBindingGeneration: 2,
        })
        .mockResolvedValueOnce({
          queryScope: mockScope,
          nativeBindingConfigured: true,
          nativeBindingGeneration: 2,
        })
        .mockResolvedValue({
          queryScope: 'b'.repeat(64),
          nativeBindingConfigured: true,
          nativeBindingGeneration: 2,
        });
      await actual.click();
      expect(actual.submit).not.toHaveBeenCalled();
      expect(actual.close).not.toHaveBeenCalled();
      expect(message.warning).not.toHaveBeenCalled();
    });
    it.each(['CreateSqlPair', 'UpdateSqlPair'])(
      'the actual Apollo error consumer renders a guarded %s lost receipt as unknown, not failed',
      (operationName) => {
        jest.mocked(message.error).mockClear();
        errorHandler({
          operation: {
            operationName,
            getContext: () => ({ nativeWriteGuarded: true }),
          },
          networkError: new Error('lost ACK'),
        } as any);
        expect(message.warning).toHaveBeenCalledWith(
          getNativeWriteText().unresolved,
        );
        expect(message.error).not.toHaveBeenCalled();
      },
    );
  });
  it('does not expose a SQL-pair validation identity for pending, another limit, query action or reset', async () => {
    const sql = 'select original_column from original_model';
    const query = renderSql(sql);
    expect(query.validatedSql()).toBeUndefined();
    mockPreview.mockImplementation(async ({ variables }) => ({
      data: {
        previewSql: {
          ...sqlReceipt(mockScope, !!variables.data.dryRun, true),
          inputReference: {
            nativeObjectRef: JSON.stringify({
              historyId: 'original-history',
              modelId: 7,
              limit: variables.data.limit,
            }),
          },
        },
      },
    }));
    for (const data of [
      { sql, limit: 50, dryRun: true },
      { sql, limit: 1 },
    ]) {
      expect(await query.preview({ variables: { data } })).toBe(true);
      expect(query.validatedSql()).toBeUndefined();
    }
    expect(
      await query.preview({
        variables: { data: { sql, limit: 1, dryRun: true } },
      }),
    ).toBe(true);
    expect(query.validatedSql()).toEqual({
      idempotencyScope: mockScope,
      idempotencyKey:
        mockPreview.mock.calls[2][0].variables.data.idempotencyKey,
    });
    query.result.reset();
    expect(query.validatedSql()).toBeUndefined();
  });
  it('keeps one opaque SQL-editor key across UNKNOWN and transport loss, without persisting SQL', async () => {
    const sql = 'select original_column from original_model';
    mockPreviewResult = { error: new Error('native delivery result unknown') };
    const query = renderSql(sql);
    expect(query.result.error).toBeUndefined();
    mockPreview.mockResolvedValue({
      data: { previewSql: sqlReceipt(mockScope) },
    });
    expect(
      await query.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(false);
    const first = mockPreview.mock.calls[0][0].variables.data;
    mockPreview.mockRejectedValueOnce(new Error('transport result unknown'));
    expect(
      await query.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(false);
    expect(mockPreview.mock.calls[1][0].variables.data.idempotencyKey).toBe(
      first.idempotencyKey,
    );
    expect(JSON.stringify([...entries.entries()])).not.toContain(sql);
    mockPreview.mockResolvedValueOnce({
      data: { previewSql: sqlReceipt(mockScope, false, true) },
    });
    expect(
      await query.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(true);
    expect(entries.size).toBe(0);
  });
  it('separates SQL-editor query/dry-run, limits and human identities without clearing UNKNOWN', async () => {
    const sql = 'select original_column from original_model';
    const query = renderSql(sql);
    mockPreview.mockResolvedValue({
      data: { previewSql: sqlReceipt(mockScope) },
    });
    for (const data of [
      { sql, limit: 50 },
      { sql, limit: 1, dryRun: true },
      { sql, limit: 1 },
    ])
      expect(await query.preview({ variables: { data } })).toBe(false);
    mockScope = 'b'.repeat(64);
    expect(
      await query.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(false);
    expect(
      new Set(
        mockPreview.mock.calls.map(
          (call) => call[0].variables.data.idempotencyKey,
        ),
      ).size,
    ).toBe(4);
    expect(entries.size).toBe(4);
  });
  it('does not validate SQL from an incomplete COMPLETED receipt or identity changed during the mutation', async () => {
    const sql = 'select original_column from original_model';
    const query = renderSql(sql);
    mockPreview.mockResolvedValueOnce({
      data: {
        previewSql: { ...sqlReceipt(mockScope, true, true), data: undefined },
      },
    });
    expect(
      await query.preview({
        variables: { data: { sql, limit: 50, dryRun: true } },
      }),
    ).toBe(false);
    expect(entries.size).toBe(1);
    mockPreview.mockImplementationOnce(async () => {
      const receipt = sqlReceipt(mockScope, true, true);
      mockScope = 'b'.repeat(64);
      return { data: { previewSql: receipt } };
    });
    expect(
      await query.preview({
        variables: { data: { sql, limit: 50, dryRun: true } },
      }),
    ).toBe(false);
    expect(entries.size).toBe(1);
  });

  it('fences a closed or reset SQL editor without clearing its pending native intent', async () => {
    const sql = 'select original_column from original_model';
    mockPreviewResult = { reset: jest.fn() };
    const query = renderSql(sql);
    let entered: () => void;
    let finish: (value: any) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mockPreview.mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = query.preview({ variables: { data: { sql, limit: 50 } } });
    await started;
    query.result.reset();
    finish({ data: { previewSql: sqlReceipt(mockScope, false, true) } });
    expect(await pending).toBe(false);
    expect(entries.size).toBe(1);
    const closed = renderSql(sql, false);
    expect(
      await closed.preview({ variables: { data: { sql, limit: 50 } } }),
    ).toBe(false);
    expect(mockPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps the original controls and renders one selected language', () => {
    expect(render()).toContain('预览数据');
    expect(render()).not.toContain('Kailo 资源 ID');
    mockButtons = [];
    mockLocale = 'en';
    const english = render();
    expect(english).toContain('Preview data');
    expect(english).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('keeps UNKNOWN for the first person while another person gets their own retry key', async () => {
    render();
    const preview = mockButtons[0].onClick;
    await preview();
    const first = mockPreview.mock.calls[0][0].variables.where;
    mockPreview.mockRejectedValueOnce(
      new Error('403 cannot prove the old outcome'),
    );
    await preview();
    expect(mockPreview.mock.calls[1][0].variables.where.idempotencyKey).toBe(
      first.idempotencyKey,
    );
    mockScope = 'b'.repeat(64);
    await preview();
    const second = mockPreview.mock.calls[2][0].variables.where;
    expect(second.idempotencyScope).not.toBe(first.idempotencyScope);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    mockScope = 'a'.repeat(64);
    await preview();
    expect(mockPreview.mock.calls[3][0].variables.where.idempotencyKey).toBe(
      first.idempotencyKey,
    );
    expect(entries.size).toBe(2);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not send without verified configuration or durable retry-key storage', async () => {
    render();
    mockConfig.mockResolvedValueOnce({});
    await mockButtons[0].onClick();
    expect(mockPreview).not.toHaveBeenCalled();
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    await mockButtons[0].onClick();
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('original model preview isolates its intent from views and observes UNKNOWN across remount', async () => {
    const renderModel = () =>
      renderToStaticMarkup(
        createElement(ModelMetadata, {
          modelId: 7,
          referenceName: 'orders',
          displayName: 'Orders',
          fields: [],
          calculatedFields: [],
          relationFields: [],
        } as any),
      );
    expect(renderModel()).toContain('metadata__preview-data');
    await mockButtons[0].onClick();
    const first = mockPreview.mock.calls[0][0].variables.where;
    expect(first).toMatchObject({
      id: 7,
      idempotencyScope: mockScope,
      idempotencyKey: expect.any(String),
    });
    mockButtons = [];
    renderModel();
    mockPreview.mockRejectedValueOnce(new Error('UNKNOWN'));
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[1][0].variables.where).toEqual(first);
    mockButtons = [];
    render();
    await mockButtons[0].onClick();
    expect(
      mockPreview.mock.calls[2][0].variables.where.idempotencyKey,
    ).not.toBe(first.idempotencyKey);
    mockButtons = [];
    renderModel();
    mockScope = 'b'.repeat(64);
    await mockButtons[0].onClick();
    expect(
      mockPreview.mock.calls[3][0].variables.where.idempotencyKey,
    ).not.toBe(first.idempotencyKey);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('original Asking preview retains UNKNOWN across remount and separates person and native selection', async () => {
    renderResponse();
    await mockButtons[0].onClick();
    const first = mockPreview.mock.calls[0][0];
    expect(first).toMatchObject({
      id: 21,
      idempotencyScope: mockScope,
      idempotencyKey: expect.any(String),
    });
    mockButtons = [];
    renderResponse();
    mockPreview.mockRejectedValueOnce(new Error('UNKNOWN'));
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[1][0]).toEqual(first);
    mockButtons = [];
    render();
    await mockButtons[0].onClick();
    expect(
      mockPreview.mock.calls[2][0].variables.where.idempotencyKey,
    ).not.toBe(first.idempotencyKey);
    mockButtons = [];
    renderResponse();
    mockScope = 'b'.repeat(64);
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[3][0].idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    mockScope = 'a'.repeat(64);
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[4][0]).toEqual(first);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('original default Asking preview accepts only its same-response frozen native SQL history and retains UNKNOWN', async () => {
    const historyId = 'eb9081b2-1e2b-44e9-85c5-15b09e43c4a1';
    renderResponse();
    await mockButtons[0].onClick();
    const first = mockPreview.mock.calls[0][0];
    const receipt = {
      terminalStatus: 'COMPLETED',
      submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
      previewScope: mockScope,
      responseId: 21,
      nativeType: 'wren.api_history',
      nativeId: historyId,
      inputReference: {
        nativeObjectRef: JSON.stringify({ historyId, modelId: 8 }),
      },
    };
    for (const value of [
      { ...receipt, terminalStatus: 'UNKNOWN' },
      { ...receipt, responseId: 22 },
      { ...receipt, nativeId: 'another-native-row' },
      { ...receipt, nativeType: 'another-native-type' },
      { ...receipt, previewScope: 'b'.repeat(64) },
      {
        ...receipt,
        inputReference: {
          nativeObjectRef: JSON.stringify({ historyId, modelId: 8, viewId: 7 }),
        },
      },
      {
        ...receipt,
        inputReference: {
          nativeObjectRef: JSON.stringify({
            historyId: 'not-an-id',
            modelId: 8,
          }),
        },
      },
    ]) {
      mockPreview.mockResolvedValueOnce(value);
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls.at(-1)[0]).toEqual(first);
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
    mockPreview.mockResolvedValueOnce(receipt);
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls.at(-1)[0]).toEqual(first);
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'original independent Asking preview consumes raw rows without a fabricated receipt or key (becomes bound=%s)',
    async (becomesBound) => {
      const rows = { columns: [{ name: 'customer' }], data: [['original']] };
      mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
      const publish = jest.fn();
      const React = jest.requireActual('react');
      const original = React.useState;
      const state = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial: any) =>
          initial === null ? [null, publish] : original(initial),
        );
      try {
        renderResponse();
        mockPreview.mockImplementationOnce(async () => {
          if (becomesBound)
            mockConfig.mockResolvedValue({
              nativeBindingConfigured: true,
              queryScope: mockScope,
            });
          return rows;
        });
        await mockButtons[0].onClick();
        expect(mockPreview).toHaveBeenCalledWith({ id: 21 });
        if (becomesBound)
          expect(publish).not.toHaveBeenCalledWith({
            kind: 'response',
            id: 21,
            data: rows,
          });
        else
          expect(publish).toHaveBeenCalledWith({
            kind: 'response',
            id: 21,
            data: rows,
          });
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
      } finally {
        state.mockRestore();
      }
    },
  );

  it.each(['model', 'view'] as const)(
    'original independent %s Preview consumes native rows with no fabricated scope, receipt or retry key',
    async (kind) => {
      const rows = {
        columns: [{ name: 'customer' }],
        data: [['original-native-row']],
      };
      mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
      const publish = jest.fn();
      const React = jest.requireActual('react');
      const original = React.useState;
      const state = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial: any) =>
          initial === null ? [null, publish] : original(initial),
        );
      try {
        renderNativeMetadata(kind);
        mockPreview.mockResolvedValueOnce({
          data: {
            [kind === 'model' ? 'previewModelData' : 'previewViewData']: rows,
          },
        });
        await mockButtons[0].onClick();
        expect(mockPreview).toHaveBeenCalledWith({
          variables: { where: { id: 7 } },
        });
        expect(publish).toHaveBeenCalledWith({ kind, id: 7, data: rows });
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
      } finally {
        state.mockRestore();
      }
    },
  );

  it.each(['model', 'view'] as const)(
    'the original independent %s page renders native rows and original aliases, without platform success or pending',
    (kind) => {
      const rows = {
        columns: [{ name: 'customer' }],
        data: [['original-native-row']],
      };
      const React = jest.requireActual('react');
      const original = React.useState;
      let independent = false;
      const state = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial: any) => {
          if (initial === null && !independent) {
            independent = true;
            return [{ kind, id: 7, data: rows }, jest.fn()];
          }
          return original(initial);
        });
      try {
        const html = renderNativeMetadata(kind);
        expect(html).toContain('original-native-row');
        if (kind === 'model') expect(html).toContain('Customer alias');
        const text = getQueryPreviewText(undefined);
        expect(html).not.toContain(text.pending);
        expect(html).not.toContain(text.ended);
        expect(html).not.toContain(text.denied);
        expect(mockButtons[0].children).toBe(text.preview);
      } finally {
        state.mockRestore();
      }
    },
  );

  it.each(['model', 'view'] as const)(
    'withholds late original independent %s rows if the configuration becomes bound, without another SQL request',
    async (kind) => {
      const rows = {
        columns: [{ name: 'customer' }],
        data: [['original-native-row']],
      };
      mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
      const publish = jest.fn();
      const React = jest.requireActual('react');
      const original = React.useState;
      const state = jest
        .spyOn(React, 'useState')
        .mockImplementation((initial: any) =>
          initial === null ? [null, publish] : original(initial),
        );
      try {
        renderNativeMetadata(kind);
        mockPreview.mockImplementationOnce(async () => {
          mockConfig.mockResolvedValue({
            nativeBindingConfigured: true,
            queryScope: mockScope,
          });
          return {
            data: {
              [kind === 'model' ? 'previewModelData' : 'previewViewData']: rows,
            },
          };
        });
        await mockButtons[0].onClick();
        expect(mockPreview).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalledWith({ kind, id: 7, data: rows });
        expect(storage.setItem).not.toHaveBeenCalled();
      } finally {
        state.mockRestore();
      }
    },
  );

  it.each(['model', 'view'] as const)(
    'refuses every ambiguous configured state in the original %s Preview rather than calling independent SQL',
    async (kind) => {
      renderNativeMetadata(kind);
      for (const config of [
        {},
        { nativeBindingConfigured: '' },
        { nativeBindingConfigured: 'wrong' },
        { nativeBindingConfigured: true },
        { nativeBindingConfigured: true, queryScope: '' },
        { nativeBindingConfigured: true, queryScope: 'invalid' },
      ]) {
        mockConfig.mockResolvedValue(config);
        await mockButtons[0].onClick();
      }
      expect(mockPreview).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it.each(['model', 'view'] as const)(
    'does not render an independent result from another native %s selection or kind',
    (kind) => {
      const rows = { columns: [], data: [['another-private-row']] };
      const React = jest.requireActual('react');
      const original = React.useState;
      for (const selection of [
        { kind, id: 8 },
        { kind: kind === 'model' ? 'view' : 'model', id: 7 },
      ]) {
        let independent = false;
        const state = jest
          .spyOn(React, 'useState')
          .mockImplementation((initial: any) => {
            if (initial === null && !independent) {
              independent = true;
              return [{ ...selection, data: rows }, jest.fn()];
            }
            return original(initial);
          });
        try {
          expect(renderNativeMetadata(kind)).not.toContain(
            'another-private-row',
          );
        } finally {
          state.mockRestore();
        }
      }
    },
  );

  it.each(['model', 'view'] as const)(
    'preserves the original independent %s error presentation instead of fabricating an UNKNOWN AE',
    (kind) => {
      mockPreviewResult = { error: new Error('Original native query refused') };
      const html = renderNativeMetadata(kind);
      const text = getQueryPreviewText(undefined);
      expect(html).not.toContain(text.pending);
      expect(html).not.toContain(text.ended);
      expect(mockButtons[0].children).toBe(text.preview);
    },
  );

  it.each([undefined, '', 'wrong'])(
    'original Asking never falls back to independent preview for ambiguous configured state %j',
    async (configured) => {
      mockConfig.mockResolvedValue({
        nativeBindingConfigured: configured,
        queryScope: mockScope,
      });
      renderResponse();
      await mockButtons[0].onClick();
      expect(mockPreview).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it.each(['wrong-response', 'wrong-native', 'wrong-scope', 'malformed'])(
    'keeps the original Asking retry key for a %s terminal receipt',
    async (failure) => {
      renderResponse();
      await mockButtons[0].onClick();
      const first = mockPreview.mock.calls[0][0];
      const receipt = {
        terminalStatus: 'COMPLETED',
        submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
        previewScope: mockScope,
        responseId: 21,
        viewId: 7,
        inputReference: { nativeObjectRef: JSON.stringify({ viewId: 7 }) },
      };
      const changed = {
        ...receipt,
        inputReference: { ...receipt.inputReference },
      };
      if (failure === 'wrong-response') changed.responseId = 22;
      if (failure === 'wrong-native')
        changed.inputReference.nativeObjectRef = JSON.stringify({ modelId: 7 });
      if (failure === 'wrong-scope') changed.previewScope = 'b'.repeat(64);
      if (failure === 'malformed')
        changed.inputReference.nativeObjectRef = 'invalid';
      mockPreview.mockResolvedValueOnce(changed);
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[1][0]).toEqual(first);
      expect(storage.removeItem).not.toHaveBeenCalled();
      mockPreview.mockResolvedValueOnce(receipt);
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[2][0]).toEqual(first);
      expect(storage.removeItem).toHaveBeenCalledTimes(1);
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[3][0].idempotencyKey).not.toBe(
        first.idempotencyKey,
      );
    },
  );

  const observed = (terminalStatus: unknown, kind = 'view') => ({
    terminalStatus,
    submission: { gateState: 'ALLOWED', dispatchState: 'DISPATCHED' },
    previewScope: mockScope,
    responseId: 21,
    viewId: 7,
    inputReference: {
      nativeObjectRef: JSON.stringify({
        [kind === 'model' ? 'modelId' : 'viewId']: 7,
      }),
    },
    data: { columns: [{ name: 'private' }], data: [['native-private-rows']] },
  });

  it.each(['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'])(
    'closes the original retry key only for the known %s task terminal',
    async (status) => {
      renderResponse();
      await mockButtons[0].onClick();
      const first = mockPreview.mock.calls[0][0];
      mockPreview.mockResolvedValueOnce(observed(status));
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[1][0]).toEqual(first);
      expect(storage.removeItem).toHaveBeenCalledTimes(1);
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[2][0].idempotencyKey).not.toBe(
        first.idempotencyKey,
      );
    },
  );

  it.each(['RUNNING', 'UNKNOWN', 'NEW_TERMINAL', null, 7])(
    'keeps the original retry key for a %j receipt without claiming a business terminal',
    async (status) => {
      renderResponse();
      await mockButtons[0].onClick();
      const first = mockPreview.mock.calls[0][0];
      mockPreview.mockResolvedValueOnce(observed(status));
      await mockButtons[0].onClick();
      expect(storage.removeItem).not.toHaveBeenCalled();
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[2][0]).toEqual(first);
    },
  );

  it.each(['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'])(
    'keeps the original retry key when %s still has UNKNOWN external dispatch',
    async (status) => {
      renderResponse();
      await mockButtons[0].onClick();
      const first = mockPreview.mock.calls[0][0];
      const receipt = observed(status);
      receipt.submission.dispatchState = 'UNKNOWN';
      mockPreview.mockResolvedValueOnce(receipt);
      await mockButtons[0].onClick();
      expect(storage.removeItem).not.toHaveBeenCalled();
      await mockButtons[0].onClick();
      expect(mockPreview.mock.calls[2][0]).toEqual(first);
    },
  );

  it.each(['view', 'model'])(
    'the original %s page renders closed task states, not truthy status strings or stale rows',
    (kind) => {
      const react = jest.requireActual('react');
      const originalUseState = react.useState;
      const originalUseRef = react.useRef;
      const state = jest
        .spyOn(react, 'useState')
        .mockImplementation((initial: any) =>
          initial === undefined
            ? [mockScope, jest.fn()]
            : originalUseState(initial),
        );
      const submitted = jest
        .spyOn(react, 'useRef')
        .mockImplementation((initial: any) =>
          initial === undefined
            ? {
                current: {
                  scope: mockScope,
                  revision: 0,
                  selection: { kind, id: 7 },
                },
              }
            : originalUseRef(initial),
        );
      try {
        for (const status of [
          'RUNNING',
          'UNKNOWN',
          'TERMINATED',
          'TIMED_OUT',
          'FAILED',
          'COMPLETED',
          'FAILED_OBSERVATION',
          'UNKNOWN_DISPATCH',
        ]) {
          const failedObservation = status === 'FAILED_OBSERVATION';
          const receipt = observed(
            failedObservation
              ? 'COMPLETED'
              : status === 'UNKNOWN_DISPATCH'
                ? 'FAILED'
                : status,
            kind,
          );
          if (status === 'UNKNOWN_DISPATCH')
            receipt.submission.dispatchState = 'UNKNOWN';
          mockPreviewResult = {
            data: {
              [kind === 'view' ? 'previewViewData' : 'previewModelData']:
                receipt,
            },
            error: failedObservation
              ? new Error('Observation unavailable')
              : undefined,
          };
          const html =
            kind === 'view'
              ? render()
              : renderToStaticMarkup(
                  createElement(ModelMetadata, {
                    modelId: 7,
                    fields: [],
                    calculatedFields: [],
                    relationFields: [],
                  } as any),
                );
          const text = getQueryPreviewText(undefined);
          if (
            status === 'RUNNING' ||
            status === 'UNKNOWN' ||
            status === 'UNKNOWN_DISPATCH' ||
            failedObservation
          ) {
            expect(html).toContain(text.pending);
            expect(html).not.toContain(text.ended);
          } else if (status !== 'COMPLETED') {
            expect(html).toContain(text.ended);
            expect(html).not.toContain(text.pending);
          }
          if (status === 'COMPLETED')
            expect(html).toContain('native-private-rows');
          else expect(html).not.toContain('native-private-rows');
        }
      } finally {
        submitted.mockRestore();
        state.mockRestore();
      }
    },
  );

  it('consumes exactly the existing task-status semantics without adding a native status authority', () => {
    for (const status of [
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELED',
      'TERMINATED',
      'TIMED_OUT',
    ]) {
      expect(queryReceiptState(observed(status))).toMatchObject({
        valid: true,
        terminal: status !== 'RUNNING',
        completed: status === 'COMPLETED',
        ended: status !== 'RUNNING' && status !== 'COMPLETED',
        pending: status === 'RUNNING',
      });
    }
    for (const status of ['UNKNOWN', null, 7]) {
      expect(queryReceiptState(observed(status))).toMatchObject({
        valid: false,
        terminal: false,
        completed: false,
        ended: false,
        pending: true,
      });
    }
  });
});

describe('original native metadata create UNKNOWN and authorized read-back consumers', () => {
  const scope = 'a'.repeat(64);
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
  const originalStorage = Object.getOwnPropertyDescriptor(
    global,
    'sessionStorage',
  );
  const originalCrypto = Object.getOwnPropertyDescriptor(global, 'crypto');
  const evidence = (nativeType = 'view', nativeId?: number) => ({
    graphQLErrors: [
      {
        extensions: {
          other: {
            nativeWrite: {
              outcome: 'UNKNOWN',
              scope,
              generation: 2,
              ...(nativeId ? { reference: { nativeType, nativeId } } : {}),
            },
          },
        },
      },
    ],
  });
  beforeEach(() => {
    entries.clear();
    mockButtons = [];
    mockConfig.mockReset().mockResolvedValue({
      nativeBindingConfigured: true,
      nativeBindingGeneration: 2,
      queryScope: scope,
    });
    jest.mocked(message.error).mockClear();
    jest.mocked(message.warning).mockClear();
    Object.defineProperty(global, 'sessionStorage', {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });
  afterAll(() => {
    if (originalStorage)
      Object.defineProperty(global, 'sessionStorage', originalStorage);
    else delete global.sessionStorage;
    if (originalCrypto) Object.defineProperty(global, 'crypto', originalCrypto);
    else delete global.crypto;
  });
  it('refuses an original standalone write if a binding appears while its actual beforeSubmit consumer is pending', async () => {
    mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
    const submit = jest.fn().mockResolvedValue({
      data: { createSqlPair: { id: 42 } },
    });
    const observe = jest.fn();
    await expect(
      runNativeMetadataWrite({
        nativeType: 'sqlPair',
        mutationField: 'createSqlPair',
        variables: { data: { question: 'Original question', sql: 'SELECT 1' } },
        beforeSubmit: async () => {
          mockConfig.mockResolvedValue({
            nativeBindingConfigured: true,
            nativeBindingGeneration: 2,
            queryScope: scope,
          });
        },
        submit,
        observe,
      }),
    ).rejects.toThrow(getNativeWriteText().scopeError);
    expect(submit).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });
  it.each(['model', 'view', 'dashboardItem'] as const)(
    'the original %s create re-entry reads its actual native ID and never resubmits the write',
    async (nativeType) => {
      const submit = jest.fn().mockRejectedValue(evidence(nativeType, 7));
      const observe = jest.fn().mockResolvedValue({ id: 7, name: 'original' });
      const run = () =>
        runNativeMetadataWrite({
          nativeType,
          variables: { data: { name: 'private input' } },
          submit,
          observe,
        });
      await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      expect(observe).not.toHaveBeenCalled();
      expect(JSON.stringify([...entries])).not.toContain('private input');
      expect(await run()).toEqual({ id: 7, name: 'original' });
      expect(submit).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(7);
      expect(entries.size).toBe(0);
    },
  );
  it.each(['model', 'view', 'dashboardItem'] as const)(
    'a lost %s ACK without a native reference stays UNKNOWN across re-entry, not not-found or a new write',
    async (nativeType) => {
      const submit = jest
        .fn()
        .mockRejectedValue(new Error('connection closed'));
      const observe = jest.fn();
      const run = () =>
        runNativeMetadataWrite({
          nativeType,
          variables: { data: { responseId: 21 } },
          submit,
          observe,
        });
      await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      expect(submit).toHaveBeenCalledTimes(1);
      expect(observe).not.toHaveBeenCalled();
      expect(entries.size).toBe(1);
      expect(message.error).not.toHaveBeenCalled();
    },
  );
  it('an absent or denied original row remains UNKNOWN until a real authorized read returns the exact row', async () => {
    const submit = jest.fn().mockRejectedValue(evidence('view', 7));
    const observe = jest
      .fn()
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 7 });
    const run = () =>
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { name: 'native' } },
        submit,
        observe,
      });
    for (let attempt = 0; attempt < 3; attempt++)
      await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    expect(await run()).toEqual({ id: 7 });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('retains the old identity intent and refuses to disclose its native result after identity changes', async () => {
    const submit = jest
      .fn()
      .mockResolvedValue({ data: { createView: { id: 7 } } });
    const observe = jest.fn().mockResolvedValue({ id: 7 });
    mockConfig
      .mockResolvedValueOnce({
        nativeBindingConfigured: true,
        nativeBindingGeneration: 2,
        queryScope: scope,
      })
      .mockResolvedValueOnce({
        nativeBindingConfigured: true,
        nativeBindingGeneration: 2,
        queryScope: scope,
      })
      .mockResolvedValueOnce({
        nativeBindingConfigured: true,
        nativeBindingGeneration: 2,
        queryScope: 'b'.repeat(64),
      });
    const run = () =>
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { name: 'native' } },
        submit,
        observe,
      });
    await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    expect(await run()).toEqual({ id: 7 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(7);
  });
  it('a changed trusted binding generation cannot reuse an old native write or authorize a new one', async () => {
    const submit = jest.fn().mockRejectedValue(evidence('view', 7));
    const observe = jest.fn().mockResolvedValue({ id: 7 });
    const run = () =>
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { name: 'native' } },
        submit,
        observe,
      });
    await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    mockConfig.mockResolvedValue({
      nativeBindingConfigured: true,
      nativeBindingGeneration: 3,
      queryScope: scope,
    });
    await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
    expect(entries.size).toBe(1);
  });
  it.each([
    {},
    { nativeBindingConfigured: true },
    { nativeBindingConfigured: true, queryScope: '' },
    { nativeBindingConfigured: true, queryScope: scope },
  ])(
    'missing or invalid configured identity %p refuses before a native call, never standalone fallback',
    async (config) => {
      mockConfig.mockResolvedValue(config);
      const submit = jest.fn();
      await expect(
        runNativeMetadataWrite({
          nativeType: 'view',
          variables: {},
          submit,
          observe: jest.fn(),
        }),
      ).rejects.toThrow(getNativeWriteText().scopeError);
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it('unavailable original intent storage refuses before a native write', async () => {
    Object.defineProperty(global, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error();
      },
    });
    const submit = jest.fn();
    await expect(
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: {},
        submit,
        observe: jest.fn(),
      }),
    ).rejects.toThrow(getNativeWriteText().storageError);
    expect(submit).not.toHaveBeenCalled();
  });
  it('an HTTP insecure-context browser without Web Crypto refuses before any native call or input persistence', async () => {
    Object.defineProperty(global, 'crypto', { configurable: true, value: {} });
    const submit = jest.fn();
    await expect(
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { sql: 'private SQL' } },
        submit,
        observe: jest.fn(),
      }),
    ).rejects.toThrow(getNativeWriteText().storageError);
    expect(submit).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });
  it('only an explicit server refusal before entering native CRUD permits a later original submission', async () => {
    const denied = {
      graphQLErrors: [
        {
          message: 'QUERY_SCOPE_DENIED',
          extensions: { other: { nativeWrite: { outcome: 'NOT_STARTED' } } },
        },
      ],
    };
    const submit = jest
      .fn()
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce({ data: { createView: { id: 7 } } });
    const run = () =>
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { name: 'native' } },
        submit,
        observe: jest.fn(),
      });
    await expect(run()).rejects.toBe(denied);
    expect(entries.size).toBe(0);
    expect(await run()).toEqual({ id: 7 });
    expect(submit).toHaveBeenCalledTimes(2);
  });
  it('a GraphQL error without pre-dispatch evidence cannot prove that native creation never started', async () => {
    const submit = jest.fn().mockRejectedValue({
      graphQLErrors: [{ message: 'Serialization error after native write' }],
    });
    const observe = jest.fn();
    const run = () =>
      runNativeMetadataWrite({
        nativeType: 'view',
        variables: { data: { name: 'native' } },
        submit,
        observe,
      });
    await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    await expect(run()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
  });
  it('the original global Apollo consumer renders UNKNOWN as a warning, never its generic failed or retry-network message', () => {
    for (const error of [
      evidence(),
      { networkError: new Error('closed') },
      {
        graphQLErrors: [{ message: 'Serialization error after native write' }],
      },
    ])
      errorHandler({
        ...error,
        operation: {
          operationName: 'CreateView',
          getContext: () => ({ nativeWriteGuarded: true }),
        },
      } as any);
    expect(message.warning).toHaveBeenCalledWith(getNativeWriteText().unknown);
    expect(message.error).not.toHaveBeenCalled();
    expect(getNativeWriteText('en').unknown).toContain('unconfirmed');
    expect(getNativeWriteText().unknown).toContain('结果尚未核验');
  });
  it('an original never-configured standalone create retains the original failure presentation', () => {
    errorHandler({
      graphQLErrors: [{ message: 'native validation error' }],
      operation: { operationName: 'CreateView', getContext: () => ({}) },
    } as any);
    expect(message.error).toHaveBeenCalledWith('Failed to create view.');
    expect(message.warning).not.toHaveBeenCalled();
  });
  it.each(['view', 'model'] as const)(
    'the original %s modal cannot close on swallowed UNKNOWN and only closes after its original read-back succeeds',
    async (nativeType) => {
      const submit = jest.fn().mockRejectedValue(evidence(nativeType, 7));
      const observe = jest.fn().mockResolvedValue({ id: 7 });
      const close = jest.fn();
      let pending: Promise<any>;
      const props: any = {
        visible: true,
        formMode: FORM_MODE.CREATE,
        defaultValue: { sql: 'SELECT 1', responseId: 21 },
        payload: {},
        onClose: close,
        onSubmit: (variables: any) =>
          (pending = runNativeMetadataWrite({
            nativeType,
            variables,
            submit,
            observe,
          })),
      };
      const logged = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        renderToStaticMarkup(
          nativeType === 'view'
            ? createElement(SaveAsViewModal, props)
            : createElement(ModelDrawer, props),
        );
        const save = mockButtons.find(
          (button) =>
            button.children === (nativeType === 'view' ? 'Save' : 'Submit'),
        );
        save.onClick();
        await Promise.resolve();
        await expect(pending!).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
        await Promise.resolve();
        expect(close).not.toHaveBeenCalled();
        save.onClick();
        await Promise.resolve();
        await pending!;
        await Promise.resolve();
        expect(close).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(observe).toHaveBeenCalledWith(7);
      } finally {
        logged.mockRestore();
      }
    },
  );
  describe('original Home Save as View governed column query', () => {
    const sql = 'SELECT customer FROM original_model';
    const historyId = '3b41671e-d794-46fa-a8c1-b287fe3ebdbb';
    let pending: Promise<any>;
    let prepare: jest.SpyInstance;
    let action: jest.SpyInstance;
    let close: jest.Mock;
    const completed = () => ({
      data: {
        previewSql: {
          previewScope: scope,
          terminalStatus: 'COMPLETED',
          submission: {
            actionKey: 'data_query.query@v1',
            gateState: 'ALLOWED',
            dispatchState: 'DISPATCHED',
          },
          inputReference: {
            nativeObjectRef: JSON.stringify({ historyId, limit: 1 }),
          },
          data: {
            columns: [{ name: 'customer', type: 'STRING' }],
            data: [['original']],
          },
        },
      },
    });
    const click = async () => {
      const save = mockButtons.find((button) => button.children === 'Save');
      save.onClick();
      await Promise.resolve();
      return pending;
    };
    beforeEach(() => {
      close = jest.fn();
      mockFormValues = { name: 'OriginalView' };
      mockPreviewResult = { reset: jest.fn() };
      mockPreview.mockReset().mockResolvedValue(completed());
      mockCreateView
        .mockReset()
        .mockResolvedValue({ data: { createView: { id: 99 } } });
      mockViewRead
        .mockReset()
        .mockResolvedValue({ data: { listViews: [{ id: 99 }] } });
      jest.mocked(message.success).mockClear();
      action = jest
        .spyOn(jest.requireActual('./hooks/useModalAction'), 'default')
        .mockReturnValue({
          state: {
            visible: true,
            defaultValue: { sql, responseId: 21 },
            payload: { rephrasedQuestion: 'Original question' },
          },
          openModal: jest.fn(),
          closeModal: close,
        });
      const original = jest.requireActual(
        './utils/errorHandler',
      ).runNativeMetadataWrite;
      prepare = jest
        .spyOn(
          jest.requireActual('./utils/errorHandler'),
          'runNativeMetadataWrite',
        )
        .mockImplementation((input: any) => {
          pending = original(input);
          return pending;
        });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      renderToStaticMarkup(createElement(HomeThread));
    });
    afterEach(() => {
      prepare.mockRestore();
      action.mockRestore();
      jest.mocked(console.error).mockRestore();
    });
    it('the actual Home Save button passes only the completed same-query history to native createView', async () => {
      await click();
      expect(mockPreview).toHaveBeenCalledTimes(1);
      expect(mockPreview.mock.calls[0][0].variables.data).toMatchObject({
        sql,
        limit: 1,
        idempotencyScope: scope,
      });
      expect(mockCreateView).toHaveBeenCalledWith({
        variables: {
          data: {
            name: 'OriginalView',
            responseId: 21,
            rephrasedQuestion: 'Original question',
            queryHistoryId: historyId,
          },
        },
        context: { nativeWriteGuarded: true },
      });
      await Promise.resolve();
      expect(close).toHaveBeenCalledTimes(1);
      expect(message.success).toHaveBeenCalledWith(
        'Successfully created view.',
      );
    });
    it('UNKNOWN leaves the original modal open and a later check retains the same query key before any native INSERT', async () => {
      const pendingReceipt = completed();
      delete pendingReceipt.data.previewSql.terminalStatus;
      mockPreview.mockResolvedValueOnce(pendingReceipt);
      await expect(click()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(mockCreateView).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(message.warning).toHaveBeenCalledWith(
        getQueryPreviewText().unknown,
      );
      expect(message.error).not.toHaveBeenCalled();
      await click();
      expect(mockPreview.mock.calls[1][0]).toEqual(
        mockPreview.mock.calls[0][0],
      );
      expect(mockCreateView).toHaveBeenCalledTimes(1);
    });
    it('a native create ACK with an original reference is reconciled by readonly view lookup, without a second preview or INSERT', async () => {
      mockCreateView.mockRejectedValueOnce(evidence('view', 99));
      await expect(click()).rejects.toThrow('NATIVE_EXECUTION_UNKNOWN');
      expect(close).not.toHaveBeenCalled();
      await click();
      expect(mockPreview).toHaveBeenCalledTimes(1);
      expect(mockCreateView).toHaveBeenCalledTimes(1);
      expect(mockViewRead).toHaveBeenCalledWith(
        expect.objectContaining({ fetchPolicy: 'no-cache' }),
      );
      expect(close).toHaveBeenCalledTimes(1);
    });
    it('keeps never-configured native Save as View unchanged, without an extra browser SQL query or fake history', async () => {
      mockConfig.mockResolvedValue({ nativeBindingConfigured: false });
      await click();
      expect(mockPreview).not.toHaveBeenCalled();
      expect(mockCreateView).toHaveBeenCalledWith({
        variables: {
          data: {
            name: 'OriginalView',
            responseId: 21,
            rephrasedQuestion: 'Original question',
          },
        },
      });
      expect(entries.size).toBe(0);
    });
    it('does not create or close when the HUMAN identity changes while the original column query completes', async () => {
      mockPreview.mockImplementationOnce(async () => {
        mockConfig.mockResolvedValue({
          nativeBindingConfigured: true,
          nativeBindingGeneration: 2,
          queryScope: 'b'.repeat(64),
        });
        return completed();
      });
      await expect(click()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(mockCreateView).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });
  });
});
