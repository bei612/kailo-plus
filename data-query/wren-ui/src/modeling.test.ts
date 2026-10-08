import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Modeling from './pages/modeling';
import { FORM_MODE } from './utils/enum';

let mockResult: any;
let mockQueryOptions: any;
let mockDrawerIndex = 0;
let mockDrawers: any[];
let mockSidebar: any;
let mockModelDrawer: any;
const mockCreateModel = jest.fn();
const mockMutation = () => [jest.fn(), {}];
jest.mock('next/router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock(
  'next/dynamic',
  () => () => (props: any) =>
    require('react').createElement('main', null, JSON.stringify(props.data)),
);
jest.mock('./apollo/client/graphql/diagram.generated', () => ({
  useDiagramQuery: (options: any) => {
    mockQueryOptions = options;
    return mockResult;
  },
}));
jest.mock('./apollo/client/graphql/deploy.generated', () => ({
  useDeployStatusQuery: () => ({}),
}));
jest.mock('./apollo/client/graphql/model.generated', () => ({
  useCreateModelMutation: () => [mockCreateModel, {}],
  useDeleteModelMutation: () => mockMutation(),
  useUpdateModelMutation: () => mockMutation(),
}));
jest.mock('./apollo/client/graphql/view.generated', () => ({
  useDeleteViewMutation: () => mockMutation(),
}));
jest.mock('./apollo/client/graphql/metadata.generated', () => ({
  useUpdateModelMetadataMutation: () => mockMutation(),
  useUpdateViewMetadataMutation: () => mockMutation(),
}));
jest.mock('./apollo/client/graphql/calculatedField.generated', () => ({
  useCreateCalculatedFieldMutation: () => mockMutation(),
  useUpdateCalculatedFieldMutation: () => mockMutation(),
  useDeleteCalculatedFieldMutation: () => mockMutation(),
}));
jest.mock('./apollo/client/graphql/relationship.generated', () => ({
  useCreateRelationshipMutation: () => mockMutation(),
  useUpdateRelationshipMutation: () => mockMutation(),
  useDeleteRelationshipMutation: () => mockMutation(),
}));
jest.mock(
  './hooks/useDrawerAction',
  () => () => mockDrawers[mockDrawerIndex++],
);
jest.mock('./hooks/useModalAction', () => () => ({
  state: {},
  openModal: jest.fn(),
}));
jest.mock('./hooks/useRelationshipModal', () => () => ({
  state: {},
  openModal: jest.fn(),
}));
jest.mock('./hooks/useCombineFieldOptions', () => ({
  convertFormValuesToIdentifier: jest.fn(),
}));
jest.mock('./utils/modelingHelper', () => ({ editCalculatedField: jest.fn() }));
jest.mock('./components/layouts/SiderLayout', () => (props: any) => {
  mockSidebar = props.sidebar;
  return require('react').createElement(
    'section',
    { 'data-loading': String(props.loading) },
    require('react').createElement(
      'aside',
      null,
      JSON.stringify(props.sidebar.data),
    ),
    props.children,
  );
});
jest.mock(
  './components/ErrorCollapse',
  () => (props: any) =>
    require('react').createElement('div', { role: 'alert' }, props.message),
);
jest.mock(
  './components/pages/modeling/MetadataDrawer',
  () => (props: any) =>
    props.visible
      ? require('react').createElement('div', null, 'open-metadata-drawer')
      : null,
);
jest.mock('./components/pages/modeling/EditMetadataModal', () => () => null);
jest.mock('./components/pages/modeling/ModelDrawer', () => (props: any) => {
  mockModelDrawer = props;
  return require('react').createElement('div', {
    'data-model-drawer': String(props.visible),
  });
});
jest.mock('./components/modals/CalculatedFieldModal', () => () => null);
jest.mock('./components/modals/RelationModal', () => () => null);

describe('original modeling page authorization result consumer', () => {
  beforeEach(() => {
    mockQueryOptions = undefined;
    mockDrawerIndex = 0;
    mockModelDrawer = undefined;
    mockSidebar = undefined;
    mockCreateModel.mockReset().mockResolvedValue({});
    mockDrawers = [true, false].map((visible) => {
      const state = { visible, defaultValue: null, formMode: FORM_MODE.CREATE };
      return {
        state,
        openDrawer: () => {
          state.visible = true;
        },
        closeDrawer: jest.fn(),
      };
    });
  });
  it('keeps the original sidebar create callback connected to its model drawer and submit consumer while diagram reads fail', async () => {
    mockResult = { error: new Error('QUERY_SCOPE_DENIED') };
    renderToStaticMarkup(createElement(Modeling));
    expect(mockModelDrawer).toBeDefined();
    expect(mockModelDrawer.visible).toBe(false);
    mockSidebar.onOpenModelDrawer();
    mockDrawerIndex = 0;
    renderToStaticMarkup(createElement(Modeling));
    expect(mockModelDrawer.visible).toBe(true);
    const data = { tableName: 'original' };
    await mockModelDrawer.onSubmit({ data });
    expect(mockCreateModel).toHaveBeenCalledWith({ variables: { data } });
  });
  it('preserves the original diagram and sidebar when the authorized response succeeds', () => {
    mockResult = {
      data: {
        diagram: {
          models: [{ modelId: 11, displayName: 'Original model' }],
          views: [],
        },
      },
    };
    const html = renderToStaticMarkup(createElement(Modeling));
    expect(html).toContain('Original model');
    expect(html).toContain('<main>');
    expect(html).toContain('open-metadata-drawer');
    expect(html).toContain('data-loading="false"');
    expect(mockQueryOptions.fetchPolicy).toBe('no-cache');
  });
  it.each([
    undefined,
    {
      diagram: {
        models: [{ modelId: 11, displayName: 'Revoked cached model' }],
        views: [],
      },
    },
  ])(
    'shows the existing error component and not an empty or previously cached graph on failure',
    (data) => {
      mockResult = { data, error: new Error('QUERY_SCOPE_DENIED') };
      const html = renderToStaticMarkup(createElement(Modeling));
      expect(html).toContain('role="alert"');
      expect(html).toContain('QUERY_SCOPE_DENIED');
      expect(html).toContain('data-loading="false"');
      expect(html).not.toContain('Revoked cached model');
      expect(html).not.toContain('<main>');
      expect(html).not.toContain('open-metadata-drawer');
    },
  );
});
