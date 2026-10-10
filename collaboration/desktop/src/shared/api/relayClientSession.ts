import { Channel, invoke } from "@tauri-apps/api/core";
import {
  createAuthEvent,
  getRelayWsUrl,
  signRelayEvent,
} from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  CHANNEL_EVENT_KINDS,
  KIND_CHANNEL_THREAD_SUMMARY,
  KIND_TYPING_INDICATOR,
} from "@/shared/constants/kinds";
import {
  getTextPayload,
  toRelayFrames,
  type ConnectionState,
  type LiveSubscriptionReadiness,
  type PendingEvent,
  type RelaySubscription,
  type RelaySubscriptionFilter,
  type SubscriptionEventBufferItem,
} from "@/shared/api/relayClientShared";
import {
  clearClosedRetry,
  flushEvents,
  handleRelayClosed,
  handleSubscriptionEose,
  prepareSubscriptionEvent,
} from "@/shared/api/relayClosedRecovery";
import { getChannelReconnectRepairEvents } from "@/shared/api/channelReconnectRepair";
import { replayLiveSubscriptions } from "@/shared/api/relayReconnectReplay";
import { publishSessionEvent } from "@/shared/api/relayEventPublisher";
import {
  RelayPublishNotSentError,
  RelayPublishRejectedError,
  RelayPublishUnknownError,
  unconfirmedFingerprint,
} from "@/shared/api/relayPublishOutcome";
import { activateRateLimitIfSignalled } from "@/shared/api/relayRateLimitGate";
import { requestHistoryGated } from "@/shared/api/relayGateBoundary";
import { RelayConnectionStateEmitter } from "@/shared/api/relayConnectionStateEmitter";
import {
  isServiceRestartClose,
  isWebSocketClose,
  isWebSocketError,
  shouldRefuseConnect,
  shouldScheduleReconnect,
  shouldWaitForScheduledReconnect,
} from "@/shared/api/relayReconnectPolicy";
import { RelayReconnectWaiters } from "@/shared/api/relayReconnectWaiters";
import { RelayStallWatchdog } from "@/shared/api/relayStallWatchdog";
import {
  AUTH_TIMEOUT_MS,
  BACKOFF_RESET_STABLE_MS,
  EVENT_BATCH_MS,
  HISTORY_TIMEOUT_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  STALL_CHECK_INTERVAL_MS,
  STALL_IDLE_TIMEOUT_MS,
} from "@/shared/api/relayClientTimings";
import { closeWebSocket } from "@/shared/api/relayWebSocketClose";
import {
  armRelayAuthentication,
  AuthOkTracker,
  type RelayAuthRequest,
} from "@/shared/api/relayAuthPolicy";
import { createRelayInboundBuffer } from "@/shared/api/relayInboundBuffer";
export class RelayClient {
  private wsId: number | null = null;
  private relayUrl: string | null = null;
  private connectPromise: Promise<number> | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectWaiters = new RelayReconnectWaiters();
  private reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  private keepAliveRequested = false;
  private authRequest: RelayAuthRequest | null = null;
  private subscriptions = new Map<string, RelaySubscription>();
  private pendingEvents = new Map<string, PendingEvent>();
  /** 发出后结果不明的消息事件，按内容指纹索引，供原样重发（见 relayPublishOutcome）。 */
  private unconfirmedEvents = new Map<string, RelayEvent>();
  private eventBuffer: SubscriptionEventBufferItem[] = [];
  private flushTimeout: number | null = null;
  private reconnectListeners = new Set<() => void>();
  private hasConnectedOnce = false;
  private notifyReconnectListeners = false;
  private onMessageChannel: Channel<unknown> | null = null;
  private connectionGeneration = 0;
  private sessionEpoch = 0;
  private stabilityTimer: number | null = null;
  private visibleChannelId: string | null = null;
  private authOkTracker = new AuthOkTracker();
  private terminal = false;

  private connectionStateEmitter = new RelayConnectionStateEmitter("idle");
  private stallWatchdog = new RelayStallWatchdog({
    intervalMs: STALL_CHECK_INTERVAL_MS,
    idleTimeoutMs: STALL_IDLE_TIMEOUT_MS,
    onStall: (error) => {
      this.connectionStateEmitter.set("stalled");
      this.resetConnection(error);
    },
  });
  setVisibleChannelId(id: string | null) {
    this.visibleChannelId = id;
  }
  disconnect() {
    const error = new Error("Relay disconnected for community switch.");

    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.stabilityTimer !== null) {
      window.clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    this.stallWatchdog.stop();
    this.sessionEpoch++;
    this.connectionGeneration++;
    this.keepAliveRequested = false;
    this.relayUrl = null;
    this.hasConnectedOnce = false;
    this.notifyReconnectListeners = false;
    this.terminal = false;
    this.visibleChannelId = null;
    this.authOkTracker.reset();
    this.connectionStateEmitter.set("idle");
    // 未确认的事件属于上一个社区与身份，不能在新会话里重发
    this.unconfirmedEvents.clear();

    if (this.wsId !== null) {
      void closeWebSocket(this.wsId, "community switch");
      this.wsId = null;
    }

    this.connectPromise = null;
    this.reconnectWaiters.settle(error);

    if (this.authRequest) {
      window.clearTimeout(this.authRequest.timeout);
      this.authRequest.reject(error);
      this.authRequest = null;
    }

    for (const [subId, sub] of this.subscriptions) {
      if (sub.mode !== "live") {
        window.clearTimeout(sub.timeout);
        sub.reject(error);
      } else {
        clearClosedRetry(sub);
      }
      this.subscriptions.delete(subId);
    }

    for (const [eventId, pending] of this.pendingEvents) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingEvents.delete(eventId);
    }

    if (this.flushTimeout !== null) {
      window.clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    this.eventBuffer = [];
    this.reconnectListeners.clear();
    this.connectionStateEmitter.clear();
    this.onMessageChannel = null;
    this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  }

  async fetchEvents(filter: RelaySubscriptionFilter): Promise<RelayEvent[]> {
    return this.fetchHistory(filter);
  }

  private async fetchHistory(filter: RelaySubscriptionFilter) {
    await this.ensureConnected();
    return this.requestHistory(filter);
  }

  private requestHistory(
    filter: RelaySubscriptionFilter,
  ): Promise<RelayEvent[]> {
    return requestHistoryGated(
      this.subscriptions,
      (payload) => this.sendRaw(payload),
      (subId) => this.closeSubscription(subId),
      filter,
      HISTORY_TIMEOUT_MS,
    );
  }

  async sendMessage(
    channelId: string,
    content: string,
    mentionPubkeys: string[] = [],
    extraTags: string[][] = [],
  ) {
    const tags: string[][] = [["h", channelId]];
    for (const pubkey of mentionPubkeys) {
      tags.push(["p", pubkey]);
    }
    for (const tag of extraTags) {
      tags.push(tag);
    }

    // 同一内容上一次的结果不明：原样重发那个已签名事件，而不是签一条新的
    // ——Relay 若已存储它只回 `duplicate:`，不会出现第二条消息
    const epoch = this.sessionEpoch;
    let fingerprint = unconfirmedFingerprint(
      this.relayUrl ?? "",
      KIND_STREAM_MESSAGE,
      content.trim(),
      tags,
    );
    let previous = this.unconfirmedEvents.get(fingerprint);
    try {
      await this.ensureConnected();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 新事件未发出是确定状态，但旧事件的首次发布仍未查证。
      if (previous && epoch === this.sessionEpoch) {
        throw new RelayPublishUnknownError(previous.id, message);
      }
      throw new RelayPublishNotSentError(message);
    }
    if (epoch !== this.sessionEpoch) {
      throw new RelayPublishNotSentError(
        "Relay disconnected for community switch.",
      );
    }
    // 首次连接才解析 Relay URL，缓存必须归属连接后的真实地址；重连前读取
    // 旧记录仅用于保留“没有再发出也不能证明首次未存储”的结果。
    fingerprint = unconfirmedFingerprint(
      this.relayUrl ?? "",
      KIND_STREAM_MESSAGE,
      content.trim(),
      tags,
    );
    previous = this.unconfirmedEvents.get(fingerprint);
    const event =
      previous ??
      (await signRelayEvent({
        kind: KIND_STREAM_MESSAGE,
        content: content.trim(),
        tags,
      }));
    if (epoch !== this.sessionEpoch) {
      throw new RelayPublishNotSentError(
        "Relay disconnected for community switch.",
      );
    }

    try {
      const published = await this.publishEvent(
        event,
        "Timed out while sending the message.",
        "Failed to send the message.",
      );
      this.unconfirmedEvents.delete(fingerprint);
      return published;
    } catch (error) {
      // 只有结果不明才留着供原样重发；重发时被拒不改变「第一次是否已存储」的
      // 未知，所以记录只在确认接受（或切换社区）时清除
      // 社区切换或退出（disconnect 递增 sessionEpoch）之后不再记录：新会话可能
      // 换了身份
      if (
        error instanceof RelayPublishUnknownError &&
        epoch === this.sessionEpoch
      ) {
        this.unconfirmedEvents.set(fingerprint, event);
      }
      if (previous && epoch === this.sessionEpoch) {
        throw new RelayPublishUnknownError(
          event.id,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  /** Subscribe to channel rows and aux starting now, with no history replay. */
  async subscribeToChannelLive(
    channelId: string,
    onEvent: (event: RelayEvent) => void,
  ) {
    // 39005 rides only this window-store subscription — CHANNEL_EVENT_KINDS'
    // other consumers (unread tracking, cache merges) must never see
    // summary overlays.
    return this.subscribe(
      {
        kinds: [...CHANNEL_EVENT_KINDS, KIND_CHANNEL_THREAD_SUMMARY],
        "#h": [channelId],
        limit: 1000,
        since: Math.floor(Date.now() / 1_000),
      },
      onEvent,
    );
  }

  async subscribeToTypingIndicators(
    channelId: string,
    onEvent: (event: RelayEvent) => void,
    onClosed: () => void,
  ) {
    // Fixed original ephemeral receive filter; not added to history/unread.
    return this.subscribe({
      kinds: [KIND_TYPING_INDICATOR], "#h": [channelId], limit: 10,
      since: Math.floor(Date.now() / 1_000) - 10,
    }, onEvent, undefined, undefined, onClosed);
  }

  async subscribeLive(
    filter: RelaySubscriptionFilter,
    onEvent: (event: RelayEvent) => void,
    onReady?: (readiness: LiveSubscriptionReadiness) => void,
    readinessTimeoutMs?: number,
  ) {
    return this.subscribe(filter, onEvent, onReady, readinessTimeoutMs);
  }
  async preconnect() {
    // Explicit re-engagement (reconnect card / community switch): clears the
    // terminal latch and AUTH rejection streak, and bypasses backoff once.
    this.terminal = false;
    this.authOkTracker.reset();
    this.keepAliveRequested = true;
    await this.connectBypassingBackoff();
  }

  /**
   * Environment-driven resume (online/focus/visibility): bypasses a pending
   * backoff timer but preserves the terminal latch and AUTH rejection streak
   * — only `preconnect()` clears those, so resume events during repeated
   * AUTH rejection cannot defeat the consecutive-rejection cap.
   */
  async resumeReconnect() {
    if (this.terminal) return;
    await this.connectBypassingBackoff();
  }

  private async connectBypassingBackoff() {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    try {
      await this.ensureConnected();
      this.reconnectWaiters.settle();
    } catch (error) {
      this.reconnectWaiters.settle(
        this.normalizeRelayError(error, "Relay reconnect failed."),
      );
      throw error;
    }
  }

  subscribeToReconnects(listener: () => void) {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  /** Current connection state — synchronous read. */
  getConnectionState(): ConnectionState {
    return this.connectionStateEmitter.get();
  }

  /**
   * Subscribe to connection-state transitions. The listener fires
   * immediately with the current state, so callers need no separate
   * `getConnectionState()` call to seed their UI.
   */
  subscribeToConnectionState(listener: (state: ConnectionState) => void) {
    return this.connectionStateEmitter.subscribe(listener);
  }

  private async ensureConnected() {
    if (shouldRefuseConnect({ terminal: this.terminal })) {
      // Terminal (e.g. relay rejected auth): refuse until disconnect() or
      // preconnect() clears the latch, else the reconnect-timer catch and
      // the publish/subscribe retry wrappers would race the terminal
      // "disconnected" state back to "reconnecting".
      throw new Error("Relay session is terminal; cannot reconnect.");
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.wsId !== null) {
      return this.connectionGeneration;
    }

    if (
      shouldWaitForScheduledReconnect({
        hasPendingReconnect: this.reconnectTimeout !== null,
      })
    ) {
      // The reconnect coordinator owns outage pacing. Query, publish, and
      // subscription callers must wait for its scheduled attempt instead of
      // clearing the timer and creating an immediate reconnect storm.
      return this.reconnectWaiters.wait().then(() => this.connectionGeneration);
    }

    const connectPromise = this.connect();
    this.connectPromise = connectPromise;

    try {
      return await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  private async connect() {
    if (this.stabilityTimer !== null) {
      window.clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }

    this.connectionStateEmitter.set(
      this.hasConnectedOnce ? "reconnecting" : "connecting",
    );
    const generation = ++this.connectionGeneration;
    const inbound = createRelayInboundBuffer(
      async (delivery) => {
        for (const message of toRelayFrames(delivery))
          await this.handleWsMessage(message, generation);
      },
      (error) => {
        if (generation === this.connectionGeneration)
          this.recoverFromSocketFailure(error, "Relay connection errored.");
      },
    );
    this.onMessageChannel = new Channel<unknown>((delivery) =>
      inbound.receive(delivery),
    );
    try {
      if (!this.relayUrl) {
        this.relayUrl = await getRelayWsUrl();
      }
      const wsId = await invoke<number>("plugin:websocket|connect", {
        url: this.relayUrl,
        onMessage: this.onMessageChannel,
        config: {},
      });
      if (generation !== this.connectionGeneration) {
        void closeWebSocket(wsId, "stale connection attempt");
        throw new Error("Relay connection attempt was superseded.");
      }
      this.wsId = wsId;

      const authentication = armRelayAuthentication(
        AUTH_TIMEOUT_MS,
        (request) => {
          this.authRequest = request;
        },
        (error) => {
          this.authRequest = null;
          this.resetConnection(error);
        },
      );

      const drain = inbound.drain();
      await Promise.race([drain, authentication, inbound.overflow]);
      await drain;
      await authentication;
      this.stabilityTimer = window.setTimeout(() => {
        this.stabilityTimer = null;
        this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
      }, BACKOFF_RESET_STABLE_MS);

      this.connectionStateEmitter.set("connected");
      await this.replayLiveSubscriptions();
      this.stallWatchdog.start();
      this.emitReconnectIfNeeded();
      return generation;
    } catch (error) {
      const connectionError = this.normalizeRelayError(
        error,
        "Failed to connect to relay.",
      );
      if (generation === this.connectionGeneration) {
        this.resetConnection(connectionError);
      }
      throw connectionError;
    }
  }

  private async subscribe(
    filter: RelaySubscriptionFilter,
    onEvent: (event: RelayEvent) => void,
    onReady?: (readiness: LiveSubscriptionReadiness) => void,
    readinessTimeoutMs = 250,
    onClosed?: () => void,
  ) {
    await this.ensureConnected();

    const subId = `live-${crypto.randomUUID()}`;
    let resolveReady = (_readiness: LiveSubscriptionReadiness) => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = (readiness) => {
        window.clearTimeout(fallbackTimeout);
        onReady?.(readiness);
        resolve();
      };
    });
    const fallbackTimeout = window.setTimeout(
      () => resolveReady("timeout"),
      readinessTimeoutMs,
    );

    this.subscriptions.set(subId, {
      mode: "live",
      filter,
      onEvent,
      resolveReady,
      onClosed,
    });

    try {
      await this.sendRawWithReconnectRetry(
        ["REQ", subId, filter],
        "Failed to restore relay subscription.",
      );
    } catch (error) {
      window.clearTimeout(fallbackTimeout);
      this.subscriptions.delete(subId);
      throw error;
    }
    await ready;

    return async () => {
      const active = this.subscriptions.get(subId);
      if (active?.mode !== "live") {
        return;
      }

      this.subscriptions.delete(subId);
      clearClosedRetry(active);
      await this.closeSubscription(subId);
    };
  }

  private async sendRaw(payload: unknown[]) {
    if (this.wsId === null) {
      throw new Error("Relay socket is not connected.");
    }

    await invoke("plugin:websocket|send", {
      id: this.wsId,
      message: {
        type: "Text",
        data: JSON.stringify(payload),
      },
    });
  }

  private async sendRawForGeneration(payload: unknown[], generation: number) {
    if (generation !== this.connectionGeneration || this.wsId === null) {
      throw new Error("Relay publish was superseded by a session change.");
    }
    const wsId = this.wsId;
    await invoke("plugin:websocket|send", {
      id: wsId,
      message: { type: "Text", data: JSON.stringify(payload) },
    });
  }

  private normalizeRelayError(error: unknown, fallbackMessage: string) {
    return error instanceof Error ? error : new Error(fallbackMessage);
  }

  private recoverFromSocketFailure(
    error: unknown,
    fallbackMessage: string,
  ): Error {
    const normalizedError = this.normalizeRelayError(error, fallbackMessage);
    this.resetConnection(normalizedError);
    return normalizedError;
  }

  private async sendRawWithReconnectRetry(
    payload: unknown[],
    fallbackMessage: string,
  ) {
    try {
      await this.sendRaw(payload);
    } catch (error) {
      const normalizedError = this.recoverFromSocketFailure(
        error,
        fallbackMessage,
      );
      try {
        await this.ensureConnected();
        await this.sendRaw(payload);
      } catch (retryError) {
        throw this.recoverFromSocketFailure(
          retryError,
          normalizedError.message,
        );
      }
    }
  }

  private async closeSubscription(subId: string) {
    if (this.wsId === null) {
      return;
    }

    await this.sendRaw(["CLOSE", subId]);
  }

  async publishEvent(
    event: RelayEvent,
    timeoutMessage: string,
    sendErrorMessage: string,
  ) {
    return publishSessionEvent(
      {
        generation: () => this.connectionGeneration,
        ownership: () => this.sessionEpoch,
        pendingEvents: this.pendingEvents,
        send: (payload, generation) =>
          this.sendRawForGeneration(payload, generation),
        reconnect: () => this.ensureConnected(),
        normalizeError: (error, fallback) =>
          this.normalizeRelayError(error, fallback),
        recoverSocketFailure: (error, fallback) =>
          this.recoverFromSocketFailure(error, fallback),
      },
      event,
      timeoutMessage,
      sendErrorMessage,
    );
  }

  /** Projects are replaceable: observe the original publication, never replay
   * an older head after UNKNOWN. Use the existing session-owned intent holder. */
  async publishProjectIntent(
    key: string,
    expectedRelayUrl: string,
    create: () => Promise<RelayEvent>,
    observeOnly = false,
    observation?: {eventId?: string; onPrepared: (eventId: string) => void},
  ): Promise<RelayEvent> {
    const epoch = this.sessionEpoch;
    const fingerprint = JSON.stringify(["project", expectedRelayUrl, key]);
    let previous = this.unconfirmedEvents.get(fingerprint);
    const unknown = () => new RelayPublishUnknownError(previous?.id ?? observation?.eventId ?? "", "Project publication outcome unknown");
    if (observeOnly && !previous && !observation?.eventId) throw unknown();
    await this.ensureConnected().catch((error) => {
      if (previous || observeOnly) throw unknown();
      throw new RelayPublishNotSentError(String(error));
    });
    const current = () => epoch === this.sessionEpoch && this.relayUrl !== null
      && new URL(this.relayUrl).href === new URL(expectedRelayUrl).href;
    if (!current()) {
      if (previous || observeOnly) throw unknown();
      throw new RelayPublishNotSentError("Project community changed.");
    }
    if (previous || observeOnly) {
      const originalId = previous?.id ?? observation?.eventId;
      if (!originalId || !/^[0-9a-f]{64}$/.test(originalId)) throw unknown();
      const observed = await this.fetchEvents({ids:[originalId],kinds:[5,30621,30617],limit:1}).catch(() => {throw unknown();});
      const original = observed.find(event => event.id === originalId && [5,30621,30617].includes(event.kind) && (!previous || event.pubkey === previous.pubkey && event.kind === previous.kind));
      if (!current() || !original) throw unknown();
      return original;
    }
    const event = await create();
    if (!current()) throw new RelayPublishNotSentError("Project community changed.");
    try {
      observation?.onPrepared(event.id);
    } catch {
      // No EVENT has left this process and no uncertain holder exists yet.
      throw new RelayPublishNotSentError("Project publication intent could not be persisted.");
    }
    this.unconfirmedEvents.set(fingerprint,event);
    previous = event;
    try {
      await this.publishEvent(event,"Project publication outcome unknown","Project publication rejected");
    } catch (error) {
      if (!(error instanceof RelayPublishRejectedError) && !(error instanceof RelayPublishNotSentError)) throw unknown();
      if (epoch === this.sessionEpoch) this.unconfirmedEvents.delete(fingerprint);
      throw error;
    }
    if (!current()) throw unknown();
    return event;
  }

  /** Drop this session's original signed intent only after the caller has
   * durably recorded its ACK and completed the scoped directory readback. */
  completeProjectIntent(key: string, expectedRelayUrl: string, eventId: string): void {
    const fingerprint = JSON.stringify(["project", expectedRelayUrl, key]);
    if (this.unconfirmedEvents.get(fingerprint)?.id === eventId) {
      this.unconfirmedEvents.delete(fingerprint);
    }
  }

  private async handleWsMessage(message: unknown, generation: number) {
    if (generation !== this.connectionGeneration) return;
    this.stallWatchdog.recordInbound();

    if (isWebSocketClose(message)) {
      if (isServiceRestartClose(message))
        this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
      this.resetConnection(new Error("Relay connection closed."));
      return;
    }
    if (isWebSocketError(message)) {
      this.resetConnection(new Error("Relay connection errored."));
      return;
    }

    const payload = getTextPayload(message);
    if (!payload) {
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return;
    }

    const [type, ...rest] = data;
    if (type === "AUTH" && typeof rest[0] === "string") {
      await this.handleAuthChallenge(rest[0], generation);
      return;
    }
    if (type === "EVENT" && typeof rest[0] === "string" && rest[1]) {
      this.handleEvent(rest[0], rest[1] as RelayEvent, generation);
      return;
    }

    if (
      type === "OK" &&
      typeof rest[0] === "string" &&
      typeof rest[1] === "boolean"
    ) {
      this.handleOk(
        rest[0],
        rest[1],
        typeof rest[2] === "string" ? rest[2] : "",
      );
      return;
    }

    if (type === "EOSE" && typeof rest[0] === "string") {
      this.handleEose(rest[0], generation);
      return;
    }
    if (type === "CLOSED" && typeof rest[0] === "string") {
      handleRelayClosed({
        subscriptions: this.subscriptions,
        subId: rest[0],
        message: typeof rest[1] === "string" ? rest[1] : "",
        sendReq: (subId, filter) =>
          this.sendRawWithReconnectRetry(
            ["REQ", subId, filter],
            "Failed to restore relay subscription after CLOSED.",
          ),
        closeSubscription: (subId) => this.closeSubscription(subId),
      });
      return;
    }

    if (type === "NOTICE" && typeof rest[0] === "string") {
      // Connection-scoped back-pressure — arm the gate until it expires.
      activateRateLimitIfSignalled(rest[0]);
    }
  }

  private async handleAuthChallenge(challenge: string, generation: number) {
    if (!this.relayUrl) {
      this.relayUrl = await getRelayWsUrl();
    }

    const event = await createAuthEvent({
      challenge,
      relayUrl: this.relayUrl,
    });

    if (generation !== this.connectionGeneration || !this.authRequest) {
      return;
    }

    this.authRequest.pendingEventId = event.id;
    await this.sendRaw(["AUTH", event]);
  }

  private handleEvent(subId: string, event: RelayEvent, generation: number) {
    const subscription = this.subscriptions.get(subId);
    if (!subscription) {
      return;
    }

    if (subscription.mode === "first") {
      subscription.onEvent(event);
      return;
    }

    if (!prepareSubscriptionEvent(subscription, event)) return;
    this.eventBuffer.push({ subId, event, generation });
    this.flushTimeout ??= window.setTimeout(
      () => this.flushEventBuffer(),
      EVENT_BATCH_MS,
    );
  }

  private flushEventBuffer() {
    this.flushTimeout = null;
    const buffer = this.eventBuffer;
    this.eventBuffer = [];

    flushEvents(buffer, this.subscriptions, this.connectionGeneration);
  }

  private handleEose(subId: string, generation: number) {
    this.flushEventBuffer(); // Deliver preceding EVENT frames before EOSE.
    handleSubscriptionEose({
      subscriptions: this.subscriptions,
      subId,
      closeSubscription: (id) => this.closeSubscription(id),
      generation,
    });
  }

  private handleOk(eventId: string, success: boolean, message: string) {
    if (this.authRequest && this.authRequest.pendingEventId === eventId) {
      window.clearTimeout(this.authRequest.timeout);
      const authRequest = this.authRequest;
      this.authRequest = null;

      // Decision table lives in relayAuthPolicy.ts.
      const decision = this.authOkTracker.record(success, message);
      if (decision === "authenticated") {
        authRequest.resolve();
      } else {
        const error = new Error(message || "Relay authentication rejected.");
        authRequest.reject(error);
        this.resetConnection(error, { reconnect: decision === "retry" });
      }

      return;
    }

    const pendingEvent = this.pendingEvents.get(eventId);
    if (!pendingEvent) {
      return;
    }

    window.clearTimeout(pendingEvent.timeout);
    this.pendingEvents.delete(eventId);

    if (success) {
      pendingEvent.resolve(pendingEvent.event);
    } else {
      // Back-pressure now arrives here rather than as a NOTICE: the relay
      // rejects an over-quota EVENT on the OK channel so this pending publish
      // can be settled at all. Unarmed, the send retries into the same quota.
      activateRateLimitIfSignalled(message);
      pendingEvent.reject(new RelayPublishRejectedError(eventId, message));
    }
  }

  private hasLiveSubscriptions() {
    return [...this.subscriptions.values()].some((s) => s.mode === "live");
  }

  private async replayLiveSubscriptions() {
    const generation = this.connectionGeneration;
    try {
      await replayLiveSubscriptions({
        subscriptions: this.subscriptions,
        sendRaw: (payload) => this.sendRaw(payload),
        requestRepair: getChannelReconnectRepairEvents,
        generation,
        visibleChannelId: this.visibleChannelId,
        isActive: () => this.connectionGeneration === generation,
      });
    } catch (error) {
      const reconnectError =
        error instanceof Error
          ? error
          : new Error("Failed to restore relay subscriptions.");
      this.resetConnection(reconnectError);
      throw reconnectError;
    }
  }

  private scheduleReconnect() {
    if (
      !shouldScheduleReconnect({
        terminal: this.terminal,
        hasPendingReconnect: this.reconnectTimeout !== null,
        hasLiveSocket: this.wsId !== null,
        keepAliveRequested: this.keepAliveRequested,
        hasLiveSubscriptions: this.hasLiveSubscriptions(),
      })
    ) {
      return;
    }

    // ±25% jitter spreads a fleet's AUTH storms across a 50% window instead
    // of hitting the relay at the same instant.
    const jitter = this.reconnectDelayMs * (0.75 + Math.random() * 0.5);
    const delay = Math.min(jitter, RECONNECT_MAX_DELAY_MS);
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      RECONNECT_MAX_DELAY_MS,
    );

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      void this.ensureConnected()
        .then(() => this.reconnectWaiters.settle())
        .catch((error) => {
          this.reconnectWaiters.settle(
            this.normalizeRelayError(error, "Relay reconnect failed."),
          );
          this.scheduleReconnect();
        });
    }, delay);
  }

  private emitReconnectIfNeeded() {
    const shouldNotifyReconnectListeners =
      this.hasConnectedOnce && this.notifyReconnectListeners;

    this.hasConnectedOnce = true;
    this.notifyReconnectListeners = false;

    if (!shouldNotifyReconnectListeners) {
      return;
    }

    for (const listener of this.reconnectListeners) {
      try {
        listener();
      } catch (error) {
        console.error("Failed to handle relay reconnect", error);
      }
    }
  }

  private resetConnection(
    error: Error,
    options?: {
      reconnect?: boolean;
    },
  ) {
    this.onMessageChannel = null;
    this.stallWatchdog.stop();
    this.connectionGeneration++;
    if (this.stabilityTimer !== null) {
      window.clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.flushTimeout !== null) window.clearTimeout(this.flushTimeout);
    this.flushTimeout = null;
    this.eventBuffer = [];

    if (options?.reconnect === false) {
      this.terminal = true;
      this.connectionStateEmitter.set("disconnected");
    } else if (
      // A late retry failure racing a terminal latch must not paint
      // "reconnecting" over the terminal "disconnected" state; stall is a
      // stronger signal than a generic drop and is kept until reconnect.
      !this.terminal &&
      this.connectionStateEmitter.get() !== "stalled"
    ) {
      this.connectionStateEmitter.set("reconnecting");
    }

    if (options?.reconnect !== false && this.hasConnectedOnce) {
      this.notifyReconnectListeners = true;
    }

    if (options?.reconnect === false && this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (options?.reconnect === false) {
      this.reconnectWaiters.settle(error);
    }

    if (this.wsId !== null) {
      void closeWebSocket(this.wsId, "connection reset");
    }

    this.wsId = null;

    if (this.authRequest) {
      window.clearTimeout(this.authRequest.timeout);
      this.authRequest.reject(error);
      this.authRequest = null;
    }

    for (const [subId, subscription] of this.subscriptions) {
      if (subscription.mode !== "live") {
        window.clearTimeout(subscription.timeout);
        subscription.reject(error);
        this.subscriptions.delete(subId);
        continue;
      }
      subscription.resolveReady?.("closed");
      subscription.resolveReady = undefined;
      clearClosedRetry(subscription);
    }
    for (const [eventId, pendingEvent] of this.pendingEvents) {
      window.clearTimeout(pendingEvent.timeout);
      // EVENT 已写出而连接断开：Relay 是否存储了它不得而知
      pendingEvent.reject(new RelayPublishUnknownError(eventId, error.message));
      this.pendingEvents.delete(eventId);
    }
    if (options?.reconnect !== false) {
      this.scheduleReconnect();
    }
  }
}
