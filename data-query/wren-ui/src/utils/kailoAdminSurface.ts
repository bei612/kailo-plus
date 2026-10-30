// DD-138(6) (`07` §4.8.5): the admin surfaces this release contributes to the
// Kailo admin area, and the native admin routes that no longer exist as a
// product of their own. The same three items are declared in
// `fork/release/manifest.native-page.json` (`adminSurfaces`); the unit test
// keeps both identical.
//
// Edge-safe (no React, no Node API): the middleware decides here, before any
// page is served, and the pages use the same table to pick what they render.
// The launch parameter only selects which admin function a page shows; it is
// never authorization — every write still passes the original resolvers
// (`nativeProjectResolver(..., 'manage')`: Core `manage` on the binding when
// GOVERNED, the directory Tenant admin when STANDALONE).

export const ADMIN_SURFACE_PARAM = 'kailo_admin_surface';

export type KailoAdminSurfaceKey =
  | 'dataSources.connection'
  | 'semantic.modeling'
  | 'system.project';

export interface KailoAdminSurface {
  key: KailoAdminSurfaceKey;
  adminCategory: 'DATA_SOURCES' | 'SYSTEM';
  path: string;
  requiredPermission: 'BINDING_MANAGE';
  access: 'EDITABLE';
  title: { ZH_CN: string; EN: string };
  description: { ZH_CN: string; EN: string };
}

export const KAILO_ADMIN_SURFACES: readonly KailoAdminSurface[] = [
  {
    key: 'dataSources.connection',
    adminCategory: 'DATA_SOURCES',
    path: '/kailo-admin/data-source',
    requiredPermission: 'BINDING_MANAGE',
    access: 'EDITABLE',
    title: { ZH_CN: '数据源连接', EN: 'Data source connection' },
    description: {
      ZH_CN: '连接用于问答的数据库，选择要建模的数据表并定义表之间的关系。',
      EN: 'Connect the database used for asking questions, choose the tables to model and define their relationships.',
    },
  },
  {
    key: 'semantic.modeling',
    adminCategory: 'DATA_SOURCES',
    path: '/kailo-admin/modeling',
    requiredPermission: 'BINDING_MANAGE',
    access: 'EDITABLE',
    title: { ZH_CN: '语义建模', EN: 'Semantic modeling' },
    description: {
      ZH_CN: '维护模型、视图、计算字段与关系，并发布模型供问答使用。',
      EN: 'Maintain models, views, calculated fields and relationships, and deploy the models for asking.',
    },
  },
  {
    key: 'system.project',
    adminCategory: 'SYSTEM',
    path: '/kailo-admin/project',
    requiredPermission: 'BINDING_MANAGE',
    access: 'EDITABLE',
    title: { ZH_CN: '项目设置', EN: 'Project settings' },
    description: {
      ZH_CN: '设置回答语言，或重置项目。',
      EN: 'Set the answer language, or reset the project.',
    },
  },
];

// Same shape as a preference key (`07` §4.8.2) and the runtime's check.
const SURFACE_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;

export function adminSurfaceKeyValid(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 64 && SURFACE_KEY.test(value)
  );
}

/** The declared surface for this exact path and key, else null. */
export function adminSurfaceFor(
  path: string | null | undefined,
  key: string | null | undefined,
): KailoAdminSurface | null {
  if (!path || !adminSurfaceKeyValid(key)) return null;
  return (
    KAILO_ADMIN_SURFACES.find(
      (surface) => surface.key === key && surface.path === path,
    ) || null
  );
}

/** The declared surface served at this path (whatever the key), else null. */
export function adminSurfaceAtPath(
  path: string | null | undefined,
): KailoAdminSurface | null {
  return KAILO_ADMIN_SURFACES.find((surface) => surface.path === path) || null;
}

export function adminSurfaceTitle(
  surface: KailoAdminSurface,
  locale: string | undefined,
): string {
  return locale === 'en' ? surface.title.EN : surface.title.ZH_CN;
}

const ADMIN_PREFIX = '/kailo-admin';
// The original console routes: modeling and the onboarding wizard. They exist
// only as the admin surfaces above.
const NATIVE_ADMIN_PREFIXES = ['/modeling', '/setup'];
const LOCALE_PREFIX = /^\/(?:zh-CN|en)(?=\/|$)/;

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Server-side closure of the native admin console (`07` §4.8.5 obligation 3).
 * True when the request must be sent to the business home instead: any
 * original admin route, and any admin surface path that does not carry exactly
 * one well-formed `kailo_admin_surface` declared for that very path.
 */
export function nativeAdminRouteClosed(
  rawPathname: string,
  search: URLSearchParams,
): boolean {
  // Next strips the locale before the middleware; a literal prefix (tests,
  // non-i18n hops) is treated the same.
  const pathname = rawPathname.replace(LOCALE_PREFIX, '') || '/';
  if (NATIVE_ADMIN_PREFIXES.some((prefix) => under(pathname, prefix)))
    return true;
  if (!under(pathname, ADMIN_PREFIX)) return false;
  const keys = search.getAll(ADMIN_SURFACE_PARAM);
  return keys.length !== 1 || !adminSurfaceFor(pathname, keys[0]);
}

/** True for the admin surface paths (the STANDALONE admin check applies). */
export function adminSurfaceRoute(rawPathname: string): boolean {
  return under(rawPathname.replace(LOCALE_PREFIX, '') || '/', ADMIN_PREFIX);
}

/** Where a closed route goes: the business home, keeping a locale prefix. */
export function businessHomePath(rawPathname: string): string {
  const locale = rawPathname.match(LOCALE_PREFIX)?.[0] || '';
  return `${locale}/home`;
}

export type AdminSurfaceView =
  | { state: 'pending'; surface: KailoAdminSurface }
  | { state: 'ready'; surface: KailoAdminSurface }
  | { state: 'unavailable'; surface: KailoAdminSurface | null };

/**
 * What an admin surface page shows (`07` §4.8.5 obligation 1): the admin
 * function only for the key declared for this exact path, and only to the
 * user the server reports as admin (Core `manage` on the binding when
 * GOVERNED, the directory Tenant admin when STANDALONE). A missing, unknown
 * or mismatched key is the Kailo empty state, never another function.
 */
export function resolveAdminSurface(
  path: string,
  launchedKey: string | null | undefined,
  session: { loaded: boolean; isAdmin: boolean },
): AdminSurfaceView {
  const surface = adminSurfaceFor(path, launchedKey);
  if (!surface)
    return { state: 'unavailable', surface: adminSurfaceAtPath(path) };
  if (!session.loaded) return { state: 'pending', surface };
  return session.isAdmin
    ? { state: 'ready', surface }
    : { state: 'unavailable', surface };
}

export type DataSourceSurfaceStep =
  | 'connection'
  | 'models'
  | 'relationships'
  | 'settings';

/**
 * The data source surface's first view for the original onboarding status:
 * no project yet → connect; a connection without models → choose tables;
 * otherwise the connection settings. Null while the status is unknown.
 */
export function dataSourceSurfaceStep(
  status: string | null | undefined,
): DataSourceSurfaceStep | null {
  switch (status) {
    case 'NOT_STARTED':
      return 'connection';
    case 'DATASOURCE_SAVED':
      return 'models';
    case 'ONBOARDING_FINISHED':
    case 'WITH_SAMPLE_DATASET':
      return 'settings';
    default:
      return null;
  }
}
