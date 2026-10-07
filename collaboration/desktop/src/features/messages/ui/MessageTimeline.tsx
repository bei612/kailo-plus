import * as React from "react";
import { MessageTimelineSurface, type MessageTimelineHandle } from "@client-kit/platform/react/messages/timeline/MessageTimelineSurface";
import type { MessageTimelineProps } from "@client-kit/platform/react/messages/timeline/types";
import { TimelineMessageList } from "./TimelineMessageList";
import { handleTimelineMentionCopy } from "@/features/messages/lib/timelineMentionCopy";
import { preloadTimelineImages } from "@/features/messages/lib/timelineImagePreload";
export type { MessageTimelineHandle } from "@client-kit/platform/react/messages/timeline/MessageTimelineSurface";
const renderList = (props: React.ComponentProps<typeof TimelineMessageList>) => <TimelineMessageList {...props} />;
export const MessageTimeline = React.memo(React.forwardRef<MessageTimelineHandle, MessageTimelineProps>(
  function MessageTimeline(props, ref) {
    const imagePreloadStateRef = React.useRef({ activeImages: new Set<HTMLImageElement>(), requestedUrls: new Set<string>() });
    React.useEffect(() => { preloadTimelineImages(props.messages, imagePreloadStateRef.current); }, [props.messages]);
    return <MessageTimelineSurface {...props} ref={ref} renderList={renderList} onCopy={handleTimelineMentionCopy} />;
  },
));
