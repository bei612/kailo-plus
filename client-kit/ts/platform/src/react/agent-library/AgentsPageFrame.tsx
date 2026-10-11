// Buzz 779af8886caae1317b4de962082429867ab61503 AgentsView + PageHeader layout.
import type { ReactNode } from "react";

export function AgentsPageFrame({ title, description, action, children }: {
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8" data-testid="agent-definitions">
      <div className="mx-auto w-full max-w-6xl space-y-8 [container-type:inline-size]" data-testid="agents-page-content">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-base font-normal text-muted-foreground">{description}</p>
          </div>
          <div className="shrink-0">{action}</div>
        </div>
        <div className="flex flex-col gap-8">{children}</div>
      </div>
    </div>
  );
}
