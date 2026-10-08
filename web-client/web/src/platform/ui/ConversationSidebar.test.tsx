// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBffClient } from "@client-kit/platform/client";
import { ItemState, type ConversationView } from "@client-kit/contracts";
import type { BffRequest } from "@client-kit/platform/transport";
import { loadConversationSidebarActivity } from "./ConversationSidebar";

const self="a".repeat(64), peer="b".repeat(64);
const conversation:ConversationView={id:"dm",channelId:"native-dm",state:ItemState.Active,version:1,operationId:"open",participantPrincipalIds:["self","peer"]};
const event={id:"c".repeat(64),pubkey:peer,created_at:10,kind:9,content:"incoming",tags:[["h","native-dm"]]};
const bounds={...event,id:"d".repeat(64),kind:39006,tags:[["h","native-dm"],["d","native-dm:head"]],content:JSON.stringify({has_more:false,next_cursor:null})};

describe("Web DM sidebar admitted real window adapter",()=>{
  function fixture(options:{scope?:string;own?:string[];current?:ConversationView[];principal?:string;cursorLoop?:boolean;signal?:AbortController}={}){
    const requests:BffRequest[]=[];
    const client=createBffClient({send:async request=>{
      requests.push(request);
      if(request.path.startsWith("/api/v1/conversation-participants"))return {status:200,body:{items:[{principalId:"self",displayName:"Me",pubkeys:options.own??[self]}],maxParticipants:9,nextCursor:options.cursorLoop?"same":undefined}};
      if(request.path==="/api/v1/conversations/dm/messages"){
        options.signal?.abort();
        return {status:200,body:{events:[{...event,tags:[["h",options.scope??"native-dm"]]},{...event,id:"e".repeat(64),pubkey:self,created_at:30},bounds]}};
      }
      if(request.path==="/api/v1/conversations")return {status:200,body:{items:options.current??[conversation]}};
      if(request.path==="/api/v1/session")return {status:200,body:{tenantPrincipalId:options.principal??"self",accessMode:"FULL"}};
      throw new Error(`Unexpected request ${request.path}`);
    }});
    return {client,requests};
  }
  it("keeps only incoming messages for counts and uses own outgoing activity for original Recent ordering",async()=>{
    const {client,requests}=fixture();
    const result=await loadConversationSidebarActivity(client,"self",[conversation],new AbortController().signal);
    expect(result.events.map(item=>item.id)).toEqual([event.id]);
    expect(result.events[0]?.channelType).toBe("dm");
    expect(result.lastMessageAt.get("native-dm")).toBe(new Date(30_000).toISOString());
    expect(requests.every(request=>request.method==="GET")).toBe(true);
    expect(requests.filter(request=>request.path.includes("/messages"))).toHaveLength(1);
  });
  it.each([
    {scope:"foreign-channel"},{own:[]},{own:["not-a-pubkey"]},{current:[]},
    {current:[{...conversation,participantPrincipalIds:["self","other"]}]},{principal:"other"},{cursorLoop:true},
  ])("fails closed for unverifiable input %j",async options=>{
    const {client}=fixture(options);
    await expect(loadConversationSidebarActivity(client,"self",[conversation],new AbortController().signal)).rejects.toThrow();
  });
  it("stops before the next read when an awaited private window loses its caller",async()=>{
    const signal=new AbortController();const {client,requests}=fixture({signal});
    await expect(loadConversationSidebarActivity(client,"self",[conversation],signal.signal)).rejects.toThrow();
    expect(requests.some(request=>request.path==="/api/v1/session")).toBe(false);
  });
  it("never reads a disabled or foreign-participant private channel",async()=>{
    for(const candidate of [{...conversation,state:ItemState.Disabled},{...conversation,participantPrincipalIds:["peer","other"]}]){
      const {client,requests}=fixture();
      await expect(loadConversationSidebarActivity(client,"self",[candidate],new AbortController().signal)).rejects.toThrow();
      expect(requests.some(request=>request.path.includes("/messages"))).toBe(false);
    }
  });
});
