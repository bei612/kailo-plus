// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/onboarding/ui/types.ts (the profile/avatar step types). DD-125(5): the
// key-import, membership-denied, harness setup and default-config pages are not in Kailo.
export type OnboardingPage = "profile" | "avatar";

export type OnboardingActions = {
  complete: () => void;
  skipForNow: () => void;
};

/** The host's own profile read: the signed-in key and its current kind:0 fields. */
export type OnboardingProfile = {
  pubkey: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type OnboardingProfileSeed = {
  profile?: OnboardingProfile;
};

export type OnboardingProfileValues = {
  avatarUrl: string;
  displayName: string;
};

export type ProfileStepSaveRecovery = {
  canAdvanceWithoutSaving: boolean;
  canSkipForNow: boolean;
  errorMessage: string | null;
};

export type ProfileStepNameState = {
  draftValue: string;
  savedValue: string;
};

export type ProfileStepAvatarState = {
  draftUrl: string;
  savedUrl: string;
};

export type ProfileStepState = {
  avatar: ProfileStepAvatarState;
  isReadyToSubmit: boolean;
  isUploadingAvatar: boolean;
  isSaving: boolean;
  name: ProfileStepNameState;
  saveRecovery: ProfileStepSaveRecovery;
};

export type ProfileStepActions = {
  advanceWithoutSaving: () => void;
  back?: () => void;
  clearAvatarDraft: () => void;
  onUploadingChange: (isUploading: boolean) => void;
  skipForNow: () => void;
  submit: () => void;
  updateAvatarUrl: (value: string) => void;
  updateDisplayName: (value: string) => void;
};
