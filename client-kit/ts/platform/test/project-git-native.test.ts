// DD-160: Desktop's native repository reads behind the shared Projects host seam.
import {describe,expect,it,vi} from "vitest";
import {createNativeProjectsGitHost} from "../src/react/projects";

const scope={expectedRelayUrl:"wss://acme.relay.example",expectedSignerPubkey:"d".repeat(64)};
const repository=`30617:${"a".repeat(64)}:repo`;
const commit={hash:"c".repeat(40),short_hash:"ccccccc",author_name:"Ada",author_email:"ada@example.test",timestamp:1_700_000_000,subject:"Init"};

describe("native Projects git host",()=>{
  it("sends only the coordinate and refs with the captured scope, and maps the original raw snapshot",async()=>{
    const invoke=vi.fn(async()=>({latest_commit:commit,commits:[commit],
      files:[{path:"README.md",kind:"blob",size:12,preview_content:"# Repo",last_changed_at:1_700_000_000,latest_commit:commit},
        {path:"src",kind:"tree",size:null,preview_content:null,last_changed_at:null,latest_commit:null}],
      contributors:[{name:"Ada",email:"ada@example.test",commit_count:1,last_commit_at:1_700_000_000}]}));
    const host=createNativeProjectsGitHost(invoke,scope);
    const snapshot=await host.getProjectRepoSnapshot({repository,defaultBranch:"main",baseBranch:"main"});
    expect(invoke).toHaveBeenCalledWith("get_project_repo_snapshot",{repository,defaultBranch:"main",baseBranch:"main",
      targetRef:null,targetCommit:null,...scope});
    expect(Object.keys(invoke.mock.calls[0]![1] as object)).not.toContain("cloneUrl");
    expect(snapshot.latestCommit).toEqual({hash:commit.hash,shortHash:"ccccccc",authorName:"Ada",authorEmail:"ada@example.test",
      timestamp:1_700_000_000,subject:"Init"});
    expect(snapshot.files[0]).toMatchObject({path:"README.md",previewContent:"# Repo",lastChangedAt:1_700_000_000});
    expect(snapshot.files[1]).toEqual({path:"src",kind:"tree",size:null,previewContent:null,lastChangedAt:null,latestCommit:null});
    expect(snapshot.contributors).toEqual([{name:"Ada",email:"ada@example.test",commitCount:1,lastCommitAt:1_700_000_000}]);
  });

  it("never renders a response of another shape",async()=>{
    for(const raw of [null,[],{files:[]},{files:"x",commits:[],contributors:[]},
      {latest_commit:null,commits:[{hash:1}],files:[],contributors:[]},
      {latest_commit:null,commits:[null],files:[],contributors:[]},
      {latest_commit:null,commits:[],files:[{path:"a"}],contributors:[]}]){
      const host=createNativeProjectsGitHost(async()=>raw,scope);
      await expect(host.getProjectRepoSnapshot({repository})).rejects.toThrow();
    }
    const diffHost=createNativeProjectsGitHost(async()=>({files:[{path:"a",additions:1,deletions:0,patch:7,truncated:false}],additions:1,deletions:0}),scope);
    await expect(diffHost.getProjectRepoDiff({repository})).rejects.toThrow();
    const fileHost=createNativeProjectsGitHost(async()=>({content:"x"}),scope);
    await expect(fileHost.getProjectRepoFileContent({repository,path:"a"})).rejects.toThrow();
  });

  it("reads file content and diffs with the original arguments",async()=>{
    const invoke=vi.fn(async(command:string)=>command==="get_project_repo_file_content"?"hello":
      {files:[{path:"a.ts",additions:2,deletions:1,patch:"@@",truncated:true}],additions:2,deletions:1,commit_body:null});
    const host=createNativeProjectsGitHost(invoke,scope);
    await expect(host.getProjectRepoFileContent({repository,defaultBranch:"main",path:"a.ts"})).resolves.toBe("hello");
    expect(invoke).toHaveBeenLastCalledWith("get_project_repo_file_content",{repository,defaultBranch:"main",targetRef:null,
      targetCommit:null,path:"a.ts",...scope});
    const diff=await host.getProjectRepoDiff({repository,targetCommit:"e".repeat(40)});
    expect(diff).toEqual({additions:2,deletions:1,commitBody:null,files:[{path:"a.ts",additions:2,deletions:1,patch:"@@",truncated:true}]});
  });

  it("offers no branch or merge writes, so the views show none",()=>{
    const host=createNativeProjectsGitHost(async()=>null,scope);
    expect(host.createProjectRemoteBranch).toBeUndefined();
    expect(host.deleteProjectRemoteBranch).toBeUndefined();
    expect(host.mergeProjectPullRequest).toBeUndefined();
  });

  it("propagates native refusals instead of showing an empty repository",async()=>{
    const host=createNativeProjectsGitHost(async()=>{throw new Error("project_repo_not_found");},scope);
    await expect(host.getProjectRepoSnapshot({repository})).rejects.toThrow("project_repo_not_found");
  });
});
