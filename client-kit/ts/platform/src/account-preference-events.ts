// DD-164(7): the account preference edit channel. The theme, language and
// component preference stores announce a user's own edit here; the Core sync
// (account-preferences.ts) listens and writes Core. Values Core supplied are
// applied inside `applyingAccountPreferences`, so they are never echoed back.
// No imports: i18n.ts, theme/use-appearance.ts and component preferences all use it.

export type AccountPreferenceLocale = "zh-CN" | "en";

/** One user edit; only the changed fields. A null component value removes the key. */
export interface AccountPreferenceEdit {
  theme?: string;
  accent?: string;
  followSystem?: boolean;
  locale?: AccountPreferenceLocale;
  componentPreferences?: Record<string, boolean | string | null>;
}

export const ACCOUNT_PREFERENCE_EDIT_EVENT = "kailo:account-preference-edit";
/** Core supplied appearance values; mounted appearance hooks adopt them without echoing. */
export const ACCOUNT_APPEARANCE_APPLY_EVENT = "kailo:account-appearance-apply";

export interface AccountAppearanceApply { theme?: string; accent?: string; followSystem?: boolean }

let applying = 0;

/** True while values that came from Core are being written into the local stores. */
export function applyingAccountPreferences(): boolean {
  return applying > 0;
}

/** Runs `apply` as an application of Core values: edits it causes are not reported. */
export function asAccountPreferenceApply<T>(apply: () => T): T {
  applying += 1;
  try { return apply(); } finally { applying -= 1; }
}

/** A user's own edit of an account preference (no-op while Core values are applied). */
export function noteAccountPreferenceEdit(edit: AccountPreferenceEdit): void {
  if (applying > 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AccountPreferenceEdit>(ACCOUNT_PREFERENCE_EDIT_EVENT, { detail: edit }));
}
