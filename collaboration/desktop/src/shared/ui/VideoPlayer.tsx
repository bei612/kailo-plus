import type { ComponentProps } from "react";
import { createVideoPlayer } from "@client-kit/platform/react/video-review";
import { EmojiPicker as SharedEmojiPicker } from "@client-kit/platform/react/custom-emoji";
import { useCustomEmojiPalette } from "@/features/messages/lib/useCustomEmojiPalette";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { UserAvatar } from "./UserAvatar";
import { useVideoContextMenu } from "./useVideoContextMenu";
function EmojiPicker(props: Omit<ComponentProps<typeof SharedEmojiPicker>, "customEmoji">) {
  const customEmoji = useCustomEmojiPalette();
  return <SharedEmojiPicker {...props} customEmoji={customEmoji} />;
}
export const VideoPlayer = createVideoPlayer({ MessageComposer, EmojiPicker, UserAvatar, useVideoContextMenu });
export type { VideoReviewComment, VideoReviewContext } from "@client-kit/platform/react/video-review";
