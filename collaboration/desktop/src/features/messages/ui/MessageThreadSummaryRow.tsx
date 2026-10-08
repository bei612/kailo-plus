import type { ComponentProps } from "react";
import { MessageThreadSummaryRow as SharedMessageThreadSummaryRow } from "@client-kit/platform/react/thread/MessageThreadSummaryRow";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

export function MessageThreadSummaryRow(props: ComponentProps<typeof SharedMessageThreadSummaryRow>) {
  return <SharedMessageThreadSummaryRow {...props} resolveMediaUrl={rewriteRelayUrl} />;
}
