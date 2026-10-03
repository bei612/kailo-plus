// 以平台给出的连接事实连 Relay：沿用桌面端既有的 `apply_workspace`（Relay 地址 +
// keyring 中的设备私钥），不另开一条连接路径。
import type { NativeCommunityFacts } from "@client-kit/contracts";

import { clearSearchHitEventCache } from "@/app/navigation/searchHitEventCache";
import { resetAudioMediaLoadScheduler } from "@/features/messages/lib/audioMediaLoadScheduler";
import { resetBackgroundMediaUploads } from "@/features/messages/lib/backgroundMediaUploadStore";
import { resetLinkPreviewPreparations } from "@/features/messages/lib/linkPreviewPreparationStore";
import {
  clearAllDrafts,
  initDraftStore,
} from "@/features/messages/lib/useDrafts";
import { resetSidebarRelayConnectionCardState } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import { relayClient } from "@/shared/api/relayClient";
import { resetRateLimitGate } from "@/shared/api/relayRateLimitGate";
import { getIdentity } from "@/shared/api/tauriIdentity";
import { applyCommunity } from "@/shared/api/tauriWorkspace";
import { resetNavigationDeepLinkDrain } from "@/shared/deep-link";
import { resetMediaCaches } from "@/shared/lib/mediaUrl";
import { resetLinkPreviewMetadataCache } from "@/shared/lib/useResolvedLinkPreviews";
import { clearMarkdownNodeCache } from "@/shared/ui/markdown/nodeCache";
import { resetMessageLinkMetadataCache } from "@/shared/ui/markdown/useMessageLinkMetadata";
import { resetVideoPlayerState } from "@/shared/ui/videoPlayerState";

/**
 * 清掉上一次会话留在模块单例里的状态。注销后以另一个身份登录时，新的 Community
 * 不能继承上一个的连接、草稿与缓存。首次启动时它们本就是空的。
 */
async function resetCommunityState(): Promise<void> {
  relayClient.disconnect();
  await resetNavigationDeepLinkDrain();
  resetRateLimitGate();
  clearAllDrafts();
  resetSidebarRelayConnectionCardState();
  resetMediaCaches();
  resetLinkPreviewMetadataCache();
  resetVideoPlayerState();
  resetAudioMediaLoadScheduler();
  resetBackgroundMediaUploads();
  resetLinkPreviewPreparations();
  clearSearchHitEventCache();
  clearMarkdownNodeCache();
  resetMessageLinkMetadataCache();
}

// 本进程里是否已经连过一次。首次连接不清理：那时单例本就是空的，而冷启动时已排队
// 的导航深链（例如从通知或 buzz://channel 打开应用）必须留给路由器取走。
let connectedBefore = false;
let connectionGeneration = 0;
let connecting: Promise<void> = Promise.resolve();

/** 失败以 reject 表示，由登录引导如实显示并提供重试。 */
export function connectCommunity(
  facts: NativeCommunityFacts,
  signal: AbortSignal,
): Promise<void> {
  const generation = ++connectionGeneration;
  const checkCurrent = () => {
    signal.throwIfAborted();
    if (generation !== connectionGeneration) {
      throw new Error("PLATFORM_OPERATION_SUPERSEDED");
    }
  };
  const disconnect = () => {
    if (generation === connectionGeneration) relayClient.disconnect();
  };
  signal.addEventListener("abort", disconnect, { once: true });
  // 原生 apply_workspace 不能中途取消：按调用顺序串行，保证旧 IPC 完成后才
  // 安装下一代地址。取消的旧连接只停止，不清理后来的连接或草稿。
  const result = connecting.then(async () => {
    checkCurrent();
    if (connectedBefore) {
      await resetCommunityState();
      checkCurrent();
    }
    connectedBefore = true;
    // 不传 nsec：签名仍用 keyring 中刚登记的设备私钥。
    await applyCommunity(facts.relayUrl);
    checkCurrent();
    resetMediaCaches();
    const identity = await getIdentity();
    checkCurrent();
    initDraftStore(identity.pubkey, facts.relayUrl);
  });
  connecting = result.catch(() => undefined);
  return result.catch((error) => {
    signal.removeEventListener("abort", disconnect);
    throw error;
  });
}

/**
 * 协作面卸载（注销、会话失效、换设备登记）时撤下以设备身份认证的 Relay 连接。
 * 不撤的话，退出后单例的 socket 与重连循环仍以本机设备密钥连着 Relay，继续收
 * Channel 的事件。其余单例状态照旧留到下一次 `connectCommunity` 清理。
 */
export function disconnectCommunity(): void {
  connectionGeneration += 1;
  relayClient.disconnect();
}
