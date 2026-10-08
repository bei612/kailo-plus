// Same original ProfileSettingsCard presentation; CLIENT writer remains native.
import { useEffect, useMemo, useRef } from "react";
import { ProfileSettingsCard as SharedProfileSettingsCard, ProfileAvatarControls, ProfileAvatarPreview } from "@client-kit/platform/react/profile-settings";
import { TransportError } from "@client-kit/platform/transport";
import { uploadProfileAvatar } from "@/shared/api/tauriProfiles";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { performDefaultHaptic } from "@/shared/lib/haptics";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { useProfileQuery, useUpdateProfileMutation } from "@/features/profile/hooks";
import { useActiveCommunity, useNativeSession } from "@/features/platform/activeCommunity";

export function ProfileSettingsCard() {
  const community = useActiveCommunity();
  const session = useNativeSession();
  const { isDark } = useTheme();
  const profile = useProfileQuery();
  const mutation = useUpdateProfileMutation();
  const locale = useDeviceLocale();
  const owner = useMemo(() => ({ active: true }), [session.client, community.id, community.relayUrl, session.devicePubkey]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  if (profile.isPending) return <p role="status">{translate(locale, "platform.loading")}</p>;
  if (profile.isError) return <div role="alert">{translate(locale, "platform.loadFailed")}<button type="button" onClick={() => void profile.refetch()}>{translate(locale, "platform.retry")}</button></div>;
  const upload = async (bytes: number[]) => {
    const requireCurrentOwner = () => {
      if (!owner.active || currentOwner.current !== owner)
        throw new TransportError(translate(locale, "platform.profile.uploadFailed"));
    };
    requireCurrentOwner();
    const descriptor = await uploadProfileAvatar(bytes, community.relayUrl, profile.data.pubkey);
    // The original editor registers an uploaded URL in the global animated
    // avatar presentation store. Never register another Community's receipt.
    requireCurrentOwner();
    return descriptor;
  };
  return <SharedProfileSettingsCard key={`${community.relayUrl}:${profile.data.pubkey}`} locale={locale} profile={profile.data}
    onCopy={writeTextToClipboard}
    avatarPreview={(actual) => <ProfileAvatarPreview locale={locale} avatarUrl={actual.avatarUrl} label={actual.displayName ?? actual.pubkey} upload={upload} rewriteMediaUrl={rewriteRelayUrl} className="h-full w-full rounded-full text-5xl" iconClassName="h-14 w-14" testId="profile-avatar-preview" />}
    avatarEditor={(props) => <ProfileAvatarControls {...props} label={profile.data.displayName ?? profile.data.pubkey} locale={locale} isDark={isDark} upload={upload} rewriteMediaUrl={rewriteRelayUrl} performDefaultHaptic={performDefaultHaptic} />}
    onSave={(request) => mutation.mutateAsync(request)} />;
}
