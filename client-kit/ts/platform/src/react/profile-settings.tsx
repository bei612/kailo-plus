// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ProfileSettingsCard.tsx.
// Original presentation; host callbacks retain SERVER/CLIENT custody and governed readback.
import { Check, ChevronDown, Copy, Pencil } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { useState } from "react";
import { npubEncode } from "nostr-tools/nip19";
import type { WebProfileUpdateRequest, WebProfileView } from "@client-kit/contracts";
import { translate, type PlatformLocale } from "../i18n";
import { newIdempotencyKey } from "../governance";
import { isOutcomeUnknown, TransportError } from "../transport";
import { SettingsOptionGroup, SettingsOptionGroupList } from "./settings-option-group";
import { SettingsSectionHeader } from "./settings-surface";
import { MaskedAvatarBadgeFrame } from "./messages/thread/MaskedAvatarBadgeFrame";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Spinner } from "./profile/buzz/shared/ui/spinner";
import { Input } from "./composer/shared/ui/input";
import { Textarea } from "./profile/buzz/shared/ui/textarea";
import { parseEmojiAvatarDataUrl } from "./profile/buzz/features/profile/ui/ProfileAvatarEditor.utils";
import type { ProfileAvatarEditorProps } from "./profile/buzz/features/profile/ui/ProfileAvatarEditor.types";
export { ProfileAvatarControls, ProfileAvatarPreview } from "./profile/profile-avatar-controls";
export type ProfilePresentation = Pick<WebProfileView, "pubkey" | "displayName" | "avatarUrl" | "about" | "nip05Handle">;
export type ProfileAvatarEditorBinding = Pick<ProfileAvatarEditorProps, "animatedPreviewContainer" | "modeTabsContainer" | "onAnimatedPreviewActiveChange" | "onAnimatedPreviewCaptionChange" | "onDone" | "onEmojiAvatarChange" | "onUploadedAvatarChange" | "donePending"> & {
  avatarUrl: string; onChange: (url: string) => void; disabled: boolean; onUploadingChange: (value: boolean) => void;
};
const AVATAR_EDITOR_TRANSITION_MS = 240;
const AVATAR_PREVIEW_CAPTION_TRANSITION = {
  duration: 0.18,
  ease: [0.23, 1, 0.32, 1],
} as const;
const AVATAR_MODE_TABS_TRANSITION = {
  duration: 0.2,
  ease: [0.23, 1, 0.32, 1],
} as const;
const AVATAR_EDITOR_LAYOUT_TRANSITION = {
  duration: 0.3,
  ease: [0.23, 1, 0.32, 1],
} as const;

// Original IdentityRow; each host supplies its existing clipboard integration.
function IdentityRow({ locale, label, value, testId, onCopy }: {
  locale: PlatformLocale; label: string; value: string | null; testId: string;
  onCopy: (value: string) => Promise<void>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
    <div className="min-w-0 space-y-1"><p className="text-sm font-medium">{label}</p>
      <p className="min-w-0 truncate text-sm text-muted-foreground" data-testid={testId} title={value ?? undefined}>{value || t("platform.profile.notSet")}</p>
      {copyState !== "idle" ? <p role="status" className="text-sm text-muted-foreground">{t(copyState === "copied" ? "platform.profile.copied" : "platform.profile.copyFailed")}</p> : null}
    </div>
    {value ? <button type="button" aria-label={`${t("platform.profile.copy")} ${label}`} data-testid={`copy-${testId}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={() => void onCopy(value).then(() => setCopyState("copied"), () => setCopyState("failed"))}>
      <Copy aria-hidden className="h-4 w-4 shrink-0" />{t("platform.profile.copy")}
    </button> : null}
  </div>;
}

function EditProfileMetadataButton({
  label,
  locale,
  testId,
  onClick,
  disabled,
  isEditing,
}: {
  label: string;
  locale: PlatformLocale;
  testId: string;
  onClick: () => void;
  disabled: boolean;
  isEditing: boolean;
}) {
  const Icon = isEditing ? Check : Pencil;
  const actionLabel = translate(locale, isEditing ? "platform.profile.done" : "platform.profile.edit");
  const accessibleLabel = `${actionLabel} ${label}`;

  return (
    <button
      aria-label={accessibleLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        isEditing
          ? "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90"
          : "border-transparent bg-muted text-foreground hover:bg-muted/80",
      )}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={accessibleLabel}
      type="button"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {actionLabel}
    </button>
  );
}

export function ProfileSettingsCard({ locale, profile: initialProfile, onSave, onCopy, avatarEditor, avatarPreview }: {
  locale: PlatformLocale; profile: ProfilePresentation;
  onSave: (request: WebProfileUpdateRequest) => Promise<ProfilePresentation>;
  onCopy: (value: string) => Promise<void>;
  avatarEditor?: (props: ProfileAvatarEditorBinding) => React.ReactNode;
  avatarPreview?: (profile: ProfilePresentation) => React.ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [profile, setProfile] = React.useState(initialProfile);
  const [busy, setBusy] = React.useState(false);
  const [writeState, setWriteState] = React.useState<"idle" | "saved" | "failed" | "unknown">("idle");
  const intent = React.useRef<WebProfileUpdateRequest | null>(null);
  const writing = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const writeLocked = busy || writeState === "unknown";

  const currentDisplayName = profile?.displayName ?? "";
  const currentAvatarUrl = profile?.avatarUrl ?? "";
  const currentAbout = profile?.about ?? "";
  const [displayNameDraft, setDisplayNameDraft] = React.useState("");
  const [avatarUrlDraft, setAvatarUrlDraft] = React.useState("");
  const [aboutDraft, setAboutDraft] = React.useState("");
  const [uploadedAvatarUrlDraft, setUploadedAvatarUrlDraft] = React.useState<
    string | null
  >(null);
  const [isAvatarEditorOpen, setIsAvatarEditorOpen] = React.useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = React.useState(false);
  const [isAvatarEditorFinishing, setIsAvatarEditorFinishing] =
    React.useState(false);
  // The animated avatar tab portals its camera feed / composed preview into
  // the main avatar preview above, replacing the regular preview while live.
  const [animatedPreviewEl, setAnimatedPreviewEl] =
    React.useState<HTMLDivElement | null>(null);
  const [avatarModeTabsEl, setAvatarModeTabsEl] =
    React.useState<HTMLDivElement | null>(null);
  const [isAnimatedPreviewActive, setIsAnimatedPreviewActive] =
    React.useState(false);
  const [animatedPreviewCaption, setAnimatedPreviewCaption] = React.useState<
    string | null
  >(null);
  const [isEditingProfileMetadata, setIsEditingProfileMetadata] =
    React.useState(false);
  const [shouldRenderAvatarEditor, setShouldRenderAvatarEditor] =
    React.useState(false);
  const [avatarSquishKey, setAvatarSquishKey] = React.useState(0);
  const displayNameInputRef = React.useRef<HTMLInputElement>(null);
  const aboutTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const isEditingProfileMetadataRef = React.useRef(false);
  const avatarEditorOpenFrameRef = React.useRef<number | null>(null);
  const avatarEditorFinishTimeoutRef = React.useRef<number | null>(null);
  const savedScrollTopRef = React.useRef<number | null>(null);
  isEditingProfileMetadataRef.current = isEditingProfileMetadata;

  React.useEffect(() => {
    if (!isEditingProfileMetadataRef.current) {
      setDisplayNameDraft(currentDisplayName);
    }
  }, [currentDisplayName]);

  React.useEffect(() => {
    if (!isAvatarEditorOpen) {
      setAvatarUrlDraft(currentAvatarUrl);
    }
  }, [currentAvatarUrl, isAvatarEditorOpen]);

  React.useEffect(() => {
    if (!isEditingProfileMetadataRef.current) {
      setAboutDraft(currentAbout);
    }
  }, [currentAbout]);

  React.useEffect(() => {
    if (
      uploadedAvatarUrlDraft &&
      currentAvatarUrl &&
      uploadedAvatarUrlDraft !== currentAvatarUrl &&
      avatarUrlDraft !== uploadedAvatarUrlDraft
    ) {
      setUploadedAvatarUrlDraft(null);
    }
  }, [avatarUrlDraft, currentAvatarUrl, uploadedAvatarUrlDraft]);

  React.useEffect(() => {
    if (isEditingProfileMetadata) {
      displayNameInputRef.current?.focus();
    }
  }, [isEditingProfileMetadata]);

  React.useEffect(() => {
    if (
      isAvatarEditorOpen ||
      !shouldRenderAvatarEditor ||
      isAvatarEditorFinishing
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRenderAvatarEditor(false);
    }, AVATAR_EDITOR_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isAvatarEditorFinishing, isAvatarEditorOpen, shouldRenderAvatarEditor]);

  React.useEffect(() => {
    if (!shouldRenderAvatarEditor) {
      setIsAvatarEditorFinishing(false);
    }
  }, [shouldRenderAvatarEditor]);

  React.useEffect(() => {
    return () => {
      if (avatarEditorOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(avatarEditorOpenFrameRef.current);
      }
      if (avatarEditorFinishTimeoutRef.current !== null) {
        window.clearTimeout(avatarEditorFinishTimeoutRef.current);
      }
    };
  }, []);

  const nextDisplayName = displayNameDraft.trim();
  const nextAvatarUrl = avatarUrlDraft.trim();
  const nextAbout = aboutDraft.trim();
  const updatePayload = React.useMemo(() => {
    const payload: {
      displayName?: string;
      avatarUrl?: string;
      about?: string;
    } = {};

    if (nextDisplayName !== currentDisplayName) {
      payload.displayName = nextDisplayName;
    }
    if (nextAvatarUrl !== currentAvatarUrl) {
      payload.avatarUrl = nextAvatarUrl;
    }
    if (nextAbout !== currentAbout) {
      payload.about = nextAbout;
    }

    return payload;
  }, [
    currentAbout,
    currentAvatarUrl,
    currentDisplayName,
    nextAbout,
    nextAvatarUrl,
    nextDisplayName,
  ]);

  const hasProfileChanges = Object.keys(updatePayload).length > 0;
  const canSave =
    hasProfileChanges && !writeLocked && !isUploadingAvatar;
  const isAvatarEditorSaving =
    isAvatarEditorFinishing ||
    (shouldRenderAvatarEditor && writeLocked);
  const readOnlyContentMotionClassName = cn(
    "min-w-0 w-full origin-top overflow-hidden transition-[opacity,scale] duration-200 ease-out will-change-[opacity,transform]",
    shouldRenderAvatarEditor ? "absolute inset-x-0 top-0" : "relative",
    isAvatarEditorOpen
      ? "pointer-events-none scale-[0.98] opacity-0"
      : "scale-100 opacity-100",
  );

  const resolvedName =
    nextDisplayName ||
    profile?.displayName ||
    t("platform.settings.profile");
  // Identity details show and copy the full canonical npub; a key that
  // cannot be encoded renders the neutral label and is never copyable.
  const identityNpub = /^[0-9a-f]{64}$/i.test(profile.pubkey) ? npubEncode(profile.pubkey) : null;
  const emojiAvatarPreview = React.useMemo(
    () => parseEmojiAvatarDataUrl(avatarUrlDraft),
    [avatarUrlDraft],
  );
  const shouldShowAnimatedPreview =
    isAvatarEditorOpen && isAnimatedPreviewActive;
  const visibleAnimatedPreviewCaption = isAvatarEditorOpen
    ? animatedPreviewCaption
    : null;
  const avatarEditorLayoutTransition = shouldReduceMotion
    ? { duration: 0 }
    : AVATAR_EDITOR_LAYOUT_TRANSITION;
  const avatarEditShellClassName = cn(
    "flex h-[54px] w-[54px] items-center justify-center rounded-full opacity-100 transition-[opacity,scale,transform] duration-150 ease-out",
    isAvatarEditorOpen
      ? "pointer-events-none scale-[0.94] opacity-0"
      : "scale-100 opacity-100",
  );
  const avatarEditButtonClassName = cn(
    "flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-active text-sidebar-active-foreground transition-[background-color,opacity,scale,transform] duration-150 ease-out hover:scale-[1.04] hover:bg-sidebar-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-90 disabled:hover:scale-100",
  );
  const clearAvatarEditorFinishTimeout = React.useCallback(() => {
    if (avatarEditorFinishTimeoutRef.current === null) {
      return;
    }
    window.clearTimeout(avatarEditorFinishTimeoutRef.current);
    avatarEditorFinishTimeoutRef.current = null;
  }, []);
  const saveScrollPosition = React.useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>("[class*='overflow-y']");
    if (scroller) savedScrollTopRef.current = scroller.scrollTop;
  }, []);
  const restoreScrollPosition = React.useCallback(() => {
    const saved = savedScrollTopRef.current;
    if (saved == null) return;
    savedScrollTopRef.current = null;
    const el = sectionRef.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>("[class*='overflow-y']");
    if (scroller) scroller.scrollTop = saved;
  }, []);
  const closeAvatarEditor = React.useCallback(() => {
    clearAvatarEditorFinishTimeout();
    setIsAvatarEditorOpen(false);
    setIsAvatarEditorFinishing(false);
    restoreScrollPosition();
  }, [clearAvatarEditorFinishTimeout, restoreScrollPosition]);
  const completeAvatarEditorClose = React.useCallback(() => {
    setIsAvatarEditorOpen(false);
    clearAvatarEditorFinishTimeout();
    restoreScrollPosition();
    avatarEditorFinishTimeoutRef.current = window.setTimeout(
      () => {
        avatarEditorFinishTimeoutRef.current = null;
        setIsAvatarEditorFinishing(false);
      },
      shouldReduceMotion ? 0 : AVATAR_EDITOR_TRANSITION_MS,
    );
  }, [
    clearAvatarEditorFinishTimeout,
    restoreScrollPosition,
    shouldReduceMotion,
  ]);
  const reopenAvatarEditorAfterClose = React.useCallback(() => {
    clearAvatarEditorFinishTimeout();
    setShouldRenderAvatarEditor(true);
    setIsAvatarEditorFinishing(false);
    setIsAvatarEditorOpen(true);
  }, [clearAvatarEditorFinishTimeout]);

  const openAvatarEditor = React.useCallback(() => {
    saveScrollPosition();
    setShouldRenderAvatarEditor(true);
    setIsAvatarEditorFinishing(false);
    clearAvatarEditorFinishTimeout();

    if (avatarEditorOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(avatarEditorOpenFrameRef.current);
    }

    avatarEditorOpenFrameRef.current = window.requestAnimationFrame(() => {
      avatarEditorOpenFrameRef.current = null;
      setIsAvatarEditorOpen(true);
    });
  }, [clearAvatarEditorFinishTimeout, saveScrollPosition]);

  const saveProfile = async (): Promise<boolean> => {
    if (writing.current || isUploadingAvatar || (!intent.current && !canSave)) return false;
    writing.current = true;
    setBusy(true);
    try {
      const request = intent.current ?? Object.freeze({
        idempotencyKey: newIdempotencyKey(), expectedPubkey: initialProfile.pubkey,
        displayName: nextDisplayName, about: nextAbout,
        ...(nextAvatarUrl !== currentAvatarUrl ? {avatarUrl: nextAvatarUrl} : {}),
      });
      intent.current = request;
      const actual = await onSave(request);
      if (!mounted.current) return false;
      if (actual.pubkey !== initialProfile.pubkey) throw new TransportError("Profile identity changed before readback");
      setProfile(actual);
      setDisplayNameDraft(actual.displayName ?? "");
      setAboutDraft(actual.about ?? "");
      setAvatarUrlDraft(actual.avatarUrl ?? "");
      setIsEditingProfileMetadata(false);
      intent.current = null;
      setWriteState("saved");
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      const unknown = writeState === "unknown" || isOutcomeUnknown(error);
      setWriteState(unknown ? "unknown" : "failed");
      if (!unknown) intent.current = null;
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const handleProfileMetadataEdit = React.useCallback(() => {
    if (!isEditingProfileMetadata) {
      setIsEditingProfileMetadata(true);
      return;
    }

    if (!hasProfileChanges) {
      setIsEditingProfileMetadata(false);
      return;
    }

    void saveProfile();
  }, [
    hasProfileChanges,
    isEditingProfileMetadata,
    saveProfile,
  ]);

  const handleAvatarEditorDone = React.useCallback(() => {
    if (!hasProfileChanges) {
      closeAvatarEditor();
      return;
    }

    setIsAvatarEditorFinishing(true);
    void saveProfile()
      .then((didSave) => {
        if (didSave) {
          completeAvatarEditorClose();
          return;
        }

        reopenAvatarEditorAfterClose();
      })
      .catch(() => {
        reopenAvatarEditorAfterClose();
      });
  }, [
    closeAvatarEditor,
    completeAvatarEditorClose,
    hasProfileChanges,
    reopenAvatarEditorAfterClose,
    saveProfile,
  ]);

  const animateEmojiAvatarChange = React.useCallback(() => {
    setAvatarSquishKey((key) => key + 1);
  }, []);

  return (
    <section
      className="min-w-0"
      data-testid="settings-profile"
      ref={sectionRef}
    >
      <div>
        <SettingsSectionHeader
          title={t("platform.settings.profile")}
          description={t("platform.profile.description")}
        />

        <div className="space-y-3">
          {writeState !== "idle" ? <div role={writeState === "failed" ? "alert" : "status"} className="text-sm text-muted-foreground">
            {t(writeState === "unknown" ? "platform.profile.unknown" : writeState === "failed" ? "platform.profile.failed" : "platform.profile.saved")}
            {writeState === "unknown" ? <button type="button" disabled={busy} className="ml-2 underline disabled:opacity-50" onClick={() => { void saveProfile().then((saved) => { if(saved && isAvatarEditorOpen) completeAvatarEditorClose(); }); }}>{t("platform.profile.check")}</button> : null}
          </div> : null}
          <div className="min-w-0">
            <form
              className="min-w-0 space-y-3"
              id="profile-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <LayoutGroup id="profile-avatar-editor-layout">
                <motion.div
                  className="flex min-w-0 flex-col items-center gap-12"
                  layout="position"
                  transition={avatarEditorLayoutTransition}
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {isAvatarEditorOpen ? (
                      <motion.div
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative z-20 -mb-14 grid h-48 w-full max-w-[576px] origin-center place-items-center"
                        data-testid="profile-avatar-mode-tabs-slot"
                        exit={
                          shouldReduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.96 }
                        }
                        initial={
                          shouldReduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.96 }
                        }
                        key="profile-avatar-mode-tabs-slot"
                        layout="position"
                        ref={setAvatarModeTabsEl}
                        transition={AVATAR_MODE_TABS_TRANSITION}
                      />
                    ) : null}
                  </AnimatePresence>

                  <motion.div
                    className="flex flex-col items-center gap-3"
                    layout="position"
                    transition={avatarEditorLayoutTransition}
                  >
                    <div
                      className="relative h-48 w-48"
                      data-testid="profile-avatar-clip-frame"
                    >
                      <MaskedAvatarBadgeFrame
                        badge={
                          isAvatarEditorOpen || !avatarEditor ? null : (
                            <div
                              className={avatarEditShellClassName}
                              data-testid="profile-avatar-edit-shell"
                            >
                              <button
                                aria-expanded={isAvatarEditorOpen}
                                aria-label={
                                  isAvatarEditorSaving
                                    ? t("platform.profile.saving")
                                    : t("platform.profile.avatar.edit")
                                }
                                className={avatarEditButtonClassName}
                                data-testid="profile-avatar-edit"
                                disabled={isAvatarEditorSaving || writeLocked}
                                onClick={openAvatarEditor}
                                title={
                                  isAvatarEditorSaving
                                    ? t("platform.profile.saving")
                                    : t("platform.profile.avatar.edit")
                                }
                                type="button"
                              >
                                {isAvatarEditorSaving && !isAvatarEditorOpen ? (
                                  <Spinner
                                    aria-label={t("platform.profile.avatar.savingAvatar")}
                                    className="h-4 w-4 border-2"
                                  />
                                ) : (
                                  <Pencil className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          )
                        }
                        badgeBox={{
                          bottom: 0,
                          height: 54,
                          right: 0,
                          width: 54,
                        }}
                        className="h-48 w-48"
                        clipTestId="profile-avatar-preview-clip"
                        cutout={{ cx: 165, cy: 165, r: 30 }}
                        size={192}
                      >
                        <div className="relative h-full w-full">
                          <div
                            className="pointer-events-none absolute inset-0 z-10"
                            data-testid="profile-avatar-animated-preview-slot"
                            ref={setAnimatedPreviewEl}
                          />
                          {shouldShowAnimatedPreview ? null : emojiAvatarPreview ? (
                            <div
                              aria-label={`${resolvedName} ${t("platform.profile.avatar")}`}
                              className="relative flex h-full w-full shrink-0 items-center justify-center overflow-hidden rounded-full shadow-xs"
                              data-testid="profile-avatar-preview"
                              role="img"
                              style={{
                                backgroundColor: emojiAvatarPreview.color,
                              }}
                            >
                              <span
                                className={cn(
                                  "buzz-avatar-emoji-glyph flex h-full w-full items-center justify-center text-[6rem] leading-[6.25rem]",
                                  avatarSquishKey > 0 && "buzz-avatar-squish",
                                )}
                                data-testid="profile-avatar-preview-emoji"
                                key={avatarSquishKey}
                              >
                                {emojiAvatarPreview.emoji}
                              </span>
                            </div>
                          ) : (
                            avatarPreview?.({...profile, avatarUrl: avatarUrlDraft || null, displayName: resolvedName})
                          )}
                        </div>
                      </MaskedAvatarBadgeFrame>
                    </div>

                    <AnimatePresence initial={false} mode="wait">
                      {visibleAnimatedPreviewCaption ? (
                        <motion.p
                          animate={{ opacity: 1, y: 0 }}
                          className="w-48 text-center text-sm text-muted-foreground"
                          exit={
                            shouldReduceMotion
                              ? { opacity: 0, y: 0 }
                              : { opacity: 0, y: -4 }
                          }
                          initial={
                            shouldReduceMotion
                              ? { opacity: 0, y: 0 }
                              : { opacity: 0, y: 6 }
                          }
                          key={visibleAnimatedPreviewCaption}
                          transition={AVATAR_PREVIEW_CAPTION_TRANSITION}
                        >
                          {visibleAnimatedPreviewCaption}
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>

                  <motion.div
                    className="relative min-w-0 w-full"
                    layout="position"
                    transition={avatarEditorLayoutTransition}
                  >
                    <div
                      className={readOnlyContentMotionClassName}
                      data-testid="profile-readonly-content"
                      inert={isAvatarEditorOpen ? true : undefined}
                    >
                      <SettingsOptionGroupList>
                        <SettingsOptionGroup
                          headerAction={
                            <EditProfileMetadataButton locale={locale}
                              disabled={writeLocked}
                              isEditing={isEditingProfileMetadata}
                              label={t("platform.profile.info")}
                              onClick={handleProfileMetadataEdit}
                              testId="profile-metadata-edit"
                            />
                          }
                          data-testid="profile-metadata-card"
                          title={t("platform.profile.info")}
                        >
                          <div className="flex min-h-16 items-center gap-4 px-4 py-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <label
                                className="block text-sm font-medium"
                                htmlFor="profile-display-name"
                              >
                                {t("platform.profile.displayName")}
                              </label>
                              {isEditingProfileMetadata ? (
                                <Input
                                  className="h-auto border-0 bg-transparent px-0 py-0 text-sm text-muted-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
                                  data-testid="profile-display-name"
                                  disabled={writeLocked}
                                  id="profile-display-name"
                                  onChange={(event) =>
                                    setDisplayNameDraft(event.target.value)
                                  }
                                  placeholder={t("platform.profile.displayName")}
                                  ref={displayNameInputRef}
                                  value={displayNameDraft}
                                />
                              ) : (
                                <p
                                  className="min-w-0 truncate text-sm text-muted-foreground"
                                  data-testid="profile-display-name-value"
                                  title={displayNameDraft || t("platform.profile.notSet")}
                                >
                                  {displayNameDraft || t("platform.profile.notSet")}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex min-h-16 items-center gap-4 px-4 py-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <label
                                className="block text-sm font-medium"
                                htmlFor="profile-about"
                              >
                                {t("platform.profile.about")}
                              </label>
                              {isEditingProfileMetadata ? (
                                <Textarea
                                  className="min-h-[72px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-muted-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
                                  data-testid="profile-about"
                                  disabled={writeLocked}
                                  id="profile-about"
                                  onChange={(event) =>
                                    setAboutDraft(event.target.value)
                                  }
                                  placeholder={t("platform.profile.about")}
                                  ref={aboutTextareaRef}
                                  value={aboutDraft}
                                />
                              ) : (
                                <p
                                  className={cn(
                                    "min-w-0 break-words text-sm",
                                    aboutDraft
                                      ? "text-muted-foreground"
                                      : "text-muted-foreground/55",
                                  )}
                                  data-testid="profile-about-value"
                                  title={aboutDraft || t("platform.profile.notSet")}
                                >
                                  {aboutDraft || t("platform.profile.notSet")}
                                </p>
                              )}
                            </div>
                          </div>
                        </SettingsOptionGroup>

                        <SettingsOptionGroup title={t("platform.profile.identity")}>
                          <details
                            className="group divide-y divide-border/55"
                            data-testid="profile-identity-card"
                          >
                            <summary
                              className="group/identity flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                              data-testid="profile-identity-toggle"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium">
                                  {t("platform.profile.identityDetails")}
                                </p>
                                <p
                                  className="text-sm font-normal text-muted-foreground/70"
                                  data-settings-subcopy
                                >
                                  {t("platform.profile.identityReadOnly")}
                                </p>
                              </div>
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 ease-out group-open:rotate-180 group-hover/identity:text-foreground group-focus-visible/identity:text-foreground" />
                            </summary>
                            <div
                              className="divide-y divide-border/55"
                              data-testid="profile-identity-details"
                            >
                              <IdentityRow locale={locale} onCopy={onCopy}
                                label={t("platform.profile.publicKey")}
                                testId="profile-pubkey"
                                value={identityNpub}
                              />
                              <IdentityRow locale={locale} onCopy={onCopy}
                                label={t("platform.profile.nip05")}
                                testId="profile-nip05"
                                value={profile.nip05Handle}
                              />

                            </div>
                          </details>
                        </SettingsOptionGroup>
                      </SettingsOptionGroupList>
                    </div>

                    {shouldRenderAvatarEditor ? (
                      <div
                        className={cn(
                          "relative origin-top transition-[opacity,scale] duration-200 ease-out will-change-[opacity,transform]",
                          isAvatarEditorOpen
                            ? "scale-100 opacity-100"
                            : "pointer-events-none scale-[0.98] opacity-0",
                          isAvatarEditorFinishing ? "pointer-events-none" : "",
                        )}
                        aria-busy={isAvatarEditorSaving ? true : undefined}
                        data-testid="profile-avatar-editor-shell"
                        inert={isAvatarEditorOpen ? undefined : true}
                      >
                        {avatarEditor?.({
                          avatarUrl: avatarUrlDraft, onChange: setAvatarUrlDraft,
                          disabled: isAvatarEditorSaving || writeLocked,
                          onUploadingChange: setIsUploadingAvatar,
                          donePending: isAvatarEditorSaving,
                          animatedPreviewContainer: animatedPreviewEl,
                          modeTabsContainer: avatarModeTabsEl,
                          onAnimatedPreviewActiveChange: setIsAnimatedPreviewActive,
                          onAnimatedPreviewCaptionChange: setAnimatedPreviewCaption,
                          onDone: handleAvatarEditorDone,
                          onEmojiAvatarChange: animateEmojiAvatarChange,
                          onUploadedAvatarChange: setUploadedAvatarUrlDraft,
                        })}
                      </div>
                    ) : null}
                  </motion.div>
                </motion.div>
              </LayoutGroup>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
