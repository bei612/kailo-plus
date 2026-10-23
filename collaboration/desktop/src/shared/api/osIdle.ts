// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/api/osIdle.ts.
// DD-125(5): the OS idle time feeds the shared presence session's automatic away; it is read
// locally and never leaves the device.
import { invokeTauri } from "@/shared/api/tauri";

/** Seconds since the last OS-wide input, or null where the platform has no idle API. */
export function getOsIdleSeconds(): Promise<number | null> {
  return invokeTauri<number | null>("get_os_idle_seconds");
}
