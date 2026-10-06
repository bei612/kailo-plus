// Original Buzz ProfileSettingsCard metadata editor, shared by both hosts.
// Source: buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/ProfileSettingsCard.tsx::{EditProfileMetadataButton,ProfileSettingsCard}
// Host callbacks retain their own SERVER/CLIENT custody and canonical writer.
import { Check, ChevronDown, Copy, Pencil } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WebProfileUpdateRequest, WebProfileView } from "@client-kit/contracts";
import { translate, type PlatformLocale } from "../i18n";
import { isOutcomeUnknown, TransportError } from "../transport";
import { SettingsOptionGroup, SettingsOptionGroupList } from "./settings-option-group";
export { ProfileAvatarControls, ProfileAvatarPreview } from "./profile/profile-avatar-controls";

export type ProfilePresentation = Pick<WebProfileView, "pubkey" | "displayName" | "avatarUrl" | "about" | "nip05Handle">;

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

export function ProfileSettingsCard({ locale, profile, onSave, onCopy, avatarEditor, avatarPreview }: {
  locale: PlatformLocale;
  profile: ProfilePresentation;
  onSave: (request: WebProfileUpdateRequest) => Promise<ProfilePresentation>;
  onCopy: (value: string) => Promise<void>;
  avatarEditor?: (props: { avatarUrl: string; onChange: (url: string) => void; disabled: boolean; onUploadingChange: (value: boolean) => void }) => ReactNode;
  avatarPreview?: (profile: ProfilePresentation) => ReactNode;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [current, setCurrent] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [about, setAbout] = useState(profile.about ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed" | "unknown">("idle");
  const intent = useRef<WebProfileUpdateRequest | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);
  const displayNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (editing) displayNameInput.current?.focus(); }, [editing]);
  const identityNpub = /^[0-9a-f]{64}$/i.test(current.pubkey) ? npubEncode(current.pubkey) : null;

  async function save() {
    if (writing.current || uploading) return;
    const request = intent.current ?? Object.freeze({
      idempotencyKey: crypto.randomUUID(), expectedPubkey: profile.pubkey, displayName: displayName.trim(), about: about.trim(),
      ...(avatarUrl !== (current.avatarUrl ?? "") ? { avatarUrl: avatarUrl.trim() } : {}),
    });
    intent.current = request;
    writing.current = true;
    setBusy(true);
    try {
      const actual = await onSave(request);
      if (!mounted.current) return;
      if (actual.pubkey !== profile.pubkey) throw new TransportError("Profile identity changed before readback");
      setCurrent(actual);
      setDisplayName(actual.displayName ?? "");
      setAbout(actual.about ?? "");
      setAvatarUrl(actual.avatarUrl ?? "");
      setEditing(false);
      setState("saved");
      intent.current = null;
    } catch (error) {
      if (!mounted.current) return;
      // A failed observation cannot prove that an earlier publication failed.
      // Keep its exact intent frozen until the host returns canonical readback.
      const unknown = state === "unknown" || isOutcomeUnknown(error);
      setState(unknown ? "unknown" : "failed");
      if (!unknown) intent.current = null;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <section className="flex min-h-0 flex-1 flex-col gap-6" data-testid="settings-profile">
    <header><h2 className="text-lg font-semibold">{t("platform.settings.profile")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("platform.profile.description")}</p></header>
    {!editing ? avatarPreview?.(current) : null}
    {editing && avatarEditor ? <SettingsOptionGroup title={t("platform.profile.avatar")}><div className="p-4">{avatarEditor({ avatarUrl, onChange: setAvatarUrl, disabled: busy || state === "unknown", onUploadingChange: setUploading })}</div></SettingsOptionGroup> : null}
    <SettingsOptionGroupList>
      <SettingsOptionGroup data-testid="profile-metadata-card" title={t("platform.profile.info")} headerAction={
        <button type="button" data-testid="profile-metadata-edit" disabled={busy || uploading || state === "unknown"}
          onClick={() => editing ? void save() : setEditing(true)}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-muted px-3 text-xs font-medium text-primary transition-colors hover:bg-muted/80 disabled:opacity-50">
          {editing ? <Check aria-hidden className="size-3.5" /> : <Pencil aria-hidden className="size-3.5" />}
          {busy ? t("platform.profile.saving") : editing ? t("platform.profile.done") : t("platform.profile.edit")}
        </button>}
      >
        <div className="flex min-h-16 items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="profile-display-name" className="block text-sm font-medium">{t("platform.profile.displayName")}</label>
          {editing ? <input id="profile-display-name" ref={displayNameInput} data-testid="profile-display-name" value={displayName} disabled={busy || state === "unknown"} onChange={(event) => setDisplayName(event.target.value)}
            className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-muted-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0" />
            : <p data-testid="profile-display-name-value" className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{current.displayName || t("platform.profile.notSet")}</p>}
          </div>
        </div>
        <div className="flex min-h-16 items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="profile-about" className="block text-sm font-medium">{t("platform.profile.about")}</label>
          {editing ? <textarea id="profile-about" value={about} disabled={busy || state === "unknown"} onChange={(event) => setAbout(event.target.value)}
            className="min-h-[72px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 text-muted-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0" />
            : <p data-testid="profile-about-value" className="min-w-0 flex-1 break-words text-sm text-muted-foreground">{current.about || t("platform.profile.notSet")}</p>}
          </div>
        </div>
      </SettingsOptionGroup>
      <SettingsOptionGroup title={t("platform.profile.identity")}>
        <details className="group divide-y divide-border/55" data-testid="profile-identity-card">
          <summary className="group/identity flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden" data-testid="profile-identity-toggle">
            <p className="text-sm font-medium">{t("platform.profile.identityDetails")}</p>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-border/55" data-testid="profile-identity-details">
            <IdentityRow locale={locale} label={t("platform.profile.publicKey")} value={identityNpub} testId="profile-pubkey" onCopy={onCopy} />
            <IdentityRow locale={locale} label={t("platform.profile.nip05")} value={current.nip05Handle} testId="profile-nip05" onCopy={onCopy} />
          </div>
        </details>
      </SettingsOptionGroup>
    </SettingsOptionGroupList>
    {state !== "idle" ? <div role={state === "failed" ? "alert" : "status"} className="text-sm text-muted-foreground">
      {t(state === "unknown" ? "platform.profile.unknown" : state === "failed" ? "platform.profile.failed" : "platform.profile.saved")}
      {state === "unknown" ? <button type="button" disabled={busy} className="ml-2 underline disabled:opacity-50" onClick={() => void save()}>{t("platform.profile.check")}</button> : null}
    </div> : null}
  </section>;
}
