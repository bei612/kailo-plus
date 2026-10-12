// Fixed Buzz desktop/src/features/projects/ui/CopyShareLinkMenuItem.tsx.
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { usePulseHost } from "../pulse/host";
import { DropdownMenuItem } from "../sidebar/dropdown-menu";

export function CopyShareLinkMenuItem({label,link,testId}: {label:string;link:string|null;testId?:string}) {
  const host = usePulseHost();
  const t = useUiT();
  if (!link) return null;
  return <DropdownMenuItem data-testid={testId} onSelect={event=>{
    event.preventDefault();event.stopPropagation();
    void host.copy(link).then(()=>toast.success(t("video.linkCopied")),()=>toast.error(t("platform.profile.copyFailed")));
  }}><Link2 className="h-4 w-4"/>{label}</DropdownMenuItem>;
}
