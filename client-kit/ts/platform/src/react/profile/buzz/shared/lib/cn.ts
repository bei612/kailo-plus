// Reused from Buzz 779af8886caae1317b4de962082429867ab61503; host transport is injected.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const mergeClassNames = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          // DD-141: `text-control` is the Kailo 13px control size, not a color.
          text: ["message", "message-timestamp", "control"],
        },
      ],
      rounded: ["rounded-squircle"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs));
}
