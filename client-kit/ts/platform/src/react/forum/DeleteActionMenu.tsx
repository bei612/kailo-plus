// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/forum/ui/{DeleteActionMenu,DeleteConfirmDialog}.tsx.
// Original menu and default AlertDialog surface; transport remains host-owned.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { isOutcomeUnknown } from "../../transport";

export function DeleteActionMenu({ reply, onConfirm }: { reply: boolean; onConfirm: () => Promise<void> }) {
  const t = useUiT();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState<"unknown" | "rejected" | null>(null);
  const active = React.useRef(false);
  const label = t(reply ? "forum.deleteReply" : "forum.deletePost");
  const confirm = async () => {
    if (active.current) return;
    active.current = true; setPending(true);
    try { await onConfirm(); setOpen(false); setProblem(null); }
    catch (error) { setProblem(isOutcomeUnknown(error) ? "unknown" : "rejected"); }
    finally { active.current = false; setPending(false); }
  };
  return <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
    <DropdownMenu modal={false}><DropdownMenuTrigger asChild><button aria-label={label}
      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" type="button">
      <MoreHorizontal className="h-4 w-4" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="mr-2 h-4 w-4" />{label}</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}><AlertDialog.Portal>
      <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
          <div className="flex flex-col space-y-2 text-left"><AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("forum.deleteTitle", { label })}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">{t("forum.deleteDescription")}</AlertDialog.Description></div>
          {problem ? <p role={problem === "unknown" ? "status" : "alert"} className={problem === "unknown" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{t(problem === "unknown" ? "forum.deleteUnknown" : "forum.deleteRejected")}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button disabled={pending} type="button" variant="outline">{t("forum.cancel")}</Button></AlertDialog.Cancel>
            <Button disabled={pending} onClick={() => { void confirm(); }} type="button" variant="destructive">{t(pending ? "forum.deleting" : problem === "unknown" ? "forum.deleteCheck" : reply ? "forum.deleteReply" : "forum.deletePost")}</Button>
          </div>
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal></AlertDialog.Root>
  </div>;
}
