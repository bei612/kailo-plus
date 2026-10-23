import { useRouter } from 'next/router';

// DD-133 §1/§4: product naming and the shared page shell follow the Kailo
// locale. The component name is fixed by DD-133 (问数 / Data Q&A); the
// deployment display name comes from PLATFORM_DISPLAY_NAME.
const messages = {
  'zh-CN': {
    componentName: '问数',
    navHome: '问答',
    navModeling: '建模',
    navKnowledge: '知识',
    navApi: 'API',
    settings: '设置',
    threads: '对话',
    newThread: '新建',
    dashboard: '看板',
    questionSqlPairs: '问题与 SQL',
    instructions: '指令',
    apiHistory: 'API 记录',
    owner: '创建者',
    ownerUnknown: '—',
    adminOnly: '仅 Kailo 租户管理员可以修改',
    adminRequiredTitle: '需要管理员',
    adminRequiredOnboarding:
      '数据源尚未连接。请联系 Kailo 租户管理员完成数据连接与建模。',
    askAboutData: '了解你的数据',
    tryAsking: '可以试着这样提问',
    loading: '加载中…',
    dataSource: '数据源',
    project: '项目',
    projectLanguage: '回答语言',
    projectLanguageHint: '该设置决定 AI 回答所用的语言。',
    selectLanguage: '选择语言',
    save: '保存',
    resetProject: '重置项目',
    reset: '重置',
    resetConfirm: '确定要重置吗？',
    resetHint: '重置会删除当前全部设置与记录，包括建模页面与问答对话。',
    languageUpdated: '回答语言已更新。',
    sqlLabel: 'SQL',
    notFoundTitle: '页面不存在',
    notFoundDescription: '该链接可能已失效，或页面已被移动。',
    backToHome: '返回问答',
  },
  en: {
    componentName: 'Data Q&A',
    navHome: 'Ask',
    navModeling: 'Modeling',
    navKnowledge: 'Knowledge',
    navApi: 'API',
    settings: 'Settings',
    threads: 'Threads',
    newThread: 'New',
    dashboard: 'Dashboard',
    questionSqlPairs: 'Question-SQL pairs',
    instructions: 'Instructions',
    apiHistory: 'API history',
    owner: 'Created by',
    ownerUnknown: '—',
    adminOnly: 'Only a Kailo Tenant administrator can change this',
    adminRequiredTitle: 'Administrator required',
    adminRequiredOnboarding:
      'No data source is connected yet. Ask a Kailo Tenant administrator to connect and model the data.',
    askAboutData: 'Know more about your data',
    tryAsking: 'Try asking some of the following questions',
    loading: 'Loading...',
    dataSource: 'Data source',
    project: 'Project',
    projectLanguage: 'Answer language',
    projectLanguageHint:
      'This setting affects the language in which the AI responds to you.',
    selectLanguage: 'Select a language',
    save: 'Save',
    resetProject: 'Reset project',
    reset: 'Reset',
    resetConfirm: 'Are you sure you want to reset?',
    resetHint:
      'Resetting deletes all current settings and records, including the modeling page and the threads.',
    languageUpdated: 'Successfully updated the answer language.',
    sqlLabel: 'SQL',
    notFoundTitle: 'Page not found',
    notFoundDescription: 'The link may be outdated, or the page has moved.',
    backToHome: 'Back to Ask',
  },
} as const;

export type KailoTextKey = keyof (typeof messages)['en'];

export function kailoText(locale: string | undefined, key: KailoTextKey) {
  return (locale === 'en' ? messages.en : messages['zh-CN'])[key];
}

// "<deployment display name> 问数" / "<deployment display name> Data Q&A".
export function kailoProductTitle(
  locale: string | undefined,
  displayName: string | null | undefined,
) {
  const component = kailoText(locale, 'componentName');
  const name = displayName?.trim();
  return name ? `${name} ${component}` : component;
}

export default function useKailoText() {
  const { locale } = useRouter();
  return (key: KailoTextKey) => kailoText(locale, key);
}
