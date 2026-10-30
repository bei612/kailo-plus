import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ADMIN_SURFACE_PARAM,
  adminSurfaceFor,
  adminSurfaceKeyValid,
  adminSurfaceRoute,
  adminSurfaceTitle,
  businessHomePath,
  dataSourceSurfaceStep,
  KAILO_ADMIN_SURFACES,
  nativeAdminRouteClosed,
  resolveAdminSurface,
} from './utils/kailoAdminSurface';
import { KAILO_TABS, pageTabs } from './hooks/useKailoPage';
import { Path } from './utils/enum';

jest.mock('./hooks/useKailoSession', () => ({
  __esModule: true,
  default: () => ({ hostPage: false }),
}));
jest.mock('./utils/kailoHost', () => ({ setPage: jest.fn() }));

// DD-138(6) (`07` §4.8.5): the admin surfaces this release declares and the
// closure of the original modeling / onboarding / settings console.
const manifest = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../fork/release/manifest.native-page.json'),
    'utf8',
  ),
);

describe('admin surface declaration (07 §4.8.5)', () => {
  const declared = manifest.frontendPresentationContract.adminSurfaces;

  it('is exactly the table the pages and the middleware use, in a new release version', () => {
    expect(declared).toEqual(KAILO_ADMIN_SURFACES);
    expect(manifest.version).toBe('1.7.0-native-page');
    expect(manifest.frontendDelivery.mode).toBe('NATIVE_PAGE');
    expect(manifest.frontendPresentationContract.integrationMode).toBe(
      'KAILO_EMBED',
    );
  });

  it('declares each item in the contract field order', () => {
    for (const item of declared)
      expect(Object.keys(item)).toEqual([
        'key',
        'adminCategory',
        'path',
        'requiredPermission',
        'access',
        'title',
        'description',
      ]);
  });

  it('follows the Core registration rules', () => {
    expect(declared.length).toBeLessThanOrEqual(12);
    expect(new Set(declared.map((item) => item.key)).size).toBe(
      declared.length,
    );
    for (const item of declared) {
      expect(adminSurfaceKeyValid(item.key)).toBe(true);
      expect(item.key.split('.')[0]).not.toMatch(
        /^(members|roles|invitations|users|groups|spaces|organizations|tenants|workspaces)$/,
      );
      expect(item.path).toMatch(/^(\/[A-Za-z0-9._~-]+)+$/);
      expect(item.path.split('/')).not.toContain('..');
      expect(item.path.length).toBeLessThanOrEqual(256);
      expect([
        'MODELS',
        'DATA_SOURCES',
        'STORAGE',
        'INDEXING',
        'INTEGRATIONS',
        'SYSTEM',
      ]).toContain(item.adminCategory);
      // Wren GOVERNED admin = Core `manage` on the binding scope.
      expect(item.requiredPermission).toBe('BINDING_MANAGE');
      // Component-owned business configuration (07 §4.8.5 ownership table).
      expect(item.access).toBe('EDITABLE');
      for (const text of [item.title, item.description]) {
        expect(Object.keys(text).sort()).toEqual(['EN', 'ZH_CN']);
        for (const value of Object.values(text) as string[]) {
          expect(value.length).toBeGreaterThan(0);
          // No component name in the copy.
          expect(value).not.toMatch(/问数|Data Q&A|wren/i);
        }
      }
      expect(item.title.ZH_CN.length).toBeLessThanOrEqual(60);
      expect(item.title.EN.length).toBeLessThanOrEqual(60);
      expect(item.description.ZH_CN.length).toBeLessThanOrEqual(200);
      expect(item.description.EN.length).toBeLessThanOrEqual(200);
    }
  });

  it('serves each surface at its own page path', () => {
    expect(
      Object.fromEntries(declared.map((item) => [item.key, item.path])),
    ).toEqual({
      'dataSources.connection': Path.AdminDataSource,
      'semantic.modeling': Path.AdminModeling,
      'system.project': Path.AdminProject,
    });
    expect(declared.map((item) => [item.key, item.adminCategory])).toEqual([
      ['dataSources.connection', 'DATA_SOURCES'],
      ['semantic.modeling', 'DATA_SOURCES'],
      ['system.project', 'SYSTEM'],
    ]);
  });

  it('names the surface in the Kailo locale', () => {
    const surface = adminSurfaceFor(Path.AdminModeling, 'semantic.modeling');
    expect(adminSurfaceTitle(surface, 'zh-CN')).toBe('语义建模');
    expect(adminSurfaceTitle(surface, 'en')).toBe('Semantic modeling');
  });
});

describe('admin surface key resolution', () => {
  const admin = { loaded: true, isAdmin: true };

  it.each([
    [Path.AdminDataSource, 'dataSources.connection'],
    [Path.AdminModeling, 'semantic.modeling'],
    [Path.AdminProject, 'system.project'],
  ])('renders %s only for its declared key %s', (path, key) => {
    const view = resolveAdminSurface(path, key, admin);
    expect(view.state).toBe('ready');
    expect(view.surface.key).toBe(key);
  });

  it.each([
    [Path.AdminModeling, null],
    [Path.AdminModeling, undefined],
    [Path.AdminModeling, ''],
    [Path.AdminModeling, 'system.project'],
    [Path.AdminModeling, 'semantic.unknown'],
    [Path.AdminModeling, 'Semantic.modeling'],
    [Path.AdminModeling, 'modeling'],
    [Path.AdminModeling, `semantic.${'a'.repeat(64)}`],
    [Path.AdminDataSource, 'semantic.modeling'],
    [Path.AdminProject, 'dataSources.connection'],
    ['/kailo-admin/other', 'system.project'],
    ['/modeling', 'semantic.modeling'],
  ])('shows the empty state on %s for key %p', (path, key) => {
    expect(resolveAdminSurface(path, key, admin).state).toBe('unavailable');
  });

  it('waits for the session, and shows no admin function to a non-admin', () => {
    expect(
      resolveAdminSurface(Path.AdminProject, 'system.project', {
        loaded: false,
        isAdmin: false,
      }).state,
    ).toBe('pending');
    const member = resolveAdminSurface(Path.AdminProject, 'system.project', {
      loaded: true,
      isAdmin: false,
    });
    expect(member.state).toBe('unavailable');
  });

  it('keeps the declared title for the empty state of a known path', () => {
    const view = resolveAdminSurface(Path.AdminProject, 'nope.nope', admin);
    expect(view.state).toBe('unavailable');
    expect(view.surface?.key).toBe('system.project');
    const unknown = resolveAdminSurface(
      '/kailo-admin/other',
      'system.project',
      admin,
    );
    expect(unknown.surface).toBeNull();
  });

  it('starts the data source surface where the original onboarding stands', () => {
    expect(dataSourceSurfaceStep('NOT_STARTED')).toBe('connection');
    expect(dataSourceSurfaceStep('DATASOURCE_SAVED')).toBe('models');
    expect(dataSourceSurfaceStep('ONBOARDING_FINISHED')).toBe('settings');
    expect(dataSourceSurfaceStep('WITH_SAMPLE_DATASET')).toBe('settings');
    expect(dataSourceSurfaceStep(undefined)).toBeNull();
  });
});

describe('native admin route closure', () => {
  const query = (value: string) => new URLSearchParams(value);

  it.each([
    '/modeling',
    '/modeling/',
    '/setup',
    '/setup/connection',
    '/setup/models',
    '/setup/relationships',
    '/en/modeling',
    '/zh-CN/setup/connection',
    '/kailo-admin',
    '/kailo-admin/',
    '/kailo-admin/modeling',
    '/kailo-admin/unknown',
  ])('closes %s without a matching surface key', (path) => {
    expect(nativeAdminRouteClosed(path, query(''))).toBe(true);
    expect(
      nativeAdminRouteClosed(path, query(`${ADMIN_SURFACE_PARAM}=bad`)),
    ).toBe(true);
  });

  it.each([
    ['/kailo-admin/data-source', 'dataSources.connection'],
    ['/kailo-admin/modeling', 'semantic.modeling'],
    ['/kailo-admin/project', 'system.project'],
    ['/en/kailo-admin/project', 'system.project'],
  ])('serves %s with %s', (path, key) => {
    expect(
      nativeAdminRouteClosed(
        path,
        query(`kailo_theme=dark&${ADMIN_SURFACE_PARAM}=${key}`),
      ),
    ).toBe(false);
    expect(adminSurfaceRoute(path)).toBe(true);
  });

  it('refuses a repeated, mismatched or malformed key', () => {
    const path = '/kailo-admin/modeling';
    for (const search of [
      `${ADMIN_SURFACE_PARAM}=semantic.modeling&${ADMIN_SURFACE_PARAM}=semantic.modeling`,
      `${ADMIN_SURFACE_PARAM}=system.project`,
      `${ADMIN_SURFACE_PARAM}=semantic.modeling.`,
      `${ADMIN_SURFACE_PARAM}=semantic%2Emodeling%20`,
      `${ADMIN_SURFACE_PARAM.toUpperCase()}=semantic.modeling`,
    ])
      expect(nativeAdminRouteClosed(path, query(search))).toBe(true);
  });

  it.each([
    '/',
    '/home',
    '/home/dashboard',
    '/home/42',
    '/knowledge/question-sql-pairs',
    '/api-management/history',
    '/api/graphql',
    '/api/config',
    '/api/v1/models',
    '/_next/static/chunks/pages/kailo-admin/modeling.js',
    '/_next/data/build/zh-CN/home.json',
    '/kailo/kailo-embed.js',
    '/modelingx',
    '/setups',
  ])('leaves the business route %s alone', (path) => {
    expect(nativeAdminRouteClosed(path, query(''))).toBe(false);
    expect(adminSurfaceRoute(path)).toBe(false);
  });

  it('sends a closed route to the business home in its locale', () => {
    expect(businessHomePath('/modeling')).toBe('/home');
    expect(businessHomePath('/en/setup/models')).toBe('/en/home');
    expect(businessHomePath('/zh-CN/kailo-admin/x')).toBe('/zh-CN/home');
  });
});

describe('business page header (DD-157 / DD-138(6))', () => {
  it('offers the business tabs 问答 · 看板 · 知识 · API, without 建模 (DD-167)', () => {
    expect(KAILO_TABS.map((tab) => tab.id)).toEqual([
      'home',
      'dashboard',
      'knowledge',
      'api',
    ]);
    const { tabs, activeTab } = pageTabs('zh-CN', Path.Home, true);
    expect(tabs.map((tab) => tab.label)).toEqual(['问答', '看板', '知识', 'API']);
    expect(activeTab).toBe('home');
    expect(pageTabs('zh-CN', Path.Thread, true).activeTab).toBe('home');
    expect(pageTabs('en', Path.HomeDashboard, false).activeTab).toBe(
      'dashboard',
    );
    expect(pageTabs('zh-CN', Path.KnowledgeInstructions, false).activeTab).toBe(
      'knowledge',
    );
    expect(JSON.stringify(tabs)).not.toMatch(/modeling|建模/);
    expect(pageTabs('en', Path.AdminModeling, true).activeTab).toBeUndefined();
  });

  it('shows the API history tab to administrators only (DD-138(7))', () => {
    const member = pageTabs('zh-CN', Path.APIManagementHistory, false);
    expect(member.tabs.map((tab) => tab.id)).toEqual([
      'home',
      'dashboard',
      'knowledge',
    ]);
    expect(member.activeTab).toBeUndefined();
    const admin = pageTabs('zh-CN', Path.APIManagementHistory, true);
    expect(admin.activeTab).toBe('api');
  });

  it('keeps no admin route behind a business tab', () => {
    for (const tab of KAILO_TABS) {
      expect(adminSurfaceRoute(tab.path)).toBe(false);
      expect(nativeAdminRouteClosed(tab.path, new URLSearchParams())).toBe(
        false,
      );
    }
  });
});
