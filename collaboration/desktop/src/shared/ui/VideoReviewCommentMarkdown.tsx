import { Markdown } from "@/shared/ui/markdown";
import type { MarkdownProps } from "@/shared/ui/markdown/types";
import { useVideoReviewCommentContent } from "@client-kit/platform/react/video-review";

export function VideoReviewCommentMarkdown({content, interactive = true, leadingInlineContent, videoReviewCommentRootId, ...markdownProps}: MarkdownProps & {videoReviewCommentRootId?: string}) {
  const review = useVideoReviewCommentContent({content, interactive, leadingInlineContent, videoReviewCommentRootId});
  return <Markdown {...markdownProps} {...review} interactive={interactive} />;
}
