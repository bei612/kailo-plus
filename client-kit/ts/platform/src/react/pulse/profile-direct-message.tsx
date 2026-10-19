// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/useProfileInteractionActions.ts::handleMessage/handleWave: the
// hover card's and profile panel's Message action opens (or reuses) the 1:1 conversation and
// navigates to it; Wave does the same and then sends the marked wave message there. The host
// supplies its existing governed DM open and publication path; without a host the actions are
// not rendered.
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../context";

export type ProfileDirectMessageHost = {
  /** True only when this pubkey is known not to belong to the signed-in person. */
  canMessage: (pubkey: string) => boolean;
  /** The host's existing open-and-navigate path; rejects with a displayable Error. */
  open: (pubkey: string) => Promise<void>;
  /**
   * DD-125(3) original handleWave: open (or reuse) the 1:1 conversation, navigate to it (then
   * `onNavigated`), and publish the original marked wave kind:9 through the host's governed DM
   * publication. Absent when the host cannot publish there.
   */
  wave?: (pubkey: string, onNavigated?: () => void) => Promise<void>;
  /** Original canWave: a person (not an agent) other than the signed-in one. */
  canWave?: (pubkey: string) => boolean;
};

const ProfileDirectMessageContext = React.createContext<ProfileDirectMessageHost | null>(null);

export function ProfileDirectMessageProvider({ value, children }: { value: ProfileDirectMessageHost; children: React.ReactNode }) {
  return <ProfileDirectMessageContext.Provider value={value}>{children}</ProfileDirectMessageContext.Provider>;
}

export function useProfileDirectMessage(): ProfileDirectMessageHost | null {
  return React.useContext(ProfileDirectMessageContext);
}

/**
 * Original useProfileInteractionActions wave branch for a profile surface: available for another
 * person the host can message (agents are not offered), one attempt at a time, failures shown as
 * the original toast. `onNavigated` closes the surface once the conversation is open, before the
 * publication settles, as the original did.
 */
export function useProfileWave(pubkey: string | undefined, onNavigated?: () => void) {
  const t = useUiT();
  const host = useProfileDirectMessage();
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inFlight = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const wave = host?.wave;
  const canWave = Boolean(pubkey && wave && host?.canMessage(pubkey) && host.canWave?.(pubkey) !== false);
  const onWave = React.useCallback(() => {
    if (!pubkey || !wave || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    void wave(pubkey, onNavigated).catch((error: unknown) => {
      toast.error(error instanceof Error && error.message ? error.message : t("platform.profile.waveFailed"));
    }).finally(() => {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    });
  }, [onNavigated, pubkey, t, wave]);
  return { onWave: canWave ? onWave : undefined, pending };
}
