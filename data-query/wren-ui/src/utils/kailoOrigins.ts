// DD-133 (`07` §4.7.1): `<meta name="kailo-web-origin">` is a deployment fact,
// the same KAILO_FRAME_ANCESTORS value the middleware turns into
// frame-ancestors. Only exact http(s) origins are kept; anything else is
// dropped, so a malformed entry can never widen the messaging origin.
export function kailoWebOrigins(raw: string | undefined): string[] {
  const origins: string[] = [];
  for (const entry of raw?.trim().split(/\s+/).filter(Boolean) ?? []) {
    try {
      const url = new URL(entry);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === entry &&
        !origins.includes(entry)
      )
        origins.push(entry);
    } catch {
      // not an origin
    }
  }
  return origins;
}
