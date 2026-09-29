import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  communityThemeApplyExpectation,
  communityThemePersistenceAction,
  communityThemeScopeFallback,
  hasMigratedCommunityTheme,
  markCommunityThemeMigrated,
  readCommunityThemePreference,
  sameCommunityThemePreference,
  writeCommunityThemePreference,
  type CommunityThemePreference,
} from "./communityThemePreference";
import { useTheme } from "./ThemeProvider";

/**
 * Scopes the appearance preference to the active identity and community:
 * switching community applies that community's stored appearance, and
 * appearance edits are stored for the active community.
 */
export function CommunityThemeController() {
  const activeCommunity = useActiveCommunity();
  const identity = useIdentityQuery();
  const theme = useTheme();
  const pubkey = identity.data?.pubkey;
  const relayUrl = activeCommunity.relayUrl;
  const expectedAppliedRef = useRef<CommunityThemePreference | null>(null);
  const initialPreferenceRef = useRef<CommunityThemePreference>({
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  });

  const currentPreferenceRef = useRef<CommunityThemePreference>({
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  });
  currentPreferenceRef.current = {
    version: 1,
    theme: theme.selectedThemeName as CommunityThemePreference["theme"],
    accent: theme.accentColor,
    followSystem: theme.followSystem,
  };

  const applyPreference = useCallback(
    (preference: CommunityThemePreference) => {
      expectedAppliedRef.current = communityThemeApplyExpectation(
        preference,
        currentPreferenceRef.current,
      );
      theme.applyAppearance(preference);
    },
    [theme.applyAppearance],
  );

  useLayoutEffect(() => {
    if (!pubkey || !relayUrl) return;
    // Preserve the user's existing global appearance the first time a
    // community is scoped. Later communities without a stored preference use
    // the stable default so the previous community never leaks.
    const fallback = communityThemeScopeFallback(
      hasMigratedCommunityTheme(pubkey),
      initialPreferenceRef.current,
    );
    const scopedPreference =
      readCommunityThemePreference(pubkey, relayUrl) ?? fallback;
    applyPreference(scopedPreference);
    markCommunityThemeMigrated(pubkey);
    // Initialization is programmatic even when the provider already exposes
    // this exact value. Mark it after applyPreference so its no-op optimization
    // cannot make the persistence effect mistake the fallback for a user edit.
    expectedAppliedRef.current = communityThemeApplyExpectation(
      scopedPreference,
      currentPreferenceRef.current,
      true,
    );
  }, [pubkey, relayUrl, applyPreference]);

  useEffect(() => {
    if (!pubkey || !relayUrl) return;
    const preference: CommunityThemePreference = {
      version: 1,
      theme: theme.selectedThemeName as CommunityThemePreference["theme"],
      accent: theme.accentColor,
      followSystem: theme.followSystem,
    };
    const persistenceAction = communityThemePersistenceAction(
      expectedAppliedRef.current,
      preference,
    );
    if (persistenceAction === "defer") return;
    if (persistenceAction === "acknowledge") {
      expectedAppliedRef.current = null;
      return;
    }
    const stored = readCommunityThemePreference(pubkey, relayUrl);
    if (stored && sameCommunityThemePreference(stored, preference)) return;
    writeCommunityThemePreference(pubkey, relayUrl, preference);
  }, [
    pubkey,
    relayUrl,
    theme.selectedThemeName,
    theme.accentColor,
    theme.followSystem,
  ]);

  return null;
}
