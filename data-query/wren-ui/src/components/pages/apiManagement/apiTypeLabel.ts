import { ApiType } from '@/apollo/client/graphql/__types__';
import { kailoText, KailoTextKey } from '@/utils/kailoI18n';

// DD-152 (20 §13.8): API types as Kailo wording in both locales; the raw
// endpoint name stays available in the request payload.
const API_TYPE_KEYS: Record<ApiType, KailoTextKey> = {
  [ApiType.ASK]: 'knowledge.apiTypeAsk',
  [ApiType.STREAM_ASK]: 'knowledge.apiTypeStreamAsk',
  [ApiType.GENERATE_SQL]: 'knowledge.apiTypeGenerateSql',
  [ApiType.STREAM_GENERATE_SQL]: 'knowledge.apiTypeStreamGenerateSql',
  [ApiType.RUN_SQL]: 'knowledge.apiTypeRunSql',
  [ApiType.GENERATE_SUMMARY]: 'knowledge.apiTypeGenerateSummary',
  [ApiType.GENERATE_VEGA_CHART]: 'knowledge.apiTypeGenerateChart',
  [ApiType.GET_MODELS]: 'knowledge.apiTypeGetModels',
  [ApiType.GET_INSTRUCTIONS]: 'knowledge.apiTypeGetInstructions',
  [ApiType.CREATE_INSTRUCTION]: 'knowledge.apiTypeCreateInstruction',
  [ApiType.UPDATE_INSTRUCTION]: 'knowledge.apiTypeUpdateInstruction',
  [ApiType.DELETE_INSTRUCTION]: 'knowledge.apiTypeDeleteInstruction',
  [ApiType.GET_SQL_PAIRS]: 'knowledge.apiTypeGetSqlPairs',
  [ApiType.CREATE_SQL_PAIR]: 'knowledge.apiTypeCreateSqlPair',
  [ApiType.UPDATE_SQL_PAIR]: 'knowledge.apiTypeUpdateSqlPair',
  [ApiType.DELETE_SQL_PAIR]: 'knowledge.apiTypeDeleteSqlPair',
};

export function apiTypeLabel(
  locale: string | undefined,
  apiType: ApiType | null | undefined,
): string {
  if (!apiType) return '-';
  const key = API_TYPE_KEYS[apiType];
  return key ? kailoText(locale, key) : apiType.toLowerCase();
}
