import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModelTree from './components/sidebar/modeling/ModelTree';

let mockResult: any;
let mockOptions: any;
let mockModal: any;
let mockActions: any[];
const mockDetect = jest.fn();
jest.mock('./utils/nodeType', () => ({ getNodeTypeIcon: () => null }));
jest.mock('./apollo/client/graphql/dataSource.generated', () => ({
  useSchemaChangeQuery: (options: any) => {
    mockOptions = options;
    return mockResult;
  },
  useResolveSchemaChangeMutation: () => [jest.fn(), {}],
  useTriggerDataSourceDetectionMutation: () => [mockDetect, {}],
}));
jest.mock('./hooks/useModalAction', () => () => ({
  state: { visible: true },
  openModal: jest.fn(),
  closeModal: jest.fn(),
}));
jest.mock('./components/sidebar/Modeling', () => ({
  StyledSidebarTree: (props: any) =>
    jest.requireActual('react').createElement(
      'aside',
      null,
      props.treeData.map((node: any) => node.title),
    ),
}));
jest.mock('./components/sidebar/utils', () => ({
  createTreeGroupNode: (options: any) => {
    mockActions = options.actions;
    return () => [{ key: 'models', title: 'Models' }];
  },
  getColumnNode: () => [],
  GroupActionButton: 'button',
}));
jest.mock('./components/modals/SchemaChangeModal', () => (props: any) => {
  mockModal = props;
  return props.visible
    ? jest
        .requireActual('react')
        .createElement('div', null, JSON.stringify(props.defaultValue))
    : null;
});
jest.mock(
  './components/ErrorCollapse',
  () => (props: any) =>
    jest
      .requireActual('react')
      .createElement('div', { role: 'alert' }, props.message),
);

describe('original modeling sidebar schema-change consumer', () => {
  beforeEach(() => {
    mockDetect.mockReset();
    mockResult = {
      data: {
        schemaChange: { deletedColumns: [{ displayName: 'private-model' }] },
      },
      refetch: jest.fn(),
    };
  });
  it('renders the original schema-change dialog from a fresh read', () => {
    const html = renderToStaticMarkup(
      createElement(ModelTree, { models: [], onOpenModelDrawer: jest.fn() }),
    );
    expect(html).toContain('private-model');
    expect(mockOptions.fetchPolicy).toBe('no-cache');
    expect(mockModal.visible).toBe(true);
  });
  it('renders the original error component and hides stale modal data without unmounting native actions', () => {
    mockResult.error = new Error('permission revoked');
    const create = jest.fn();
    const html = renderToStaticMarkup(
      createElement(ModelTree, { models: [], onOpenModelDrawer: create }),
    );
    expect(html).toContain('permission revoked');
    expect(html).toContain('Models');
    expect(html).not.toContain('private-model');
    expect(mockModal.defaultValue).toBeUndefined();
    expect(mockModal.visible).toBe(false);
    mockActions
      .find((action) => action.key === 'add-model')
      .render()
      .props.onClick();
    expect(create).toHaveBeenCalledTimes(1);
    mockActions
      .find((action) => action.key === 'trigger-schema-detection')
      .icon()
      .props.onClick();
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });
  it('does not reopen the old dialog while the fresh result is absent', () => {
    mockResult = { refetch: jest.fn() };
    renderToStaticMarkup(
      createElement(ModelTree, { models: [], onOpenModelDrawer: jest.fn() }),
    );
    expect(mockModal.visible).toBe(false);
  });
});
