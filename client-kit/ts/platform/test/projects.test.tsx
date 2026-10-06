import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { beforeEach,describe,expect,it,vi } from "vitest";
import {setLocale} from "../src/i18n";
import {ProjectsView,loadProjects,type ProjectsHost} from "../src/react/projects";
import type {PulseEvent} from "../src/react/pulse/host";
import {buildProjectReadModels} from "../src/react/projects/projectModels";
import {render,button,click} from "./render";

const owner="a".repeat(64),other="b".repeat(64);
function project(name="Real project",id="p",time=10):PulseEvent{return {id,pubkey:owner,kind:30621,created_at:time,content:"",tags:[["d",id],["name",name],["description","Signed announcement"],["a",`30617:${other}:missing`]]};}
function host(rows:PulseEvent[]=[project()]):ProjectsHost{return {scopeKey:"tenant:owner",query:async req=>({events:req.view==="PROJECTS"?rows:[],pubkey:owner,limit:3})};}
const signal=()=>new AbortController().signal;
beforeEach(()=>setLocale("en"));

describe("original Projects announcements",()=>{
  it("reads actual NIP-MP names and retains unresolved repository coordinates without guessing access",async()=>{
    const read=await loadProjects(host(),signal());
    expect(read[0]?.name).toBe("Real project");expect(read[0]?.owner).toBe(owner);
    expect(read[0]?.repositories).toEqual([]);
    expect(read[0]?.unavailableRepositoryAddresses).toEqual([`30617:${other}:missing`]);
  });
  it("only enumerates scoped tombstones and fails closed rather than resurrecting deleted projects",async()=>{
    const h=host();const fetch=h.query;h.query=vi.fn(async req=>{if(req.view==="DELETIONS")throw new Error("Relay unreachable");return fetch(req);});
    await expect(loadProjects(h,signal())).rejects.toThrow("Relay unreachable");
    expect(h.query).toHaveBeenCalledWith(expect.objectContaining({view:"DELETIONS",coordinates:[`30621:${owner}:p`]}));
    const deleted=buildProjectReadModels({projectEvents:[project()],repositoryEvents:[],deletionEvents:[{id:"d",pubkey:owner,kind:5,created_at:11,content:"",tags:[["a",`30621:${owner}:p`]]}]});
    expect(deleted).toEqual([]);
  });
  it("retains the upstream unlisted owner boundary and canonical NIP-MP membership checks",()=>{
    const hidden=project();hidden.tags.push(["buzz-visibility","unlisted"]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:other})).toEqual([]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:owner})).toHaveLength(1);
    const invalid=project();invalid.tags.push(["a",`30617:${other}:missing`]);
    expect(buildProjectReadModels({projectEvents:[invalid],repositoryEvents:[]})).toEqual([]);
  });
  it("drains the full oldest second before advancing and refuses an uncompletable bucket",async()=>{
    const query=vi.fn<ProjectsHost["query"]>(async req=>({pubkey:owner,limit:2,events:req.view!=="PROJECTS"?[]:req.since!==undefined?[project("boundary","b",8)]:req.until===7?[project("older","c",7)]:[project("new","a",10),project("boundary","b",8)]}));
    expect(await loadProjects({scopeKey:"scope",query},signal())).toHaveLength(3);
    expect(query).toHaveBeenCalledWith({view:"PROJECTS",coordinates:undefined,since:8,until:8});
    const saturated:ProjectsHost={scopeKey:"scope",query:async req=>({pubkey:owner,limit:2,events:req.view==="PROJECTS"?[project("a","a",8),project("b","b",8)]:[]})};
    await expect(loadProjects(saturated,signal())).rejects.toThrow("timestamp bucket");
  });
  it("refuses a changed signing identity during enumeration",async()=>{
    let n=0;const h:ProjectsHost={scopeKey:"scope",query:async()=>({pubkey:n++===0?owner:other,limit:3,events:[]})};
    await expect(loadProjects(h,signal())).rejects.toThrow("scope changed");
  });
  it("cancels further enumeration when leaving the scope",async()=>{
    const abort=new AbortController();const h=host();const query=h.query;h.query=async r=>{abort.abort();return query(r);};
    await expect(loadProjects(h,abort.signal)).rejects.toThrow();
  });
  it("opens the original announcement card, switches layout and removes old detail on failed fresh read",async()=>{
    const h=host();const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<QueryClientProvider client={cache}><ProjectsView host={h}/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    await click(button(ui,"View Real project"));
    expect(ui.querySelector("aside")?.textContent).toContain(`30617:${other}:missing`);
    expect(ui.querySelector("aside")?.textContent).toContain("does not grant access");
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="List layout"]')!);expect(ui.querySelectorAll("[data-projects-grid-card]")).toHaveLength(0);
    h.query=async()=>{throw new Error("revoked");};await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Try again"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')).not.toBeNull());
    expect(ui.querySelector("aside")).toBeNull();expect(ui.textContent).not.toContain("Real project");
  });
  it("uses the same Chinese catalog without fabricating create or Git actions",async()=>{
    setLocale("zh-CN");const cache=new QueryClient();
    const ui=await render(<QueryClientProvider client={cache}><ProjectsView host={host([])}/></QueryClientProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("暂无项目"));
    expect(ui.querySelector('button[aria-label="网格布局"]')).not.toBeNull();
    expect(ui.textContent).not.toMatch(/Create project|Delete project|terminal/);
  });
});
