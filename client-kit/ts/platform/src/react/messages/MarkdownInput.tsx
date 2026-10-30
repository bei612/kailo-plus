// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/markdown/MarkdownInput.tsx — GFM task-list items render as
// the read-only Checkbox instead of a bare browser checkbox (shared by Web and Desktop).
import type * as React from "react";

import { useUiT } from "../context";
import { Checkbox } from "../profile/buzz/shared/ui/checkbox";
import { cn } from "../profile/buzz/shared/lib/cn";

type MarkdownInputProps = React.ComponentProps<"input"> & {
  node?: unknown;
};

export function MarkdownInput({
  checked,
  className,
  node: _node,
  type,
  ...props
}: MarkdownInputProps) {
  const t = useUiT();
  if (type === "checkbox") {
    return (
      <Checkbox
        aria-label={checked ? t("messages.task.completed") : t("messages.task.incomplete")}
        checked={Boolean(checked)}
        className={cn(
          "pointer-events-none mr-1.5 inline-flex align-[-0.125rem] disabled:opacity-45",
          className,
        )}
        disabled
        tabIndex={-1}
      />
    );
  }

  return <input {...props} className={className} type={type} />;
}
