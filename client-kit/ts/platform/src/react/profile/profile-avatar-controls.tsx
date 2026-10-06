import { useMemo } from "react";
import type { PlatformLocale } from "../../i18n";
import { AvatarHostProvider, type AvatarHost } from "./avatar-host";
import { ProfileAvatarEditor } from "./buzz/features/profile/ui/ProfileAvatarEditor";
import { ProfileAvatar } from "./buzz/features/profile/ui/ProfileAvatar";
import { EmojiBurstProvider } from "./buzz/shared/ui/EmojiBurstProvider";

const browserHaptic = () => {};
export function ProfileAvatarControls({ avatarUrl, label, locale, isDark, onChange, disabled, onUploadingChange, upload, rewriteMediaUrl, performDefaultHaptic = browserHaptic }: {
  label: string; locale: PlatformLocale; isDark: boolean;
  avatarUrl: string; onChange: (url: string) => void; disabled: boolean;
  onUploadingChange: (value: boolean) => void;
  upload: AvatarHost["uploadMediaBytes"];
  rewriteMediaUrl: AvatarHost["rewriteMediaUrl"];
  performDefaultHaptic?: AvatarHost["performDefaultHaptic"];
}) {
  const host = useMemo(() => ({ locale, uploadMediaBytes: upload, rewriteMediaUrl, performDefaultHaptic }), [locale, upload, rewriteMediaUrl, performDefaultHaptic]);
  return <AvatarHostProvider value={host}><EmojiBurstProvider>
    <ProfileAvatar avatarUrl={avatarUrl} label={label} className="mx-auto mb-4 size-24" />
    <ProfileAvatarEditor avatarUrl={avatarUrl} previewName={label} onUrlChange={onChange} emojiPickerTheme={isDark ? "dark" : "light"}
      disabled={disabled} onUploadingChange={onUploadingChange} />
  </EmojiBurstProvider></AvatarHostProvider>;
}

export function ProfileAvatarPreview({ avatarUrl, label, locale, rewriteMediaUrl, upload }: {
  locale: PlatformLocale;
  avatarUrl: string | null; label: string; rewriteMediaUrl: AvatarHost["rewriteMediaUrl"]; upload: AvatarHost["uploadMediaBytes"];
}) {
  const host = useMemo<AvatarHost>(() => ({ locale, rewriteMediaUrl, performDefaultHaptic: browserHaptic,
    uploadMediaBytes: upload,
  }), [locale, rewriteMediaUrl, upload]);
  return <AvatarHostProvider value={host}><ProfileAvatar avatarUrl={avatarUrl} label={label} className="size-24" /></AvatarHostProvider>;
}
