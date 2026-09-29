import { invokeTauri } from "@/shared/api/tauri";
import type { Identity, IdentityStorage } from "@/shared/api/types";

type RawIdentity = {
  pubkey: string;
  display_name: string;
  storage?: IdentityStorage;
  lost?: boolean;
  locked?: boolean;
};

function fromRawIdentity(raw: RawIdentity): Identity {
  return {
    pubkey: raw.pubkey,
    displayName: raw.display_name,
    storage: raw.storage,
    lost: raw.lost === true,
    locked: raw.locked === true,
  };
}

export async function getIdentity(): Promise<Identity> {
  return fromRawIdentity(await invokeTauri<RawIdentity>("get_identity"));
}

export async function persistCurrentIdentity(): Promise<Identity> {
  return fromRawIdentity(
    await invokeTauri<RawIdentity>("persist_current_identity"),
  );
}
