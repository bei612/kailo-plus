// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/catalogOwnerLabel.ts;
// the owner is a Kailo Principal resolved through the same-Tenant people directory (no Relay
// profile lookup). Falls back to the original "Community member" label.
import type { Translate } from "../context";

export function resolveCatalogOwnerLabel(
  t: Translate,
  ownerPrincipalId: string,
  currentPrincipalId: string | undefined,
  names: ReadonlyMap<string, string> | null,
): string {
  if (currentPrincipalId !== undefined && ownerPrincipalId === currentPrincipalId) return t("agentCatalog.addedByYou");
  return names?.get(ownerPrincipalId)?.trim() || t("agentCatalog.communityMember");
}
