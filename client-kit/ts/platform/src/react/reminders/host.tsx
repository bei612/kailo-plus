import * as React from "react";
import type { ReminderPublishRequest } from "@client-kit/contracts";
import type { Reminder, ReminderTarget } from "./lib/reminderTypes";

export type ReminderSource = {
  authorLabel: string;
  avatarUrl: string | null;
  channel: {channelType: string} | null;
  channelLabel: string;
  isAgent?: boolean;
};

/** Only custody/transport/navigation differ; both hosts consume the original UI. */
export type ReminderHost = {
  scopeKey: string;
  pubkey: string;
  query: () => Promise<Reminder[]>;
  publish: (request: ReminderPublishRequest, idempotencyKey: string, observeOnly:boolean,
    observation:{eventId?:string;onPrepared:(eventId:string)=>void}) => Promise<{eventId:string}>;
  completePublication?: (idempotencyKey:string,eventId:string)=>void;
  source: (target: ReminderTarget) => Promise<ReminderSource>;
  navigate: (target: ReminderTarget) => Promise<void>;
};
const Context = React.createContext<ReminderHost | null>(null);
export function ReminderHostProvider({host,children}:{host:ReminderHost;children:React.ReactNode}) {
  return <Context.Provider value={host}>{children}</Context.Provider>;
}
export function useReminderHost() {
  const host=React.useContext(Context);
  if(!host)throw new Error("Reminder host unavailable");
  return host;
}
