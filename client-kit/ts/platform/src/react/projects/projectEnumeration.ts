// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/projectEnumeration.ts::enumerateProjectEvents.
// Host adapts only the typed query. Original second-boundary drain and tombstone
// fold are retained; page size comes from this Relay, not a frontend constant.
import type { ProjectsQueryRequest } from "@client-kit/contracts";
import type { PulseEvent } from "../pulse/host";
import { buildProjectReadModels } from "./projectModels";
import { absorbStandaloneProjectRepositories } from "./lib/projectCollection";

export type ProjectsPage = {events: PulseEvent[]; limit: number; pubkey: string; bindingVersion?: number};
export type ProjectsHost = {scopeKey: string; query: (request: ProjectsQueryRequest)=>Promise<ProjectsPage>};

export async function loadProjects(host: ProjectsHost, signal: AbortSignal) {
  const first = await host.query({view:"PROJECTS" as ProjectsQueryRequest["view"]});
  signal.throwIfAborted();
  if (!Number.isSafeInteger(first.limit) || first.limit <= 0 || !/^[0-9a-f]{64}$/.test(first.pubkey)) throw new Error("Invalid project scope");
  const fetchPage = async (request: ProjectsQueryRequest) => {
    signal.throwIfAborted();
    const page = await host.query(request);
    signal.throwIfAborted();
    if (page.limit !== first.limit || page.pubkey !== first.pubkey || page.bindingVersion !== first.bindingVersion) throw new Error("Project scope changed");
    return page.events;
  };
  const enumerate = async (view: ProjectsQueryRequest["view"], coordinates?: string[], seed?: PulseEvent[]) => {
    const eventsById = new Map<string,PulseEvent>();
    let until: number | undefined;
    for (;;) {
      signal.throwIfAborted();
      const page = seed ?? await fetchPage({view,coordinates,until}); seed=undefined;
      if(page.length>first.limit)throw new Error("Invalid project page");
      for(const event of page)eventsById.set(event.id,event);
      if(page.length<first.limit)return [...eventsById.values()];
      const oldest=Math.min(...page.map(event=>event.created_at));
      if(!Number.isSafeInteger(oldest)||oldest<0||(until!==undefined&&oldest>until))throw new Error("Invalid project cursor");
      const boundary=await fetchPage({view,coordinates,since:oldest,until:oldest});
      for(const event of boundary)eventsById.set(event.id,event);
      if(boundary.length>=first.limit)throw new Error("Project timestamp bucket exceeds Relay page limit");
      if(oldest<=0)return [...eventsById.values()];
      until=oldest-1;
    }
  };
  const [projectEvents,repositoryEvents]=await Promise.all([
    enumerate("PROJECTS" as ProjectsQueryRequest["view"],undefined,first.events),
    enumerate("REPOSITORIES" as ProjectsQueryRequest["view"]),
  ]);
  const coordinates=[...new Set([...projectEvents,...repositoryEvents].flatMap(event=>{
    const d=event.tags.find(tag=>tag[0]==="d")?.[1];return d?[`${event.kind}:${event.pubkey}:${d}`]:[];
  }))];
  const deletionEvents:PulseEvent[]=[];
  // Sequential bounded batches: do not saturate Relay with one REQ per repository.
  for(let index=0;index<coordinates.length;index+=first.limit){
    deletionEvents.push(...await enumerate("DELETIONS" as ProjectsQueryRequest["view"],coordinates.slice(index,index+first.limit)));
  }
  signal.throwIfAborted();
  return absorbStandaloneProjectRepositories(buildProjectReadModels({projectEvents,repositoryEvents,deletionEvents,viewerPubkey:first.pubkey}))
    .sort((a,b)=>b.createdAt-a.createdAt);
}
