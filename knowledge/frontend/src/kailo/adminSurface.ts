// DD-138(6), design 07 §4.8.5: the knowledge admin functions contributed to the
// Kailo admin area as admin surfaces. This table is the build fact behind the
// release declaration (knowledge/fork/release/manifest.native-page.json
// `frontendPresentationContract.adminSurfaces`) and the nginx allowlist written
// by docker-entrypoint.sh; keep the three in step (adminSurface.test.ts checks
// the manifest).
//
// Kailo opens `<origin><path>?kailo_admin_surface=<key>`; KailoEmbed.adminSurface()
// returns the key. The key only selects which function renders; the server
// still decides authority from the directory-derived role (DD-133(4)).

export type AdminCategory = 'MODELS' | 'DATA_SOURCES' | 'STORAGE' | 'INDEXING' | 'INTEGRATIONS' | 'SYSTEM'
export type AdminAccess = 'EDITABLE' | 'READ_ONLY'
export type AdminSurfaceKey =
  | 'models.catalog'
  | 'storage.backends'
  | 'indexing.parsers'
  | 'answers.webSearch'

export interface LocalizedText {
  ZH_CN: string
  EN: string
}

export interface AdminSurface {
  key: AdminSurfaceKey
  adminCategory: AdminCategory
  path: string
  requiredPermission: 'BINDING_MANAGE' | 'TENANT_MANAGE'
  access: AdminAccess
  title: LocalizedText
  description: LocalizedText
}

/** Path prefix of every admin surface page (a standalone route, outside the platform shell). */
export const ADMIN_SURFACE_PATH_PREFIX = '/platform/admin/'

// DD-163 (07 §4.8.5, §4.8.8): answer skills (with their sandboxes) and MCP
// services serve only the agent mode Kailo mode closes, so they are no admin
// surfaces; the server refuses their writes (internal/middleware/kailo_managed.go).
//
// TENANT_MANAGE for every surface: the dedicated instance behind one binding
// mirrors the whole Kailo Tenant directory (Tenant space and every Workspace
// space, 07 §4.7.4), only a Tenant ADMIN becomes a native admin, and these
// settings act on the whole instance rather than one Workspace.
export const ADMIN_SURFACES: readonly AdminSurface[] = [
  {
    key: 'models.catalog',
    adminCategory: 'MODELS',
    path: '/platform/admin/models',
    requiredPermission: 'TENANT_MANAGE',
    access: 'READ_ONLY',
    title: { ZH_CN: '模型目录', EN: 'Model catalog' },
    description: {
      ZH_CN: '知识库与问答可选用的模型，由平台模型路由提供。',
      EN: 'Models that knowledge bases and answers can use, provided by platform model routing.',
    },
  },
  {
    key: 'storage.backends',
    adminCategory: 'STORAGE',
    path: '/platform/admin/storage',
    requiredPermission: 'TENANT_MANAGE',
    access: 'READ_ONLY',
    title: { ZH_CN: '存储与向量库', EN: 'Storage and vector stores' },
    description: {
      ZH_CN: '文件存储与向量库由部署声明，在此只读查看。',
      EN: 'File storage and vector stores are set by the deployment and shown here read-only.',
    },
  },
  {
    key: 'indexing.parsers',
    adminCategory: 'INDEXING',
    path: '/platform/admin/parsers',
    requiredPermission: 'TENANT_MANAGE',
    access: 'READ_ONLY',
    title: { ZH_CN: '文档解析引擎', EN: 'Document parsers' },
    description: {
      ZH_CN: '解析文档所用的引擎与可处理的文件类型，由部署声明。',
      EN: 'Engines that parse documents and the file types they handle, set by the deployment.',
    },
  },
  {
    key: 'answers.webSearch',
    adminCategory: 'INTEGRATIONS',
    path: '/platform/admin/web-search',
    requiredPermission: 'TENANT_MANAGE',
    access: 'EDITABLE',
    title: { ZH_CN: '联网搜索', EN: 'Web search' },
    description: {
      ZH_CN: '配置问答使用的联网搜索服务。',
      EN: 'Set up the web search services answers use.',
    },
  },
]

/** Same key shape as a preference key (07 §4.8.2) and the runtime's check. */
const ADMIN_SURFACE_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/

export function isAdminSurfaceKeyShape(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && ADMIN_SURFACE_KEY.test(value)
}

function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** The declared surface served at `path`, if any. */
export function adminSurfaceForPath(path: string): AdminSurface | null {
  const wanted = normalizePath(path)
  return ADMIN_SURFACES.find((surface) => surface.path === wanted) ?? null
}

/**
 * The surface to render for a launched key on this path: the key must have the
 * declared shape, be a declared key, and belong to this path. Anything else
 * (unknown key, key of another path, missing key) renders no admin function.
 */
export function resolveAdminSurface(path: string, key: unknown): AdminSurface | null {
  if (!isAdminSurfaceKeyShape(key)) return null
  const surface = adminSurfaceForPath(path)
  return surface && surface.key === key ? surface : null
}

export function adminSurfaceText(text: LocalizedText, locale: string): string {
  return /^zh\b/i.test(locale || '') ? text.ZH_CN : text.EN
}

/** Kailo-styled empty state text when no admin function may render (07 §4.8.5 obligation 1). */
export function unavailableText(locale: string): { title: string; description: string } {
  return /^zh\b/i.test(locale || '')
    ? { title: '该管理项不可用', description: '请从管理区重新打开。' }
    : { title: 'This admin item is unavailable', description: 'Open it again from the admin area.' }
}

/**
 * Native admin console routes closed in Kailo mode (07 §4.8.5 obligation 3):
 * the Settings dialog route, its compatibility redirects and the system
 * administration pages. The SPA guard sends them to the business home; nginx
 * does the same before any page is served (docker-entrypoint.sh).
 */
export const NATIVE_ADMIN_PATH_PREFIXES: readonly string[] = [
  '/platform/settings',
  '/platform/system',
  '/platform/integrations',
  '/platform/tenant',
]

export function isNativeAdminPath(path: string): boolean {
  const p = normalizePath(path)
  return NATIVE_ADMIN_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'))
}

/** Business home for redirected admin routes. */
export const BUSINESS_HOME = '/platform/knowledge-bases'
