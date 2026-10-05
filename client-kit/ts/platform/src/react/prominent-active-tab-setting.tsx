import { translate, type PlatformLocale } from "../i18n";
import { Switch } from "./switch";

/** Original Buzz appearance row; the host owns the device preference. */
export function ProminentActiveTabSetting({
  locale,
  prominentActiveTab,
  setProminentActiveTab,
}: {
  locale: PlatformLocale;
  prominentActiveTab: boolean;
  setProminentActiveTab: (enabled: boolean) => void;
}) {
  return (
    <div
      className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 text-sm [@container(max-width:34rem)]:flex-col [@container(max-width:34rem)]:items-start [@container(max-width:34rem)]:[&>[data-slot=segmented-control]]:w-full"
      data-testid="prominent-active-tab-row"
    >
      <div className="min-w-0">
        <label className="text-sm font-medium" htmlFor="prominent-active-tab-switch">
          {translate(locale, "platform.settings.prominentActiveTab")}
        </label>
        <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>
          {translate(locale, "platform.settings.prominentActiveTabDescription")}
        </p>
      </div>
      <Switch
        checked={prominentActiveTab}
        data-testid="prominent-active-tab-toggle"
        id="prominent-active-tab-switch"
        onCheckedChange={setProminentActiveTab}
      />
    </div>
  );
}
