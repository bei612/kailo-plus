import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewMetadata from './components/pages/modeling/metadata/ViewMetadata';
import ModelMetadata from './components/pages/modeling/metadata/ModelMetadata';

let mockLocale: string | undefined;
let mockScope: string;
let mockButtons: any[];
const mockPreview = jest.fn();
const mockConfig = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ locale: mockLocale }) }));
jest.mock('./utils/env', () => ({ getUserConfig: () => mockConfig() }));
jest.mock('./apollo/client/graphql/view.generated', () => ({
  usePreviewViewDataMutation: () => [mockPreview, {}],
}));
jest.mock('./apollo/client/graphql/model.generated', () => ({
  usePreviewModelDataMutation: () => [mockPreview, {}],
}));
jest.mock('antd', () => {
  const React = require('react');
  const field = ({ children }: any) =>
    React.createElement('div', null, children);
  const Input: any = () => null;
  Input.TextArea = () => null;
  return {
    Alert: field,
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
jest.mock('./components/dataPreview/PreviewData', () => () => null);
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
    mockLocale = undefined;
    mockScope = 'a'.repeat(64);
    mockConfig
      .mockReset()
      .mockImplementation(async () => ({ queryScope: mockScope }));
    mockPreview
      .mockReset()
      .mockResolvedValue({
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

  it('keeps the original controls and renders one selected language', () => {
    expect(render()).toContain('预览数据');
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
    const renderModel = () => renderToStaticMarkup(createElement(ModelMetadata, {
      modelId: 7, referenceName: 'orders', displayName: 'Orders', fields: [],
      calculatedFields: [], relationFields: [],
    } as any));
    expect(renderModel()).toContain('metadata__preview-data');
    await mockButtons[0].onClick();
    const first = mockPreview.mock.calls[0][0].variables.where;
    expect(first).toMatchObject({ id: 7, idempotencyScope: mockScope, idempotencyKey: expect.any(String) });
    mockButtons = [];
    renderModel();
    mockPreview.mockRejectedValueOnce(new Error('UNKNOWN'));
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[1][0].variables.where).toEqual(first);
    mockButtons = [];
    render();
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[2][0].variables.where.idempotencyKey).not.toBe(first.idempotencyKey);
    mockButtons = [];
    renderModel();
    mockScope = 'b'.repeat(64);
    await mockButtons[0].onClick();
    expect(mockPreview.mock.calls[3][0].variables.where.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
