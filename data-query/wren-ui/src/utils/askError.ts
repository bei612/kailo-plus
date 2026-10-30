import type { KailoTextKey } from '@/utils/kailoI18n';

type AskError = {
  code?: string | null;
  message?: string | null;
  shortMessage?: string | null;
};
type AskErrorTextKeys = { title: KailoTextKey; hint: KailoTextKey };

// Asking failures the Kailo presentation explains in the user's locale. Other
// codes keep the server's original short message and message.
const ASK_ERROR_TEXT: Record<string, AskErrorTextKeys> = {
  // The model answered without any SQL; the AI service failed the task at once
  // (data-query/fork/verify/ask-empty-sql.md).
  NO_SQL_GENERATED: {
    title: 'home.noSqlGenerated',
    hint: 'home.noSqlGeneratedHint',
  },
};

export function askErrorText(
  error: AskError | null | undefined,
  t: (key: KailoTextKey) => string,
): Pick<AskError, 'shortMessage' | 'message'> {
  const keys =
    error?.code &&
    Object.prototype.hasOwnProperty.call(ASK_ERROR_TEXT, error.code)
      ? ASK_ERROR_TEXT[error.code]
      : undefined;
  if (!keys)
    return { shortMessage: error?.shortMessage, message: error?.message };
  return { shortMessage: t(keys.title), message: t(keys.hint) };
}
