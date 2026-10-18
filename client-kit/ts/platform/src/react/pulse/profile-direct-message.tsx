// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/ui/useProfileInteractionActions.ts::handleMessage: the hover
// card's Message action opens (or reuses) the 1:1 conversation and navigates to it. The host
// supplies its existing governed DM open path; without a host the action is not rendered.
import * as React from "react";

export type ProfileDirectMessageHost = {
  /** True only when this pubkey is known not to belong to the signed-in person. */
  canMessage: (pubkey: string) => boolean;
  /** The host's existing open-and-navigate path; rejects with a displayable Error. */
  open: (pubkey: string) => Promise<void>;
};

const ProfileDirectMessageContext = React.createContext<ProfileDirectMessageHost | null>(null);

export function ProfileDirectMessageProvider({ value, children }: { value: ProfileDirectMessageHost; children: React.ReactNode }) {
  return <ProfileDirectMessageContext.Provider value={value}>{children}</ProfileDirectMessageContext.Provider>;
}

export function useProfileDirectMessage(): ProfileDirectMessageHost | null {
  return React.useContext(ProfileDirectMessageContext);
}
