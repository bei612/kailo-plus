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
window.__TAURI_INTERNALS__=globalThis.__TAURI_INTERNALS__={invoke:async command=>{
  if(command==="get_identity")return {pubkey:own,displayName:"Viewer"};
  if(command==="get_custom_emoji")return {items:[]};
  if(command==="plugin:event|listen")return 1;
  if(command==="plugin:event|unlisten")return;
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
const {setLocale}=await import("@client-kit/platform/i18n");
const {ActiveCommunityProvider}=await import("./activeCommunity.tsx");
const {PulseScreen}=await import("./PulseScreen.tsx");
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
  const pulse=createRoute({getParentRoute:()=>base,path:"/",component:PulseScreen});
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
