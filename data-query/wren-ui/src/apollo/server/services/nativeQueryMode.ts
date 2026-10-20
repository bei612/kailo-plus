// DD-127(7) / DD-124: the single source of this Wren instance's query mode.
//
// The mode is a deployment fact, never a request fact. A Wren instance is
// GOVERNED exactly when its deployment unit delivers a platform query or
// binding configuration (`query-governance.yaml` sets both env names); any
// present value, including an empty or relative path, is GOVERNED and fails
// closed in `loadQueryDelivery` / the middleware. Without either delivery the
// instance is an independently deployed native page (STANDALONE): every
// consumer keeps the original upstream path and never loads a delivery.
//
// Whether a request carries the native OIDC token or identity partition does
// not select the mode. Native OIDC login always yields a token, and only the
// middleware of a GOVERNED instance forwards it to the Node consumers; a
// consumer that inferred the mode from that token would refuse every
// independent request, and one that inferred STANDALONE from its absence would
// open a governed instance. GOVERNED consumers still refuse a missing identity.
//
// Edge-safe: only reads process.env, so middleware and Node share it.

export enum NativeQueryMode {
  STANDALONE = 'STANDALONE',
  GOVERNED = 'GOVERNED',
}

export function nativeQueryMode(): NativeQueryMode {
  return process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
    process.env.WREN_PLATFORM_BINDING_CONFIG_FILE !== undefined
    ? NativeQueryMode.GOVERNED
    : NativeQueryMode.STANDALONE;
}

export function isGovernedQueryMode(): boolean {
  return nativeQueryMode() === NativeQueryMode.GOVERNED;
}
