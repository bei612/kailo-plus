// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/app/RootErrorBoundary.tsx.
// Root-level render fence (upstream block/buzz issue 5078): an uncaught render error shows the original
// degraded splash with Reload instead of a blank page. Copy is localized at render time.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { translateCurrent } from "../i18n";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[RootErrorBoundary] uncaught render error:", error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background px-6 text-foreground"
          data-testid="root-error-boundary" role="alert">
          <p className="text-base font-semibold">{translateCurrent("platform.rootError.title")}</p>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {translateCurrent("platform.rootError.description")}
          </p>
          <button
            type="button"
            className="rounded-md border border-border bg-secondary px-4 py-2 text-sm hover:bg-secondary/80"
            onClick={() => window.location.reload()}
          >
            {translateCurrent("platform.rootError.reload")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
