import assert from "node:assert/strict";
import {after, afterEach, beforeEach, test} from "node:test";
import {JSDOM} from "jsdom";
import {finalizeEvent, getPublicKey} from "nostr-tools/pure";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {url:"http://localhost"});
Object.assign(globalThis, {window:dom.window, document:dom.window.document, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,"navigator",{configurable:true,value:dom.window.navigator});
const React = await import("react");
const {act} = React;
const {createRoot} = await import("react-dom/client");
const {ActiveCommunityProvider} = await import("@/features/platform/activeCommunity");
const {relayClient} = await import("@/shared/api/relayClient");
const {useChannelTyping} = await import("./useChannelTyping.ts");
const {handleRelayClosed, flushEvents} = await import("@/shared/api/relayClosedRecovery");
const original = {subscribe:relayClient.subscribeToTypingIndicators, connection:relayClient.subscribeToConnectionState, state:relayClient.getConnectionState};
const secret = new Uint8Array(32).fill(8);
const ownSecret = new Uint8Array(32).fill(9);
const peer = getPublicKey(secret);
const own = getPublicKey(ownSecret);
const channel = {id:"scope",channelType:"stream",isMember:true,archivedAt:null};
const session = {facts:{communityHost:"community.test",relayUrl:"wss://community.test"},devicePubkey:own,client:{},displayName:null};
let subscriptions, connectionListeners, connection, result, host, root;
function Consumer({channel}) {
  result=useChannelTyping(channel,own);
  return React.createElement("output",null,JSON.stringify(result.typingEntries));
}
const event = (kind=20002, tags=[["h","scope"]], created_at=Math.floor(Date.now()/1000), key=secret) =>
  finalizeEvent({kind,created_at,tags,content:kind===20002?"":"message"},key);
async function render(nextChannel=channel,nextSession=session) {
  await act(async()=>root.render(React.createElement(ActiveCommunityProvider,{session:nextSession},React.createElement(Consumer,{channel:nextChannel}))));
}
beforeEach(()=>{
  subscriptions=[];connectionListeners=new Set();connection="connected";
  relayClient.getConnectionState=()=>connection;
  relayClient.subscribeToConnectionState=listener=>{connectionListeners.add(listener);listener(connection);return()=>connectionListeners.delete(listener);};
  relayClient.subscribeToTypingIndicators=async(id,receive,closed)=>{
    const subscription={id,receive,closed,disposed:false};subscriptions.push(subscription);
    return async()=>{subscription.disposed=true;};
  };
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
after(()=>{
  relayClient.subscribeToTypingIndicators=original.subscribe;
  relayClient.subscribeToConnectionState=original.connection;
  relayClient.getConnectionState=original.state;
  dom.window.close();
});

test("native typing consumes only current signed channel/thread events and real completion",async()=>{
  await render();
  const receive=subscriptions[0].receive;
  await act(async()=>{
    receive(event(20002,[["h","other"]]));
    receive(event(20002,[["h","scope"],["h","other"]]));
    receive(event(20002,[["h","scope"]],Math.floor(Date.now()/1000)-9));
    receive(event(20002,[["h","scope"]],undefined,ownSecret));
    receive({...JSON.parse(JSON.stringify(event())),sig:"0".repeat(128)});
    receive({tags:null});
    receive(event(1));
  });
  assert.deepEqual(result.typingEntries,[]);
  const tags=[["h","scope"],["e","thread-root","","reply"]];
  await act(async()=>receive(event(20002,tags)));
  assert.deepEqual(result.typingEntries,[{pubkey:peer,threadHeadId:"thread-root"}]);
  await act(async()=>result.receiveMessage(event(9,tags)));
  assert.deepEqual(result.typingEntries,[]);
  await act(async()=>receive(event(20002,tags)));
  assert.deepEqual(result.typingEntries,[],"a duplicate indicator cannot undo completion suppression");
});

test("native terminal CLOSED drops buffered events; a fresh subscription and degraded connection use the actual dispatch boundary",async()=>{
  await render();
  const subscription=subscriptions[0];
  await act(async()=>subscription.receive(event()));
  assert.equal(result.typingEntries.length,1);
  const live={mode:"live",filter:{kinds:[20002],"#h":["scope"]},onEvent:subscription.receive,onClosed:subscription.closed};
  const active=new Map([["typing",live]]);
  const sendReq=()=>assert.fail("restricted subscriptions cannot retry");
  await act(async()=>handleRelayClosed({subscriptions:active,subId:"typing",message:"restricted: membership revoked",sendReq}));
  assert.deepEqual(result.typingEntries,[]);
  await act(async()=>flushEvents([{subId:"typing",event:event(),generation:1}],active,1));
  assert.deepEqual(result.typingEntries,[],"the actual dispatcher rejects a buffered event after terminal CLOSED");
  await render({...channel,isMember:false});
  await render();
  const reopened=subscriptions.at(-1);
  assert.notEqual(reopened,subscription,"fresh membership creates the original new subscription");
  await act(async()=>reopened.receive(event()));
  assert.equal(result.typingEntries.length,1);
  await act(async()=>{
    connection="reconnecting";
    for(const listener of connectionListeners)listener(connection);
    reopened.receive(event());
  });
  assert.deepEqual(result.typingEntries,[]);
  await act(async()=>{connection="connected";for(const listener of connectionListeners)listener(connection);});
  assert.deepEqual(result.typingEntries,[],"reconnection cannot restore an old indicator");
});

test("native membership, session and scope changes discard old subscription deliveries",async()=>{
  await render();
  const first=subscriptions[0];
  await act(async()=>first.receive(event()));
  assert.equal(result.typingEntries.length,1);
  await render({...channel,isMember:false});
  assert.equal(first.disposed,true);
  assert.deepEqual(result.typingEntries,[]);
  await act(async()=>first.receive(event()));
  assert.deepEqual(result.typingEntries,[]);
  await render();
  const second=subscriptions.at(-1);
  await act(async()=>second.receive(event()));
  assert.equal(result.typingEntries.length,1);
  await render(channel,{...session,client:{}});
  assert.equal(second.disposed,true);
  assert.deepEqual(result.typingEntries,[]);
  await act(async()=>second.receive(event()));
  assert.deepEqual(result.typingEntries,[]);
  await render({...channel,channelType:"forum"});
  assert.equal(subscriptions.at(-1).disposed,true);
  assert.deepEqual(result.typingEntries,[]);
});
