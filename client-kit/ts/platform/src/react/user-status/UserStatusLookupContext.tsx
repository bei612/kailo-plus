// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/UserStatusLookupContext.tsx: one batched status read shared
// by every mounted name indicator (mounted by PresenceHostProvider instead of the root route).
import * as React from "react";

import { normalizePubkey } from "../conversations/pubkey";
import { useUserStatusQuery } from "./hooks";
import type { UserStatusLookup } from "./types";

const EMPTY_USER_STATUS_LOOKUP: UserStatusLookup = {};

type UserStatusLookupContextValue = {
  lookup: UserStatusLookup;
  register: (pubkey: string) => () => void;
};

const UserStatusLookupContext =
  React.createContext<UserStatusLookupContextValue | null>(null);

/** Batches the status lookup shared by every mounted name indicator. */
export function UserStatusLookupProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [registrations, setRegistrations] = React.useState<
    ReadonlyMap<string, number>
  >(new Map());

  const register = React.useCallback((value: string) => {
    const pubkey = normalizePubkey(value);
    if (!pubkey) return () => {};

    let active = true;
    setRegistrations((current) => {
      const next = new Map(current);
      next.set(pubkey, (next.get(pubkey) ?? 0) + 1);
      return next;
    });

    return () => {
      if (!active) return;
      active = false;
      setRegistrations((current) => {
        const count = current.get(pubkey) ?? 0;
        if (count === 0) return current;
        const next = new Map(current);
        if (count === 1) next.delete(pubkey);
        else next.set(pubkey, count - 1);
        return next;
      });
    };
  }, []);

  const pubkeys = React.useMemo(
    () => [...registrations.keys()].sort(),
    [registrations],
  );
  const pubkeysKey = pubkeys.join(":");
  const deferredPubkeys = React.useDeferredValue(pubkeys);
  const deferredPubkeysKey = deferredPubkeys.join(":");
  const queriedPubkeys =
    pubkeysKey === deferredPubkeysKey ? pubkeys : deferredPubkeys;
  const statusQuery = useUserStatusQuery(queriedPubkeys, true);
  const value = React.useMemo(
    () => ({
      lookup: statusQuery.data ?? EMPTY_USER_STATUS_LOOKUP,
      register,
    }),
    [register, statusQuery.data],
  );

  return (
    <UserStatusLookupContext.Provider value={value}>
      {children}
    </UserStatusLookupContext.Provider>
  );
}

export function useUserStatusLookupContext() {
  return React.useContext(UserStatusLookupContext);
}
