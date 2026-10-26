// DD-160: Desktop's native repository reads behind the shared Projects host seam.
import {describe,expect,it,vi} from "vitest";
import {createNativeProjectsGitHost} from "../src/react/projects";

const scope={expectedRelayUrl:"wss://acme.relay.example",expectedSignerPubkey:"d".repeat(64)};
const repository=`30617:${"a".repeat(64)}:repo`;
const commit={hash:"c".repeat(40),short_hash:"ccccccc",author_name:"Ada",author_email:"ada@example.test",timestamp:1_700_000_000,subject:"Init"};

describe("native Projects git host",()=>{
  it("sends only the coordinate and refs with the captured scope, and maps the original raw snapshot",async()=>{
    const invoke=vi.fn(async(_command:string,_args:Record<string,unknown>)=>({latest_commit:commit,commits:[commit],
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

  it("routes native branch writes with a retained key and no URL or signer supplied by the page",async()=>{
    const invoke=vi.fn(async()=>({branch:"feature",commit:commit.hash}));
    const host=createNativeProjectsGitHost(invoke,scope);
    const key="11111111-1111-4111-8111-111111111111";
    await host.createProjectRemoteBranch!({repository,sourceBranch:"main",newBranch:"feature",expectedCommit:commit.hash},key);
    expect(invoke).toHaveBeenLastCalledWith("create_project_remote_branch",{input:{operation:"CREATE_BRANCH",repository,branch:"feature",sourceBranch:"main",expectedCommit:commit.hash},idempotencyKey:key,...scope});
    await host.deleteProjectRemoteBranch!({repository,branch:"feature",expectedCommit:commit.hash},key);
    expect(invoke).toHaveBeenLastCalledWith("delete_project_remote_branch",{input:{operation:"DELETE_BRANCH",repository,branch:"feature",expectedCommit:commit.hash},idempotencyKey:key,...scope});
  });
  it("requires the actual device owner for merge and preserves the native confirmed status",async()=>{
    const invoke=vi.fn(async()=>({mergeCommit:commit.hash,statusEventId:"e".repeat(64)}));
    const input={repoAddress:repository,pullRequestId:"f".repeat(64),targetBranch:"main",sourceBranch:"feature",expectedCommit:commit.hash};
    await expect(createNativeProjectsGitHost(invoke,scope).mergeProjectPullRequest!(input,"key")).rejects.toThrow("PERMISSION_DENIED");
    expect(invoke).not.toHaveBeenCalled();
    const owner={...scope,expectedSignerPubkey:"a".repeat(64)};
    await expect(createNativeProjectsGitHost(invoke,owner).mergeProjectPullRequest!(input,"key")).resolves.toEqual({mergeCommit:commit.hash,statusEventId:"e".repeat(64)});
    expect(invoke).toHaveBeenLastCalledWith("merge_project_pull_request",{input:{operation:"MERGE",repository,branch:"main",sourceBranch:"feature",expectedCommit:commit.hash,pullRequestEventId:"f".repeat(64)},idempotencyKey:"key",...owner});
  });
  it("keeps typed native uncertainty and its operation ID for the original dialog",async()=>{
    const operationId="11111111-1111-4111-8111-111111111111";
    const host=createNativeProjectsGitHost(async()=>{throw {code:"PUBLISH_RESULT_UNKNOWN",operationId};},scope);
    await expect(host.deleteProjectRemoteBranch!({repository,branch:"feature",expectedCommit:commit.hash},operationId)).rejects.toMatchObject({errorClass:"UNKNOWN",reason:"PUBLISH_RESULT_UNKNOWN",operationId});
  });

  it("propagates native refusals instead of showing an empty repository",async()=>{
    const host=createNativeProjectsGitHost(async()=>{throw new Error("project_repo_not_found");},scope);
    await expect(host.getProjectRepoSnapshot({repository})).rejects.toThrow("project_repo_not_found");
  });
});

describe("native local checkout host",()=>{
  const rawStatus={local_path:"/app/checkouts/repo",local_branch:null,local_branches:[],local_head:null,
    remote_branch:"retained-branch",remote_head:null,ahead_count:0,behind_count:0,has_uncommitted_changes:false,
    has_untracked_files:false,can_push:true,can_pull:false,push_block_reason:null,pull_block_reason:"pending",
    pending_push:{branch:"retained-branch",old_commit:null,new_commit:"e".repeat(40),outcome:"retry_same_intent"}};
  it("retains the frozen push target when current local HEAD is absent",async()=>{
    const invoke=vi.fn(async(_command:string,_args:Record<string,unknown>)=>rawStatus);
    const host=createNativeProjectsGitHost(invoke,scope);
    const status=await host.checkout!.getProjectRepoSyncStatus({repository,branchName:"main"});
    expect(status).toMatchObject({localHead:null,canPush:true,pendingPush:{branch:"retained-branch",newCommit:"e".repeat(40),outcome:"retry_same_intent"}});
    expect(invoke).toHaveBeenCalledWith("get_project_repo_sync_status",{repository,branchName:"main",baseBranch:null,...scope});
  });
  it("reads a local file without invoking the remote reader",async()=>{
    const invoke=vi.fn(async(_command:string,_args:Record<string,unknown>)=>"local content");
    const host=createNativeProjectsGitHost(invoke,scope);
    await expect(host.checkout!.getProjectLocalRepoFileContent({repository,path:"src/local.ts"})).resolves.toBe("local content");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("get_project_local_repo_file_content",{repository,path:"src/local.ts",...scope});
  });
  it("never accepts an unconfirmed push or malformed pending status",async()=>{
    const host=createNativeProjectsGitHost(async()=>({pushed:false,branch:"main",commit:"e".repeat(40)}),scope);
    await expect(host.checkout!.pushProjectLocalRepository({repository,branchName:"main"})).rejects.toThrow();
    const wrongBranch=createNativeProjectsGitHost(async()=>({pushed:true,branch:"other",commit:"e".repeat(40)}),scope);
    await expect(wrongBranch.checkout!.pushProjectLocalRepository({repository,branchName:"main"})).rejects.toThrow();
    for(const raw of [{...rawStatus,pending_push:{...rawStatus.pending_push,outcome:"delivered"}},
      {...rawStatus,can_push:"yes"},{...rawStatus,can_pull:true},{...rawStatus,pending_push:{...rawStatus.pending_push,outcome:"unknown"}},{...rawStatus,pending_push:{...rawStatus.pending_push,new_commit:"bad"}}]){
      const malformed=createNativeProjectsGitHost(async()=>raw,scope);
      await expect(malformed.checkout!.getProjectRepoSyncStatus({repository})).rejects.toThrow();
    }
  });
  it("keeps native write uncertainty and conflicts distinguishable",async()=>{
    for(const code of ["project_repo_outcome_unknown","project_repo_conflict"]){
      const host=createNativeProjectsGitHost(async()=>{throw code;},scope);
      await expect(host.checkout!.pushProjectLocalRepository({repository})).rejects.toThrow(code);
    }
  });
});
