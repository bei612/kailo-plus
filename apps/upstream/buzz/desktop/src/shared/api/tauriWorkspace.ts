import { invokeTauri } from "@/shared/api/tauri";

export async function applyCommunity(relayUrl: string): Promise<void> {
  await invokeTauri("apply_workspace", { relayUrl });
}
