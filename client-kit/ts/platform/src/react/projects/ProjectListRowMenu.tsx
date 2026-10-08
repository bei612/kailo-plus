// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectListRowMenu.tsx, shared host imports only.
import { MoreHorizontal } from "lucide-react";
import type * as React from "react";

import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";

export function ProjectListRowMenu({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={label}
          className="relative z-20 h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
