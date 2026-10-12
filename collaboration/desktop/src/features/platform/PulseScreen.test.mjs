import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
for(const name of ["window","document","localStorage","HTMLElement","Element","Node","NodeFilter","SVGElement",
  "HTMLInputElement","HTMLIFrameElement","HTMLTextAreaElement","HTMLMediaElement","Event","CustomEvent","MutationObserver","DOMParser","Range"])
  globalThis[name]=dom.window[name];
Object.assign(globalThis,{self:dom.window,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true,
  ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}});
Object.defineProperty(globalThis,"navigator",{configurable:true,value:dom.window.navigator});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
window.requestAnimationFrame=globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
window.cancelAnimationFrame=globalThis.cancelAnimationFrame=clearTimeout;
Object.defineProperties(HTMLElement.prototype,{offsetHeight:{configurable:true,get:()=>420},offsetWidth:{configurable:true,get:()=>800}});
HTMLElement.prototype.getBoundingClientRect=()=>new dom.window.DOMRect(0,0,800,420);
const own="a".repeat(64),peer="b".repeat(64),eventId="c".repeat(64);
const originId="12345678-1234-4234-8234-123456789012";
let nativeOrigin,originReads=[],nativeSearch,searchReads=[],detailFailure;
window.__TAURI_INTERNALS__=globalThis.__TAURI_INTERNALS__={invoke:async (command,args)=>{
  if(command==="get_identity")return {pubkey:own,displayName:"Viewer"};
  if(command==="get_custom_emoji")return {items:[]};
  if(command==="plugin:event|listen")return 1;
  if(command==="plugin:event|unlisten")return;
  if(command==="get_channels")return {hash:"original-member-snapshot",channels:[],last_messages:{}};
  if(command==="get_channel_details"){originReads.push(args.channelId);if(detailFailure)throw detailFailure;return nativeOrigin;}
  if(command==="search_messages"){searchReads.push(args);return typeof nativeSearch==="function"?nativeSearch():nativeSearch;}
  throw new Error(`Unexpected native command ${command}`);
}};
const React=await import("react");const {act}=React;
const {createRoot}=await import("react-dom/client");
const {QueryClient,QueryClientProvider}=await import("@tanstack/react-query");
const {createMemoryHistory,createRootRoute,createRoute,createRouter,RouterProvider}=await import("@tanstack/react-router");
const {PlatformProvider}=await import("@client-kit/platform/react/context");
const {createBffClient}=await import("@client-kit/platform/client");
const {ConversationVisibilityProvider}=await import("@client-kit/platform/react/new-message");
const {TooltipProvider}=await import("@client-kit/platform/react/sidebar/tooltip");
const {usePulseHost}=await import("@client-kit/platform/react/pulse");
const {setLocale}=await import("@client-kit/platform/i18n");
const {ActiveCommunityProvider}=await import("./activeCommunity.tsx");
const {PulseScreen}=await import("./PulseScreen.tsx");
const {ProjectRichContent}=await import("../../../../../client-kit/ts/platform/src/react/projects/ProjectRichContent.tsx");
const {relayClient}=await import("@/shared/api/relayClient");
const originalFetch=relayClient.fetchEvents;
relayClient.fetchEvents=async filter=>filter.kinds.includes(0)?(filter.authors??[]).map(pubkey=>({
  id:eventId,pubkey,created_at:1,kind:0,tags:[],
  content:JSON.stringify({display_name:pubkey===peer?"Actual author":"Viewer",about:"Original public biography"}),
})):filter.kinds.includes(1)?[{id:eventId,pubkey:peer,created_at:1,kind:1,tags:[],content:"Actual Pulse note"}]:[];
after(()=>{relayClient.fetchEvents=originalFetch;dom.window.close();});
async function until(check){for(let index=0;index<80;index++){
  if(check())return;await act(async()=>new Promise(resolve=>setTimeout(resolve,5)));
}assert.ok(check(),"Expected mounted original Pulse state");}

async function mount(options={}) {
  setLocale("en");
  const requests=[];
  const client=createBffClient({send:async request=>{
    requests.push(request);
    if(request.path==="/api/v1/session")return {status:200,body:{accessMode:"FULL",tenantPrincipalId:"viewer"}};
    if(request.path.startsWith("/api/v1/conversation-participants"))return {status:200,body:{maxParticipants:9,
      items:[{principalId:"peer",displayName:"Actual author",pubkeys:[peer]}]}};
    if(request.method==="POST")return options.accept?.()??{status:202,body:{actionKey:"conversation.open",
      actionExecutionId:"execution",operationId:"operation",gateState:"ALLOWED",dispatchState:"DISPATCHED"}};
    if(request.path.startsWith("/api/v1/conversations"))return options.conversations?.()??{status:200,body:{items:[{
      id:"actual-dm",channelId:"actual-native-channel",state:"ACTIVE",participantPrincipalIds:["peer","viewer"],operationId:"operation",version:1}]}};
    throw new Error(request.path);
  }});
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const base=createRootRoute();
  function OriginConsumer(){const {OriginReference}=usePulseHost();assert.ok(OriginReference);return React.createElement(OriginReference,{channelId:originId});}
  function DiscussionConsumer(){const {discussions}=usePulseHost();options.discussions(discussions);return discussions.renderPreview("Original **preview** [link](https://example.test/page)");}
  const pulse=createRoute({getParentRoute:()=>base,path:"/",component:options.discussions?()=>React.createElement(PulseScreen,null,React.createElement(DiscussionConsumer)):options.origin?()=>React.createElement(PulseScreen,null,React.createElement(OriginConsumer)):
    options.richContent?()=>React.createElement(PulseScreen,null,React.createElement(ProjectRichContent,{className:options.className,content:"Original **project body** with [a link](https://example.test/page)"})):PulseScreen});
  const channel=createRoute({getParentRoute:()=>base,path:"/channels/$channelId",component:()=>React.createElement("p",null,"Actual governed DM")});
  const compose=createRoute({getParentRoute:()=>base,path:"/messages/new",component:()=>React.createElement("p",null,"Wrong compose route")});
  const router=createRouter({routeTree:base.addChildren([pulse,channel,compose]),history:createMemoryHistory({initialEntries:["/"]})});
  await router.load();
  const visibility={read:async()=>new Set(),prepare:async()=>async()=>{}};
  async function render(communityHost="one.test") {
    const session={client,devicePubkey:own,displayName:null,facts:{communityHost,relayUrl:`wss://${communityHost}`,relayQueryLimit:16}};
    await act(async()=>root.render(React.createElement(QueryClientProvider,{client:cache},
      React.createElement(PlatformProvider,{client,locale:"en"},React.createElement(ConversationVisibilityProvider,{value:visibility},
        React.createElement(ActiveCommunityProvider,{session},React.createElement(TooltipProvider,null,
          React.createElement(RouterProvider,{router}))))))));
  }
  await render();
  return {host,router,requests,render,async close(){await act(async()=>root.unmount());cache.clear();host.remove();}};
}
async function openProfile(view){
  await until(()=>[...view.host.querySelectorAll("article button")].some(button=>button.textContent==="Actual author"));
  await act(async()=>[...view.host.querySelectorAll("article button")].find(button=>button.textContent==="Actual author").click());
  await until(()=>view.host.querySelector('[data-testid="user-profile-message"]'));
}

test("Native discussion host consumes original search, exact missing metadata, noninteractive preview and scope cancellation",async()=>{
  searchReads=[];detailFailure="channel not found";
  nativeSearch={hits:[{event_id:eventId,channel_id:originId,channel_name:null,pubkey:peer,created_at:3,content:"Actual discussion",kind:9,score:1}],found:1};
  let host;
  const view=await mount({discussions:value=>{host=value;}});
  try{
    await until(()=>host);const current=host;
    const result=await current.read(eventId,originId,new AbortController().signal);
    assert.equal(searchReads[0].q,eventId);assert.equal(searchReads[0].limit,500);
    assert.equal(result.hits[0].eventId,eventId);assert.deepEqual(result.channels,[]);
    assert.equal(view.host.querySelector(".inbox-preview-markdown strong").textContent,"preview");
    assert.equal(view.host.querySelector(".inbox-preview-markdown a"),null);
    detailFailure="Dependency unavailable: channel not found";
    await assert.rejects(current.read(eventId,originId,new AbortController().signal),error=>error.payload===detailFailure);
    detailFailure=null;
    let finish;nativeSearch=()=>new Promise(resolve=>{finish=resolve;});
    const late=current.read(eventId,null,new AbortController().signal);
    await view.render("two.test");finish({hits:[],found:0});
    await assert.rejects(late);assert.throws(()=>current.openChannel(originId));
    assert.equal(view.router.state.location.pathname,"/");
  }finally{detailFailure=null;await view.close();}
});

for(const className of [undefined,"mt-1 text-sm text-foreground/90","text-sm text-muted-foreground"]){
  test(`Native original project rich-content passes ${className??"default"} to the actual Markdown body`,async()=>{
    const view=await mount({richContent:true,className});try{
      await until(()=>view.host.querySelector(".message-markdown strong"));
      const body=view.host.querySelector(".message-markdown");
      assert.equal(body.querySelector("strong").textContent,"project body");
      assert.equal(body.classList.contains("text-sm"),true);
      assert.equal(body.classList.contains("text-message"),false);
      assert.equal(body.classList.contains(className?.includes("text-muted-foreground")?"text-muted-foreground":className?"text-foreground/90":"text-foreground"),true);
      if(className)assert.equal(body.classList.contains("text-foreground"),false);
      if(className?.includes("mt-1"))assert.equal(body.classList.contains("mt-1"),true);
      assert.equal(body.querySelector("a").getAttribute("href"),"https://example.test/page");
      assert.notEqual(body.parentElement.className,className??"text-sm");
      assert.equal(view.requests.filter(request=>request.method==="POST").length,0);
    }finally{await view.close();}
  });
}

test("Native Pulse original profile Message opens the governed ACTIVE channel, never an empty compose page",async()=>{
  const view=await mount();try{
    await openProfile(view);
    await act(async()=>view.host.querySelector('[data-testid="user-profile-message"]').click());
    await until(()=>view.router.state.location.pathname==="/channels/actual-native-channel");
    assert.deepEqual(view.requests.find(request=>request.method==="POST").body.conversationOpen.participantPrincipalIds,["peer","viewer"]);
    assert.equal(view.requests.filter(request=>request.method==="POST").length,1);
  }finally{await view.close();}
});

test("Native Pulse unknown DM stays on the current page and keeps the original profile",async()=>{
  const view=await mount({conversations:()=>({status:200,body:{items:[]}})});try{
    await openProfile(view);
    await act(async()=>view.host.querySelector('[data-testid="user-profile-message"]').click());
    await until(()=>view.host.querySelector('[role="alert"]'));
    assert.equal(view.router.state.location.pathname,"/");
    assert.notEqual(view.host.querySelector('[data-testid="user-profile-panel"]'),null);
    assert.equal(view.requests.filter(request=>request.method==="POST").length,1);
  }finally{await view.close();}
});

test("Native Pulse fences a late confirmed DM when the Community session changes",async()=>{
  let confirm;
  const view=await mount({accept:()=>new Promise(resolve=>{confirm=resolve;})});try{
    await openProfile(view);
    await act(async()=>view.host.querySelector('[data-testid="user-profile-message"]').click());
    await until(()=>confirm);
    await view.render("two.test");
    await act(async()=>confirm({status:202,body:{actionKey:"conversation.open",actionExecutionId:"execution",
      operationId:"operation",gateState:"ALLOWED",dispatchState:"DISPATCHED"}}));
    assert.equal(view.router.state.location.pathname,"/");
  }finally{await view.close();}
});

for(const visibility of ["open","private"]){
  test(`Native original project origin uses bounded metadata and preserves ${visibility} navigation`,async()=>{
    originReads=[];
    nativeOrigin={id:originId,name:"Native origin",channel_type:"stream",visibility,description:"",topic:null,purpose:null,
      member_count:1,member_pubkeys:[],last_message_at:null,archived_at:null,participants:[],participant_pubkeys:[],
      ttl_seconds:null,ttl_deadline:null,created_by:peer,created_at:"2026-10-07T00:00:00Z",updated_at:"2026-10-07T00:00:00Z",
      topic_set_by:null,topic_set_at:null,purpose_set_by:null,purpose_set_at:null,topic_required:false,max_members:null,nip29_group_id:null};
    const view=await mount({origin:true});try{
      await until(()=>view.host.textContent.includes("author-claimed"));
      assert.deepEqual(originReads,[originId]);
      if(visibility==="open"){
        const button=view.host.querySelector('[aria-label="Open author-claimed origin channel #Native origin"]');
        assert.ok(button);await act(async()=>button.click());
        await until(()=>view.router.state.location.pathname===`/channels/${originId}`);
      }else{
        assert.equal(view.host.querySelector("button"),null);
        assert.ok(view.host.textContent.includes("a private channel"));
        assert.equal(view.router.state.location.pathname,"/");
      }
      assert.equal(view.requests.filter(request=>request.method==="POST").length,0);
    }finally{await view.close();}
  });
}
