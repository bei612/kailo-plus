import { hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools/pure";

import { TEST_IDENTITIES } from "./bridge";

// =============================================================================
// Hard-dataset relay seeder — GUI read-model overhaul (Dawn's lane)
// =============================================================================
//
// Publishes REAL signed Nostr events through the relay ingest path
// (`POST /events`), never raw SQL. This is the load-bearing fidelity choice:
// `thread_metadata` (depth, root, reply counts) is computed AT INGEST
// (buzz-relay/src/handlers/ingest.rs). Eva's channel-window surface reads that
// metadata; a raw-SQL bulk load would bypass computation and hand the window
// surface empty/wrong summaries — a false green. See
// PLANS/GUI_OVERHAUL_TEST_HARNESS_DAWN.md.
//
// Transport auth: the test relay runs BUZZ_REQUIRE_AUTH_TOKEN=false
// (start-relay-for-tests.sh), so `POST /events` accepts a plain `X-Pubkey`
// header (bridge.rs verify_bridge_auth dev fallback). The EVENT is still fully
// signed — only the per-request NIP-98 auth envelope is skipped. `POST /events`
// ingests ONE event per request, so bulk seeding parallelizes with a bounded
// concurrency pool. Authors must be seeded channel members
// (setup-desktop-test-data.sh seeds tyler/alice/bob/charlie into `general`),
// which `enforce_relay_membership` requires.
//
// Canonical tag shapes (crates/buzz-sdk/src/builders.rs thread_tags + ingest):
//   top-level : ["h", channelId]                       — no e-tag → depth NULL
//   direct    : ["e", parentId, "", "reply"]           — reply alone; root=parent
//   nested    : ["e", rootId, "", "root"],
//               ["e", parentId, "", "reply"]           — depth N
//   reaction  : kind 7, ["e", targetId], ["h", channelId], content = emoji
//   deletion  : kind 5, ["e", targetId]
// A reply carrying ONLY ["e", id, "", "root"] (no "reply" marker) is stored
// WITHOUT thread_metadata (ingest.rs returns None) — the "legacy/spurious row"
// shape used to probe contract-v1.1 item 7 (`depth IS NULL` = top-level).

const KIND_MESSAGE = 9;

const DEFAULT_RELAY_HTTP =
  process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000";

type IdentityName = keyof typeof TEST_IDENTITIES;

export type SeededEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
};

/** A signer bound to one seeded identity. */
class Signer {
  readonly pubkey: string;
  private readonly sk: Uint8Array;

  constructor(privateKeyHex: string) {
    this.sk = hexToBytes(privateKeyHex);
    this.pubkey = getPublicKey(this.sk);
  }

  sign(template: EventTemplate): NostrEvent {
    return finalizeEvent(template, this.sk);
  }
}

const signerCache = new Map<string, Signer>();

function signerFor(name: IdentityName): Signer {
  const cached = signerCache.get(name);
  if (cached) return cached;
  const signer = new Signer(TEST_IDENTITIES[name].privateKey);
  signerCache.set(name, signer);
  return signer;
}

export type SeedOptions = {
  relayHttpUrl?: string;
  /** Max in-flight POST /events requests. */
  concurrency?: number;
};

/**
 * POST one signed event through the relay ingest path. Throws on non-2xx so a
 * broken seed fails loudly rather than producing a silently-partial dataset.
 */
async function publishEvent(
  event: NostrEvent,
  relayHttpUrl: string,
): Promise<void> {
  const response = await fetch(`${relayHttpUrl}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Dev-mode transport auth; the event body is fully signed regardless.
      "X-Pubkey": event.pubkey,
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "<no body>");
    throw new Error(
      `POST /events failed (${response.status}) for kind ${event.kind} ${event.id.slice(0, 8)}: ${detail}`,
    );
  }
}

/**
 * Publish a batch with bounded concurrency, preserving ORDER GUARANTEES the
 * caller encodes as `barrier` boundaries: events within one barrier group may
 * publish concurrently, but a group only starts once every earlier group has
 * fully landed. Thread replies MUST NOT race their parents — ingest hard-errors
 * on an unknown parent (ingest.rs "reply parent not found") — so parents go in
 * an earlier group than their children.
 */
async function publishGroups(
  groups: NostrEvent[][],
  relayHttpUrl: string,
  concurrency: number,
): Promise<void> {
  for (const group of groups) {
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const worker = async () => {
      while (cursor < group.length) {
        const event = group[cursor];
        cursor += 1;
        await publishEvent(event, relayHttpUrl);
      }
    };
    for (let i = 0; i < Math.min(concurrency, group.length); i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }
}

// ── Event builders (canonical tag shapes) ────────────────────────────────────

function buildMessage(
  signer: Signer,
  channelId: string,
  content: string,
  createdAt: number,
  extraTags: string[][] = [],
): NostrEvent {
  return signer.sign({
    kind: KIND_MESSAGE,
    content,
    created_at: createdAt,
    tags: [["h", channelId], ...extraTags],
  });
}

function nestedReplyTags(rootId: string, parentId: string): string[][] {
  return [
    ["e", rootId, "", "root"],
    ["e", parentId, "", "reply"],
  ];
}

const toRow = (e: NostrEvent): SeededEvent => ({
  id: e.id,
  kind: e.kind,
  pubkey: e.pubkey,
  created_at: e.created_at,
  content: e.content,
  tags: e.tags,
});

const AUTHORS: IdentityName[] = ["tyler", "alice", "bob", "charlie"];

// ── Scenario builders ────────────────────────────────────────────────────────
//
// Each scenario returns { groups, expected }:
//  - groups: ordered barrier groups for publishGroups (parents before children)
//  - expected: the ground-truth SeededEvent[] the correctness suite asserts the
//    GUI must render (or, for aux/deleted, reason about) — the "every event the
//    relay returns must render" contract.

export type Scenario = {
  name: string;
  groups: NostrEvent[][];
  expected: SeededEvent[];
};

/**
 * Dense same-second wall: `count` top-level messages all at ONE created_at.
 * The exact keyset hazard — a bare `until` cursor can never advance past a
 * single second holding more rows than one page. All independent → one group.
 */
export function denseSecondWall(opts: {
  channelId: string;
  second: number;
  count: number;
}): Scenario {
  const { channelId, second, count } = opts;
  const events: NostrEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const signer = signerFor(AUTHORS[i % AUTHORS.length]);
    events.push(buildMessage(signer, channelId, `dense ${i}`, second));
  }
  return {
    name: "dense-second-wall",
    groups: [events],
    expected: events.map(toRow),
  };
}

/**
 * Backdated events: `created_at` older than publish order — the author-clock
 * hazard that broke the created_at-anchored pager. Independent tops → one group.
 */
export function backdated(opts: {
  channelId: string;
  now: number;
  count: number;
}): Scenario {
  const { channelId, now, count } = opts;
  const events: NostrEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    // Publish newest-first but stamp them progressively OLDER: the wire arrival
    // order and the created_at order deliberately disagree.
    const createdAt = now - (i + 1) * 37;
    const signer = signerFor(AUTHORS[i % AUTHORS.length]);
    events.push(
      buildMessage(
        signer,
        channelId,
        `backdated ${i} @${createdAt}`,
        createdAt,
      ),
    );
  }
  return { name: "backdated", groups: [events], expected: events.map(toRow) };
}

/**
 * Ancestor-island cursor poisoning (Dawn's Jul-2 root cause + Wren's Jul-3
 * proven repro `239cc161`): the disease the read-model overhaul deletes.
 *
 * On main, the cold channel load paints the newest `CHANNEL_HISTORY_LIMIT` (60)
 * top-level rows. If one of those rows is a reply whose root/parent is OUTSIDE
 * that window, `useLoadMissingAncestors` fetches that old root by id and merges
 * it into the SAME channel cache — a non-contiguous "island". The older-history
 * pager then anchors `oldestTimestamp = baseline[0].created_at` on the island
 * (the injected old root), so every scroll-up pages backward FROM the island and
 * permanently skips the real history between the island and the true frontier.
 * CLI `/query` returns those `gap-*` rows; the GUI never requests them → RED.
 *
 * Shape (all inside the ±120s ingest window — the boundary here is ROW COUNT
 * (60), not time, so timestamps stay tight around NOW):
 *   - 1 old thread root at `now - oldRootOffset` (default 115s)
 *   - `gapCount` `gap-*` top-levels between the old root and the newest window
 *   - `newestCount` (> 60) `new-*` top-levels at the newest seconds, exactly ONE
 *     of which is a reply whose root+parent point at the old root → the trigger
 *
 * Barrier ordering: the old root must land before the reply that references it
 * (ingest rejects an unknown parent), so the reply is its own later group.
 *
 * `expected` is the `gap-*` set — the contract is "every gap row CLI returns
 * must render". RED on main (0 reachable); GREEN on the windowed read model.
 */
export function ancestorIsland(opts: {
  channelId: string;
  gapCount: number;
  newestCount: number;
  now?: number;
  /** Seconds below NOW for the old island root. Default 115 (inside ±120s). */
  oldRootOffset?: number;
  /**
   * Per-run isolation tag. The suite seeds into shared `general`, so every run
   * accumulates rows; without a unique marker, a prior run's `gap` rows inflate
   * the reachable set and false-green the parity assertion (observed 2026-07-03:
   * a contaminated relay "passed" in 3.3s while a clean channel is RED with
   * `seen.size === 0`). Callers pass a unique nonce and assert only against this
   * run's expected set. Default is time+random so ad-hoc calls are still safe.
   */
  nonce?: string;
}): Scenario {
  const {
    channelId,
    gapCount,
    newestCount,
    now = Math.floor(Date.now() / 1000),
    oldRootOffset = 115,
    nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  } = opts;

  const oldRootSecond = now - oldRootOffset;
  const oldRoot = buildMessage(
    signerFor("tyler"),
    channelId,
    `island root ${nonce}`,
    oldRootSecond,
  );

  // Gap rows: strictly between the old root and the newest window. Spread them
  // across the seconds just above the old root so none collide with it.
  const gapTop = now - 10; // newest gap second, still below the newest window
  const gapBottom = oldRootSecond + 1;
  const gapSpan = Math.max(1, gapTop - gapBottom);
  const gap: NostrEvent[] = [];
  const gapExpected: SeededEvent[] = [];
  for (let i = 0; i < gapCount; i += 1) {
    const signer = signerFor(AUTHORS[i % AUTHORS.length]);
    const second = gapBottom + (i % gapSpan);
    const event = buildMessage(signer, channelId, `gap ${nonce} ${i}`, second);
    gap.push(event);
    gapExpected.push(toRow(event));
  }

  // Newest window: `newestCount` rows at the top seconds. One is a reply to the
  // old root (the ancestor-fetch trigger); the rest are plain top-levels.
  const newestBottom = now - 9;
  const newest: NostrEvent[] = [];
  const replyIndex = Math.floor(newestCount / 2);
  for (let i = 0; i < newestCount; i += 1) {
    const signer = signerFor(AUTHORS[i % AUTHORS.length]);
    const second = newestBottom + (i % 10);
    if (i === replyIndex) {
      newest.push(
        buildMessage(
          signer,
          channelId,
          `new ${nonce} ${i} (reply to island root)`,
          second,
          nestedReplyTags(oldRoot.id, oldRoot.id),
        ),
      );
    } else {
      newest.push(buildMessage(signer, channelId, `new ${nonce} ${i}`, second));
    }
  }

  const reply = newest[replyIndex];
  const nonReplyNewest = newest.filter((_, i) => i !== replyIndex);

  // Group 1: old root + gap + newest (except the cross-gap reply). Group 2: the
  // reply (its parent/root is the old root, which must land first).
  return {
    name: "ancestor-island",
    groups: [[oldRoot, ...gap, ...nonReplyNewest], [reply]],
    expected: gapExpected,
  };
}

/**
 * Publish an already-built scenario, returning the ground-truth expected set.
 */
export async function seedScenario(
  scenario: Scenario,
  options: SeedOptions = {},
): Promise<SeededEvent[]> {
  const relayHttpUrl = options.relayHttpUrl ?? DEFAULT_RELAY_HTTP;
  const concurrency = options.concurrency ?? 16;
  await publishGroups(scenario.groups, relayHttpUrl, concurrency);
  return scenario.expected;
}
