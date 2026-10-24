// DD-133 §3: the Wren user is the Kailo user. The identity key is the OIDC
// issuer + subject of the verified component token (SS-WRN-IDENTITY, the same
// rule as DD-127(9)); display name, avatar, e-mail and locale are the standard
// claims of that token and are refreshed on every login. Nothing here is an
// authorization grant: on a STANDALONE instance the middleware sets `admin`
// only from the applied Core member directory (DD-133(4); false until it is
// delivered), and a GOVERNED instance keeps the Core binding permission as the
// sole authority.
//
// Edge-safe: used by the Next middleware (Web Crypto, no Buffer) and by the
// Node consumers that read the forwarded header.

export const KAILO_USER_HEADER = 'x-kailo-native-user';
// Set (value "1") only for a verified native service-audience token, e.g. the
// native AI service's own calls; such a caller is not a Kailo member.
export const KAILO_SERVICE_HEADER = 'x-kailo-native-service';

export interface KailoUserProfile {
  // sha256 hex of JSON [issuer, subject]. The raw pair is stored only to
  // address Kailo notifications (DD-138(4)), never displayed.
  key: string;
  name: string | null;
  username: string | null;
  email: string | null;
  picture: string | null;
  locale: string | null;
  // STANDALONE: Tenant ADMIN in the applied member directory. GOVERNED: null
  // (Core decides).
  admin: boolean | null;
  // DD-138(4), `07` §4.8.3: the verified OIDC issuer and subject behind `key`,
  // forwarded only on the private Next hop so the instance can address Kailo
  // notifications (Core identifies people by iss+sub). Never shown in the UI;
  // the Node side re-derives `key` from them before storing.
  issuer?: string | null;
  subject?: string | null;
}

const limits = {
  name: 200,
  username: 200,
  email: 320,
  picture: 2048,
  issuer: 2048,
  subject: 255,
};

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return null;
  // Control characters never reach the UI or the database.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function profileLocale(value: unknown): string | null {
  const locale = text(value, 35);
  return locale && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(locale)
    ? locale.replace('_', '-')
    : null;
}

export function profilePicture(value: unknown): string | null {
  const picture = text(value, limits.picture);
  if (!picture) return null;
  try {
    const url = new URL(picture);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function kailoUserKey(
  issuer: string,
  subject: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([issuer, subject])),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function kailoUserFromClaims(
  issuer: string,
  claims: Record<string, unknown>,
  admin: boolean | null,
): Promise<KailoUserProfile> {
  if (typeof claims.sub !== 'string' || !claims.sub.trim())
    throw new Error('A verified subject is required');
  return {
    key: await kailoUserKey(issuer, claims.sub),
    name: text(claims.name, limits.name),
    username: text(claims.preferred_username, limits.username),
    // `07` §4.7.3: e-mail is profile data only, and only once verified.
    email:
      claims.email_verified === true ? text(claims.email, limits.email) : null,
    picture: profilePicture(claims.picture),
    locale: profileLocale(claims.locale),
    admin,
    // DD-138(4): kept only when it is stored verbatim (no trimming/limits
    // change), so it always hashes back to `key`.
    issuer: text(issuer, limits.issuer) === issuer ? issuer : null,
    subject:
      text(claims.sub, limits.subject) === claims.sub ? claims.sub : null,
  };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

export function encodeKailoUser(profile: KailoUserProfile): string {
  return toBase64Url(JSON.stringify(profile));
}

// Only the middleware sets this header, after removing any browser-supplied
// value; a malformed value is treated as absent, never as a partial identity.
export function decodeKailoUser(
  header: string | string[] | undefined | null,
): KailoUserProfile | null {
  if (typeof header !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(header))
    return null;
  try {
    const value = JSON.parse(fromBase64Url(header));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.key !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.key) ||
      ![true, false, null].includes(value.admin)
    )
      return null;
    return {
      key: value.key,
      name: text(value.name, limits.name),
      username: text(value.username, limits.username),
      email: text(value.email, limits.email),
      picture: profilePicture(value.picture),
      locale: profileLocale(value.locale),
      admin: value.admin,
      // DD-138(4): absent or malformed -> undefined (no notification address).
      issuer: text(value.issuer, limits.issuer) ?? undefined,
      subject: text(value.subject, limits.subject) ?? undefined,
    };
  } catch {
    return null;
  }
}

// The name shown for a Kailo user: display name, then login name, then e-mail.
export function kailoUserLabel(
  user: Pick<KailoUserProfile, 'name' | 'username' | 'email'> | null,
): string | null {
  return user ? user.name || user.username || user.email || null : null;
}

// The actor named in Kailo notifications and shares: the Kailo display name
// of the Core member directory, else the login name. The token `name` claim
// is IdP profile data (e.g. given/family name), not the Kailo display name.
export function kailoActorLabel(
  user: Pick<KailoUserProfile, 'username'> | null | undefined,
  listedName: string | null | undefined,
): string | null {
  return listedName || user?.username || null;
}
