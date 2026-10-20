// DD-125(5), V-SCN-140: the original GIF option on Web. The BFF answers whether the Relay
// advertises it and which image origins the deployment registered; those are also the only
// origins the static CSP appends to img-src. Nothing here talks to the Relay or the provider.
import { QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";
import type { WebGifCapabilityView } from "@client-kit/contracts";
import { bff } from "@/platform/bff-client";

export const GIF_CAPABILITY_QUERY_KEY = ["platform", "gif-capability"] as const;
const GIF_CAPABILITY_STALE_MS = 5 * 60_000;

const gifCapabilityQuery = {
  queryKey: GIF_CAPABILITY_QUERY_KEY,
  queryFn: (): Promise<WebGifCapabilityView> => bff.gifCapability(),
  staleTime: GIF_CAPABILITY_STALE_MS,
  retry: 1,
};

/** The composer's picker gate (original relayKlipyEndpoints capability query). */
export function useGifCapability(enabled: boolean) {
  return useQuery({ ...gifCapabilityQuery, enabled });
}

/** An imeta-less image may load only from a registered https origin. */
export function isRegisteredGifUrl(src: string | undefined, origins: readonly string[]): boolean {
  if (!src || origins.length === 0) return false;
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin);
  } catch {
    return false;
  }
}

/**
 * Registered GIF origins for message rendering. Message bodies render in many hosts; without a
 * query client (or before the answer) nothing external is loaded and the link stays a link.
 */
export function useRegisteredGifOrigins(): readonly string[] {
  const client = useContext(QueryClientContext);
  const [origins, setOrigins] = useState<readonly string[]>(
    () => client?.getQueryData<WebGifCapabilityView>(GIF_CAPABILITY_QUERY_KEY)?.imageOrigins ?? [],
  );
  useEffect(() => {
    if (!client) return;
    let current = true;
    client.fetchQuery(gifCapabilityQuery)
      .then((view) => { if (current && Array.isArray(view.imageOrigins)) setOrigins(view.imageOrigins); })
      .catch(() => { /* The option stays off: the URL renders as a plain link. */ });
    return () => { current = false; };
  }, [client]);
  return origins;
}
