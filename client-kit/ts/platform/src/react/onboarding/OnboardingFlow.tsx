// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/onboarding/ui/OnboardingFlow.tsx::OnboardingFlow (profile and avatar
// pages, createProfileUpdatePayload, resolveProfileSaveRecovery, back/skip/continue semantics).
// DD-125(5): only the community profile and avatar steps remain. Kailo differences, each by
// design: the membership pre-check and "membership denied" page are the platform session's job
// (a non-member never reaches this flow, DD-83); key import and the identity-lost recovery are
// identity custody (DD-75/78/79); the community-change overlay does not exist (one Community per
// Tenant, DD-01); completion does not start the Welcome kickoff (DD-125(5) exclusion). The save
// goes through the host's existing own-profile publication (`saveProfile`, Web BFF
// `identity.profile.publish`, Desktop native CLIENT writer); an unknown result keeps the same
// request and idempotency key for the next attempt (DD-81).
import * as React from "react";
import { flushSync } from "react-dom";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";

import { useUiLocale, useUiT } from "../context";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import { AvatarHostProvider, type AvatarHost } from "../profile/avatar-host";
import { EmojiBurstProvider } from "../profile/buzz/shared/ui/EmojiBurstProvider";
import { AvatarStep } from "./AvatarStep";
import { OnboardingCard } from "./OnboardingCard";
import {
  type OnboardingTransitionDirection,
} from "./OnboardingSlideTransition";
import { ProfileStep } from "./ProfileStep";
import type {
  OnboardingActions,
  OnboardingPage,
  OnboardingProfileSeed,
  OnboardingProfileValues,
  ProfileStepState,
} from "./types";

/** The host transport the two steps need; no identity or profile authority lives here. */
export type OnboardingHost = {
  /** The host's existing own-profile publication with readback (same as Settings → Profile). */
  saveProfile: (request: WebProfileUpdateRequest) => Promise<void>;
  uploadMediaBytes: AvatarHost["uploadMediaBytes"];
  rewriteMediaUrl: AvatarHost["rewriteMediaUrl"];
  performDefaultHaptic?: AvatarHost["performDefaultHaptic"];
  /** Desktop window drag region; none in the browser. */
  dragRegion?: React.ReactNode;
};

type OnboardingFlowProps = {
  actions: OnboardingActions;
  host: OnboardingHost;
  initialProfile: OnboardingProfileSeed;
  initialProfileDecisionSettled: boolean;
};

function isFallbackDisplayName(value?: string | null) {
  const normalizedValue = value?.trim().toLowerCase() ?? "";
  return (
    normalizedValue.startsWith("npub1") ||
    normalizedValue.startsWith("nostr:npub1")
  );
}

function sanitizeDisplayName(value?: string | null) {
  const trimmedValue = value?.trim() ?? "";
  return isFallbackDisplayName(trimmedValue) ? "" : trimmedValue;
}

function resolveSavedProfile({
  profile,
}: OnboardingProfileSeed): OnboardingProfileValues {
  return {
    avatarUrl: profile?.avatarUrl ?? "",
    displayName: sanitizeDisplayName(profile?.displayName),
  };
}

export function createProfileUpdatePayload({
  draftProfile,
  savedProfile,
}: {
  draftProfile: OnboardingProfileValues;
  savedProfile: OnboardingProfileValues;
}) {
  const nextDisplayName = draftProfile.displayName.trim();
  const nextAvatarUrl = draftProfile.avatarUrl.trim();
  const updatePayload: {
    avatarUrl?: string;
    displayName?: string;
  } = {};

  if (
    nextDisplayName.length > 0 &&
    nextDisplayName !== savedProfile.displayName
  ) {
    updatePayload.displayName = nextDisplayName;
  }

  if (nextAvatarUrl.length > 0 && nextAvatarUrl !== savedProfile.avatarUrl) {
    updatePayload.avatarUrl = nextAvatarUrl;
  }

  return updatePayload;
}

export function resolveProfileSaveRecovery(
  errorMessage: string | null,
  savedDisplayName: string,
): ProfileStepState["saveRecovery"] {
  return {
    canAdvanceWithoutSaving:
      errorMessage !== null && savedDisplayName.length > 0,
    canSkipForNow: errorMessage !== null && savedDisplayName.length === 0,
    errorMessage,
  };
}

function useSystemColorScheme(): "dark" | "light" {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const [colorScheme, setColorScheme] = React.useState<"dark" | "light">(read);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorScheme(mediaQuery.matches ? "dark" : "light");
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  return colorScheme;
}

export function OnboardingFlow({
  actions,
  host,
  initialProfile,
  initialProfileDecisionSettled,
}: OnboardingFlowProps) {
  const t = useUiT();
  const locale = useUiLocale();
  const { complete, skipForNow } = actions;
  const [savedProfile, setSavedProfile] = React.useState<OnboardingProfileValues>(
    () => resolveSavedProfile(initialProfile),
  );
  const [currentPage, setCurrentPage] = React.useState<OnboardingPage>("profile");
  const [profileDraft, setProfileDraft] =
    React.useState<OnboardingProfileValues>(savedProfile);
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false);
  const [isProfileAdvancePending, setIsProfileAdvancePending] =
    React.useState(false);
  const [saveError, setSaveError] = React.useState<"failed" | "unknown" | null>(null);
  const [transitionDirection, setTransitionDirection] =
    React.useState<OnboardingTransitionDirection>("forward");
  const systemColorScheme = useSystemColorScheme();
  // DD-81: an unresolved publication keeps its request (and key) until a known outcome.
  const intent = React.useRef<WebProfileUpdateRequest | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pubkey = initialProfile.profile?.pubkey ?? null;

  const resetProfileSaveError = React.useCallback(() => {
    // A pending unknown intent stays locked to its original values.
    if (intent.current === null) setSaveError(null);
  }, []);

  const updateProfileDraft = React.useCallback(
    (patch: Partial<OnboardingProfileValues>) => {
      resetProfileSaveError();
      setProfileDraft((current) => ({
        ...current,
        ...patch,
      }));
    },
    [resetProfileSaveError],
  );

  const showAvatarPage = React.useCallback(
    (direction: OnboardingTransitionDirection = "forward") => {
      setTransitionDirection(direction);
      setCurrentPage("avatar");
    },
    [],
  );

  const showProfilePage = React.useCallback(() => {
    setTransitionDirection("backward");
    setCurrentPage("profile");
  }, []);

  const saveProfileAndContinue = React.useCallback(
    async (nextPage: OnboardingPage | "complete") => {
      if (!initialProfileDecisionSettled || isProfileAdvancePending || !pubkey) {
        return;
      }
      if (profileDraft.displayName.trim().length === 0) {
        return;
      }

      flushSync(() => {
        setIsProfileAdvancePending(true);
      });

      try {
        let request: WebProfileUpdateRequest | null = intent.current;
        if (request === null) {
          const updatePayload = createProfileUpdatePayload({
            draftProfile: profileDraft,
            savedProfile,
          });
          request = Object.keys(updatePayload).length > 0
            ? Object.freeze({ idempotencyKey: newIdempotencyKey(), expectedPubkey: pubkey, ...updatePayload })
            : null;
        }

        if (request !== null) {
          const published = request;
          intent.current = published;
          try {
            await host.saveProfile(published);
          } catch (error) {
            if (!mounted.current) return;
            const unknown = isOutcomeUnknown(error);
            if (!unknown) intent.current = null;
            // Error falls through to the error banner / recovery buttons.
            setSaveError(unknown ? "unknown" : "failed");
            return;
          }
          intent.current = null;
          if (!mounted.current) return;
          setSaveError(null);
          setSavedProfile((current) => ({
            avatarUrl: published.avatarUrl ?? current.avatarUrl,
            displayName: published.displayName ?? current.displayName,
          }));
        }

        if (nextPage === "complete") {
          complete();
          return;
        }
        showAvatarPage();
      } finally {
        if (mounted.current) setIsProfileAdvancePending(false);
      }
    },
    [
      initialProfileDecisionSettled,
      isProfileAdvancePending,
      profileDraft,
      pubkey,
      savedProfile,
      complete,
      host,
      showAvatarPage,
    ],
  );

  const updateDisplayNameDraft = React.useCallback(
    (value: string) => {
      updateProfileDraft({ displayName: value });
    },
    [updateProfileDraft],
  );

  const updateAvatarUrlDraft = React.useCallback(
    (value: string) => {
      updateProfileDraft({ avatarUrl: value });
    },
    [updateProfileDraft],
  );

  const resetAvatarDraft = React.useCallback(() => {
    updateProfileDraft({ avatarUrl: savedProfile.avatarUrl });
  }, [savedProfile.avatarUrl, updateProfileDraft]);

  const advanceFromProfileWithoutSaving = React.useCallback(() => {
    if (intent.current === null) setSaveError(null);
    setProfileDraft((current) => ({
      ...current,
      displayName: savedProfile.displayName,
    }));
    showAvatarPage();
  }, [savedProfile.displayName, showAvatarPage]);

  const saveErrorMessage = saveError === "unknown" ? t("platform.profile.unknown")
    : saveError === "failed" ? t("platform.profile.failed") : null;
  const profileStepState: ProfileStepState = {
    avatar: {
      draftUrl: profileDraft.avatarUrl,
      savedUrl: savedProfile.avatarUrl,
    },
    isReadyToSubmit: initialProfileDecisionSettled,
    isUploadingAvatar,
    isSaving: isProfileAdvancePending,
    name: {
      draftValue: profileDraft.displayName,
      savedValue: savedProfile.displayName,
    },
    saveRecovery: resolveProfileSaveRecovery(
      saveErrorMessage,
      savedProfile.displayName,
    ),
  };
  const avatarStepState: ProfileStepState = {
    ...profileStepState,
    saveRecovery: saveErrorMessage
      ? {
          canAdvanceWithoutSaving: true,
          canSkipForNow: false,
          errorMessage: saveErrorMessage,
        }
      : profileStepState.saveRecovery,
  };
  const activeSteps: OnboardingPage[] = ["profile", "avatar"];
  const currentStep = activeSteps.indexOf(currentPage) + 1;

  // The original profile-page Back opened the community change overlay, which Kailo does not
  // have (DD-01); the avatar page goes back to the profile page.
  const chromeBackAction =
    currentPage === "avatar"
      ? {
          disabled:
            avatarStepState.isSaving || avatarStepState.isUploadingAvatar,
          onClick: showProfilePage,
        }
      : undefined;

  const avatarHost = React.useMemo<AvatarHost>(() => ({
    locale,
    uploadMediaBytes: host.uploadMediaBytes,
    rewriteMediaUrl: host.rewriteMediaUrl,
    performDefaultHaptic: host.performDefaultHaptic ?? (() => {}),
  }), [host.performDefaultHaptic, host.rewriteMediaUrl, host.uploadMediaBytes, locale]);

  return (
    <AvatarHostProvider value={avatarHost}>
      <EmojiBurstProvider>
        <OnboardingCard
          allowWideContent={currentPage === "avatar"}
          backAction={chromeBackAction}
          current={currentStep}
          dragRegion={host.dragRegion}
          stableWideWidth={currentPage === "avatar"}
          systemColorScheme={systemColorScheme}
          testId="onboarding-gate"
          total={activeSteps.length}
        >
          <div className="relative flex w-full max-w-none flex-col items-stretch text-left">
            {currentPage === "profile" ? (
              <ProfileStep
                actions={{
                  advanceWithoutSaving: advanceFromProfileWithoutSaving,
                  clearAvatarDraft: resetAvatarDraft,
                  onUploadingChange: setIsUploadingAvatar,
                  skipForNow,
                  submit: () => {
                    void saveProfileAndContinue("avatar");
                  },
                  updateAvatarUrl: updateAvatarUrlDraft,
                  updateDisplayName: updateDisplayNameDraft,
                }}
                direction={transitionDirection}
                state={profileStepState}
              />
            ) : (
              <AvatarStep
                actions={{
                  advanceWithoutSaving: complete,
                  back: showProfilePage,
                  onUploadingChange: setIsUploadingAvatar,
                  skipForNow,
                  submit: () => {
                    void saveProfileAndContinue("complete");
                  },
                  updateAvatarUrl: updateAvatarUrlDraft,
                }}
                direction={transitionDirection}
                showAlwaysSkip={true}
                showBack={false}
                state={avatarStepState}
              />
            )}
          </div>
        </OnboardingCard>
      </EmojiBurstProvider>
    </AvatarHostProvider>
  );
}
