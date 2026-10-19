// DD-125(5) (V-SCN-142): the Web host of the original first-run profile and avatar steps
// (Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/onboarding). The own
// profile is the BFF read of this session's SERVER key; the steps open while that key has no
// kind:0. Saving is the same `identity.profile.publish` with readback as Settings → Profile, and
// the avatar upload is the same own-profile media path. No new route, action or authority.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlatformSessionView, WebProfileUpdateRequest, WebProfileView } from "@client-kit/contracts";
import { OnboardingGate, type OnboardingHost, type OnboardingProfileRead } from "@client-kit/platform/react/onboarding";
import { TransportError } from "@client-kit/platform/transport";
import { bff, uploadProfileAvatar } from "@/platform/bff-client";

function validOwnProfile(value: unknown): value is WebProfileView {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<WebProfileView>;
  return typeof profile.pubkey === "string" && /^[0-9a-f]{64}$/.test(profile.pubkey)
    && (profile.eventId === null || profile.eventId === undefined || (typeof profile.eventId === "string" && /^[0-9a-f]{64}$/.test(profile.eventId)))
    && typeof profile.avatarMediaPaths === "object" && profile.avatarMediaPaths !== null;
}

export function WebOnboardingGate({ session, blocking, children }: {
  session: PlatformSessionView; blocking: ReactNode; children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["platform", "onboarding-own-profile", session.tenantId, session.tenantPrincipalId, session.platformSessionId],
    queryFn: () => bff.profile(),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const own = validOwnProfile(query.data) ? query.data : undefined;
  const read: OnboardingProfileRead = {
    status: query.isPending ? "pending" : query.isError || !own ? "error" : "success",
    isFetching: query.isFetching === true,
    data: own ? { pubkey: own.pubkey, displayName: own.displayName ?? null, avatarUrl: own.avatarUrl ?? null,
      hasProfileEvent: typeof own.eventId === "string" } : undefined,
  };
  // The flow is keyed by session in PlatformApp; a completed old upload or save never reads
  // back through a later session.
  const owner = useRef(true);
  useEffect(() => { owner.current = true; return () => { owner.current = false; }; }, []);
  const uploadedPaths = useRef<Record<string, string>>({});
  const pubkey = own?.pubkey ?? null;
  const mediaPaths = own?.avatarMediaPaths;
  const host = useMemo<OnboardingHost>(() => {
    const requireCurrentOwner = () => {
      if (!owner.current) throw new TransportError("Profile view no longer active");
    };
    return {
      saveProfile: async (request: WebProfileUpdateRequest) => {
        requireCurrentOwner();
        const receipt = await bff.updateProfile(request);
        requireCurrentOwner();
        // A subsequent read failure does not undo the accepted publication.
        const actual = await bff.profile().catch(() => { throw new TransportError("Profile publication readback unavailable"); });
        requireCurrentOwner();
        if (actual.pubkey !== request.expectedPubkey || actual.eventId !== receipt.eventId) {
          throw new TransportError("Profile publication readback is not the original event");
        }
        Object.assign(uploadedPaths.current, actual.avatarMediaPaths);
      },
      uploadMediaBytes: async (bytes: number[]) => {
        requireCurrentOwner();
        if (!pubkey) throw new TransportError("Profile identity unavailable");
        const descriptor = await uploadProfileAvatar(bytes, pubkey);
        requireCurrentOwner();
        uploadedPaths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
        return descriptor;
      },
      rewriteMediaUrl: (url: string) => {
        const clean = url.split("?")[0]!;
        // Preserve local previews and original inline emoji. Never turn an arbitrary remote
        // URL into a credentialed BFF fetch or relax Web CSP.
        return uploadedPaths.current[url] ?? mediaPaths?.[url] ?? uploadedPaths.current[clean] ?? mediaPaths?.[clean] ?? url;
      },
    };
  }, [mediaPaths, pubkey]);
  return <OnboardingGate profile={read} host={host} blocking={blocking}>{children}</OnboardingGate>;
}
