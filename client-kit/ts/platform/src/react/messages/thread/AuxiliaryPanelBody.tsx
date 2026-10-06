// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/layout/AuxiliaryPanelBody.tsx.
import * as React from "react";

import {
  AuxiliaryPanelContext,
  resolveAuxiliaryPanelBodyMode,
} from "./auxiliaryPanelContext";
import type { AuxiliaryPanelMode } from "./auxiliaryPanelContext";
import { getAuxiliaryPanelBodyClass } from "./AuxiliaryPanelHeader";
import { cn } from "../../profile/buzz/shared/lib/cn";

type AuxiliaryPanelBodyProps = Omit<
  React.ComponentProps<"div">,
  "className"
> & {
  className?: string;
  /** Override mode when rendered outside `AuxiliaryPanel` (e.g. Radix dialog content). */
  mode?: AuxiliaryPanelMode;
  /** Apply top padding in floating overlay (`panel`) mode. */
  panelPadding?: boolean;
};

/** Scroll/content region for auxiliary panels with consistent chrome padding. */
export function AuxiliaryPanelBody({
  className,
  mode: modeOverride,
  panelPadding = false,
  ...props
}: AuxiliaryPanelBodyProps) {
  const context = React.useContext(AuxiliaryPanelContext);
  const mode = resolveAuxiliaryPanelBodyMode({
    context,
    mode: modeOverride,
  });

  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        getAuxiliaryPanelBodyClass({ mode }),
        panelPadding && mode === "panel" && "pt-4",
        className,
      )}
      {...props}
    />
  );
}
