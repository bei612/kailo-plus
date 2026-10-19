// DD-125(3): the original Huddle counts ("1 participant" / "N participants") through the shared
// catalog's plural forms.
import { useCallback } from "react";
import { platformPluralForm } from "../../i18n";
import { useLocale, useT } from "../context";

type PluralBase = "huddle.participants" | "huddle.joinActive" | "huddle.activeTooltip" | "huddle.showAllParticipants";

export function useHuddlePlural() {
  const t = useT();
  const locale = useLocale();
  return useCallback((base: PluralBase, count: number) =>
    t(`${base}.${platformPluralForm(locale, count)}`, { count }), [locale, t]);
}
