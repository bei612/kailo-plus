// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/settings/UpdateChecker.tsx.
// DD-125(5): the original Updates section. Copy comes from the shared catalog and colours from
// the DD-141 roles; the manual-download page is the configured release page (none: no link).
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { translate, type PlatformMessageKey } from "@client-kit/platform/i18n";
import { Button } from "@/shared/ui/button";
import { useUpdaterContext } from "./hooks/UpdaterProvider";
import { SettingsOptionGroup, SettingsOptionRow } from "./ui/SettingsOptionGroup";
import { SettingsSectionHeader } from "./ui/SettingsSectionHeader";

function StatusCopy({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-normal text-muted-foreground" data-settings-subcopy>
        {children}
      </p>
    </div>
  );
}

export function UpdateChecker() {
  const locale = useDeviceLocale();
  const t = (key: PlatformMessageKey, variables?: Record<string, string>) =>
    translate(locale, key, variables);
  const { status, releaseUrl, checkForUpdate, installAndRelaunch } = useUpdaterContext();

  return (
    <section className="min-w-0" data-testid="settings-updates">
      <SettingsSectionHeader title={t("updates.title")} description={t("updates.description")} />

      <SettingsOptionGroup title={t("updates.statusGroup")}>
        {status.state === "idle" && (
          <SettingsOptionRow>
            <StatusCopy>{t("updates.idle")}</StatusCopy>
            <Button size="sm" onClick={checkForUpdate}>{t("updates.check")}</Button>
          </SettingsOptionRow>
        )}

        {status.state === "checking" && (
          <SettingsOptionRow role="status">
            <StatusCopy>{t("updates.checking")}</StatusCopy>
          </SettingsOptionRow>
        )}

        {status.state === "up-to-date" && (
          <SettingsOptionRow>
            <StatusCopy>{t("updates.upToDate")}</StatusCopy>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>{t("updates.checkAgain")}</Button>
          </SettingsOptionRow>
        )}

        {status.state === "unavailable" && (
          <SettingsOptionRow data-testid="settings-updates-unavailable">
            <StatusCopy>{t(releaseUrl ? "updates.unavailableManual" : "updates.unavailable")}</StatusCopy>
            <div className="flex shrink-0 items-center gap-2">
              {releaseUrl ? (
                <Button variant="outline" size="sm" onClick={() => void openUrl(releaseUrl)}>
                  {t("updates.openReleasePage")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={checkForUpdate}>{t("updates.checkAgain")}</Button>
            </div>
          </SettingsOptionRow>
        )}

        {status.state === "manual-required" && (
          <SettingsOptionRow>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t("updates.manualTitle", { version: status.version })}
              </p>
              <p className="text-sm font-normal text-muted-foreground" data-settings-subcopy>
                {t(status.releaseUrl ? "updates.manualLinux" : "updates.manualLinuxNoLink")}
              </p>
            </div>
            {status.releaseUrl ? (
              <Button size="sm" onClick={() => void openUrl(status.releaseUrl!)}>{t("updates.download")}</Button>
            ) : null}
          </SettingsOptionRow>
        )}

        {status.state === "available" && (
          <SettingsOptionRow role="status"><StatusCopy>{t("updates.preparing")}</StatusCopy></SettingsOptionRow>
        )}

        {status.state === "downloading" && (
          <SettingsOptionRow role="status"><StatusCopy>{t("updates.downloading")}</StatusCopy></SettingsOptionRow>
        )}

        {status.state === "installing" && (
          <SettingsOptionRow role="status"><StatusCopy>{t("updates.installing")}</StatusCopy></SettingsOptionRow>
        )}

        {status.state === "ready" && (
          <SettingsOptionRow>
            <StatusCopy>{t("updates.ready")}</StatusCopy>
            <Button size="sm" onClick={installAndRelaunch}>{t("updates.updateNow")}</Button>
          </SettingsOptionRow>
        )}

        {status.state === "error" && (
          <SettingsOptionRow role="alert">
            <div className="min-w-0">
              <p className="text-sm font-normal text-danger-text">
                {t("updates.failed", { message: status.message })}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={checkForUpdate}>{t("updates.retry")}</Button>
          </SettingsOptionRow>
        )}
      </SettingsOptionGroup>
    </section>
  );
}
