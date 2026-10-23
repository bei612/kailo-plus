// Reused from Buzz 779af8886caae1317b4de962082429867ab61503; host transport is injected.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

// DD-141 §9: Kailo button — 13/500 type, lg radius, brand primary with
// hover/pressed steps, a 2px keyboard focus ring and a 1px press settle.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-control font-medium tracking-[-0.003em] transition-[background-color,border-color,color,box-shadow,transform] duration-100 ease-standard focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-xs hover:border-muted-foreground/35 hover:bg-accent/60",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground/85 hover:bg-accent hover:text-accent-foreground",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 px-2.5",
        xs: "h-6 px-2",
        lg: "h-9 px-5",
        icon: "h-8 w-8",
        "icon-xs": "h-6 w-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
