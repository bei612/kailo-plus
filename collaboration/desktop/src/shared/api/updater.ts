// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/api/tauri.ts
// (isAutoUpdateSupported), plus the release page from the Desktop release configuration
// (DD-125(5)): null when the build was packaged without one.
import { invokeTauri } from "@/shared/api/tauri";

export function isAutoUpdateSupported(): Promise<boolean> {
  return invokeTauri<boolean>("is_auto_update_supported");
}

export function getUpdaterReleaseUrl(): Promise<string | null> {
  return invokeTauri<string | null>("updater_release_url");
}
