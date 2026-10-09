import { useMemo } from "react";
import type { PlatformLocale } from "../../i18n";
import { AvatarHostProvider, type AvatarHost } from "./avatar-host";
import { ProfileAvatarEditor } from "./buzz/features/profile/ui/ProfileAvatarEditor";
import { ProfileAvatar } from "./buzz/features/profile/ui/ProfileAvatar";
import { EmojiBurstProvider } from "./buzz/shared/ui/EmojiBurstProvider";
import type { ProfileAvatarEditorBinding } from "../profile-settings";

const browserHaptic = () => {};
export function ProfileAvatarControls({ avatarUrl, previewName, locale, isDark, onChange, disabled, onUploadingChange, upload, rewriteMediaUrl, performDefaultHaptic = browserHaptic, ...editor }: ProfileAvatarEditorBinding & {
  locale: PlatformLocale; isDark: boolean;
  avatarUrl: string; onChange: (url: string) => void; disabled: boolean;
  onUploadingChange: (value: boolean) => void;
  upload: AvatarHost["uploadMediaBytes"];
  rewriteMediaUrl: AvatarHost["rewriteMediaUrl"];
  performDefaultHaptic?: AvatarHost["performDefaultHaptic"];
}) {
  const host = useMemo(() => ({ locale, uploadMediaBytes: upload, rewriteMediaUrl, performDefaultHaptic }), [locale, upload, rewriteMediaUrl, performDefaultHaptic]);
  return <AvatarHostProvider value={host}><EmojiBurstProvider>
    {!editor.onDone ? <ProfileAvatar avatarUrl={avatarUrl} label={previewName} className="mx-auto mb-4 size-24" /> : null}
    <ProfileAvatarEditor {...editor} avatarUrl={avatarUrl} previewName={previewName} onUrlChange={onChange} emojiPickerTheme={isDark ? "dark" : "light"}
      disabled={disabled} onUploadingChange={onUploadingChange} />
  </EmojiBurstProvider></AvatarHostProvider>;
}

export function ProfileAvatarPreview({ avatarUrl, label, locale, rewriteMediaUrl, upload, className = "size-24", iconClassName, testId }: {
  locale: PlatformLocale;
  className?: string; iconClassName?: string; testId?: string;
  avatarUrl: string | null; label: string; rewriteMediaUrl: AvatarHost["rewriteMediaUrl"]; upload: AvatarHost["uploadMediaBytes"];
}) {
  const host = useMemo<AvatarHost>(() => ({ locale, rewriteMediaUrl, performDefaultHaptic: browserHaptic,
    uploadMediaBytes: upload,
  }), [locale, rewriteMediaUrl, upload]);
  return <AvatarHostProvider value={host}><ProfileAvatar avatarUrl={avatarUrl} label={label} className={className} iconClassName={iconClassName} testId={testId} /></AvatarHostProvider>;
}
