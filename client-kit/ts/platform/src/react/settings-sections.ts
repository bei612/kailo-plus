// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/settings/ui/SettingsPanels.tsx
// section identifiers (the sections Kailo hosts render). Kept free of UI so route validation can
// use it without loading the settings surface.
// DD-138: "documents" and "answers" are Kailo categories whose items components contribute (07 §4.8.2);
// they are listed only when an item exists.
export type SettingsSection = "profile" | "appearance" | "notifications" | "documents" | "answers" | "shortcuts" | "community-members" | "moderation" | "custom-emoji" | "channel-templates" | "agents" | "experimental";

/** Every section a host may route to (original /settings?section=). */
export const settingsSectionValues: readonly SettingsSection[] = [
  "profile", "appearance", "notifications", "documents", "answers", "shortcuts", "community-members", "moderation", "custom-emoji", "channel-templates", "agents", "experimental",
];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && (settingsSectionValues as readonly string[]).includes(value);
}
