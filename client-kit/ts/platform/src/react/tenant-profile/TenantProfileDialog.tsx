// Buzz 779af8886caae1317b4de962082429867ab61503 CommunityEditForm and
// CommunityIconSettingsCard: name form, rounded icon, local image/emoji selection.
// DD-158 changes the server Tenant profile only after explicit governed confirmation.
// Also desktop/src/features/communities/ui/EditCommunityDialog.tsx (name + icon edit) and
// desktop/src/features/communities/lib/downscaleIcon.ts (downscaleTenantIcon: square 256 px, size cap).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { TenantProfileView } from "@client-kit/contracts";
import emojiData from "@emoji-mart/data";
import emojiEnglish from "@emoji-mart/data/i18n/en.json";
import emojiChinese from "@emoji-mart/data/i18n/zh.json";
import Picker from "../profile/buzz/shared/ui/emoji-picker";
import { Button } from "../profile/buzz/shared/ui/button";
import { Input } from "../composer/shared/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useBffClient, useLocale, useT } from "../context";
import { useGovernedChannelAction, channelActionOutcomeText } from "../channel-management-actions";
import { TransportError } from "../../transport";

export const TENANT_PROFILE_ACTION = "tenant.profile.update";
export async function downscaleTenantIcon(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("Invalid image");
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) throw new Error("Invalid image");
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image unavailable");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    let icon = canvas.toDataURL("image/webp", 0.85);
    if (!icon.startsWith("data:image/webp;")) icon = canvas.toDataURL("image/png");
    if (icon.length > 96 * 1024) throw new Error("Image too large");
    return icon;
  } finally { bitmap.close(); }
}

export function TenantProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const api = useBffClient(), locale = useLocale(), t = useT();
  const [view, setView] = useState<TenantProfileView>();
  const [name, setName] = useState(""), [icon, setIcon] = useState("");
  const [failed, setFailed] = useState(false), [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false), [processing, setProcessing] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), epoch = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const write = useGovernedChannelAction(() => { if (alive.current) { setConfirmed(false); setReload(v => v + 1); void queryClient.invalidateQueries({ queryKey: ["platform", "session"] }); } }, true);
  const locked = write.busy || write.unknown || processing;
  useEffect(() => {
    if (!open || write.unknown) return;
    let current = true;
    setLoading(true); setFailed(false);
    void api.tenantProfile().then(result => {
      if (!result || typeof result.name !== "string" || !Number.isSafeInteger(result.version) || result.version < 1
        || (result.icon !== undefined && typeof result.icon !== "string")
        || (result.updateActionKey !== undefined && result.updateActionKey !== TENANT_PROFILE_ACTION)) throw new TransportError("Invalid profile");
      if (current) { setView(result); setName(result.name); setIcon(result.icon ?? ""); setConfirmed(false); setNeedsRefresh(false); }
    }).catch(() => { if (current) { setFailed(true); setView(undefined); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, open, reload]);
  const editable = view?.updateActionKey === TENANT_PROFILE_ACTION;
  const dirty = view !== undefined && (name.trim() !== view.name || icon !== (view.icon ?? ""));
  async function attach(file: File | undefined) {
    if (!file || locked) return;
    const current = ++epoch.current;
    setProcessing(true); setFailed(false);
    try { const next = await downscaleTenantIcon(file); if (alive.current && current === epoch.current) { setIcon(next); setConfirmed(false); } }
    catch { if (alive.current && current === epoch.current) setFailed(true); }
    finally { if (alive.current && current === epoch.current) setProcessing(false); if (input.current) input.current.value = ""; }
  }
  async function save() {
    if (write.unknown) { await write.submit(); return; }
    if (!view || !editable || !dirty || !confirmed || locked) return;
    const outcome = await write.submit({ actionKey: TENANT_PROFILE_ACTION, resourceVersion: view.version, explicitConfirmation: true,
      tenantProfile: { ...(name.trim() !== view.name ? { name: name.trim() } : {}), ...(icon !== (view.icon ?? "") ? icon ? { icon } : { clearIcon: true } : {}) } });
    if (alive.current && outcome && ["rejected", "aborted"].includes(outcome.kind)) { setConfirmed(false); setNeedsRefresh(true); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!write.busy && !processing) onOpenChange(next); }}>
    <DialogContent className="max-w-md" aria-describedby={undefined} data-testid="tenant-profile-dialog">
      <DialogHeader><DialogTitle>{t("tenantProfile.title")}</DialogTitle></DialogHeader>
      {loading ? <p role="status">{t("tenantProfile.loading")}</p> : null}
      {view ? <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="flex items-center gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted text-3xl">
          {icon.startsWith("data:image/") ? <img src={icon} alt={t("tenantProfile.icon")} className="h-full w-full object-cover"/> : <span>{icon || name.slice(0, 1)}</span>}</div>
          {editable ? <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => input.current?.click()}>{t("tenantProfile.image")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setChoosing(v => !v)}>{t("tenantProfile.emoji")}</Button>
            {icon ? <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => { setIcon(""); setConfirmed(false); }}>{t("tenantProfile.clear")}</Button> : null}</div> : null}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void attach(event.target.files?.[0])}/></div>
        {choosing && editable && !locked ? <Picker data={emojiData} i18n={locale === "zh-CN" ? emojiChinese : emojiEnglish} previewPosition="none" set="native" theme="auto"
          onEmojiSelect={(emoji: { native?: string }) => { if (emoji.native) { setIcon(emoji.native); setChoosing(false); setConfirmed(false); } }}/> : null}
        <label className="space-y-1.5 text-sm font-medium">{t("tenantProfile.name")}<Input value={name} disabled={!editable || locked} onChange={event => { setName(event.target.value); setConfirmed(false); }} data-testid="tenant-profile-name"/></label>
        {editable ? <><p className="text-xs text-muted-foreground">{t("tenantProfile.limits")}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked || !dirty} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>{t("tenantProfile.confirm")}</label>
          <Button type="submit" disabled={write.busy || processing || (!write.unknown && (needsRefresh || !dirty || !confirmed || !name.trim() || [...name.trim()].length > 64))}>{t(write.unknown ? "tenantProfile.retry" : "tenantProfile.save")}</Button></> : <p>{t("tenantProfile.readOnly")}</p>}
        {write.outcome ? <p role="status">{channelActionOutcomeText(t, write.outcome)}</p> : null}
      </form> : null}
      {failed ? <p role="alert">{t("tenantProfile.failed")}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={locked} onClick={() => { write.dismiss(); setReload(v => v + 1); }}>{t("tenantProfile.refresh")}</Button>
        <Button type="button" variant="ghost" disabled={write.busy || processing} onClick={() => onOpenChange(false)}>{t("tenantProfile.close")}</Button></div>
    </DialogContent>
  </Dialog>;
}
