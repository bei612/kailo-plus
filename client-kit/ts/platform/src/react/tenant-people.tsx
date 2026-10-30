// DD-168(1)(2): owners are shown and chosen by name, never by Principal ID. The
// authorized directory of this Tenant's ACTIVE human members is the existing
// `/api/v1/conversation-participants` read (same Tenant, fresh `discover`); a
// member who is not in it is no longer an ACTIVE member of the organization.
import type { ConversationParticipant, ConversationParticipantPage } from "@client-kit/contracts";
import type { BffClient } from "../client";
import { TransportError } from "../transport";
import { useBffClient, useT } from "./context";
import { type Loaded, useLoad } from "./use-load";

/** Upper bound on directory pages read for one view; a longer directory fails closed. */
const MAX_PAGES = 50;

export type TenantPerson = Pick<ConversationParticipant, "principalId" | "displayName" | "picture">;

function validPerson(person: ConversationParticipant): boolean {
  return !!person && typeof person.principalId === "string" && !!person.principalId
    && typeof person.displayName === "string"
    && (person.picture === undefined || typeof person.picture === "string");
}

/** Every page of the Tenant's ACTIVE human directory; a malformed or looping page fails closed. */
export async function loadTenantPeople(client: Pick<BffClient, "conversationParticipants">): Promise<TenantPerson[]> {
  const people = new Map<string, TenantPerson>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer: ConversationParticipantPage = await client.conversationParticipants(cursor);
    if (!answer || !Array.isArray(answer.items) || !answer.items.every(validPerson)
      || (answer.nextCursor !== undefined && (typeof answer.nextCursor !== "string" || !answer.nextCursor
        || seen.has(answer.nextCursor)))) throw new TransportError("Invalid tenant member directory");
    for (const person of answer.items) {
      people.set(person.principalId, { principalId: person.principalId, displayName: person.displayName, picture: person.picture });
    }
    if (!answer.nextCursor) return [...people.values()];
    seen.add(answer.nextCursor);
    cursor = answer.nextCursor;
  }
  throw new TransportError("Tenant member directory exceeds the page bound");
}

export type TenantPeople = {
  state: Loaded<TenantPerson[]>;
  reload: () => void;
  /** The member's display name; `undefined` while loading or when the read failed. */
  name: (principalId: string) => string | undefined;
  /** True only when the directory was read and the Principal is not an ACTIVE member. */
  departed: (principalId: string) => boolean;
};

export function useTenantPeople(key = ""): TenantPeople {
  const client = useBffClient();
  const [state, reload] = useLoad(`tenant-people:${key}`, () => loadTenantPeople(client));
  const people = state.status === "ok" ? state.data : null;
  return {
    state,
    reload,
    name: (principalId) => {
      const person = people?.find((row) => row.principalId === principalId);
      return person ? person.displayName.trim() || undefined : undefined;
    },
    departed: (principalId) => !!people && !people.some((row) => row.principalId === principalId),
  };
}

/**
 * The owner as a person: display name, or a definite state while the directory is
 * unread, unreadable or no longer lists them. Never the Principal ID.
 */
export function OwnerName({ people, principalId }: { people: TenantPeople; principalId: string }) {
  const t = useT();
  const status = people.state.status;
  const text = status === "pending" ? t("platform.loading")
    : status === "error" ? t("owner.unavailable")
    : people.departed(principalId) ? t("owner.departed")
    : people.name(principalId) ?? t("owner.unnamed");
  return <span data-testid="owner-name" data-owner-state={status === "ok" && people.departed(principalId) ? "departed" : status}>{text}</span>;
}
