// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/home/ui/InboxDetailPane.tsx::InboxMessageDetailPane render
// frame: the detail section, original header, message column and the bottom
// composer overlay (fade, corner masks) whose height pads the message column.
// Hosts supply only their governed composers, rows and dialogs.
import * as React from "react";

import { InboxDetailHeader } from "../inbox-surface";

type HeaderProps = React.ComponentProps<typeof InboxDetailHeader>;

export function InboxDetailFrame({
  header,
  headerKey,
  sectionRef,
  renderMessages,
  composer,
  dialog,
}: {
  header: HeaderProps;
  /** Remounts the header (and its open menu) when the actor or anchor changes. */
  headerKey: string;
  sectionRef?: React.Ref<HTMLElement>;
  renderMessages: (composerOverlayRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
  composer: React.ReactNode;
  dialog?: React.ReactNode;
}) {
  const composerWrapperRef = React.useRef<HTMLDivElement | null>(null);
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60"
      data-testid="home-inbox-detail"
      ref={sectionRef}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <InboxDetailHeader key={headerKey} {...header} />

        {renderMessages(composerWrapperRef)}

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-40 isolate before:absolute before:inset-x-0 before:bottom-0 before:h-12 before:bg-gradient-to-b before:from-transparent before:to-background before:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:h-4 after:bg-background after:content-['']"
          data-testid="home-inbox-detail-composer-overlay"
          ref={composerWrapperRef}
        >
          <span
            aria-hidden="true"
            className="absolute bottom-4 left-4 h-4 w-4 bg-background"
            style={{
              maskImage:
                "radial-gradient(circle at top right, transparent 0 1rem, black calc(1rem + 0.5px))",
              WebkitMaskImage:
                "radial-gradient(circle at top right, transparent 0 1rem, black calc(1rem + 0.5px))",
            }}
          />
          <span
            aria-hidden="true"
            className="absolute bottom-4 right-4 h-4 w-4 bg-background"
            style={{
              maskImage:
                "radial-gradient(circle at top left, transparent 0 1rem, black calc(1rem + 0.5px))",
              WebkitMaskImage:
                "radial-gradient(circle at top left, transparent 0 1rem, black calc(1rem + 0.5px))",
            }}
          />
          <div className="pointer-events-auto">{composer}</div>
        </div>
      </div>
      {dialog}
    </section>
  );
}
