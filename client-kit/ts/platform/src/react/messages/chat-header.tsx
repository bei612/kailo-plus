// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/chat/ui/ChatHeader.tsx::ChatHeader.
// Hosts retain clipboard transport and admitted channel data; the title surface is shared.
import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";

export function ChatHeader({ title, description, leadingContent, statusBadge, onCopyTitle }: {
  title: string;
  description?: string;
  leadingContent: ReactNode;
  statusBadge?: ReactNode;
  onCopyTitle: (title: string) => Promise<void>;
}) {
  const t = useUiT();
  return <header className="pointer-events-auto relative z-30 min-w-0 shrink-0 cursor-default select-none bg-transparent px-5 py-2 transition-[margin,padding] duration-200 ease-linear"
    data-testid="chat-header" data-tauri-drag-region>
    <div className="flex h-9 min-w-0 items-center gap-2.5"><div className="min-w-0 flex-1">
      <div className="group/title flex min-w-0 items-center gap-[4px] overflow-hidden">
        <div className="flex shrink-0 items-center">{leadingContent}</div>
        <h1 className="min-w-0 translate-y-px truncate text-base font-semibold leading-6 tracking-tight"
          data-testid="chat-title" title={description?.trim() || undefined}>{title}</h1>
        <Button aria-label={`${t("sidebar.copyName")}: ${title}`}
          className="h-6 w-6 shrink-0 opacity-0 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/title:opacity-100"
          onClick={() => { const value = title.trim(); if (value) void onCopyTitle(value); }}
          size="icon-xs" title={t("sidebar.copyName")} type="button" variant="ghost">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {statusBadge ? <div className="flex shrink-0 flex-wrap items-center gap-1">{statusBadge}</div> : null}
      </div>
    </div></div>
  </header>;
}
