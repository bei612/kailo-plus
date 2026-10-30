// DD-138(6), 07 §4.8.5 and 20 §13.2: READ_ONLY admin surfaces show values as a
// definition list (text-muted values, 1 px line separators), never disabled
// inputs. This module turns the native read APIs into that list; the server
// refuses the matching writes in Kailo mode (internal/middleware/kailo_managed.go).
//
// Only descriptive, non-secret fields are shown: no endpoints of model
// gateways, no connection settings or credentials of storage engines.

import { modelLabel, modelRawName } from './modelLabel'

export interface ReadOnlyRow {
  label: string
  value: string
}

export interface ReadOnlyItem {
  id: string
  title: string
  /** Neutral tag next to the title ("默认"). */
  badge?: string
  rows: ReadOnlyRow[]
}

export interface ReadOnlySection {
  id: string
  title: string
  items: ReadOnlyItem[]
  /** Shown instead of the list when there are no items. */
  empty: string
}

type Lang = 'zh' | 'en'

const TEXT = {
  zh: {
    modelsChat: '对话模型',
    modelsEmbedding: '向量模型',
    modelsRerank: '重排序模型',
    modelsVision: '多模态模型',
    modelsAsr: '语音识别模型',
    modelsEmpty: '还没有可用的模型。请在平台的模型路由中为该服务选择模型。',
    modelId: '模型',
    provider: '提供方',
    source: '来源',
    sourceRoute: '平台模型路由',
    sourceDeployment: '部署内置',
    sourceWorkspace: '工作区',
    contextWindow: '上下文窗口',
    dimension: '向量维度',
    vision: '图像输入',
    supported: '支持',
    isDefault: '默认',
    tokens: '{n} tokens',
    fileStorage: '文件存储',
    fileStorageEmpty: '未声明文件存储，使用服务的本地存储。',
    vectorStores: '向量库',
    vectorStoresEmpty: '未声明向量库，使用服务的默认向量库。',
    kind: '类型',
    engine: '引擎',
    endpoint: '服务地址',
    bucket: '存储桶',
    region: '区域',
    pathPrefix: '路径前缀',
    status: '状态',
    active: '启用',
    disabled: '停用',
    sourceEnv: '部署声明',
    parserService: '解析服务',
    connection: '连接状态',
    connected: '已连接',
    disconnected: '未连接',
    transport: '连接方式',
    parserEngines: '解析引擎',
    parserEnginesEmpty: '没有检测到解析引擎。',
    available: '可用',
    unavailable: '不可用',
    fileTypes: '文件类型',
    description: '说明',
  },
  en: {
    modelsChat: 'Chat models',
    modelsEmbedding: 'Embedding models',
    modelsRerank: 'Rerank models',
    modelsVision: 'Vision models',
    modelsAsr: 'Speech recognition models',
    modelsEmpty: 'No models are available yet. Choose models for this service in the platform model routing.',
    modelId: 'Model',
    provider: 'Provider',
    source: 'Source',
    sourceRoute: 'Platform model routing',
    sourceDeployment: 'Built into the deployment',
    sourceWorkspace: 'Workspace',
    contextWindow: 'Context window',
    dimension: 'Dimensions',
    vision: 'Image input',
    supported: 'Supported',
    isDefault: 'Default',
    tokens: '{n} tokens',
    fileStorage: 'File storage',
    fileStorageEmpty: 'No file storage is declared; the service uses its local storage.',
    vectorStores: 'Vector stores',
    vectorStoresEmpty: 'No vector store is declared; the service uses its default vector store.',
    kind: 'Type',
    engine: 'Engine',
    endpoint: 'Endpoint',
    bucket: 'Bucket',
    region: 'Region',
    pathPrefix: 'Path prefix',
    status: 'Status',
    active: 'Active',
    disabled: 'Disabled',
    sourceEnv: 'Deployment',
    parserService: 'Parsing service',
    connection: 'Connection',
    connected: 'Connected',
    disconnected: 'Not connected',
    transport: 'Transport',
    parserEngines: 'Parsing engines',
    parserEnginesEmpty: 'No parsing engine was detected.',
    available: 'Available',
    unavailable: 'Unavailable',
    fileTypes: 'File types',
    description: 'Description',
  },
} as const

type TextKey = keyof typeof TEXT.zh

function langOf(locale: string): Lang {
  return /^zh\b/i.test(locale || '') ? 'zh' : 'en'
}

export function readOnlyText(key: TextKey, locale: string): string {
  return TEXT[langOf(locale)][key]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function rows(list: Array<[string, unknown]>): ReadOnlyRow[] {
  return list
    .map(([label, value]) => ({ label, value: typeof value === 'number' ? String(value) : text(value) }))
    .filter((row) => row.value !== '')
}

// ---------------------------------------------------------------------------
// Models (MODELS, READ_ONLY)

export interface ModelRecord {
  id?: string
  name?: string
  display_name?: string
  type?: string
  is_default?: boolean
  is_builtin?: boolean
  managed_by?: string
  parameters?: {
    provider?: string
    supports_vision?: boolean
    context_window?: number
    embedding_parameters?: { dimension?: number }
  }
}

const MODEL_GROUPS: ReadonlyArray<{ type: string; key: TextKey }> = [
  { type: 'KnowledgeQA', key: 'modelsChat' },
  { type: 'Embedding', key: 'modelsEmbedding' },
  { type: 'Rerank', key: 'modelsRerank' },
  { type: 'VLLM', key: 'modelsVision' },
  { type: 'ASR', key: 'modelsAsr' },
]

/** Hidden white-label providers never appear (surface.ts WHITE_LABEL_HIDDEN_PROVIDERS). */
export function modelSections(
  models: readonly ModelRecord[],
  locale: string,
  hiddenProviders: ReadonlySet<string> = new Set(),
): ReadOnlySection[] {
  const t = (key: TextKey) => readOnlyText(key, locale)
  const visible = models.filter((model) => !hiddenProviders.has(text(model.parameters?.provider)))
  const sections = MODEL_GROUPS.map(({ type, key }) => ({
    id: `models-${type}`,
    title: t(key),
    empty: '',
    items: visible.filter((model) => model.type === type).map((model, index) => {
      const p = model.parameters ?? {}
      const source = model.managed_by === 'kailo-model-route'
        ? t('sourceRoute')
        : model.is_builtin ? t('sourceDeployment') : t('sourceWorkspace')
      const context = (type === 'KnowledgeQA' || type === 'VLLM') && typeof p.context_window === 'number' && p.context_window > 0
        ? t('tokens').replace('{n}', p.context_window.toLocaleString('en-US'))
        : ''
      const dimension = type === 'Embedding' ? p.embedding_parameters?.dimension : undefined
      const item: ReadOnlyItem = {
        id: model.id || `${type}-${index}`,
        title: modelLabel(model, locale),
        rows: rows([
          [t('modelId'), modelRawName(model)],
          [t('provider'), p.provider],
          [t('source'), source],
          [t('contextWindow'), context],
          [t('dimension'), typeof dimension === 'number' && dimension > 0 ? dimension : ''],
          [t('vision'), type === 'KnowledgeQA' && p.supports_vision ? t('supported') : ''],
        ]),
      }
      if (model.is_default) item.badge = t('isDefault')
      return item
    }),
  })).filter((section) => section.items.length > 0)
  return sections.length > 0 ? sections : [{ id: 'models', title: t('modelsChat'), items: [], empty: t('modelsEmpty') }]
}

// ---------------------------------------------------------------------------
// Storage (STORAGE, READ_ONLY)

export interface StorageBackendRecord {
  id: string
  name?: string
  provider?: string
  source?: string
  status?: string
  config?: { endpoint?: string; bucket_name?: string; region?: string; path_prefix?: string }
}

export interface VectorStoreRecord {
  id?: string
  name?: string
  engine_type?: string
  source?: string
}

export function storageSections(
  backends: readonly StorageBackendRecord[],
  defaultBackendId: string | null | undefined,
  stores: readonly VectorStoreRecord[],
  locale: string,
): ReadOnlySection[] {
  const t = (key: TextKey) => readOnlyText(key, locale)
  const source = (value: unknown) => (value === 'env' ? t('sourceEnv') : t('sourceWorkspace'))
  return [
    {
      id: 'file-storage',
      title: t('fileStorage'),
      empty: t('fileStorageEmpty'),
      items: backends.map((backend) => {
        const c = backend.config ?? {}
        const item: ReadOnlyItem = {
          id: backend.id,
          title: text(backend.name) || text(backend.provider) || backend.id,
          rows: rows([
            [t('kind'), backend.provider],
            [t('endpoint'), c.endpoint],
            [t('bucket'), c.bucket_name],
            [t('region'), c.region],
            [t('pathPrefix'), c.path_prefix],
            [t('status'), backend.status === 'disabled' ? t('disabled') : t('active')],
            [t('source'), source(backend.source)],
          ]),
        }
        if (defaultBackendId && backend.id === defaultBackendId) item.badge = t('isDefault')
        return item
      }),
    },
    {
      id: 'vector-stores',
      title: t('vectorStores'),
      empty: t('vectorStoresEmpty'),
      items: stores.map((store, index) => ({
        id: store.id || `store-${index}`,
        title: text(store.name) || text(store.engine_type),
        rows: rows([
          [t('engine'), store.engine_type],
          [t('source'), source(store.source)],
        ]),
      })),
    },
  ]
}

// ---------------------------------------------------------------------------
// Parsers (INDEXING, READ_ONLY)

export interface ParserEngineRecord {
  Name: string
  Description?: string
  FileTypes?: string[]
  Available?: boolean
  UnavailableReason?: string
}

export interface ParserNaming {
  name(engine: string): string
  description(engine: string, fallback: string): string
}

export function parserSections(
  response: { data?: readonly ParserEngineRecord[]; connected?: boolean; docreader_transport?: string } | null | undefined,
  locale: string,
  naming: ParserNaming,
  hiddenEngines: ReadonlySet<string> = new Set(),
): ReadOnlySection[] {
  const t = (key: TextKey) => readOnlyText(key, locale)
  const engines = (response?.data ?? []).filter((engine) => engine && !hiddenEngines.has(engine.Name))
  const connected = response?.connected ?? engines.length > 0
  const transport = text(response?.docreader_transport).toLowerCase() === 'http' ? 'HTTP' : 'gRPC'
  // The built-in engine is the parsing service itself: one entry, not two.
  const builtin = engines.find((engine) => engine.Name === 'builtin')
  return [
    {
      id: 'parser-service',
      title: t('parserService'),
      empty: '',
      items: [{
        id: 'builtin',
        title: naming.name('builtin'),
        rows: rows([
          [t('connection'), connected ? t('connected') : t('disconnected')],
          [t('transport'), transport],
          [t('fileTypes'), (builtin?.FileTypes ?? []).map(text).filter(Boolean).join(', ')],
          [t('description'), builtin ? naming.description('builtin', text(builtin.Description)) : ''],
        ]),
      }],
    },
    {
      id: 'parser-engines',
      title: t('parserEngines'),
      empty: t('parserEnginesEmpty'),
      items: engines.filter((engine) => engine.Name !== 'builtin').map((engine) => ({
        id: engine.Name,
        title: naming.name(engine.Name),
        rows: rows([
          [t('status'), engine.Available ? t('available')
            : [t('unavailable'), text(engine.UnavailableReason)].filter(Boolean).join(' · ')],
          [t('fileTypes'), (engine.FileTypes ?? []).map(text).filter(Boolean).join(', ')],
          [t('description'), naming.description(engine.Name, text(engine.Description))],
        ]),
      })),
    },
  ]
}
