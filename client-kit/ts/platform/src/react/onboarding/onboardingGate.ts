// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/onboarding/hooks.ts::useFirstRunOnboardingGate (per-key completion flag,
// "a real kind:0 for this key skips onboarding", skip-for-now closes it for this run only).
// DD-125(5): the profile/avatar steps open when the signed-in key has no kind:0. The original
// shared-identity worktree fast path, forced fresh onboarding, identity-lost reopen and the
// Welcome starter channels are not part of Kailo (DD-75/78/79 and the Welcome exclusion).
import * as React from "react";

const ONBOARDING_COMPLETION_STORAGE_KEY = "buzz-onboarding-complete.v1";
export type OnboardingGateStage = "blocking" | "onboarding" | "ready";
export type OnboardingQueryStatus = "pending" | "success" | "error";

type OnboardingGateState = {
  currentPubkey: string | null;
  hasCompletedCurrentPubkey: boolean;
  hasSettledCurrentPubkey: boolean;
  isOpen: boolean;
};

export function onboardingCompletionStorageKey(pubkey: string) {
  return `${ONBOARDING_COMPLETION_STORAGE_KEY}:${pubkey}`;
}

function readOnboardingCompletion(pubkey: string | null) {
  if (typeof window === "undefined" || !pubkey) {
    return false;
  }
  try {
    return (
      window.localStorage.getItem(onboardingCompletionStorageKey(pubkey)) ===
      "true"
    );
  } catch {
    return false;
  }
}

function writeOnboardingCompletion(pubkey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(onboardingCompletionStorageKey(pubkey), "true");
  } catch {
    // A device that cannot persist the flag asks again next run, as on a fresh device.
  }
}

function createOnboardingGateState(pubkey: string | null): OnboardingGateState {
  const hasCompletedCurrentPubkey = readOnboardingCompletion(pubkey);

  return {
    currentPubkey: pubkey,
    hasCompletedCurrentPubkey,
    hasSettledCurrentPubkey: hasCompletedCurrentPubkey,
    isOpen: false,
  };
}

function resolveActiveGateState(
  gateState: OnboardingGateState,
  currentPubkey: string | null,
) {
  return gateState.currentPubkey === currentPubkey
    ? gateState
    : createOnboardingGateState(currentPubkey);
}

function updateActiveGateState(
  gateState: OnboardingGateState,
  currentPubkey: string | null,
  update: (activeGateState: OnboardingGateState) => OnboardingGateState,
) {
  return update(resolveActiveGateState(gateState, currentPubkey));
}

function isSettledQueryStatus(status: OnboardingQueryStatus) {
  return status === "success" || status === "error";
}

function resolveOnboardingGateStage({
  currentPubkey,
  gateState,
  identityIsFetching,
  identityStatus,
}: {
  currentPubkey: string | null;
  gateState: OnboardingGateState;
  identityIsFetching: boolean;
  identityStatus: OnboardingQueryStatus;
}): OnboardingGateStage {
  const isBlockingCurrentPubkey =
    currentPubkey !== null &&
    !gateState.hasCompletedCurrentPubkey &&
    (gateState.isOpen || !gateState.hasSettledCurrentPubkey);

  if (gateState.isOpen) {
    return "onboarding";
  }

  if (
    identityIsFetching ||
    !isSettledQueryStatus(identityStatus) ||
    isBlockingCurrentPubkey
  ) {
    return "blocking";
  }

  return "ready";
}

/**
 * `currentPubkey` is the signed-in key (Web: the SERVER key the BFF reads the own profile for;
 * Desktop: this device's CLIENT key). `profileHasEvent` is whether the Relay returned a real
 * kind:0 for it.
 */
export function useFirstRunOnboardingGate({
  currentPubkey,
  identityIsFetching,
  identityStatus,
  profileHasEvent,
  profileIsFetching,
  profileStatus,
}: {
  currentPubkey: string | null;
  identityIsFetching: boolean;
  identityStatus: OnboardingQueryStatus;
  profileHasEvent: boolean | undefined;
  profileIsFetching: boolean;
  profileStatus: OnboardingQueryStatus;
}) {
  const [gateState, setGateState] = React.useState<OnboardingGateState>(() =>
    createOnboardingGateState(currentPubkey),
  );
  const activeGateState = resolveActiveGateState(gateState, currentPubkey);
  const { hasSettledCurrentPubkey } = activeGateState;

  React.useEffect(() => {
    setGateState((current) =>
      current.currentPubkey === currentPubkey
        ? current
        : createOnboardingGateState(currentPubkey),
    );
  }, [currentPubkey]);

  React.useEffect(() => {
    if (hasSettledCurrentPubkey || !currentPubkey) {
      return;
    }

    if (identityStatus === "error") {
      setGateState((current) =>
        updateActiveGateState(current, currentPubkey, (activeState) => ({
          ...activeState,
          hasSettledCurrentPubkey: true,
        })),
      );
      return;
    }

    if (identityStatus !== "success") {
      return;
    }

    if (!isSettledQueryStatus(profileStatus) || profileIsFetching) {
      return;
    }

    // If the relay has a real kind:0 metadata event for this pubkey, the user
    // has previously completed onboarding (possibly on another device). Skip
    // the onboarding flow and mark it as complete. A missing event always
    // shows onboarding regardless of display_name.
    const hasExistingProfile =
      profileStatus === "success" && profileHasEvent === true;

    setGateState((current) =>
      updateActiveGateState(current, currentPubkey, (activeState) => {
        const alreadyOnboarded =
          activeState.hasCompletedCurrentPubkey ||
          readOnboardingCompletion(currentPubkey) ||
          hasExistingProfile;
        if (alreadyOnboarded) {
          writeOnboardingCompletion(currentPubkey);
        }
        return {
          ...activeState,
          hasCompletedCurrentPubkey: alreadyOnboarded,
          hasSettledCurrentPubkey: true,
          isOpen: !alreadyOnboarded,
        };
      }),
    );
  }, [
    currentPubkey,
    hasSettledCurrentPubkey,
    identityStatus,
    profileHasEvent,
    profileIsFetching,
    profileStatus,
  ]);

  const skipForNow = React.useCallback(() => {
    setGateState((current) =>
      updateActiveGateState(current, currentPubkey, (activeState) => ({
        ...activeState,
        hasSettledCurrentPubkey: true,
        isOpen: false,
      })),
    );
  }, [currentPubkey]);

  const complete = React.useCallback(() => {
    if (currentPubkey) {
      writeOnboardingCompletion(currentPubkey);
    }

    setGateState({
      currentPubkey,
      hasCompletedCurrentPubkey: true,
      hasSettledCurrentPubkey: true,
      isOpen: false,
    });
  }, [currentPubkey]);

  return {
    complete,
    skipForNow,
    stage: resolveOnboardingGateStage({
      currentPubkey,
      gateState: activeGateState,
      identityIsFetching,
      identityStatus,
    }),
  };
}
