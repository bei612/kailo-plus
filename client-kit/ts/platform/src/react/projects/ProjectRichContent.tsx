// Original ProjectRichContent delegates Markdown and NIP-92 metadata to the
// existing host, just as Pulse does; Web media stays BFF-authorized.
import { usePulseHost } from "../pulse/host";

export function ProjectRichContent({content,tags,className="text-sm"}:{content:string;tags?:string[][];className?:string}) {
  return usePulseHost().renderContent(content,tags,className);
}
