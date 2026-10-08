// Buzz 779af8886caae1317b4de962082429867ab61503: desktop/src/features/agents/lib/agentDescription.ts.
/** Original public-description editing cap, not a migration of existing versions. */
export const MAX_AGENT_DESCRIPTION_CHARS = 280;

/** Count Unicode scalar values, matching Rust's `str::chars().count()`. */
export function agentDescriptionCharacterCount(value: string): number {
  return Array.from(value).length;
}

/** Original paste/insert behaviour, by Unicode scalar. */
export function clampAgentDescription(value: string): string {
  return Array.from(value).slice(0, MAX_AGENT_DESCRIPTION_CHARS).join("");
}

/** Original card description; no slug, runtime key or resource-id substitute. */
export function effectiveAgentDescription(
  persona: { description?: string | null },
): string | null {
  const authored = persona.description?.trim() ?? "";
  return authored.length > 0 ? authored : null;
}
