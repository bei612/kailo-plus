// DD-164(7): mounted once per signed-in platform scope (Web and Desktop) by
// PlatformProvider; the scope's client reads and writes the account's preferences.
import { useEffect } from "react";
import type { BffClient } from "../client";
import { AccountPreferenceSync } from "../account-preferences";

export function AccountPreferenceSyncMount({ client }: { client: BffClient }) {
  useEffect(() => {
    if (typeof client.accountPreferences !== "function") return;
    return new AccountPreferenceSync(client).start();
  }, [client]);
  return null;
}
