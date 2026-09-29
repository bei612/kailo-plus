// 以 Kailo 给出的连接事实连 Relay：沿用桌面端既有的 `apply_workspace`（Relay 地址 +
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

/** 失败以 reject 表示，由登录引导如实显示并提供重试。 */
export async function connectCommunity(
  facts: NativeCommunityFacts,
): Promise<void> {
  if (connectedBefore) await resetCommunityState();
  connectedBefore = true;
  // 不传 nsec：签名用的是 keyring 中的设备私钥，也就是刚登记的那一把
  await applyCommunity(facts.relayUrl);
  // Relay 覆盖地址装好之后再刷新依赖它的媒体状态：冷启动时 mediaUrl 可能已按
  // 缺省地址缓存了来源，留着它会把本 Relay 的媒体当成外部资源
  resetMediaCaches();
  initDraftStore((await getIdentity()).pubkey, facts.relayUrl);
}
