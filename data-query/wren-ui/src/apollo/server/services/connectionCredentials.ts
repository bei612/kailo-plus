import { DataSourceName } from '../types';
import {
  decryptConnectionInfo,
  encryptConnectionInfo,
  sensitivePropsOf,
} from '../dataSource';
import {
  ComponentSecretStore,
  ComponentSecretUnavailable,
  KailoActor,
  kailoComponentSecrets,
  SecretValue,
} from './kailoComponentSecrets';

// DD-169(5): where the credentials of a data source connection live.
//
// Kailo mode (the instance has the Kailo service identity): the credential
// fields (`sensitiveProps` of the type) are written to Core component secret
// custody and the stored connection keeps only `kailoSecretId`. The original
// encrypted shape is rebuilt in memory right before a connection is used, so
// `toIbisConnectionInfo` and every Ibis call stay unchanged.
// Independent native deployment (no service identity): the original Encryptor
// storage (SF-WRN-10) is kept as is.

export const KAILO_SECRET_FIELD = 'kailoSecretId';
// Names (never values) of the credential fields Kailo holds, for "已设置".
export const KAILO_SECRET_FIELDS = 'kailoSecretFields';
const REFERENCE_FIELDS = new Set([KAILO_SECRET_FIELD, KAILO_SECRET_FIELDS]);

export class ConnectionCredentialError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type ConnectionInfo = Record<string, any>;

/** Splits a plaintext connection into its general and credential fields. */
export function splitCredentials(
  type: DataSourceName,
  connectionInfo: ConnectionInfo,
): { general: ConnectionInfo; credentials: SecretValue } {
  const sensitive = new Set(sensitivePropsOf(type));
  const general: ConnectionInfo = {};
  const credentials: SecretValue = {};
  for (const [key, value] of Object.entries(connectionInfo || {})) {
    if (REFERENCE_FIELDS.has(key)) continue;
    if (!sensitive.has(key)) {
      general[key] = value;
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string')
      throw new ConnectionCredentialError('INVALID_CONNECTION_CREDENTIAL');
    credentials[key] = value;
  }
  return { general, credentials };
}

/** True when the stored connection keeps its credentials with Kailo. */
export function heldByKailo(connectionInfo: ConnectionInfo | null | undefined) {
  return typeof connectionInfo?.[KAILO_SECRET_FIELD] === 'string';
}

/** True when the stored connection still carries native ciphertext. */
export function hasLocalCredentials(
  type: DataSourceName,
  connectionInfo: ConnectionInfo | null | undefined,
) {
  return sensitivePropsOf(type).some((prop) => !!connectionInfo?.[prop]);
}

export class ConnectionCredentials {
  constructor(private readonly secrets: ComponentSecretStore | null) {}

  /** Kailo holds the credentials of new and edited connections. */
  public get custody(): boolean {
    return this.secrets !== null;
  }

  /**
   * The row to store for a plaintext connection. With custody, the credential
   * fields are written to Kailo first (fail closed: nothing is stored locally
   * when Core refuses or is unavailable).
   */
  public async store(
    type: DataSourceName,
    connectionInfo: ConnectionInfo,
    actor: KailoActor | null,
  ): Promise<{ stored: ConnectionInfo; secretId: string | null }> {
    if (!this.secrets)
      return {
        stored: encryptConnectionInfo(type, connectionInfo as any),
        secretId: null,
      };
    const { general, credentials } = splitCredentials(type, connectionInfo);
    if (!Object.keys(credentials).length)
      return { stored: general, secretId: null };
    if (!actor) throw new ConnectionCredentialError('KAILO_ACTOR_REQUIRED');
    const { secretId } = await this.secrets.write(actor, credentials);
    return {
      stored: {
        ...general,
        [KAILO_SECRET_FIELD]: secretId,
        [KAILO_SECRET_FIELDS]: Object.keys(credentials).sort(),
      },
      secretId,
    };
  }

  /** The stored connection in the native encrypted shape, for one use. */
  public async resolve(
    type: DataSourceName,
    stored: ConnectionInfo,
  ): Promise<ConnectionInfo> {
    if (!heldByKailo(stored)) return { ...stored };
    if (!this.secrets) throw new ComponentSecretUnavailable('read');
    const {
      [KAILO_SECRET_FIELD]: secretId,
      [KAILO_SECRET_FIELDS]: _fields,
      ...general
    } = stored;
    const credentials = await this.secrets.read(secretId);
    return encryptConnectionInfo(type, { ...general, ...credentials } as any);
  }

  /** The stored connection as plaintext (edit merges and migration only). */
  public async plaintext(
    type: DataSourceName,
    stored: ConnectionInfo,
  ): Promise<ConnectionInfo> {
    if (heldByKailo(stored)) {
      if (!this.secrets) throw new ComponentSecretUnavailable('read');
      const {
        [KAILO_SECRET_FIELD]: secretId,
        [KAILO_SECRET_FIELDS]: _fields,
        ...general
      } = stored;
      return { ...general, ...(await this.secrets.read(secretId)) };
    }
    return decryptConnectionInfo(type, { ...stored } as any);
  }

  /** Retires a replaced or deleted connection's credentials. */
  public async retire(
    stored: ConnectionInfo | null | undefined,
    actor: KailoActor | null,
  ): Promise<void> {
    if (!heldByKailo(stored)) return;
    if (!this.secrets) throw new ComponentSecretUnavailable('retire');
    if (!actor) throw new ConnectionCredentialError('KAILO_ACTOR_REQUIRED');
    await this.secrets.retire(actor, stored[KAILO_SECRET_FIELD]);
  }
}

let instance: ConnectionCredentials | undefined;

export function connectionCredentials(): ConnectionCredentials {
  if (!instance) instance = new ConnectionCredentials(kailoComponentSecrets());
  return instance;
}

/** Tests only: replace the process-wide instance. */
export function setConnectionCredentials(value: ConnectionCredentials) {
  instance = value;
}
