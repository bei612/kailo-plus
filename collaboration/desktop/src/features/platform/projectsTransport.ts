import type {ProjectsPublishRequest} from "@client-kit/contracts";
import {verifyEvent} from "nostr-tools/pure";
import {TransportError} from "@client-kit/platform/transport";
import {relayClient} from "@/shared/api/relayClient";
import {signRelayEvent} from "@/shared/api/tauri";
import {classifyRelayPublishFailure,RelayPublishNotSentError} from "@/shared/api/relayPublishOutcome";
import type {BffClient} from "@client-kit/platform/client";
import {buildProjectBootstrapTemplates,buildGitIssueTags,buildProjectCommentTags,buildProjectIssueAssignment,buildProjectPullRequestApproval,buildProjectPullRequestStatus,canReviewProjectPullRequest,loadProjectAssignmentHumans,eventToProjectIssue,eventToProjectPullRequest,nextProjectIssueCommentCreatedAt,nextProjectPullRequestReviewCreatedAt,nextProjectPullRequestStatusCreatedAt,normalizeProjectPullRequestCommentAnchor,enumerateProjectEvents,type ProjectsHost} from "@client-kit/platform/react/projects";
import {ProjectsQueryRequestView} from "@client-kit/contracts";

// The existing Native typed query, next to its publication consumer. Generic
// a-tag filters run after Relay's SQL limit, so activity must drain before fold.
export function createProjectsQuery(viewer:string,active:()=>boolean,limit:number):ProjectsHost["query"]{
  const check=()=>{if(!active())throw new Error("Project identity changed");};
  return async request=>{
    check();const kinds=request.view==="PROJECTS"?[30621]:request.view==="REPOSITORIES"?[30617]:request.view==="DELETIONS"?[5]
      :request.view==="WORK_ITEMS"?[1618,1621]:request.view==="WORK_ITEM_ACTIVITY"?[1,1619,1630,1631,1632,1633]:null;
    const coordinateScoped=request.view!=="PROJECTS"&&request.view!=="REPOSITORIES";
    if(!Number.isSafeInteger(limit)||limit<1||kinds===null||coordinateScoped&&(!request.coordinates?.length||request.coordinates.length>limit||
      new Set(request.coordinates).size!==request.coordinates.length||request.coordinates.some(value=>
        !(request.view==="DELETIONS"?/^(30617|30621):[0-9a-f]{64}:.+$/:/^30617:[0-9a-f]{64}:.+$/).test(value)))
      ||!coordinateScoped&&request.coordinates!==undefined)throw new Error("Invalid project query");
    let events;
    if(request.view===ProjectsQueryRequestView.WorkItemActivity){
      const history=await enumerateProjectEvents(async page=>{
        const since=page.since===undefined?request.since:request.since===undefined?page.since:Math.max(page.since,request.since);
        const until=page.until===undefined?request.until:request.until===undefined?page.until:Math.min(page.until,request.until);
        if(since!==undefined&&until!==undefined&&since>until)return [];
        const rows=await relayClient.fetchEvents({kinds,limit,since,until});check();
        if(rows.some(event=>!kinds.includes(event.kind)||!verifyEvent(event)))throw new Error("Invalid project response");
        return rows;
      },request.view,limit,new AbortController().signal);
      events=history.filter(event=>request.coordinates!.includes(event.tags.find(tag=>tag[0]==="a")?.[1]??""))
        .sort((left,right)=>right.created_at-left.created_at||right.id.localeCompare(left.id)).slice(0,limit);
    }else{
      events=await relayClient.fetchEvents({kinds,limit,since:request.since,until:request.until,...(request.coordinates?{"#a":request.coordinates}:{})});
    }
    check();if(events.length>limit||events.some(event=>!kinds.includes(event.kind)||
      request.coordinates&&!event.tags.some(tag=>tag[0]==="a"&&request.coordinates!.includes(tag[1]??""))))throw new Error("Invalid project response");
    return {events,limit,pubkey:viewer};
  };
}

// Original projectCreation/projectDeletion; CLIENT signs and Relay decides ownership.
export function createProjectsPublisher(scopeKey:string,relayUrl:string,viewer:string,active:()=>boolean,client:Pick<BffClient,"workspaces"|"conversationParticipants">,relayQueryLimit:number){
  const check=()=>{if(!active())throw new TransportError("Project identity changed");};
  return async(request:ProjectsPublishRequest,key:string,observeOnly=false,observation?:{eventId?:string;onPrepared:(eventId:string)=>void})=>{
    let enteredPublication=false;
    try {
      check();
      // Original review comment fields ride only on a review comment (approval carries just its head).
      if(request.operation!=="CREATE_PULL_REQUEST_COMMENT"&&(request.reviewDecision!==undefined||request.anchorPath!==undefined
        ||request.anchorSide!==undefined||request.anchorLine!==undefined))throw new Error("Unexpected review comment fields");
      // Original pullRequestReviews.ts / hooks.ts review writes read the review head and the reviewer
      // authority from the trusted author/owner history (and the signer's own comments for ordering).
      const drain=(kinds:number[],authors:string[])=>enumerateProjectEvents(async page=>{
        const events=await relayClient.fetchEvents({kinds,authors,limit:relayQueryLimit,since:page.since,until:page.until});check();
        if(events.some(event=>!kinds.includes(event.kind)||!authors.includes(event.pubkey)||!verifyEvent(event)))throw new Error("Review history unavailable");
        return events;
      },ProjectsQueryRequestView.WorkItemActivity,relayQueryLimit,new AbortController().signal);
      const readReview=async(root:Parameters<typeof eventToProjectPullRequest>[0],owner:string,decision:boolean)=>{
        const actors=[...new Set([owner,root.pubkey])];
        const lifecycle=await drain([1619,1630,1631,1632,1633],actors);
        const comments=decision?await drain([1],[...new Set([...actors,viewer])]):[];
        return eventToProjectPullRequest(root,lifecycle.filter(event=>event.kind===1619),comments,lifecycle.filter(event=>event.kind!==1619));
      };
      const reviewCommit=/^[0-9a-f]{40}([0-9a-f]{24})?$/;
      if(request.operation==="APPROVE_PULL_REQUEST"){
        // Fixed pullRequestReviews.ts::submitProjectPullRequestReview("approve"); CLIENT signs.
        if(!request.targetEventId||!/^[0-9a-f]{64}$/.test(request.targetEventId)||!request.commit||!reviewCommit.test(request.commit)
          ||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined||request.visibility!==undefined
          ||request.title!==undefined||request.category!==undefined||request.mentions!==undefined||request.attachments!==undefined
          ||request.assigneeLabel!==undefined||request.assigneePubkey!==undefined||request.priorEventId!==undefined||request.pullRequestStatus!==undefined
          ||request.branchName!==undefined||request.targetBranch!==undefined||request.mergeBase!==undefined||request.reviewers!==undefined
          ||!Number.isSafeInteger(relayQueryLimit)||relayQueryLimit<1)throw new Error("Invalid review approval");
        const commit=request.commit;
        const readTarget=async()=>{
          const [root]=await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[1618],limit:1});check();
          if(!root||root.id!==request.targetEventId||root.kind!==1618||!verifyEvent(root))throw new Error("Review unavailable");
          const address=root.tags.find(tag=>tag[0]==="a")?.[1];
          const [kind,owner,...identifier]=address?.split(":")??[];
          const slug=identifier.join(":");
          if(kind!=="30617"||!owner||!/^[0-9a-f]{64}$/.test(owner)||!slug)throw new Error("Repository coordinate unavailable");
          const [repo]=await relayClient.fetchEvents({kinds:[30617],authors:[owner],"#d":[slug],limit:1});check();
          if(!repo||repo.kind!==30617||repo.pubkey!==owner||!verifyEvent(repo)||!repo.tags.some(tag=>tag[0]==="d"&&tag[1]===slug))throw new Error("Repository unavailable");
          return {root,repository:{owner,repoAddress:address!}};
        };
        const target=await readTarget();
        const template=buildProjectPullRequestApproval(target.repository,{id:target.root.id,author:target.root.pubkey},commit,request.body??"");
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try{
            const fresh=await readTarget();
            if(fresh.root.id!==target.root.id||fresh.repository.repoAddress!==target.repository.repoAddress)throw new Error("Review changed");
            const current=await readReview(fresh.root,fresh.repository.owner,true);
            if(current.commit!==commit)throw new Error("Review head changed");
            if(!canReviewProjectPullRequest(fresh.repository,current,viewer))throw new Error("Review decision denied");
            const signed=await signRelayEvent({kind:1,content:template.content,tags:template.tags,
              createdAt:nextProjectPullRequestReviewCreatedAt(current,Math.floor(Date.now()/1_000))});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Review approval signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==1||event.pubkey!==viewer||!verifyEvent(event)||event.content!==template.content
          ||JSON.stringify(event.tags)!==JSON.stringify(template.tags))throw new TransportError("Review approval receipt mismatch");
        return {eventId:event.id};
      }
      if(request.operation==="SELF_ASSIGN_ISSUE"||request.operation==="SELF_UNASSIGN_ISSUE"||request.operation==="ASSIGN_ISSUE"||request.operation==="UNASSIGN_ISSUE"){
        const self=request.operation==="SELF_ASSIGN_ISSUE"||request.operation==="SELF_UNASSIGN_ISSUE";
        const assignee=self?viewer:request.assigneePubkey;
        if(!request.targetEventId||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined
          ||request.visibility!==undefined||request.title!==undefined||request.body!==undefined||request.category!==undefined
          ||request.mentions!==undefined||request.attachments!==undefined||typeof request.assigneeLabel!=="string"
          ||!assignee||!/^[0-9a-f]{64}$/.test(assignee)||self&&request.assigneePubkey!==undefined
          ||!self&&(assignee===viewer||request.priorEventId!==undefined)
          ||request.priorEventId!==undefined&&!/^[0-9a-f]{64}$/.test(request.priorEventId)
          ||!Number.isSafeInteger(relayQueryLimit)||relayQueryLimit<1)throw new Error("Invalid task assignment");
        const readTarget=async()=>{
          const [root]=await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[1621],limit:1});check();
          if(!root||root.id!==request.targetEventId||root.kind!==1621||!verifyEvent(root))throw new Error("Task unavailable");
          const address=root.tags.find(tag=>tag[0]==="a")?.[1];
          const [kind,owner,...identifier]=address?.split(":")??[];
          const slug=identifier.join(":");
          if(kind!=="30617"||!owner||!/^[0-9a-f]{64}$/.test(owner)||!slug)throw new Error("Repository coordinate unavailable");
          const [repo]=await relayClient.fetchEvents({kinds:[30617],authors:[owner],"#d":[slug],limit:1});check();
          if(!repo||repo.kind!==30617||repo.pubkey!==owner||!verifyEvent(repo)||!repo.tags.some(tag=>tag[0]==="d"&&tag[1]===slug))throw new Error("Repository unavailable");
          if(!self){
            if(root.pubkey!==viewer&&owner!==viewer)throw new Error("Task assignment denied");
            const people=await loadProjectAssignmentHumans(client,new AbortController().signal);check();
            if(!people.has(assignee))throw new Error("Task assignee unavailable");
          }
          return {root,address:address!};
        };
        const target=await readTarget();
        const template=buildProjectIssueAssignment(request.operation==="SELF_ASSIGN_ISSUE"||request.operation==="ASSIGN_ISSUE"?"assign":"unassign",
          target.root.id,target.address,assignee,request.assigneeLabel,request.priorEventId);
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try{
            const fresh=await readTarget();
            if(fresh.root.id!==target.root.id||fresh.address!==target.address)throw new Error("Task changed");
            // Assignment heads include owner operations, not just this signer.
            // Drain unfiltered history because Relay filters tags after SQL cap.
            const history=await enumerateProjectEvents(async page=>{
              const events=await relayClient.fetchEvents({kinds:[1],limit:relayQueryLimit,since:page.since,until:page.until});check();
              if(events.some(event=>event.kind!==1||!verifyEvent(event)))throw new Error("Task assignment history unavailable");
              return events;
            },ProjectsQueryRequestView.WorkItemActivity,relayQueryLimit,new AbortController().signal);
            const current=eventToProjectIssue(fresh.root,[],history.filter(event=>event.tags.find(tag=>tag[0]==="a")?.[1]===fresh.address));
            if(self&&current.assigneeOperationHeads[viewer]!==request.priorEventId)throw new Error("Task assignment changed");
            const signed=await signRelayEvent({kind:1,...template,createdAt:nextProjectIssueCommentCreatedAt(current,Math.floor(Date.now()/1_000),viewer)});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Task assignment signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==1||event.pubkey!==viewer||!verifyEvent(event)||event.content!==template.content
          ||JSON.stringify(event.tags)!==JSON.stringify(template.tags))throw new TransportError("Task assignment receipt mismatch");
        return {eventId:event.id};
      }
      if(request.assigneeLabel!==undefined||request.assigneePubkey!==undefined||request.priorEventId!==undefined)throw new Error("Unexpected task assignment fields");
      if(request.operation==="SET_PULL_REQUEST_STATUS"){
        // Fixed pullRequestReviews.ts::updateProjectPullRequestStatus. CLIENT signs;
        // only the review author or repository owner (allowedActorsForRoot) may.
        const status=request.pullRequestStatus;
        if(!request.targetEventId||!/^[0-9a-f]{64}$/.test(request.targetEventId)||(status!=="open"&&status!=="draft"&&status!=="closed")
          ||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined||request.visibility!==undefined
          ||request.title!==undefined||request.body!==undefined||request.category!==undefined||request.mentions!==undefined||request.attachments!==undefined
          ||!Number.isSafeInteger(relayQueryLimit)||relayQueryLimit<1)throw new Error("Invalid review status");
        const readTarget=async()=>{
          const [root]=await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[1618],limit:1});check();
          if(!root||root.id!==request.targetEventId||root.kind!==1618||!verifyEvent(root))throw new Error("Review unavailable");
          const address=root.tags.find(tag=>tag[0]==="a")?.[1];
          const [kind,owner,...identifier]=address?.split(":")??[];
          const slug=identifier.join(":");
          if(kind!=="30617"||!owner||!/^[0-9a-f]{64}$/.test(owner)||!slug)throw new Error("Repository coordinate unavailable");
          const [repo]=await relayClient.fetchEvents({kinds:[30617],authors:[owner],"#d":[slug],limit:1});check();
          if(!repo||repo.kind!==30617||repo.pubkey!==owner||!verifyEvent(repo)||!repo.tags.some(tag=>tag[0]==="d"&&tag[1]===slug))throw new Error("Repository unavailable");
          if(root.pubkey!==viewer&&owner!==viewer)throw new Error("Review status denied");
          return {root,repository:{owner,repoAddress:address!}};
        };
        const target=await readTarget();
        const lifecycle=status==="open"?"open":status==="draft"?"draft":"closed";
        const template=buildProjectPullRequestStatus(target.repository,{id:target.root.id,author:target.root.pubkey},lifecycle);
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try{
            const fresh=await readTarget();
            if(fresh.root.id!==target.root.id||fresh.repository.repoAddress!==target.repository.repoAddress)throw new Error("Review changed");
            // Only author/owner lifecycle events are trusted; push those authors
            // and kinds to SQL and match the root locally after Relay's limit.
            const authors=[...new Set([fresh.repository.owner,fresh.root.pubkey])];
            const history=await enumerateProjectEvents(async page=>{
              const events=await relayClient.fetchEvents({kinds:[1630,1631,1632,1633],authors,limit:relayQueryLimit,since:page.since,until:page.until});check();
              if(events.some(event=>![1630,1631,1632,1633].includes(event.kind)||!authors.includes(event.pubkey)||!verifyEvent(event)))throw new Error("Review status history unavailable");
              return events;
            },ProjectsQueryRequestView.WorkItemActivity,relayQueryLimit,new AbortController().signal);
            const current=eventToProjectPullRequest(fresh.root,[],[],history);
            const signed=await signRelayEvent({kind:template.kind,content:template.content,tags:template.tags,
              createdAt:nextProjectPullRequestStatusCreatedAt(current,Math.floor(Date.now()/1_000))});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Review status signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==template.kind||event.pubkey!==viewer||!verifyEvent(event)||event.content!==template.content
          ||JSON.stringify(event.tags)!==JSON.stringify(template.tags))throw new TransportError("Review status receipt mismatch");
        return {eventId:event.id};
      }
      if(request.pullRequestStatus!==undefined)throw new Error("Unexpected review status field");
      if(request.operation==="CREATE_ISSUE_COMMENT"||request.operation==="CREATE_PULL_REQUEST_COMMENT"){
        const targetKind=request.operation==="CREATE_ISSUE_COMMENT"?1621:1618;
        if(!request.targetEventId||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined
          ||request.visibility!==undefined||request.title!==undefined||request.category!==undefined||typeof request.body!=="string"||!request.body.trim()
          ||request.mentions?.some(pubkey=>!/^[0-9a-f]{64}$/.test(pubkey))||!Number.isSafeInteger(relayQueryLimit)||relayQueryLimit<1)throw new Error("Invalid task comment");
        // Original hooks.ts::createProjectPullRequestComment review variants: line anchor and/or change request.
        const anchored=request.anchorPath!==undefined||request.anchorSide!==undefined||request.anchorLine!==undefined;
        const anchor=anchored?normalizeProjectPullRequestCommentAnchor({path:request.anchorPath,side:request.anchorSide,line:request.anchorLine}):null;
        const decision=request.reviewDecision===undefined?undefined:request.reviewDecision==="request-changes"?"request-changes" as const:null;
        const review=anchor||decision?{anchor:anchor??undefined,decision:decision??undefined,commit:request.commit??""}:undefined;
        if(anchored&&!anchor||decision===null||(review!==undefined)!==(request.commit!==undefined)||review&&!reviewCommit.test(review.commit)
          ||review&&targetKind!==1618)throw new Error("Invalid review comment");
        const readTarget=async()=>{
          const [root]=await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[targetKind],limit:1});check();
          if(!root||root.id!==request.targetEventId||root.kind!==targetKind||!verifyEvent(root))throw new Error("Project work item unavailable");
          const address=root.tags.find(tag=>tag[0]==="a")?.[1];
          const [kind,owner,...identifier]=address?.split(":")??[];
          const slug=identifier.join(":");
          if(kind!=="30617"||!owner||!/^[0-9a-f]{64}$/.test(owner)||!slug)throw new Error("Repository coordinate unavailable");
          const [repo]=await relayClient.fetchEvents({kinds:[30617],authors:[owner],"#d":[slug],limit:1});check();
          if(!repo||repo.kind!==30617||repo.pubkey!==owner||!verifyEvent(repo)||!repo.tags.some(tag=>tag[0]==="d"&&tag[1]===slug))throw new Error("Repository unavailable");
          return {root,repository:{owner,repoAddress:address!}};
        };
        const target=await readTarget();
        const content=request.body.trim();
        const tags=buildProjectCommentTags(target.repository,targetKind===1621?eventToProjectIssue(target.root):eventToProjectPullRequest(target.root),request.mentions??[],request.attachments??[],review);
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try{
            const fresh=await readTarget();
            if(fresh.root.id!==target.root.id||fresh.repository.repoAddress!==target.repository.repoAddress)throw new Error("Task changed");
            // Relay applies generic tags after its SQL limit. Drain unfiltered
            // author history first; a newer other task must not hide this root.
            let createdAt:number|undefined;
            if(targetKind===1621){
            const history=await enumerateProjectEvents(async page=>{
              const events=await relayClient.fetchEvents({kinds:[1],authors:[viewer],limit:relayQueryLimit,since:page.since,until:page.until});check();
              if(events.some(event=>event.kind!==1||event.pubkey!==viewer||!verifyEvent(event)))throw new Error("Task comment history unavailable");
              return events;
            },ProjectsQueryRequestView.WorkItemActivity,relayQueryLimit,new AbortController().signal);
            const comments=history.filter(comment=>comment.tags.some(tag=>tag[0]==="a"&&tag[1]===target.repository.repoAddress));
            createdAt=nextProjectIssueCommentCreatedAt(eventToProjectIssue(fresh.root,[],comments),Math.floor(Date.now()/1_000),viewer);
            }
            if(review){
              // The named head must still be the review's; decisions need the original reviewer authority.
              const current=await readReview(fresh.root,fresh.repository.owner,review.decision!==undefined);
              if(current.commit!==review.commit)throw new Error("Review head changed");
              if(review.decision){
                if(!canReviewProjectPullRequest(fresh.repository,current,viewer))throw new Error("Review decision denied");
                createdAt=nextProjectPullRequestReviewCreatedAt(current,Math.floor(Date.now()/1_000));
              }
            }
            // Fixed original ordinary PR comment signs at current time. Only
            // Tasks (and separately review decisions) use monotonic activity.
            const signed=await signRelayEvent({kind:1,content,tags,...(createdAt===undefined?{}:{createdAt})});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Comment signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==1||event.pubkey!==viewer||!verifyEvent(event)||event.content!==content||JSON.stringify(event.tags)!==JSON.stringify(tags))throw new TransportError("Comment publication receipt mismatch");
        return {eventId:event.id};
      }
      if(request.operation==="CREATE_ISSUE"){
        if(!request.targetEventId||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined
          ||request.visibility!==undefined||request.mentions!==undefined||request.attachments!==undefined||typeof request.title!=="string"||typeof request.body!=="string"
          ||!["issue","change-request","improvement"].includes(request.category??""))throw new Error("Invalid task creation");
        const [repo]=await relayClient.fetchEvents({ids:[request.targetEventId],kinds:[30617],limit:1});check();
        if(!repo||repo.id!==request.targetEventId||repo.kind!==30617||!verifyEvent(repo))throw new Error("Repository head unavailable");
        const slug=repo.tags.find(tag=>tag[0]==="d")?.[1];
        if(!slug)throw new Error("Repository coordinate unavailable");
        const tags=buildGitIssueTags({repoAddress:`30617:${repo.pubkey}:${slug}`,repoOwner:repo.pubkey,title:request.title,labels:[request.category!]});
        const content=request.body.trim();
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try {
            const [head]=await relayClient.fetchEvents({kinds:[30617],authors:[repo.pubkey],"#d":[slug],limit:1});check();
            if(!head||head.id!==repo.id||!verifyEvent(head))throw new Error("Repository head changed");
            const signed=await signRelayEvent({kind:1621,content,tags});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Task signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==1621||event.pubkey!==viewer||!verifyEvent(event)||event.content!==content||JSON.stringify(event.tags)!==JSON.stringify(tags))
          throw new TransportError("Task publication receipt mismatch");
        return {eventId:event.id};
      }
      const creating=request.operation!=="DELETE";
      if(creating){
        if((request.operation!=="CREATE_PROJECT"&&request.operation!=="CREATE_REPOSITORY")||!request.workspaceId||!request.name||request.targetEventId
          ||request.title!==undefined||request.body!==undefined||request.category!==undefined||request.mentions!==undefined||request.attachments!==undefined
          ||request.operation==="CREATE_PROJECT"&&!['listed','unlisted'].includes(request.visibility??'')
          ||request.operation==="CREATE_REPOSITORY"&&request.visibility!==undefined)throw new Error("Invalid project creation");
      }else if(!request.targetEventId||request.workspaceId||request.name!==undefined||request.description!==undefined||request.visibility!==undefined
        ||request.title!==undefined||request.body!==undefined||request.category!==undefined||request.mentions!==undefined||request.attachments!==undefined)throw new Error("Invalid project deletion");
      const admitHome=async()=>{
        const workspace=(await client.workspaces()).find(row=>row.id===request.workspaceId&&row.isMember===true);check();
        if(!workspace)throw new Error("Project home channel unavailable");
        return workspace;
      };
      const workspace=creating?await admitHome():null;
      // DD-80: WorkspaceView.id is the original Channel id, including recovery.
      const templates=workspace?buildProjectBootstrapTemplates({name:request.name!,description:request.description,ownerPubkey:viewer,
        projectChannelId:workspace.id,projectVisibility:request.visibility??"listed"}):null;
      const template=templates?(request.operation==="CREATE_PROJECT"?templates.project:templates.repository):null;
      enteredPublication=true;
      const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
        try {
        if(template&&templates){
          const heads=await relayClient.fetchEvents({kinds:[template.kind],authors:[viewer],"#d":[templates.dtag],limit:1});check();
          if(heads.length)throw new Error("Project coordinate already exists");
          await admitHome();
          const signed=await signRelayEvent(template);check();
          if(signed.pubkey!==viewer)throw new TransportError("Project signing identity changed");
          return signed;
        }
        const target=(await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[30621,30617],limit:1}))[0];check();
        if(!target||target.id!==request.targetEventId||![30621,30617].includes(target.kind))throw new Error("Project head unavailable");
        const slug=target.tags.find(tag=>tag[0]==="d")?.[1];
        if(!slug)throw new Error("Project coordinate unavailable");
        const [head]=await relayClient.fetchEvents({kinds:[target.kind],authors:[target.pubkey],"#d":[slug],limit:1});check();
        if(head?.id!==target.id)throw new Error("Project changed; refresh its current head");
        const signed=await signRelayEvent({kind:5,content:`Delete project ${target.tags.find(tag=>tag[0]==="name")?.[1]??slug}`,
          createdAt:Math.max(Math.floor(Date.now()/1_000),target.created_at+1),tags:[["a",`${target.kind}:${target.pubkey}:${slug}`]]});
        check();if(signed.pubkey!==viewer)throw new TransportError("Project signing identity changed");return signed;
        }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
      },observeOnly,observation);
      const expectedKind=request.operation==="DELETE"?5:request.operation==="CREATE_PROJECT"?30621:30617;
      check();if(event.kind!==expectedKind||event.pubkey!==viewer
        ||template&&(event.content!==template.content||JSON.stringify(event.tags)!==JSON.stringify(template.tags)))throw new TransportError("Project publication receipt identity mismatch");
      if(creating)await admitHome();
      return {eventId:event.id};
    }catch(error){
      if(!enteredPublication&&!observeOnly)throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));
      const failure=classifyRelayPublishFailure(error);
      if(observeOnly||failure?.kind==="outcomeUnknown"||!failure)throw new TransportError("Project publication outcome unknown");
      throw error;
    }
  };
}
