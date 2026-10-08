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

/** Native-only: Rust rejects a receipt for any other device identity. */
export async function getNsec(expectedPubkey: string): Promise<string> {
  return invokeTauri<string>("get_nsec", { expectedPubkey });
}

export type GeneratePassphraseOptions = { words?: number; separator?: string };

export async function generateBackupPassphrase(options?: GeneratePassphraseOptions): Promise<string> {
  return invokeTauri<string>("generate_backup_passphrase", {
    words: options?.words, separator: options?.separator,
  });
}

/** NIP-49 encryption remains local, serialized with the native identity. */
export async function createNcryptsecBackup(password: string, expectedPubkey: string): Promise<string> {
  return invokeTauri<string>("create_ncryptsec_backup", { password, expectedPubkey });
}

export async function saveNcryptsecCopy(ncryptsec: string, expectedPubkey: string): Promise<string | null> {
  return (await invokeTauri<string | null>("save_ncryptsec_copy", { ncryptsec, expectedPubkey })) ?? null;
}

export type BackupVerification = { pubkey: string; npub: string; matchesCurrentIdentity: boolean };

export async function verifyNcryptsecBackup(ncryptsec: string, password: string, expectedPubkey: string): Promise<BackupVerification> {
  return invokeTauri<BackupVerification>("verify_ncryptsec_backup", { ncryptsec, password, expectedPubkey });
}

export async function persistCurrentIdentity(): Promise<Identity> {
  return fromRawIdentity(
    await invokeTauri<RawIdentity>("persist_current_identity"),
  );
}
