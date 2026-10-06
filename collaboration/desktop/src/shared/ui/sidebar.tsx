import * as React from "react";
import { SidebarProvider as SharedSidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { performSidebarDefaultHaptic } from "@/shared/lib/haptics";
export * from "@client-kit/platform/react/sidebar/sidebar";
export const SidebarProvider = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof SharedSidebarProvider>>((props, ref) =>
  <SharedSidebarProvider {...props} ref={ref} onDefaultWidthHaptic={performSidebarDefaultHaptic} />);
SidebarProvider.displayName = "SidebarProvider";
