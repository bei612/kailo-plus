// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/community-members/ui/CommunityInviteDialog.tsx.
// DD-83 replaces direct public-key admission with the existing approved invitation flow.
import type { ReactNode } from "react";
import { useT } from "../context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../composer/shared/ui/dialog";

export function CommunityInviteDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[85vh] max-w-xl overflow-y-auto"
        data-testid="community-invite-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("invitations.communityInvite")}</DialogTitle>
          <DialogDescription>{t("invitations.explain")}</DialogDescription>
        </DialogHeader>
        <section className="mt-2 space-y-3">{children}</section>
      </DialogContent>
    </Dialog>
  );
}
