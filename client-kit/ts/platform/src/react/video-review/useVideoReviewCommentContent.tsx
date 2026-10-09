// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/ui/VideoReviewCommentMarkdown.tsx.
import * as React from "react";
import { useOpenVideoReviewAt } from "./VideoReviewNavigation";
import { parseVideoReviewTimecode } from "./videoReviewTimecode";
import { VideoReviewTimecodeButton, VideoReviewTimecodeChip } from "./VideoReviewTimecodeButton";

export function useVideoReviewCommentContent({content, interactive = true, leadingInlineContent: suppliedLeadingInlineContent, videoReviewCommentRootId}: {
  content: string;
  interactive?: boolean;
  leadingInlineContent?: React.ReactNode;
  videoReviewCommentRootId?: string;
}) {
  const openVideoReviewAt = useOpenVideoReviewAt();
  const reviewTimecode = React.useMemo(
    () => (videoReviewCommentRootId ? parseVideoReviewTimecode(content) : null),
    [content, videoReviewCommentRootId],
  );
  const handleTimecodeClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (reviewTimecode && videoReviewCommentRootId) openVideoReviewAt?.(videoReviewCommentRootId, reviewTimecode.seconds);
  }, [openVideoReviewAt, reviewTimecode, videoReviewCommentRootId]);
  const leadingInlineContent = React.useMemo(() => {
    if (!reviewTimecode) return suppliedLeadingInlineContent;
    const timecode = interactive && openVideoReviewAt
      ? <VideoReviewTimecodeButton surface="message" timecode={reviewTimecode.timecode} onClick={handleTimecodeClick} />
      : <VideoReviewTimecodeChip surface="message" timecode={reviewTimecode.timecode} />;
    return <>{suppliedLeadingInlineContent}{timecode}{" "}</>;
  }, [handleTimecodeClick, interactive, openVideoReviewAt, reviewTimecode, suppliedLeadingInlineContent]);
  return {content: reviewTimecode ? reviewTimecode.text || "\u200B" : content, leadingInlineContent};
}
