export * from "@client-kit/platform/react/messages/timeline/channelWindowStore";
import { emptyChannelWindowStore as emptyStore, type ChannelWindowStore as WindowStore } from "@client-kit/platform/react/messages/timeline/channelWindowStore";
import type { ChannelWindowPage as WindowPage, ChannelWindowRow as WindowRow } from "@client-kit/platform/react/forum/channelWindowResponse";
import type { RelayEvent } from "@/shared/api/types";
export type ChannelWindowStore = WindowStore<RelayEvent>;
export type ChannelWindowPage = WindowPage<RelayEvent>;
export type ChannelWindowRow = WindowRow<RelayEvent>;
export const emptyChannelWindowStore = emptyStore<RelayEvent>;
