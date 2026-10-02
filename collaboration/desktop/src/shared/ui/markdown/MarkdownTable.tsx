import * as React from "react";
import { MessageTable } from "@client-kit/platform/react/message-body";

import { useSmoothCorners } from "@/shared/ui/smoothCorners";

export function MarkdownTable({ children }: { children?: React.ReactNode }) {
  const tableBlockRef = React.useRef<HTMLDivElement | null>(null);
  useSmoothCorners(tableBlockRef);

  return <MessageTable ref={tableBlockRef}>{children}</MessageTable>;
}
