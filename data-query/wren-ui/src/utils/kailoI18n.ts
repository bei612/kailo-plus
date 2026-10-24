import Router, { useRouter } from 'next/router';
import { presentation } from './kailoEmbed';
import homeMessages from './i18n/home';
import modelingMessages from './i18n/modeling';
import knowledgeMessages from './i18n/knowledge';
import setupMessages from './i18n/setup';

// DD-133 §1/§4, DD-152 (20 §13.8): every visible string follows the Kailo
// locale (zh-CN default, en). The component name is fixed by DD-133
// (问数 / Data Q&A); the deployment display name comes from
// PLATFORM_DISPLAY_NAME. Shell keys live here; each product area keeps its
// strings in ./i18n/<area>.ts with area-prefixed keys ("home.ask"), merged
// below into one dictionary per locale.
const shell = {
  'zh-CN': {
    componentName: '问数',
    navHome: '问答',
    navModeling: '建模',
    navKnowledge: '知识',
    navApi: 'API',
    settings: '设置',
    threads: '对话',
    newThread: '新建',
    // DD-152 (20 §13.2): page header Kailo renders for this component.
    newConversation: '新对话',
    newConversationAction: '新建对话',
    share: '分享',
    deployModels: '发布模型',
    deploying: '正在发布…',
    deploySynced: '已发布',
    deployPending: '有未发布的更改',
    deployFailed: '模型未能发布',
    deployFailedHint: '请查看日志了解原因。',
    dataSourceSettings: '数据源设置',
    addQuestionSqlPair: '添加问答对',
    addInstruction: '添加指令',
    actionFailed: '操作未完成',
    // DD-152 (20 §13.8 确认): destructive actions are questions.
    cancel: '取消',
    confirm: '确定',
    delete: '删除',
    deleteTitle: '删除{item}？',
    deleteNamedTitle: '删除{item}「{name}」？',
    deleteDescription: '删除后无法恢复。',
    deleteThreadDescription: '对话中的全部问答记录将被永久删除，且无法恢复。',
    itemThread: '对话',
    itemView: '视图',
    itemModel: '模型',
    itemCalculatedField: '计算字段',
    itemRelationship: '关系',
    itemDashboardItem: '看板项',
    itemQuestionSqlPair: '问答对',
    itemInstruction: '指令',
    dashboard: '看板',
    questionSqlPairs: '问答对',
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
    noData: '暂无数据',
    dataSource: '数据源',
    project: '项目',
    projectLanguage: '回答语言',
    projectLanguageHint: '该设置决定 AI 回答所用的语言。',
    selectLanguage: '选择语言',
    save: '保存',
    resetProject: '重置项目',
    reset: '重置',
    resetConfirm: '重置项目？',
    resetHint: '重置会删除当前全部设置与记录，包括建模页面与问答对话。',
    languageUpdated: '回答语言已更新',
    sqlLabel: 'SQL',
    notFoundTitle: '页面不存在',
    notFoundDescription: '该链接可能已失效，或页面已被移动。',
    backToHome: '返回问答',
    // DD-138(4), `07` §4.8.3: share with Kailo members (Kailo inbox).
    shareWithMember: '分享给成员',
    shareThreadTitle: '把对话分享给成员',
    shareDashboardTitle: '把团队看板分享给成员',
    shareHint: '所选成员会在 Kailo 收件箱收到通知，并可从通知直接打开。',
    shareMembersPlaceholder: '选择成员',
    shareNoMembers: '没有可以分享的其他成员',
    shareSubmit: '分享',
    shareCancel: '取消',
    shareDone: '已通知所选成员',
    shareFailed: '分享未完成，请稍后重试。',
  },
  en: {
    componentName: 'Data Q&A',
    navHome: 'Ask',
    navModeling: 'Modeling',
    navKnowledge: 'Knowledge',
    navApi: 'API',
    settings: 'Settings',
    threads: 'Conversations',
    newThread: 'New',
    // DD-152 (20 §13.2): page header Kailo renders for this component.
    newConversation: 'New conversation',
    newConversationAction: 'New conversation',
    share: 'Share',
    deployModels: 'Deploy models',
    deploying: 'Deploying…',
    deploySynced: 'Deployed',
    deployPending: 'Undeployed changes',
    deployFailed: 'Models were not deployed',
    deployFailedHint: 'Check the log for the reason.',
    dataSourceSettings: 'Data source settings',
    addQuestionSqlPair: 'Add question-SQL pair',
    addInstruction: 'Add instruction',
    actionFailed: 'Action did not complete',
    // DD-152 (20 §13.8 确认): destructive actions are questions.
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    deleteTitle: 'Delete this {item}?',
    deleteNamedTitle: 'Delete {item} "{name}"?',
    deleteDescription: 'This cannot be undone.',
    deleteThreadDescription:
      'Every question and answer in this conversation is deleted permanently.',
    itemThread: 'conversation',
    itemView: 'view',
    itemModel: 'model',
    itemCalculatedField: 'calculated field',
    itemRelationship: 'relationship',
    itemDashboardItem: 'dashboard item',
    itemQuestionSqlPair: 'question-SQL pair',
    itemInstruction: 'instruction',
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
    loading: 'Loading…',
    noData: 'No data',
    dataSource: 'Data source',
    project: 'Project',
    projectLanguage: 'Answer language',
    projectLanguageHint:
      'This setting affects the language in which the AI responds to you.',
    selectLanguage: 'Select a language',
    save: 'Save',
    resetProject: 'Reset project',
    reset: 'Reset',
    resetConfirm: 'Reset the project?',
    resetHint:
      'Resetting deletes all current settings and records, including the modeling page and the threads.',
    languageUpdated: 'Answer language updated',
    sqlLabel: 'SQL',
    notFoundTitle: 'Page not found',
    notFoundDescription: 'The link may be outdated, or the page has moved.',
    backToHome: 'Back to Ask',
    // DD-138(4), `07` §4.8.3: share with Kailo members (Kailo inbox).
    shareWithMember: 'Share with member',
    shareThreadTitle: 'Share this thread with members',
    shareDashboardTitle: 'Share the team dashboard with members',
    shareHint:
      'The selected members are notified in their Kailo inbox and can open it from there.',
    shareMembersPlaceholder: 'Select members',
    shareNoMembers: 'There are no other members to share with',
    shareSubmit: 'Share',
    shareCancel: 'Cancel',
    shareDone: 'Selected members notified',
    shareFailed: 'Sharing did not complete. Please try again later.',
  },
} as const;

const messages = {
  'zh-CN': {
    ...shell['zh-CN'],
    ...homeMessages['zh-CN'],
    ...modelingMessages['zh-CN'],
    ...knowledgeMessages['zh-CN'],
    ...setupMessages['zh-CN'],
  },
  en: {
    ...shell.en,
    ...homeMessages.en,
    ...modelingMessages.en,
    ...knowledgeMessages.en,
    ...setupMessages.en,
  },
};

export type KailoTextKey = keyof (typeof messages)['en'];
export type KailoTextVars = Record<string, string | number>;

// "{name}" placeholders are replaced from vars; unknown names stay visible.
export function kailoText(
  locale: string | undefined,
  key: KailoTextKey,
  vars?: KailoTextVars,
): string {
  const text: string = (locale === 'en' ? messages.en : messages['zh-CN'])[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

// The locale outside React (Apollo error handlers, toasts from hooks): the
// Next router once it exists, else the Kailo presentation locale.
export function currentLocale(): string {
  try {
    if (Router.router?.locale) return Router.router.locale;
  } catch {
    // no router instance yet (unit tests, early module code)
  }
  return presentation().locale;
}

// Non-hook accessor for code that runs outside components.
export function kailoT(key: KailoTextKey, vars?: KailoTextVars) {
  return kailoText(currentLocale(), key, vars);
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

// The Next locale, or the Kailo one where no router is mounted (component
// renders outside a page, unit tests).
export function useKailoLocale(): string {
  let locale: string | undefined;
  try {
    // Called on every render (the try is not a condition); Next throws only
    // when no router is mounted.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    locale = useRouter()?.locale;
  } catch {
    locale = undefined;
  }
  return locale || presentation().locale;
}

export default function useKailoText() {
  const locale = useKailoLocale();
  return (key: KailoTextKey, vars?: KailoTextVars) =>
    kailoText(locale, key, vars);
}
