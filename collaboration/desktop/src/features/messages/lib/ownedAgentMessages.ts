// DD-142 Desktop host of the original "own Agent" edit/delete
// (Buzz 779af8886caae1317b4de962082429867ab61503 canManageMessageForCurrentUser).
//
// This device's key signs only its own messages (DD-75). A message signed by an Agent whose
// ACTIVE Installation the viewer owns can only be signed by Core with that Agent's SERVER key,
// so the edit/delete goes through the same BFF Workspace publish routes as the Web host
// (`editEventId` / `deleteEventId`). Core re-reads the target, re-checks ownership and fresh
// `manage`, and audits the owner as actor; this module only offers the action and keeps one
// DD-81 idempotency key per intent.
import { WebMessageType, type WebMessageAttachment, type WebPublishMessageRequest } from "@client-kit/contracts";
import type { BffClient } from "@client-kit/platform/client";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import {
  canManageMessageForCurrentUser,
  findSpoileredImetaMediaUrls,
  imetaMediaFromTags,
  restoreImetaMediaDisplayLabels,
  stripImetaMediaLines,
} from "@client-kit/platform/react/messages";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import type { TimelineMessage } from "@/features/messages/types";

/**
 * The owned-Agent set a row may use. Only a Workspace channel has one: a private conversation
 * never offers another signer's message, as on the Web host.
 */
export function ownedAgentScope(
  channelType: string | null | undefined,
  ownedAgentPubkeys: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
  return channelType === "dm" || !ownedAgentPubkeys?.size ? undefined : ownedAgentPubkeys;
}

/** The same rule as the Web host: the viewer's own message, or an owned Agent's in a Workspace channel. */
export function canManageDesktopMessage(
  message: TimelineMessage,
  currentPubkey: string | null | undefined,
  ownedAgentPubkeys: ReadonlySet<string> | undefined,
): boolean {
  return canManageMessageForCurrentUser(message, currentPubkey, ownedAgentPubkeys);
}

/** A manageable message this device cannot sign: it must go through the BFF as its Agent. */
export function isOwnedAgentMessage(
  message: TimelineMessage,
  currentPubkey: string | null | undefined,
  ownedAgentPubkeys: ReadonlySet<string> | undefined,
): boolean {
  const signer = (message.signerPubkey ?? "").toLowerCase();
  return signer !== (currentPubkey ?? "").toLowerCase() && ownedAgentPubkeys?.has(signer) === true &&
    canManageMessageForCurrentUser(message, currentPubkey, ownedAgentPubkeys);
}

export type PublishIntents = <T>(intent: string, publish: (idempotencyKey: string) => Promise<T>) => Promise<T>;

/**
 * One idempotency key per publication intent (DD-81). While an attempt's outcome is unknown a
 * retry of the same intent reuses its key, so Core answers that attempt instead of signing a
 * second event; a confirmed or refused attempt releases it.
 */
export function createPublishIntents(newKey: () => string = newIdempotencyKey): PublishIntents {
  const pending = new Map<string, string>();
  return async (intent, publish) => {
    const key = pending.get(intent) ?? newKey();
    pending.set(intent, key);
    try {
      const result = await publish(key);
      pending.delete(intent);
      return result;
    } catch (error) {
      if (!isOutcomeUnknown(error)) pending.delete(intent);
      throw error;
    }
  };
}

/** Process-wide: an intent left unknown is still answered after the pane remounts. */
const ownedAgentIntents = createPublishIntents();

type Receipt = { eventId: string; operationId: string };

function confirmed(receipt: Receipt | undefined): Receipt {
  if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Publication has no confirmed receipt.");
  return receipt;
}

function attachment(media: ReturnType<typeof imetaMediaFromTags>[number], spoilered: ReadonlySet<string>): WebMessageAttachment {
  const descriptor: WebMessageAttachment & { uploaded?: number } = { ...media };
  delete descriptor.uploaded;
  return spoilered.has(descriptor.url) ? { ...descriptor, spoiler: true } : descriptor;
}

/**
 * The Web edit request from the Desktop composer's output. The composer appends its media as
 * markdown lines plus imeta tags; Core renders `attachments` itself, so those lines leave the
 * body and the imeta entries become attachments. Agent mentions are Installation IDs; only
 * people stay in `mentionPubkeys`.
 */
export function ownedAgentEditRequest(
  message: Pick<TimelineMessage, "id">,
  content: string,
  mentions: readonly string[],
  mediaTags: readonly string[][],
  agentInstallationIds: ReadonlyMap<string, string>,
): WebPublishMessageRequest {
  const media = restoreImetaMediaDisplayLabels(content, imetaMediaFromTags(mediaTags.filter((tag) => tag[0] === "imeta")));
  const spoilered = findSpoileredImetaMediaUrls(content, media);
  const installations = new Set<string>();
  const people = new Set<string>();
  for (const pubkey of mentions) {
    const key = pubkey.toLowerCase();
    const installation = agentInstallationIds.get(key);
    if (installation) installations.add(installation);
    else people.add(key);
  }
  return {
    content: stripImetaMediaLines(content, media).trimEnd(),
    attachments: media.map((item) => attachment(item, spoilered)),
    mentionInstallationIds: [...installations].sort(),
    editEventId: message.id,
    mentionPubkeys: [...people].sort(),
  };
}

export function ownedAgentDeleteRequest(message: Pick<TimelineMessage, "id">): WebPublishMessageRequest {
  return { content: "", attachments: [], mentionInstallationIds: [], messageType: WebMessageType.Stream, deleteEventId: message.id };
}

type MutationClient = Pick<BffClient, "publishWorkspaceMessage" | "deleteWorkspaceMessage">;

/** Intent identity: the scope, the route and the exact request. A changed edit is a new intent. */
function intentOf(scope: string, route: string, request: WebPublishMessageRequest): string {
  return JSON.stringify([scope, route, request]);
}

export async function editOwnedAgentMessage(
  client: MutationClient,
  workspaceId: string,
  scope: string,
  request: WebPublishMessageRequest,
  intents: PublishIntents = ownedAgentIntents,
): Promise<Receipt> {
  if (!request.editEventId) throw new Error("Edit target is unavailable.");
  return intents(intentOf(scope, `edit:${workspaceId}`, request),
    async (key) => confirmed(await client.publishWorkspaceMessage(workspaceId, request, key)));
}

export async function deleteOwnedAgentMessage(
  client: MutationClient,
  workspaceId: string,
  scope: string,
  message: Pick<TimelineMessage, "id">,
  intents: PublishIntents = ownedAgentIntents,
): Promise<Receipt> {
  const request = ownedAgentDeleteRequest(message);
  return intents(intentOf(scope, `delete:${workspaceId}`, request),
    async (key) => confirmed(await client.deleteWorkspaceMessage(workspaceId, request, key)));
}
