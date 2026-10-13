import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { translate } from "@client-kit/platform/i18n";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { classifyRelayPublishFailure } from "../../../shared/api/relayPublishOutcome.ts";

import {
  buildInboxItems,
  formatInboxTypeLabel,
  getInboxConversationId,
  getInboxTypeLabel,
} from "./inbox.ts";
import { getHomeMessageCapabilities } from "./homeMessageCapabilities.ts";
import { hasInboxThreadContext } from "./inboxViewHelpers.ts";

test("Native original header delete captures its admitted anchor and cannot retarget a stale or UNKNOWN intent", () => {
  const file=ts.createSourceFile("InboxDetailPane.tsx",readFileSync(new URL("../ui/InboxDetailPane.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=new Set(["canEdit","headerDeleteTarget","headerDeletePending","requestHeaderDelete"]), declarations=[];
  let header;
  function visit(node) {
    if(ts.isVariableDeclaration(node)&&names.has(node.name.getText(file)))declarations.push(`const ${node.getText(file)};`);
    if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==="InboxDetailHeader")header=node.getText(file);
    ts.forEachChild(node,visit);
  }
  visit(file);assert.equal(declarations.length,names.size);assert.ok(header);
  const fields=["videoReviewMessages","sourceEventId","canManageMessages","hasThreadContextLoadError","isThreadContextLoading","currentPubkey","editing","unresolved","isSendingReply","editTarget","deleteDialog","owner","currentHeaderDelete","editScopeKey","contextLabel","onBack","openContextLabel","item","contextChannelId","canOpenContext","onOpenContext","contextThreadRootId"];
  const source=ts.transpile(`const {${fields.join(",")}}=input;${declarations.join("\n")}currentHeaderDelete.current=requestHeaderDelete;return ${header};`,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
  const render=new Function("React","InboxDetailHeader","input",source);
  const calls=[],pubkey="a".repeat(64),target={id:"b".repeat(64),kind:9,signerPubkey:pubkey};
  const currentHeaderDelete={current:undefined};
  const input={videoReviewMessages:[target],sourceEventId:target.id,canManageMessages:true,hasThreadContextLoadError:false,isThreadContextLoading:false,currentPubkey:pubkey,
    editing:false,unresolved:false,isSendingReply:false,editTarget:null,deleteDialog:{pending:false,unresolvedMessageId:null,requestDelete:message=>calls.push(message)},owner:{active:true},currentHeaderDelete,
    editScopeKey:"actor/channel/thread",contextLabel:"Original channel",openContextLabel:"open",item:{fullTimestampLabel:"now"},contextChannelId:"channel",canOpenContext:false,onOpenContext:()=>assert.fail("delete cannot navigate"),contextThreadRootId:"root"};
  const build=changes=>render(React,()=>null,{...input,...changes});
  for(const kind of [9,45001,45003]) {
    const message={...target,kind};const element=build({videoReviewMessages:[message]});
    assert.equal(element.props.onOpen,undefined,"open permission is not delete permission");
    element.props.onDelete();assert.equal(calls.at(-1),message);
  }
  const stale=build();const next={...target,id:"c".repeat(64)};const current=build({sourceEventId:next.id,videoReviewMessages:[next]});
  assert.notEqual(stale.key,current.key,"changing anchor closes the original menu");
  const before=calls.length;stale.props.onDelete();assert.equal(calls.length,before);
  for(const changes of [{canManageMessages:false},{hasThreadContextLoadError:true},{isThreadContextLoading:true},{currentPubkey:"other"},{videoReviewMessages:[]}])assert.equal(build(changes).props.onDelete,undefined);
  for(const changes of [{editing:true},{unresolved:true},{isSendingReply:true},{editTarget:target},{deleteDialog:{...input.deleteDialog,pending:true}},
    {deleteDialog:{...input.deleteDialog,unresolvedMessageId:next.id}}]) {
    const blocked=build(changes);assert.equal(blocked.props.deletePending,true);blocked.props.onDelete();
  }
  assert.equal(calls.length,before);
  const retry=build({deleteDialog:{...input.deleteDialog,unresolvedMessageId:target.id}});
  assert.equal(retry.props.deletePending,false);retry.props.onDelete();assert.equal(calls.at(-1),target);
  const late=build();input.owner.active=false;late.props.onDelete();assert.equal(calls.length,before+1);
});

test("Native Inbox's actual detail header and composer restore original DM context, draft and send target", async () => {
  const file = ts.createSourceFile("InboxDetailPane.tsx", readFileSync(new URL("../ui/InboxDetailPane.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Set(["isDirectMessage", "composerChannelType", "replyTarget", "composerParentEventId", "composerReplyTarget", "channelContextName", "isThreadContext", "contextLabel", "contextThreadRootId", "openContextLabel"]);
  const declarations = [];
  let composer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && bindings.has(node.name.getText(file))) declarations.push(`const ${node.getText(file)};`);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MessageComposer") composer = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(declarations.length, bindings.size);
  assert.ok(composer);
  const source = ts.transpile(`const editTarget=null; const deleteDialog={pending:false};${declarations.join("\n")}return {contextLabel,contextThreadRootId,openContextLabel,composer:${composer}};`, {target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
  const project = new Function("React", "item", "displayMessages", "messages", "replyTargetId", "capturedDefaultParentId", "contextChannelName", "hasInboxThreadContext", "formatInboxTypeLabel", "locale", "t", "MessageComposer", "canReply", "isSendingReply", "disabledReplyReason", "setReplyTargetId", "onSendReply", source);
  const root = {id:"root",content:"root",authorLabel:"Original sender",tags:[["h",DM_CHANNEL_ID]]};
  const reply = {id:"reply",content:"reply",authorLabel:"Original sender",tags:[["h",DM_CHANNEL_ID],["e","root","","root"],["e","root","","reply"]]};
  const row = {id:"root",conversationId:`dm:${DM_CHANNEL_ID}`,channelLabel:"internal channel name",senderLabel:"Original sender",item:{...root,channelId:DM_CHANNEL_ID,channelType:"dm"},groupItems:[root,reply]};
  for (const locale of ["en","zh-CN"]) {
    const sends = [];
    const render = (value,replyId=null,canReply=true) => project(React,value,[root,reply],[root,reply],replyId,"captured-parent",null,hasInboxThreadContext,formatInboxTypeLabel,locale,(key,variables)=>translate(locale,key,variables),()=>null,canReply,false,"Actual refusal",()=>{},async payload=>sends.push(payload));
    const dm = render(row);
    assert.equal(dm.contextLabel, locale === "en" ? "DM with Original sender" : "与 Original sender 的私聊");
    assert.equal(dm.openContextLabel, locale === "en" ? "Open conversation" : "打开会话");
    assert.equal(dm.contextThreadRootId,null);
    assert.equal(dm.composer.props.draftKey,DM_CHANNEL_ID);
    assert.equal(dm.composer.props.channelType,"dm");
    assert.equal(dm.composer.props.placeholder,locale === "en" ? "Message Original sender" : "给 Original sender 发消息");
    await dm.composer.props.onSend("actual content",[],[]);
    assert.equal(sends.at(-1).parentEventId,null);
    const selected = render(row,"reply");
    await selected.composer.props.onSend("explicit reply",[],[]);
    assert.equal(sends.at(-1).parentEventId,"reply");
    assert.equal(selected.composer.props.draftKey,DM_CHANNEL_ID);
    assert.equal(render(row,null,false).composer.props.placeholder,"Actual refusal");
    const stream = render({...row,item:{...row.item,channelType:"stream"}});
    assert.equal(stream.contextLabel,locale === "en" ? "Thread in #internal channel name" : "#internal channel name 中的线程");
    assert.equal(stream.composer.props.draftKey,`thread:${row.conversationId}`);
    assert.equal(stream.composer.props.channelType,"stream");
    assert.equal(render({...row,item:{...row.item,channelType:"forum"}},null,false).composer.props.channelType,"forum");
    assert.equal(render({...row,item:{...row.item,channelType:"unknown"}},null,false).composer.props.channelType,null);
    await stream.composer.props.onSend("stream reply",[],[]);
    assert.equal(sends.at(-1).parentEventId,"captured-parent");
  }
});

test("Native Inbox edit/delete consumes the signed target, scope, original publisher and structural refresh",async()=>{
  const file=ts.createSourceFile("HomeView.tsx",readFileSync(new URL("../ui/HomeView.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let mutation;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==="mutateMessage")mutation=node.initializer.getText(file);ts.forEachChild(node,visit);}
  visit(file);assert.ok(mutation);
  const source=ts.transpile(`return (${mutation});`,{target:ts.ScriptTarget.ES2022});
  const factory=new Function("selectedItem","threadContext","canManageMessages","currentPubkey","nativeSession","editMessage","deleteMessage","TransportError","t","mutationOwner","mutationOwnerRef","onRefresh",source);
  const pubkey="a".repeat(64),target="b".repeat(64);
  const row={id:target,pubkey,kind:9};
  const calls=[],refreshes=[];
  const owner={active:true},ownerRef={current:owner};
  const make=(allowed=true,events=[row],receipt={id:"c".repeat(64),kind:40003,pubkey,tags:[["e",target]]})=>factory({item:{channelId:"admitted-channel"}},
    {events,refreshReactions:async()=>{refreshes.push("structural");}},allowed,pubkey,{devicePubkey:pubkey,facts:{relayUrl:"https://relay.example.invalid"}},
    async(...args)=>{calls.push(["edit",...args]);return receipt;},async(...args)=>{calls.push(["delete",...args]);return {...receipt,kind:5};},TransportError,
    key=>translate("en",key),owner,ownerRef,()=>refreshes.push("feed"));
  await make()(row,{content:"updated with media",mentions:["d".repeat(64)],media:[["imeta","url https://media.example.invalid/a"],["untrusted","ignored"]]});
  assert.deepEqual(calls[0],["edit","admitted-channel",target,"updated with media",[["imeta","url https://media.example.invalid/a"]],["d".repeat(64)],"https://relay.example.invalid",pubkey]);
  assert.deepEqual(refreshes,["structural","feed"]);
  await make()(row);assert.deepEqual(calls[1],["delete","admitted-channel",target,"https://relay.example.invalid",pubkey]);
  for(const kind of [45001,45003]){
    const forum={...row,kind};
    await make(true,[forum])(forum,{content:"forum edit",mentions:[],media:[]});
    assert.deepEqual(calls.at(-1),["edit","admitted-channel",target,"forum edit",[],[],"https://relay.example.invalid",pubkey]);
    await make(true,[forum])(forum);
    assert.deepEqual(calls.at(-1),["delete","admitted-channel",target,"https://relay.example.invalid",pubkey]);
  }
  const before=calls.length;
  await assert.rejects(make(false)(row,{content:"no",mentions:[],media:[]}));
  await assert.rejects(make(true,[{...row,pubkey:"e".repeat(64)}])(row,{content:"no",mentions:[],media:[]}));
  await assert.rejects(make(true,[{...row,kind:40003}])(row,{content:"no",mentions:[],media:[]}));
  assert.equal(calls.length,before);
  refreshes.length=0;
  await assert.rejects(make(true,[row],{id:"c".repeat(64),kind:40003,pubkey,tags:[["e","wrong-target"]]})(row,{content:"actual",mentions:[],media:[]}),TransportError);
  assert.deepEqual(refreshes,[]);
  ownerRef.current={active:true};
  await make()(row,{content:"late confirmed",mentions:[],media:[]});assert.deepEqual(refreshes,[]);
});

test("Native Inbox Forum management keeps fresh scope and author guards without requiring inline replies",()=>{
  const readDeclaration=(path,name)=>{
    const file=ts.createSourceFile(path,readFileSync(new URL(path,import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let value;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)===name)value=node.initializer.getText(file);ts.forEachChild(node,visit);}visit(file);assert.ok(value);return value;
  };
  const admission=new Function("selectedItem","availableChannelIds","coreReads","channelsQuery","threadContext","currentPubkey","nativeSession","selectedChannel","directChannel",
    ts.transpile(`return ${readDeclaration("../ui/HomeView.tsx","canManageMessages")};`,{target:ts.ScriptTarget.ES2022}));
  const eligible=new Function("canManageMessages","hasThreadContextLoadError","isThreadContextLoading","currentPubkey",
    ts.transpile(`return ${readDeclaration("../ui/InboxDetailPane.tsx","canEdit")};`,{target:ts.ScriptTarget.ES2022}));
  const pubkey="a".repeat(64),channelId="forum";
  const admit=(visible=true,archived=false,device=pubkey)=>admission({item:{channelId}},new Set([channelId]),{visibleChannels:new Set(visible?[channelId]:[])},{isFetching:false,isError:false},{hasLoadError:false,isLoading:false},pubkey,{devicePubkey:device},{isMember:true,archivedAt:archived?1:null},null);
  assert.equal(admit(),true);
  for(const kind of [9,45001,45003]){
    const row={kind,signerPubkey:pubkey};
    assert.equal(eligible(admit(),false,false,pubkey)(row),true);
    assert.equal(eligible(admit(false),false,false,pubkey)(row),false);
    assert.equal(eligible(admit(),false,false,pubkey)({...row,signerPubkey:"b".repeat(64)}),false);
    assert.equal(eligible(admit(),false,false,pubkey)({...row,pending:true}),false);
  }
  assert.equal(admit(true,true),false);assert.equal(admit(true,false,"other"),false);
  assert.equal(eligible(admit(),false,false,pubkey)({kind:40099,signerPubkey:pubkey}),false);
});

test("Native Inbox Forum row Edit renders the actual editor with replies disabled, submits and preserves UNKNOWN",async()=>{
  const file=ts.createSourceFile("InboxDetailPane.tsx",readFileSync(new URL("../ui/InboxDetailPane.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=new Map();let editAction,editor;
  function visit(node){
    if(ts.isVariableDeclaration(node)&&["canEdit","saveEdit","composerChannelType"].includes(node.name.getText(file)))declarations.set(node.name.getText(file),node.initializer.getText(file));
    if(ts.isJsxAttribute(node)&&node.name.getText(file)==="onEdit")editAction=node.initializer.expression.getText(file);
    if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==="MessageComposer"&&node.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(file)==="editTarget"))editor=node.parent.getText(file);
    ts.forEachChild(node,visit);
  }
  visit(file);assert.equal(declarations.size,3);assert.ok(editAction);assert.ok(editor);
  const source=ts.transpile(`
    let editTarget=null,editing=false,unresolved=false,canManageMessages=true,hasThreadContextLoadError=false,isThreadContextLoading=false;
    const canReply=false,isSendingReply=false,owner={active:true},profiles={},item={item:{channelId:"forum",channelType:"forum"},channelLabel:"Forum"};
    const composerChannelType=${declarations.get("composerChannelType")};
    const deleteDialog={pending:false,unresolvedMessageId:null,requestDelete(){}},focusComposer=()=>{},setReplyTargetId=()=>{},toTimelineMessage=value=>value;
    const setEditTarget=value=>{editTarget=typeof value==="function"?value(editTarget):value;};
    const setEditState=value=>{editing=value?.pending??false;unresolved=value?.unknown??false;};
    const handleCancelEdit=()=>{editTarget=null;};
    const canEdit=${declarations.get("canEdit")};
    const saveEdit=${declarations.get("saveEdit")};
    return {select:()=>{const action=${editAction};if(action)action(message);},render:()=>(${editor}),target:()=>editTarget,
      revoke:()=>{canManageMessages=false;},load:()=>{isThreadContextLoading=true;},state:()=>({editing,unresolved})};
  `,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
  const consume=new Function("React","MessageComposer","message","currentPubkey","onEditSave","t","isOutcomeUnknown","TransportError","classifyRelayPublishFailure",source);
  for(const kind of [45001,45003]){
    const message={id:"b".repeat(64),kind,signerPubkey:"a".repeat(64),body:"original"};
    const calls=[];let fail=false;
    const make=()=>consume(React,()=>null,message,message.signerPubkey,async(...args)=>{calls.push(args);if(fail)throw new TransportError("unknown");},key=>translate("en",key),isOutcomeUnknown,TransportError,classifyRelayPublishFailure);
    const view=make();view.select();
    const editor=view.render();assert.ok(React.isValidElement(editor));assert.equal(editor.props.editTarget,message);assert.equal(editor.props.disabled,false);assert.equal(editor.props.channelType,"forum");
    fail=true;await assert.rejects(editor.props.onSend("updated",["c".repeat(64)],[]),TransportError);
    assert.equal(view.state().unresolved,true);assert.equal(view.target(),message);assert.equal(view.render().props.onCancelEdit,undefined);
    fail=false;await view.render().props.onSend("updated",["c".repeat(64)],[]);
    assert.deepEqual(calls,[ [message,"updated",["c".repeat(64)],[]], [message,"updated",["c".repeat(64)],[]] ]);
    assert.equal(view.target(),null);assert.equal(view.render(),null);
    for(const guard of ["revoke","load"]){const denied=make();denied.select();denied[guard]();assert.equal(denied.render(),null);}
  }
});

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DM_CHANNEL_ID = "8ad375a7-6990-4b22-985f-e3fd34f634d7";

const channels = [
  {
    id: CHANNEL_ID,
    name: "buzz-bugs",
    channelType: "stream",
  },
  {
    id: DM_CHANNEL_ID,
    name: "dm-alice",
    channelType: "dm",
  },
];

function feedWith(overrides) {
  return {
    mentions: overrides.mentions ?? [],
    activity: overrides.activity ?? [],
  };
}

function item(overrides) {
  return {
    id: overrides.id ?? "event-1",
    kind: overrides.kind ?? 9,
    pubkey: overrides.pubkey ?? "author",
    content: overrides.content ?? "hello",
    createdAt: overrides.createdAt ?? 1,
    channelId: overrides.channelId ?? CHANNEL_ID,
    channelName: overrides.channelName ?? "",
    tags: overrides.tags ?? [["h", CHANNEL_ID]],
    category: overrides.category ?? "mention",
  };
}

test("the real Inbox row producer consumes locale without changing admitted identities or user content", () => {
  const feed = feedWith({ mentions: [item({ content: " \n " })], activity: [item({ id: "activity", category: "activity", content: "user text" })] });
  const english = buildInboxItems({ channels, feed });
  const chinese = buildInboxItems({ channels, feed, locale: "zh-CN" });
  const enMention = english.find(row => row.id === "event-1");
  const zhMention = chinese.find(row => row.id === "event-1");
  assert.equal(enMention.subject, "Mention");
  assert.equal(enMention.categoryLabel, "Mention");
  assert.equal(enMention.preview, "No additional details were attached to this event.");
  assert.equal(formatInboxTypeLabel(enMention), "Mentioned in #buzz-bugs");
  assert.equal(zhMention.subject, "提及");
  assert.equal(zhMention.categoryLabel, "提及");
  assert.equal(zhMention.preview, "此事件没有附加详情。");
  assert.equal(formatInboxTypeLabel(zhMention, "zh-CN"), "提及于 #buzz-bugs");
  assert.equal(chinese.find(row => row.id === "activity").preview, "user text");
  assert.equal(chinese.find(row => row.id === "activity").subject, "频道更新");
  assert.equal(chinese.find(row => row.id === "activity").categoryLabel, "动态");
  assert.deepEqual(chinese.map(row => [row.id, row.conversationId, row.groupItems, row.unreadCount]),
    english.map(row => [row.id, row.conversationId, row.groupItems, row.unreadCount]));
});

test("localized disabled-reply reasons preserve the actual admitted-channel guard", () => {
  const [row] = buildInboxItems({ channels, feed: feedWith({ mentions: [item({})] }) });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set(), "en"), {
    canReply: false, disabledReplyReason: "Open the linked channel to reply.",
  });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set(), "zh-CN"), {
    canReply: false, disabledReplyReason: "打开关联频道以回复。",
  });
  const noTarget = { ...row, item: { ...row.item, channelId: null } };
  assert.deepEqual(getHomeMessageCapabilities(noTarget, new Set([CHANNEL_ID]), "en"), {
    canReply: false, disabledReplyReason: "This inbox item does not have a reply target.",
  });
  assert.deepEqual(getHomeMessageCapabilities(noTarget, new Set([CHANNEL_ID]), "zh-CN"), {
    canReply: false, disabledReplyReason: "此收件箱条目没有可回复的目标。",
  });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set([CHANNEL_ID]), "zh-CN"), { canReply: true, disabledReplyReason: null });
  assert.deepEqual(getHomeMessageCapabilities(null, new Set(), "zh-CN"), { canReply: false, disabledReplyReason: null });
  for (const kind of [45001,45003]) {
    const forum = {...row,item:{...row.item,kind,channelType:"forum"}};
    assert.deepEqual(getHomeMessageCapabilities(forum,new Set([CHANNEL_ID]),"en"), {
      canReply:false,disabledReplyReason:"This item does not support inline replies yet.",
    });
    assert.deepEqual(getHomeMessageCapabilities(forum,new Set([CHANNEL_ID]),"zh-CN"), {
      canReply:false,disabledReplyReason:"此条目尚不支持行内回复。",
    });
    assert.equal(getHomeMessageCapabilities(forum,new Set(),"en").disabledReplyReason,"Open the linked channel to reply.");
  }
});

test("mention rows use the channel list when feed channelName is blank", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [item({ category: "mention" })],
    }),
  });

  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Mentioned in",
    channelLabel: "buzz-bugs",
  });
});

test("owned top-level activity keeps the original channel label while only replies are threads", () => {
  const [topLevel] = buildInboxItems({ channels, feed: feedWith({ activity: [item({ category: "activity" })] }) });
  assert.deepEqual(getInboxTypeLabel(topLevel), { text: "Channel update in", channelLabel: "buzz-bugs" });
  assert.deepEqual(getInboxTypeLabel(topLevel, "zh-CN"), { text: "频道更新于", channelLabel: "buzz-bugs" });
});

test("DM rows use directory type, merge roots and select the earliest unread message", () => {
  const events = [1, 2, 3].map(index => item({ id: `dm-${index}`, category: "activity", createdAt: index,
    channelId: DM_CHANNEL_ID, tags: [["h", DM_CHANNEL_ID], ...(index === 3 ? [["e", "dm-1", "", "reply"]] : [])] }));
  const rows = buildInboxItems({ channels, feed: feedWith({ activity: events }), getChannelReadAt: () => 1, getMessageReadAt: () => 100 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conversationId, `dm:${DM_CHANNEL_ID}`);
  assert.equal(rows[0].id, "dm-2");
  assert.equal(rows[0].unreadCount, 2);
  assert.equal(getInboxTypeLabel(rows[0]).channelLabel, null);
  assert.match(getInboxTypeLabel(rows[0]).text, /^DM from /);
});

test("thread activity rows use the channel list when feed channelName is blank", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          category: "activity",
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups are represented by the latest reply rather than the root", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          content: "Original thread starter",
          createdAt: 1,
        }),
        item({
          id: "reply-event",
          category: "activity",
          content: "New reply in the thread",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.id, "reply-event");
  assert.equal(inboxItem.preview, "New reply in the thread");
  assert.deepEqual(
    inboxItem.groupItems.map((groupItem) => groupItem.id),
    ["root-event", "reply-event"],
  );
  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups use the latest row label even when the root was a mention", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [
        item({
          id: "root-event",
          category: "mention",
          content: "Original mention",
          createdAt: 1,
        }),
      ],
      activity: [
        item({
          id: "reply-event",
          category: "activity",
          content: "New reply in the thread",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.id, "reply-event");
  assert.deepEqual(
    inboxItem.groupItems.map((groupItem) => groupItem.id),
    ["root-event", "reply-event"],
  );
  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups resume at the oldest unread reply", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          category: "activity",
          content: "Already read reply",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          category: "activity",
          content: "First unread reply",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
        item({
          id: "reply-3",
          category: "activity",
          content: "Newest unread reply",
          createdAt: 3,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-2", "", "reply"],
          ],
        }),
      ],
    }),
    getThreadReadAt: (rootId) => (rootId === "root-event" ? 1 : null),
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.preview, "First unread reply");
  assert.equal(inboxItem.latestActivityAt, 3);
  assert.equal(inboxItem.unreadCount, 2);
});

test("thread groups skip an individually read reply when choosing the resume point", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
      ],
    }),
    getMessageReadAt: (messageId) => (messageId === "reply-1" ? 1 : null),
    getThreadReadAt: () => null,
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.unreadCount, 1);
});

test("thread groups follow per-message unread state when the aggregate thread marker is newer", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
      ],
    }),
    getMessageReadAt: (messageId) => (messageId === "reply-1" ? 1 : null),
    getThreadReadAt: () => 2,
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.unreadCount, 1);
});

test("conversationId is stable when a live reply advances the representative", () => {
  // Simulate initial feed: thread root is the latest item.
  const before = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
      ],
    }),
  });

  assert.equal(before.length, 1);
  const conversationIdBefore = before[0].conversationId;

  // Simulate live reply arriving — root-event is now no longer the latest.
  const after = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: "reply-event",
          category: "activity",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(after.length, 1);
  // The conversation is still the same group — conversationId must be stable.
  assert.equal(after[0].conversationId, conversationIdBefore);
  // Representative is now the reply (latest by createdAt).
  assert.equal(after[0].id, "reply-event");
});

test("conversationId equals the thread root event id when a root tag is present", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-event",
          category: "activity",
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.conversationId, "root-event");
});

test("conversationId falls back to event id for a top-level item with no thread tags", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [
        item({
          id: "top-level-event",
          category: "mention",
          tags: [["h", CHANNEL_ID]],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.conversationId, "top-level-event");
  assert.equal(inboxItem.id, "top-level-event");
});

test("getInboxConversationId uses root tag when present", () => {
  const tags = [
    ["h", CHANNEL_ID],
    ["e", "root-event", "", "root"],
    ["e", "parent-event", "", "reply"],
  ];

  assert.equal(getInboxConversationId(tags, "reply-event"), "root-event");
});

test("getInboxConversationId falls back to eventId when no root tag", () => {
  const tags = [["h", CHANNEL_ID]];

  assert.equal(
    getInboxConversationId(tags, "top-level-event"),
    "top-level-event",
  );
});

test("old event still resolves to its conversation row via groupItems", () => {
  // Demonstrates that findItemByEventId searching groupItems works: the old
  // root event id is still present in groupItems even when a newer reply
  // becomes the representative.
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: "reply-event",
          category: "activity",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  // The representative is the reply, but the root is still in groupItems.
  assert.equal(inboxItem.id, "reply-event");
  assert.ok(
    inboxItem.groupItems.some((groupItem) => groupItem.id === "root-event"),
    "root-event should be in groupItems",
  );
});

// ── nested-anchor retention: feed advance must not lose the anchor ───────────

test("nested-anchor: old selected event stays resolvable by conversationId after representative advances", () => {
  // Scenario: user selected "reply-1" (a non-root reply) as the anchor.
  // A new deeper reply arrives and becomes the new representative.
  // The feed now contains only "reply-2" (the new representative) plus the
  // root. "reply-1" has been displaced from the live feed window.
  //
  // Properties that must hold after the feed advance:
  //   1. The conversationId derived from the LATCHED anchor's tags matches
  //      the conversationId of the surviving InboxItem (so row stays selected).
  //   2. The surviving InboxItem is resolvable by that conversationId.
  //   3. The anchor event id ("reply-1") is NOT in the new groupItems —
  //      confirming the eviction we're testing against.

  const ROOT_ID = "root-event";
  const ANCHOR_EVENT_ID = "reply-1"; // what the user clicked
  const LATEST_EVENT_ID = "reply-2"; // new representative after feed advance

  // Build inboxItems from the feed AFTER the advance (reply-1 is gone).
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: ROOT_ID,
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: LATEST_EVENT_ID,
          category: "activity",
          createdAt: 3,
          tags: [
            ["h", CHANNEL_ID],
            ["e", ROOT_ID, "", "root"],
            ["e", ANCHOR_EVENT_ID, "", "reply"],
          ],
        }),
        // reply-1 is intentionally absent — it has been evicted.
      ],
    }),
  });

  // Property 3: anchor event is NOT in the new groupItems.
  assert.ok(
    !inboxItem.groupItems.some((gi) => gi.id === ANCHOR_EVENT_ID),
    "evicted anchor must not be in groupItems after feed advance",
  );

  // Property 1: conversationId derived from the latched anchor's tags
  // (what HomeView computes as latchedConversationId) equals the surviving
  // InboxItem's conversationId.
  const anchorTags = [
    ["h", CHANNEL_ID],
    ["e", ROOT_ID, "", "root"],
    ["e", "some-parent", "", "reply"],
  ];
  const latchedConversationId = getInboxConversationId(
    anchorTags,
    ANCHOR_EVENT_ID,
  );
  assert.equal(
    latchedConversationId,
    inboxItem.conversationId,
    "latchedConversationId must match the surviving InboxItem's conversationId",
  );

  // Property 2: the surviving row is resolvable by that conversationId.
  assert.equal(inboxItem.conversationId, ROOT_ID);
  assert.equal(latchedConversationId, ROOT_ID);

  // The new representative is the latest reply.
  assert.equal(inboxItem.id, LATEST_EVENT_ID);
});
