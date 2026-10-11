// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/projects/ui/ProjectOriginReference.tsx.
import { useUiT } from "../context";
import { usePulseHost } from "../pulse/host";
import type { SearchChannel } from "../search/types";

export type ProjectOriginReferenceProps = {agentName?:string|null;channelId?:string|null};

export function ProjectOriginReference(props:ProjectOriginReferenceProps) {
  const {OriginReference}=usePulseHost();
  if(!props.channelId&&!props.agentName)return null;
  if(!OriginReference)throw new Error("Project origin host unavailable");
  return <OriginReference {...props}/>;
}

/** Original presentation; metadata discovery does not admit channel messages. */
export function ProjectOriginReferenceContent({agentName,channelId,channel,ready,onOpenChannel}:
  ProjectOriginReferenceProps&{channel?:Pick<SearchChannel,"id"|"name"|"visibility"|"isMember">;
    ready:boolean;onOpenChannel:(channelId:string)=>void}) {
  const t=useUiT();
  if(channelId){
    // A pending/failed lookup is not evidence that a channel is private.
    if(!ready)return null;
    const isOpenable=channel!==undefined&&(channel.isMember||channel.visibility==="open");
    return <span className="inline-flex max-w-full min-w-0 items-center gap-1"
      title={isOpenable?t("projects.origin.claimed"):t("projects.origin.unavailable",{channelId})}>
      <span className="shrink-0 whitespace-nowrap" data-project-metadata-phrase>{t("projects.origin.startedFrom")}</span>
      {isOpenable?<button aria-label={t("projects.origin.open",{name:channel.name})}
        className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
        onClick={()=>onOpenChannel(channel.id)} type="button">#{channel.name}</button>
        :<span className="shrink-0 whitespace-nowrap">{t("projects.origin.privateChannel")}</span>}
      <span className="shrink-0 whitespace-nowrap" data-project-metadata-phrase>{t("projects.origin.authorClaimed")}</span>
    </span>;
  }
  if(agentName)return <span className="inline-flex max-w-full min-w-0 items-center gap-1" title={t("projects.origin.privateIdentifier")}>
    <span className="shrink-0 whitespace-nowrap" data-project-metadata-phrase>{t("projects.origin.startedPrivately")}</span>
    <span className="truncate font-medium text-foreground">{agentName}</span>
  </span>;
  return null;
}
