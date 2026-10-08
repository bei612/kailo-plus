import { ProjectLanguage } from '@/apollo/client/graphql/__types__';

export const getNativeWriteText = (locale?: string) =>
  locale === 'en'
    ? {
        unknown:
          'The original write outcome is unconfirmed. Submit again only to check the recorded object; the write will not be repeated. Without its reference, keep this outcome unresolved.',
        unresolved:
          'The original write outcome is unconfirmed. No reliable native reference is available; this form will not submit the write again. Keep it unresolved until reconciliation.',
        scopeError:
          'The current identity or binding could not be verified. No new write was submitted.',
        storageError:
          'The original write identifier could not be retained. No new write was submitted.',
      }
    : {
        unknown:
          '原写入结果尚未核验。再次提交只检查已记录的原生对象，不重复写入；没有原引用时保留结果不明。',
        unresolved:
          '原写入结果尚未核验，且没有可靠的原生引用；当前表单不会再次提交写入，请保留结果不明并进行对账。',
        scopeError: '无法核验当前身份或绑定，未发起新的写入。',
        storageError: '无法保存原写入标识，未发起新的写入。',
      };

// Native UI locale is separate from ProjectLanguage (the AI's answer language).
// Only the existing governed preview controls consume these messages.
export const getQueryPreviewText = (locale?: string) =>
  locale === 'en'
    ? {
        results: 'View results',
        preview: 'Preview data',
        check: 'Check query',
        storageError:
          'Cannot retain the query identifier; nothing was submitted.',
        scopeError:
          'The current query identity could not be verified. Nothing was submitted.',
        pending:
          'The original query is pending; check again without running it twice.',
        unknown:
          'The query result could not be verified. Check the original query without running it twice.',
        ended: 'The original query ended without a successful result.',
        denied: 'Query execution was not authorized.',
        referenceTitle: 'Kailo governed query reference',
        referenceDescription:
          'Select this existing view and a row limit. Export only a frozen native reference; submit it from Kailo under your own platform session and approvals. No query runs here.',
        rowLimit: 'Query row limit',
        exportReference: 'Export reference',
        frozenReference: 'Frozen query reference',
        referenceError:
          'The native reference could not be verified. Nothing was executed.',
      }
    : {
        results: '查看结果',
        preview: '预览数据',
        check: '检查原查询',
        storageError: '无法保存查询标识，未发起查询。',
        scopeError: '无法核验当前查询身份，未发起查询。',
        pending: '原查询尚未完成；再次检查不会重复执行。',
        unknown: '无法核验查询结果；检查原查询，不重复执行。',
        ended: '原查询已结束，未返回成功结果。',
        denied: '查询未获准执行。',
        referenceTitle: 'Kailo 受治理查询引用',
        referenceDescription:
          '选择现有视图及行数上限，仅导出固定的原生引用；随后在 Kailo 中以自己的身份提交并完成所需审批。此处不执行查询。',
        rowLimit: '查询行数上限',
        exportReference: '导出引用',
        frozenReference: '固定的查询引用',
        referenceError: '无法核验原生引用，未执行任何查询。',
      };

export const getLanguageText = (language: ProjectLanguage) =>
  ({
    [ProjectLanguage.EN]: 'English',
    [ProjectLanguage.ES]: 'Spanish',
    [ProjectLanguage.FR]: 'French',
    [ProjectLanguage.ZH_TW]: 'Traditional Chinese',
    [ProjectLanguage.ZH_CN]: 'Simplified Chinese',
    [ProjectLanguage.DE]: 'German',
    [ProjectLanguage.PT]: 'Portuguese',
    [ProjectLanguage.RU]: 'Russian',
    [ProjectLanguage.JA]: 'Japanese',
    [ProjectLanguage.KO]: 'Korean',
    [ProjectLanguage.IT]: 'Italian',
    [ProjectLanguage.FA_IR]: 'Persian',
    [ProjectLanguage.AR]: 'Arabic',
    [ProjectLanguage.NL]: 'Dutch',
    [ProjectLanguage.AZ_AZ]: 'Azerbaijani',
    [ProjectLanguage.TR]: 'Turkish',
  })[language] || language;
