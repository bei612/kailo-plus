// Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/custom-emoji/ui/CustomEmojiSettingsCard.tsx.
import { ImagePlus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { normalizeShortcode, suggestShortcodeFromFilename } from "./emoji";
import { useEmojiSettings, type CustomEmojiHost } from "./hooks";
import { Button } from "../profile/buzz/shared/ui/button";
import { Input } from "../composer/shared/ui/input";
import { SettingsOptionGroup } from "../settings-option-group";
import { SettingsSectionHeader } from "../settings-surface";
import { ReadFailure } from "../ui";
import { useUiT } from "../context";
import { isOutcomeUnknown } from "../../transport";

/**
 * Custom emoji management (NIP-30, kind:30030). Each member owns their own set:
 * adding uploads an image and republishes the caller's own 30030; removing only
 * touches the caller's own set. So this card edits "My emoji" — the only set the
 * caller can publish — and shows the community palette (the read-only union of
 * every member's set) separately, since a member cannot remove someone else's
 * emoji. When shortcodes collide across members, the palette shows one
 * deterministic winner (see `unionCustomEmoji`).
 */
export function CustomEmojiSettingsCard({ host }: { host: CustomEmojiHost }) {
  const t = useUiT();
  const { query, own, community, setEmoji, removeEmoji, unknown } = useEmojiSettings(host);
  const ownLoading = query.isPending;
  const communityLoading = query.isPending;
  const { pickAndUploadMedia, rewriteRelayUrl } = host;

  const [name, setName] = React.useState("");
  const [pendingUpload, setPendingUpload] = React.useState<{
    url: string;
    filename: string | null;
  } | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const normalized = normalizeShortcode(name);
  const nameInvalid = name.trim().length > 0 && normalized === null;
  // "Replace" only applies to MY set — that's the set the upload will rewrite.
  const ownDuplicate =
    normalized !== null && own.some((e) => e.shortcode === normalized);
  const canSubmit =
    pendingUpload !== null &&
    normalized !== null &&
    !isUploading &&
    !setEmoji.isPending;

  const handleUpload = React.useCallback(async () => {
    setIsUploading(true);
    try {
      const blobs = await pickAndUploadMedia();
      const blob = blobs[0];
      if (!blob?.url) {
        return;
      }
      if (!blob.type.startsWith("image/")) {
        toast.error(t("customEmoji.chooseImage"));
        return;
      }
      setPendingUpload({ url: blob.url, filename: blob.filename ?? null });
      const suggested = blob.filename
        ? suggestShortcodeFromFilename(blob.filename)
        : null;
      if (suggested && name.trim().length === 0) {
        setName(suggested);
      }
    } catch (error) {
      toast.error(
        t("customEmoji.uploadFailed"),
      );
    } finally {
      setIsUploading(false);
    }
  }, [name, t, pickAndUploadMedia]);

  const handleAdd = React.useCallback(async () => {
    if (normalized === null || pendingUpload === null) return;
    try {
      const stored = await setEmoji.mutateAsync({
        shortcode: normalized,
        url: pendingUpload.url,
      });
      setName("");
      setPendingUpload(null);
      toast.success(t("customEmoji.added", {name: stored}));
    } catch (error) {
      toast.error(
        t(isOutcomeUnknown(error) ? "platform.audit.unknownResult" : "customEmoji.addFailed"),
      );
    }
  }, [normalized, pendingUpload, setEmoji, t]);

  const handleReset = React.useCallback(() => {
    setName("");
    setPendingUpload(null);
  }, []);

  const handleRemove = React.useCallback(
    async (shortcode: string) => {
      try {
        await removeEmoji.mutateAsync(shortcode);
        toast.success(t("customEmoji.removed", {name: shortcode}));
      } catch (error) {
        toast.error(
          t(isOutcomeUnknown(error) ? "platform.audit.unknownResult" : "customEmoji.removeFailed"),
        );
      }
    },
    [removeEmoji, t],
  );

  // Community emoji owned by someone else (so the caller can't remove them).
  const ownShortcodes = new Set(own.map((e) => e.shortcode));
  const othersEmoji = community.filter((e) => !ownShortcodes.has(e.shortcode));

  if (query.isError) return <ReadFailure error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <section className="min-w-0" data-testid="settings-custom-emoji">
      <SettingsSectionHeader
        title={t("customEmoji.title")}
        description={
          <>
            {t("customEmoji.descriptionBefore")}{" "}
            <code>:name:</code>{t("customEmoji.descriptionAfter")}
          </>
        }
      />

      <div className="space-y-6">
        <form
          className="w-full"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void handleAdd();
          }}
        >
          <SettingsOptionGroup title={t("customEmoji.add")}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-[1_1_22rem]">
                <h4 className="text-sm font-medium">{t("customEmoji.uploadHeading")}</h4>
                <p
                  className="text-sm font-normal text-muted-foreground/70"
                  data-settings-subcopy
                >
                  {t("customEmoji.imageHint")}
                </p>
              </div>
              <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-background">
                  {pendingUpload ? (
                    <img
                      alt={t("customEmoji.preview")}
                      src={rewriteRelayUrl(pendingUpload.url)}
                      className="h-14 w-14 object-contain"
                      draggable={false}
                    />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  {pendingUpload?.filename ? (
                    <p className="max-w-full truncate text-sm font-normal text-muted-foreground">
                      {pendingUpload.filename}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    data-testid="custom-emoji-upload"
                    onClick={() => void handleUpload()}
                    disabled={isUploading || setEmoji.isPending || unknown}
                    variant="outline"
                  >
                    {isUploading
                      ? t("customEmoji.uploading")
                      : pendingUpload
                        ? t("customEmoji.chooseDifferent")
                         : t("customEmoji.upload")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-[1_1_22rem]">
                <h4 className="text-sm font-medium">{t("customEmoji.nameHeading")}</h4>
                <p
                  className="text-sm font-normal text-muted-foreground/70"
                  data-settings-subcopy
                >
                  {t("customEmoji.nameHint")}
                </p>
              </div>
              <div className="w-full min-w-0 max-w-sm flex-[1_1_20rem] space-y-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    :
                  </span>
                  <Input
                    id="custom-emoji-name"
                    data-testid="custom-emoji-name-input"
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="px-6"
                    placeholder="party-parrot"
                    spellCheck={false}
                    disabled={unknown || setEmoji.isPending}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    :
                  </span>
                </div>
                {nameInvalid ? (
                  <p className="text-sm text-destructive">
                    {t("customEmoji.invalidName")}
                  </p>
                ) : pendingUpload === null ? (
                  <p
                    className="text-sm font-normal text-muted-foreground/70"
                    data-settings-subcopy
                  >
                    {t("customEmoji.chooseFirst")}
                  </p>
                ) : ownDuplicate ? (
                  <p
                    className="text-sm font-normal text-muted-foreground/70"
                    data-settings-subcopy
                  >
                    {t("customEmoji.replaceHint", {name: normalized})}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={
                  setEmoji.isPending || unknown || (name.length === 0 && !pendingUpload)
                }
              >
                {t("customEmoji.clear")}
              </Button>
              <Button
                type="submit"
                data-testid="custom-emoji-add"
                disabled={!canSubmit}
              >
                {t(setEmoji.isPending ? "customEmoji.saving" : "customEmoji.save")}
              </Button>
            </div>
          </SettingsOptionGroup>
        </form>

        <div data-testid="custom-emoji-mine">
          {ownLoading ? (
            <SettingsOptionGroup title={t("customEmoji.mine")}>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                {t("platform.loading")}
              </div>
            </SettingsOptionGroup>
          ) : own.length === 0 ? (
            <SettingsOptionGroup title={t("customEmoji.mine")}>
              <div className="px-4 py-3 text-sm font-normal text-muted-foreground">
                {t("customEmoji.empty")}
              </div>
            </SettingsOptionGroup>
          ) : (
            <SettingsOptionGroup title={t("customEmoji.mineCount", {count: own.length})}>
              {own.map((e) => (
                <div
                  key={e.shortcode}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <img
                    alt={`:${e.shortcode}:`}
                    src={rewriteRelayUrl(e.url)}
                    className="h-6 w-6 shrink-0 object-contain"
                    draggable={false}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    :{e.shortcode}:
                  </span>
                  <Button
                    aria-label={t("customEmoji.remove", {name: e.shortcode})}
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleRemove(e.shortcode)}
                    disabled={removeEmoji.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </SettingsOptionGroup>
          )}
        </div>

        {!communityLoading && othersEmoji.length > 0 ? (
          <div data-testid="custom-emoji-community">
            <SettingsOptionGroup
              description={t("customEmoji.communityHint")}
              title={t("customEmoji.communityCount", {count: othersEmoji.length})}
            >
              {othersEmoji.map((e) => (
                <div
                  key={e.shortcode}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <img
                    alt={`:${e.shortcode}:`}
                    src={rewriteRelayUrl(e.url)}
                    className="h-6 w-6 shrink-0 object-contain"
                    draggable={false}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    :{e.shortcode}:
                  </span>
                </div>
              ))}
            </SettingsOptionGroup>
          </div>
        ) : null}
      </div>
    </section>
  );
}
