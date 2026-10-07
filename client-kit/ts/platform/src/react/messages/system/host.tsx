import * as React from "react";
import { UserAvatar as Avatar, type UserAvatarProps } from "../UserAvatar";

export type SystemMessageHost = {
  resolveMediaUrl?: (url: string) => string | undefined;
  ProfilePopover: React.ComponentType<{
    children: React.ReactNode;
    pubkey: string;
    triggerElement?: "div" | "span";
    triggerAriaLabel?: string;
    role?: string;
    botIdenticonValue?: string;
  }>;
  AgentManagementMarker?: React.ComponentType<{
    pubkey?: string;
    ownerPubkey?: string | null;
  }>;
};

const Context = React.createContext<SystemMessageHost | null>(null);

export function SystemMessageHostProvider({ host, children }: {
  host: SystemMessageHost;
  children: React.ReactNode;
}) {
  return <Context.Provider value={host}>{children}</Context.Provider>;
}

function useSystemMessageHost() {
  const host = React.useContext(Context);
  if (!host) throw new Error("System message host unavailable");
  return host;
}

export function UserProfilePopover(props: React.ComponentProps<SystemMessageHost["ProfilePopover"]>) {
  const Component = useSystemMessageHost().ProfilePopover;
  return <Component {...props} />;
}

export function AgentManagementMarker(props: { pubkey?: string; ownerPubkey?: string | null }) {
  const Component = useSystemMessageHost().AgentManagementMarker;
  // An absent device placement projection is not evidence of remote ownership.
  return Component ? <Component {...props} /> : null;
}

export function UserAvatar(props: Omit<UserAvatarProps, "resolveMediaUrl">) {
  const resolve = useSystemMessageHost().resolveMediaUrl;
  return <Avatar {...props} resolveMediaUrl={(url) => resolve?.(url) ?? ""} />;
}
