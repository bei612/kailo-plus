// DD-125(6), V-SCN-143: the Web side of the shared transcript stream seam.
// Kept out of bff-client so hosts and tests that replace that module keep their
// own surface; only the platform session probe is borrowed from it at runtime.
import type { AgentTranscriptEvent } from "@client-kit/contracts";
import type { AgentTranscriptStreamOpener } from "@client-kit/platform/client";
import { BffError, SessionEndedError } from "@client-kit/platform/transport";
import { bff } from "./bff-client";

/** The Core route of the live Agent transcript (SSE retry/live/transcript/closed). */
export function agentTranscriptStreamPath(installationId: string): string {
  return `/api/v1/agent-installations/${encodeURIComponent(installationId)}/transcript/stream`;
}

/** Closed reasons that end the stream for good: audit, session or key revoked. */
const FINAL_REASONS = new Set(["scope-revoked", "session-revoked", "identity-revoked"]);

/**
 * Open one Installation's live transcript. Core admits Installation `audit` at
 * open and on its periodic readmission and writes the ACCESS audit; frames are
 * forwarded native items, never stored. Like `openStream`, a broken connection
 * first re-confirms the platform session (fresh, never a settled read), then
 * reopens after the server-sent retry interval; without a known interval it
 * reports `closed` instead of inventing one.
 */
export const openAgentTranscriptStream: AgentTranscriptStreamOpener = (installationId, onEvent, onState) => {
  let source: EventSource | undefined;
  let retryMillis: number | undefined;
  let reopen: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let connectedOnce = false;
  const stop = (reason: string) => {
    stopped = true;
    clearTimeout(reopen);
    reopen = undefined;
    source?.close();
    source = undefined;
    onState("closed", reason);
  };
  const recover = async () => {
    try {
      await bff.session({ fresh: true });
    } catch (error) {
      if (stopped) return;
      if (error instanceof SessionEndedError || (error instanceof BffError && (error.status === 401 || error.status === 403))) {
        stop("session-revoked");
        return;
      }
      if (retryMillis !== undefined) reopen = setTimeout(() => { void recover(); }, retryMillis);
      else onState("closed", "disconnected");
      return;
    }
    if (stopped) return;
    if (retryMillis !== undefined) reopen = setTimeout(open, retryMillis);
    else onState("closed", "disconnected");
  };
  const open = () => {
    if (stopped) return;
    clearTimeout(reopen);
    reopen = undefined;
    onState(connectedOnce ? "reconnecting" : "connecting");
    const es = new EventSource(agentTranscriptStreamPath(installationId));
    source = es;
    es.addEventListener("retry", (e) => {
      if (stopped || source !== es) return;
      const ms = Number((e as MessageEvent<string>).data);
      if (Number.isFinite(ms) && ms > 0) retryMillis = ms;
    });
    es.addEventListener("live", () => {
      if (stopped || source !== es) return;
      connectedOnce = true;
      onState("live");
    });
    es.addEventListener("transcript", (e) => {
      if (stopped || source !== es) return;
      let frame: unknown;
      try {
        frame = JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (frame !== null && typeof frame === "object"
        && (frame as { installationId?: unknown }).installationId === installationId) {
        onEvent(frame as AgentTranscriptEvent);
      }
    });
    es.addEventListener("closed", (e) => {
      if (stopped || source !== es) return;
      const reason = (e as MessageEvent<string>).data;
      if (FINAL_REASONS.has(reason)) {
        stop(reason);
        return;
      }
      onState("reconnecting", reason);
    });
    es.addEventListener("error", () => {
      if (stopped || source !== es) return;
      es.close();
      source = undefined;
      onState(connectedOnce ? "reconnecting" : "connecting");
      void recover();
    });
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(reopen);
    source?.close();
    source = undefined;
  };
};
