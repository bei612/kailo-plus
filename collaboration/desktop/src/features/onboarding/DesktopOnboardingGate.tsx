// DD-125(5) (V-SCN-142): the Desktop host of the original first-run profile and avatar steps
// (Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/onboarding/hooks.ts
// useAppOnboardingState and App.tsx's onboarding stage). The own profile is this device's
// CLIENT key read; the steps open while that key has no kind:0 (`hasProfileEvent`). Saving is the
// same native CLIENT writer as Settings → Profile; no identity, community or Welcome step.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { OnboardingGate, type OnboardingHost, type OnboardingProfileRead } from "@client-kit/platform/react/onboarding";
import { TransportError } from "@client-kit/platform/transport";
import { useProfileQuery, useUpdateProfileMutation } from "@/features/profile/hooks";
import { useActiveCommunity, useNativeSession } from "@/features/platform/activeCommunity";
import { uploadProfileAvatar } from "@/shared/api/tauriProfiles";
import { performDefaultHaptic } from "@/shared/lib/haptics";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

export function DesktopOnboardingGate({ blocking, children }: { blocking: ReactNode; children: ReactNode }) {
  const community = useActiveCommunity();
  const session = useNativeSession();
  const profile = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const saveProfile = mutation.mutateAsync;
  const owner = useMemo(() => ({ active: true }), [community.id, community.relayUrl, session.devicePubkey]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  const own = profile.data && profile.data.pubkey === session.devicePubkey ? profile.data : undefined;
  const read: OnboardingProfileRead = {
    status: profile.isPending ? "pending" : own ? "success" : "error",
    isFetching: profile.isFetching,
    data: own ? { pubkey: own.pubkey, displayName: own.displayName, avatarUrl: own.avatarUrl, hasProfileEvent: own.hasProfileEvent } : undefined,
  };
  const relayUrl = community.relayUrl;
  const devicePubkey = session.devicePubkey;
  const host = useMemo<OnboardingHost>(() => ({
    saveProfile: async (request) => { await saveProfile(request); },
    uploadMediaBytes: async (bytes: number[]) => {
      // Never register another Community's receipt in the shared presentation store.
      if (!owner.active || currentOwner.current !== owner) throw new TransportError("Profile view no longer active");
      const descriptor = await uploadProfileAvatar(bytes, relayUrl, devicePubkey);
      if (!owner.active || currentOwner.current !== owner) throw new TransportError("Profile view no longer active");
      return descriptor;
    },
    rewriteMediaUrl: rewriteRelayUrl,
    performDefaultHaptic,
    dragRegion: <StartupWindowDragRegion />,
  }), [devicePubkey, owner, relayUrl, saveProfile]);
  return <OnboardingGate profile={read} host={host} blocking={blocking}>{children}</OnboardingGate>;
}
