// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; only identity/transport seams adapt to Kailo.
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../profile/buzz/shared/lib/cn";
import { POPOVER_RADIX_MOTION_CLASS, POPOVER_RADIX_SIDE_MOTION_CLASS, POPOVER_SHADOW_STYLE, POPOVER_SURFACE_CLASS } from "../popover-surface";
export const DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS = 500;
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverContent = React.forwardRef<
 React.ElementRef<typeof PopoverPrimitive.Content>,
 React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({className, align = "center", sideOffset = 4, style, ...props}, ref) => (
 <PopoverPrimitive.Portal><PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset}
 className={cn("z-50 w-72 origin-(--radix-popover-content-transform-origin) outline-hidden rounded-xl p-4", POPOVER_RADIX_MOTION_CLASS, POPOVER_RADIX_SIDE_MOTION_CLASS, POPOVER_SURFACE_CLASS, className)}
 style={{...POPOVER_SHADOW_STYLE, ...style}} {...props} /></PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
