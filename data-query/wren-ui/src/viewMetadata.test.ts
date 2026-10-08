import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewMetadata from './components/pages/modeling/metadata/ViewMetadata';
import ModelMetadata from './components/pages/modeling/metadata/ModelMetadata';
import useGovernedPreview from './hooks/useGovernedPreview';
import useGovernedSqlPreview from './hooks/useGovernedSqlPreview';
import { queryReceiptState } from './utils/queryReceipt';
import { getQueryPreviewText } from './utils/language';

let mockLocale: string | undefined;
let mockScope: string;
let mockButtons: any[];
let mockPreviewResult: any;
const mockPreview = jest.fn();
const mockConfig = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ locale: mockLocale }) }));
jest.mock('./utils/env', () => ({ getUserConfig: () => mockConfig() }));
jest.mock('./apollo/client/graphql/view.generated', () => ({
  usePreviewViewDataMutation: () => [mockPreview, mockPreviewResult],
}));
jest.mock('./apollo/client/graphql/model.generated', () => ({
  usePreviewModelDataMutation: () => [mockPreview, mockPreviewResult],
}));
jest.mock('./apollo/client/graphql/sql.generated', () => ({
  usePreviewSqlMutation: () => [mockPreview, mockPreviewResult],
}));
jest.mock('antd', () => {
  const React = require('react');
  const field = ({ children }: any) =>
    React.createElement('div', null, children);
  const Input: any = (props: any) =>
    React.createElement('input', { 'aria-label': props['aria-label'] });
  Input.TextArea = () => null;
  return {
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
    Typography: { Text: field, Paragraph: field },
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
    require('react').createElement(
      'div',
      { 'data-native-preview': true },
      props.previewData ? JSON.stringify(props.previewData) : null,
    ),
);
jest.mock('./components/table/FieldTable', () => () => null);
jest.mock('./components/table/CalculatedFieldTable', () => () => null);
jest.mock('./components/table/RelationTable', () => () => null);
jest.mock('./components/table/BaseTable', () => ({ COLUMN: {} }));

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
  beforeEach(() => {
    entries.clear();
    mockButtons = [];
    mockPreviewResult = {};
    mockLocale = undefined;
    mockScope = 'a'.repeat(64);
    mockConfig
      .mockReset()
      .mockImplementation(async () => ({ queryScope: mockScope }));
    mockPreview.mockReset().mockResolvedValue({
      data: { previewViewData: { submission: { gateState: 'ALLOWED' } } },
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
      const react = require('react');
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
            ? { current: mockScope }
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
