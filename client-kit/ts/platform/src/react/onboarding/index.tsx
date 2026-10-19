// DD-125(5) (V-SCN-142): the original first-run profile and avatar steps shared by the Web and
// Desktop hosts. Each host supplies its own-profile read (the signed-in key and whether the Relay
// has a real kind:0 for it), its existing own-profile publication and avatar upload.
import type * as React from "react";
import { OnboardingFlow, type OnboardingHost } from "./OnboardingFlow";
import { type OnboardingQueryStatus, useFirstRunOnboardingGate } from "./onboardingGate";
import type { OnboardingProfile } from "./types";

export { OnboardingFlow, createProfileUpdatePayload, resolveProfileSaveRecovery, type OnboardingHost } from "./OnboardingFlow";
export { onboardingCompletionStorageKey, useFirstRunOnboardingGate, type OnboardingGateStage, type OnboardingQueryStatus } from "./onboardingGate";
export type { OnboardingProfile } from "./types";

/** The host's own-profile read, already validated (a malformed read is an error, never "no kind:0"). */
export type OnboardingProfileRead = {
  status: OnboardingQueryStatus;
  isFetching: boolean;
  data: (OnboardingProfile & { hasProfileEvent: boolean }) | undefined;
};

/**
 * Original App onboarding stage: "blocking" until the own profile settles, the flow while the
 * signed-in key has no kind:0 and has not finished onboarding on this device, otherwise the app.
 * A failed own-profile read does not block the app (the key is unknown, as for an identity error).
 */
export function OnboardingGate({ profile, host, blocking, children }: {
  profile: OnboardingProfileRead;
  host: OnboardingHost;
  blocking: React.ReactNode;
  children: React.ReactNode;
}) {
  // A later background refetch (or its failure) never re-blocks or closes a settled gate: the
  // first settled read decides, as the original gate decided once per key.
  const currentPubkey = profile.data?.pubkey ?? null;
  const status: OnboardingQueryStatus = profile.data ? "success" : profile.status;
  const gate = useFirstRunOnboardingGate({
    currentPubkey,
    identityIsFetching: false,
    identityStatus: status,
    profileHasEvent: profile.data?.hasProfileEvent,
    profileIsFetching: profile.isFetching,
    profileStatus: status,
  });
  if (gate.stage === "blocking") return <>{blocking}</>;
  if (gate.stage === "onboarding" && profile.data && currentPubkey) {
    return <OnboardingFlow key={currentPubkey} actions={{ complete: gate.complete, skipForNow: gate.skipForNow }} host={host}
      initialProfile={{ profile: profile.data }} initialProfileDecisionSettled />;
  }
  return <>{children}</>;
}
