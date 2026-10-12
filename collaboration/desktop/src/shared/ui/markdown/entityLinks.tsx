import { EntityLinkAnchor as SharedEntityLinkAnchor } from "@client-kit/platform/react/projects";
import { translateCurrent as t } from "@client-kit/platform/i18n";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useProjectsHost } from "@/features/platform/ProjectsScreen";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { copyTextToClipboard } from "@/shared/lib/clipboard";

export function EntityLinkAnchor(props: {href:string;children?:ReactNode;interactive?:boolean;asChip?:boolean}) {
  if (props.interactive === false) return <SharedEntityLinkAnchor {...props}/>;
  return <NativeEntityLinkAnchor {...props}/>;
}
function NativeEntityLinkAnchor(props: {href:string;children?:ReactNode;interactive?:boolean;asChip?:boolean}) {
  const host = useProjectsHost();
  const {goProject} = useAppNavigation();
  return <SharedEntityLinkAnchor {...props} runtime={{host,onOpen:goProject,
    copyLink:href=>copyTextToClipboard(href,t("video.linkCopied")),
    onError:()=>toast.error(t("platform.loadFailed"))}}/>;
}
